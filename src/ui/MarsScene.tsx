/** Continuous Mars → regional imagery → local 3D terrain approach. */

import { useEffect, useMemo, useRef } from "react";
import type { JSX } from "react";
import { Html, useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { LoadedPackage } from "../domain/load.js";
import type { MissionLocation } from "../domain/missions.js";
import { overviewPose, worldTransform } from "../domain/world.js";
import type { Lang } from "./i18n.js";
import { SpaceBackdrop } from "./SpaceBackdrop.js";
import { SUN_DIR } from "./SceneDressing.js";
import { MARS_RADIUS, MARS_CENTRE, DIVE_SECONDS, smoothstep, smootherstep, latLonToPoint, globeOrientation, approachStage, approachPose, approachPlaybackRate, globeSurfaceGrade } from "./marsApproach.js";
export { MARS_RADIUS, MARS_CENTRE } from "./marsApproach.js";

const GLOBE_TEXTURE = "/data/mars/viking_mdim21_color_3840.jpg";
/** true Mars radius in metres: the globe and the terrain share one scale */

export const MARS_ORBIT_DIST = MARS_RADIUS * 3.0;
/** oblique start: 29° off the pole, 34° of azimuth, like holding a globe */
const ORBIT_POLAR = 0.5;
const ORBIT_AZIMUTH = 0.6;

export const DIVE_STAGES = 3;
const IDENTITY = new THREE.Quaternion();

export type MarsPhase = "orbit" | "dive" | "off";

/** near/far follow the dive: a 1e4 depth ratio at every altitude, no log buffer */
function setClip(camera: THREE.PerspectiveCamera, dist: number): void {
  const near = Math.min(Math.max(dist * 0.006, 50), 120000);
  const far = Math.max(dist * 2.4, 45000);
  if (camera.near !== near || camera.far !== far) {
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}

function MarsPin({
  mission,
  pos,
  active,
  onPick,
  onUnavailable,
  dragQ,
  spin,
}: {
  mission: MissionLocation;
  pos: THREE.Vector3;
  active: boolean;
  onPick: (id: string) => void;
  onUnavailable: (id: string) => void;
  dragQ: React.MutableRefObject<THREE.Quaternion>;
  spin: THREE.Quaternion;
}): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const camera = useThree((s) => s.camera);
  const pinDir = useRef(new THREE.Vector3());
  const camDir = useRef(new THREE.Vector3());
  const lastVis = useRef(true);

  useFrame(() => {
    // pin direction from Mars center in world space:
    pinDir.current.copy(pos).applyQuaternion(spin).applyQuaternion(dragQ.current);
    camDir.current.copy(camera.position).sub(MARS_CENTRE);
    const isFront = pinDir.current.dot(camDir.current) > 0;
    if (isFront !== lastVis.current) {
      lastVis.current = isFront;
      if (wrapRef.current) {
        wrapRef.current.style.display = isFront ? "block" : "none";
      }
    }
  });

  const available = mission.package === true;

  return (
    <Html position={[pos.x, pos.y, pos.z]} center zIndexRange={[40, 40]}>
      <div ref={wrapRef} style={{ pointerEvents: "auto" }}>
        <button
          type="button"
          className={`mars-pin${available ? "" : " is-dim"}${active ? " is-active" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            if (available) onPick(mission.id);
            else onUnavailable(mission.id);
          }}
        >
          <b>{mission.name}</b>
          <span>{available ? mission.label : `${mission.label} · no package`}</span>
        </button>
      </div>
    </Html>
  );
}

export function MarsScene({
  surfaceGroup,
  pkg,
  missions,
  activeMissionId,
  phase,
  onPick,
  onUnavailable,
  onStage,
  onDiveDone,
}: {
  surfaceGroup: React.RefObject<THREE.Group | null>;
  pkg: LoadedPackage;
  missions: MissionLocation[];
  activeMissionId: string;
  phase: MarsPhase;
  onPick: (id: string) => void;
  onUnavailable: (id: string) => void;
  /** 1-based zoom level while diving, for the loading readout */
  onStage: (stage: number, progress?: number, dist?: number) => void;
  onDiveDone: () => void;
}): JSX.Element {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const gl = useThree((state) => state.gl);
  const texture = useTexture(GLOBE_TEXTURE);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const normalMap = useTexture("/data/mars/mars_normal_1024.png");
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = 8;
  // stable uniforms: a fresh object each render would reset the fade
  const hazeUniforms = useMemo(() => ({ uOpacity: { value: 1 } }), []);
  const globeUniforms = useMemo(
    () => ({
      uMap: { value: texture },
      uNormal: { value: normalMap },
      uSun: { value: SUN_DIR.clone() },
      uOpacity: { value: 1 },
      uSurfaceGrade: { value: 0 },
    }),
    [texture, normalMap],
  );

  const t = useMemo(() => worldTransform(pkg.terrain), [pkg]);
  // the loaded package defines where the globe must point: its centre is the
  // point under the camera, and the terrain plate is tangent there
  const lat = (pkg.region.boundsLatLon.north + pkg.region.boundsLatLon.south) / 2;
  const lon = (pkg.region.boundsLatLon.east + pkg.region.boundsLatLon.west) / 2;
  const spin = useMemo(() => globeOrientation(lat, lon), [lat, lon]);

  const skyMesh = useRef<THREE.Mesh>(null);
  const globeMat = useRef<THREE.ShaderMaterial | null>(null);
  const hazeMat = useRef<THREE.ShaderMaterial | null>(null);
  const center = useRef<THREE.Group | null>(null);
  const globeGroup = useRef<THREE.Group | null>(null);
  const globeMesh = useRef<THREE.Mesh>(null!);
  const opacity = useRef(1);
  const dragQ = useRef(new THREE.Quaternion());
  const zoom = useRef({ current: MARS_ORBIT_DIST, target: MARS_ORBIT_DIST });
  const orbitDir = useRef(new THREE.Vector3(0, 1, 0));
  const stageRef = useRef(-1);
  const telemetryTime = useRef(0);
  const dive = useRef<{
    elapsed: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    toT: THREE.Vector3;
    initialDragQ: THREE.Quaternion;
    done: boolean;
  } | null>(null);

  const pins = useMemo(
    () =>
      missions.map((m) => ({
        mission: m,
        pos: latLonToPoint(m.lat, m.lon, 1).normalize().multiplyScalar(MARS_RADIUS * 1.004),
      })),
    [missions],
  );

  // ---- trackball: drag the globe itself, in any direction -----------------
  useEffect(() => {
    if (phase !== "orbit") return;
    const el = gl.domElement;
    el.style.cursor = "grab";
    let active = false;
    const v0 = new THREE.Vector3(0, 0, 1);
    const v1 = new THREE.Vector3();
    const axis = new THREE.Vector3();

    const ball = (e: PointerEvent): THREE.Vector3 => {
      const rect = el.getBoundingClientRect();
      const r = Math.min(rect.width, rect.height) * 0.45;
      const x = (e.clientX - (rect.left + rect.width / 2)) / r;
      const y = (e.clientY - (rect.top + rect.height / 2)) / r;
      const d2 = x * x + y * y;
      // hyperbolic roll off outer edge ensures zero sticking or locking when dragging outside the disk
      const z = d2 <= 0.5 ? Math.sqrt(1.0 - d2) : 0.5 / Math.sqrt(d2);
      return new THREE.Vector3(x, -y, z).normalize();
    };

    const down = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      active = true;
      v0.copy(ball(e));
      el.style.cursor = "grabbing";
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent): void => {
      if (!active) return;
      v1.copy(ball(e));
      const dot = Math.min(Math.max(v0.dot(v1), -1), 1);
      const angle = Math.acos(dot);
      if (angle > 1e-4) {
        axis.crossVectors(v0, v1).normalize().applyQuaternion(camera.quaternion);
        const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
        dragQ.current.premultiply(q);
      }
      v0.copy(v1);
    };
    const up = (e: PointerEvent): void => {
      if (!active) return;
      active = false;
      el.style.cursor = "grab";
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      // normalise line/page deltas: some wheels report 3 instead of ~120
      const d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const k = Math.exp(d * 0.0015);
      zoom.current.target = Math.min(
        Math.max(zoom.current.target * k, MARS_RADIUS * 1.15),
        MARS_RADIUS * 3.8,
      );
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("wheel", wheel);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.style.cursor = "";
    };
  }, [phase, gl, camera]);

  // ---- camera: orbit pose -------------------------------------------------
  useEffect(() => {
    if (phase !== "orbit") return;
    camera.position.set(
      Math.sin(ORBIT_POLAR) * Math.sin(ORBIT_AZIMUTH) * MARS_ORBIT_DIST,
      MARS_CENTRE.y + Math.cos(ORBIT_POLAR) * MARS_ORBIT_DIST,
      Math.sin(ORBIT_POLAR) * Math.cos(ORBIT_AZIMUTH) * MARS_ORBIT_DIST,
    );
    orbitDir.current
      .set(
        Math.sin(ORBIT_POLAR) * Math.sin(ORBIT_AZIMUTH),
        Math.cos(ORBIT_POLAR),
        Math.sin(ORBIT_POLAR) * Math.cos(ORBIT_AZIMUTH),
      )
      .normalize();
    zoom.current.current = MARS_ORBIT_DIST;
    zoom.current.target = MARS_ORBIT_DIST;
    dragQ.current.identity();
    camera.up.set(0, 1, 0);
    camera.lookAt(MARS_CENTRE);
    setClip(camera, MARS_ORBIT_DIST);
    opacity.current = 1;
    dive.current = null;
    stageRef.current = -1;
    telemetryTime.current = 0;
  }, [phase, camera]);

  // ---- camera: dive to the loaded region ---------------------------------
  useEffect(() => {
    if (phase !== "dive") return;
    const end = overviewPose(t, 400);
    const from = camera.position.clone();
    const to = new THREE.Vector3(end.position.x, end.position.y, end.position.z);
    const toT = new THREE.Vector3(end.target.x, end.target.y, end.target.z);
    dive.current = {
      elapsed: 0,
      from,
      to,
      toT,
      initialDragQ: dragQ.current.clone(),
      done: false,
    };
  }, [phase, t, camera]);

  useFrame((_, delta) => {
    const mat = globeMat.current;
    if (phase === "orbit") {
      const z = zoom.current;
      // clamp the frame delta: a React re-render hitch must not become a zoom
      // jump (the old 250 ms HUD tick caused exactly that)
      const dt = Math.min(delta, 1 / 30);
      z.current += (z.target - z.current) * (1 - Math.exp(-dt * 9));
      camera.position.copy(orbitDir.current).multiplyScalar(z.current).add(MARS_CENTRE);
      camera.lookAt(MARS_CENTRE);
      setClip(camera, z.current);
    }
    if (center.current !== null) center.current.quaternion.copy(dragQ.current);
    const d = dive.current;
    if (phase === "dive" && d !== null && !d.done) {
      // A stalled frame must not skip over an entire geographical scale.
      d.elapsed = Math.min(DIVE_SECONDS, d.elapsed + Math.min(delta, 1 / 30) * approachPlaybackRate(d.elapsed / DIVE_SECONDS));
      const progress = d.elapsed / DIVE_SECONDS;
      dragQ.current.copy(d.initialDragQ).slerp(IDENTITY, smootherstep(progress / 0.35));
      if (center.current) center.current.quaternion.copy(dragQ.current);
      const pose = approachPose(d.from, d.to, d.toT, progress);
      camera.position.copy(pose.position);
      camera.lookAt(pose.target);
      setClip(camera, pose.distance);
      opacity.current = smoothstep(Math.log(18000), Math.log(65000), Math.log(camera.position.length()));
      // Keep React/HUD work out of most animation frames.
      const stage = approachStage(camera.position.length());
      if (stage !== stageRef.current || d.elapsed - telemetryTime.current >= 0.1 || progress === 1) {
        stageRef.current = stage;
        telemetryTime.current = d.elapsed;
        onStage(stage, progress, pose.distance);
      }

      if (d.elapsed >= DIVE_SECONDS) {
        d.done = true;
        onDiveDone();
      }
    }

    // Terrain and its regional surround share the globe's rigid transform.
    // Geometry remains fixed; cosmetic context fading never changes its pose.
    const surface = surfaceGroup.current;
    if (surface) {
      const q = phase === "off" ? IDENTITY : dragQ.current;
      surface.quaternion.copy(q);
      surface.position.copy(MARS_CENTRE).sub(MARS_CENTRE.clone().applyQuaternion(q));
    }

    if (mat !== null) {
      const o = opacity.current;
      (mat.uniforms.uOpacity as { value: number }).value = o;
      (mat.uniforms.uSurfaceGrade as { value: number }).value = globeSurfaceGrade(camera.position.length());
      mat.visible = o > 0.01;
      if (hazeMat.current !== null) {
        (hazeMat.current.uniforms.uOpacity as { value: number }).value = o;
        hazeMat.current.visible = o > 0.01;
      }
      if (globeGroup.current !== null) globeGroup.current.visible = o > 0.01;
    }

    // the sky must follow the camera *after* this frame's zoom/rotation update;
    // doing it in the backdrop's own useFrame lags a frame and makes the stars
    // slide during a zoom, then snap back when it stops
    const sm = skyMesh.current;
    if (sm !== null) {
      sm.position.copy(camera.position);
      sm.quaternion.copy(dragQ.current);
      const r = Math.max(camera.near * 2.5 + 400, 2000);
      sm.scale.setScalar(Math.min(r, camera.far * 0.6));

      const mat = sm.material as THREE.ShaderMaterial | undefined;
      if (mat?.uniforms?.uZoom) {
        if (phase === "orbit") {
          const k = (MARS_ORBIT_DIST - zoom.current.current) / (MARS_ORBIT_DIST - MARS_RADIUS * 1.15);
          // subtle zoom: up to +10% magnification at closest zoom, smoothly linked without stutter
          (mat.uniforms.uZoom as { value: number }).value =
            1.0 + Math.max(-0.06, Math.min(0.12, k * 0.1));
        } else if (phase === "dive" && d !== null) {
          const diveProgress = Math.min(1, d.elapsed / (DIVE_SECONDS * 0.6));
          (mat.uniforms.uZoom as { value: number }).value = 1.08 + diveProgress * 0.07;
        } else {
          (mat.uniforms.uZoom as { value: number }).value = 1.1;
        }
      }
    }
  }, -2);

  // leaving the stage restores the terrain's clip planes (skip from orbit)
  useEffect(() => {
    if (phase !== "off") return;
    camera.near = 50;
    camera.far = 45000;
    camera.updateProjectionMatrix();
  }, [phase, camera]);

  const pinsVisible = phase === "orbit";

  return (
    <>
      {phase !== "off" && <SpaceBackdrop meshRef={skyMesh} />}
      <group ref={center} position={[0, -MARS_RADIUS, 0]} name="mars-globe" visible={phase !== "off"}>
        <group ref={globeGroup} quaternion={spin}>
          <mesh ref={globeMesh}>
            <sphereGeometry args={[MARS_RADIUS, 192, 128]} />
            <shaderMaterial
              ref={globeMat}
              uniforms={globeUniforms}
              transparent
              depthWrite={false}
              fog={false}
              toneMapped
              vertexShader={/* glsl */ `
                varying vec2 vUv;
                varying vec3 vN;
                varying vec3 vT;
                varying vec3 vB;
                varying vec3 vP;
                void main() {
                  vUv = uv;
                  vec3 objN = normalize(position);
                  vec3 objT = normalize(vec3(-position.z, 0.0, position.x));
                  if (abs(position.y) > 3396000.0) {
                    objT = vec3(1.0, 0.0, 0.0);
                  }
                  vec3 objB = cross(objN, objT);

                  vN = normalize(mat3(modelMatrix) * objN);
                  vT = normalize(mat3(modelMatrix) * objT);
                  vB = normalize(mat3(modelMatrix) * objB);

                  vec4 wp = modelMatrix * vec4(position, 1.0);
                  vP = wp.xyz;
                  gl_Position = projectionMatrix * viewMatrix * wp;
                }
              `}
              fragmentShader={/* glsl */ `
                varying vec2 vUv;
                varying vec3 vN;
                varying vec3 vT;
                varying vec3 vB;
                varying vec3 vP;
                uniform sampler2D uMap;
                uniform sampler2D uNormal;
                uniform vec3 uSun;
                uniform float uOpacity;
                uniform float uSurfaceGrade;

                void main() {
                  vec3 base = texture2D(uMap, vUv).rgb;
                  // The global map is colourized; CTX is monochrome. Approach
                  // the local warm-grey palette gradually, keeping photo detail.
                  float luma = dot(base, vec3(0.2126, 0.7152, 0.0722));
                  vec3 orbital = mix(vec3(luma), base, 0.85);
                  vec3 surface = vec3(luma) * vec3(1.08, 1.0, 0.94);
                  base = mix(orbital, surface, uSurfaceGrade * 0.88);

                  vec3 nm = texture2D(uNormal, vUv).rgb * 2.0 - 1.0;
                  // deep, crisp relief on craters, valleys and surface features
                  vec3 Nw = normalize(vT * nm.x * 2.2 + vB * nm.y * 2.2 + vN * nm.z);

                  vec3 V = normalize(cameraPosition - vP);
                  float ndl = dot(Nw, normalize(uSun));
                  float day = smoothstep(-0.55, 0.5, ndl);
                  // a soft camera-side fill keeps the visible face readable
                  // while the terminator stays on the limb
                  float fill = 0.5 + 0.5 * dot(Nw, V);
                  float light = 0.18 + 0.65 * day + 0.38 * fill;
                  vec3 col = base * mix(light, 1.0, uSurfaceGrade * 0.6);

                  vec3 H = normalize(normalize(uSun) + V);
                  float spec = pow(max(dot(Nw, H), 0.0), 28.0) * 0.05 * day;
                  col += vec3(1.0, 0.82, 0.66) * spec;

                  float fres = pow(1.0 - max(dot(vN, V), 0.0), 4.0);
                  col += vec3(1.0, 0.5, 0.26) * fres * 0.10;

                  gl_FragColor = vec4(col, uOpacity);
                  #include <tonemapping_fragment>
                  #include <colorspace_fragment>
                }
              `}
            />
          </mesh>
          <mesh scale={1.004}>
            <sphereGeometry args={[MARS_RADIUS, 64, 48]} />
            <shaderMaterial
              ref={hazeMat}
              side={THREE.BackSide}
              transparent
              depthWrite={false}
              fog={false}
              blending={THREE.AdditiveBlending}
              uniforms={hazeUniforms}
              vertexShader={/* glsl */ `
                varying vec3 vN;
                varying vec3 vV;
                void main() {
                  vec4 mv = modelViewMatrix * vec4(position, 1.0);
                  vN = normalize(normalMatrix * normal);
                  vV = normalize(-mv.xyz);
                  gl_Position = projectionMatrix * mv;
                }
              `}
              fragmentShader={/* glsl */ `
                varying vec3 vN;
                varying vec3 vV;
                uniform float uOpacity;
                void main() {
                  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
                  gl_FragColor = vec4(vec3(1.0, 0.5, 0.24) * rim * 0.5 * uOpacity, rim * 0.5 * uOpacity);
                }
              `}
            />
          </mesh>

          {pinsVisible &&
            pins.map(({ mission, pos }) => (
              <MarsPin
                key={mission.id}
                mission={mission}
                pos={pos}
                active={mission.id === activeMissionId}
                onPick={onPick}
                onUnavailable={onUnavailable}
                dragQ={dragQ}
                spin={spin}
              />
            ))}
        </group>
      </group>
    </>
  );
}

/** Console hint shared by the Mars HUD. */
export function marsHint(lang: Lang, available: number, total: number): string {
  if (lang === "zh") {
    return `任意方向拖动星球 · 滚轮缩放 · 选择任务地点（${available}/${total} 个有地形数据）`;
  }
  return `Drag the globe in any direction · scroll to zoom · pick a mission area (${available} of ${total} with terrain)`;
}
