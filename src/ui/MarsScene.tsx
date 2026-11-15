/** One-take Mars approach: a true-scale Viking globe under the same camera that
 * frames the loaded region. No second canvas and no cut — the camera descends
 * in five staged pushes (with short holds, like map tiles resolving) while the
 * globe fades into the terrain.
 *
 * Locations come from public/data/missions.json. An entry with a terrain
 * package can be entered; the others are drawn as future mission areas. The
 * active package's lat/lon bounds decide how the globe is oriented, so adding
 * another package with its own bounds is all it takes to make its pin real.
 *
 * The globe can be dragged to rotate in the orbit state; it recentres during
 * the first moments of the dive. Display context only: nothing here feeds
 * routing, timing or resources.
 */

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
import { RegionalPlane } from "./RegionalPlane.js";

const GLOBE_TEXTURE = "/data/mars/viking_mdim21_color_3840.jpg";
/** true Mars radius in metres: the globe and the terrain share one scale */
export const MARS_RADIUS = 3396190;
export const MARS_ORBIT_DIST = MARS_RADIUS * 3.0;
/** oblique start: 29° off the pole, 34° of azimuth, like holding a globe */
const ORBIT_POLAR = 0.5;
const ORBIT_AZIMUTH = 0.6;
export const MARS_CENTRE = new THREE.Vector3(0, -MARS_RADIUS, 0);
/** MDIM 2.1 is a 0–360 east product displayed from 180°W */
const LON_ORIGIN_DEG = 180;
/** five zoom levels with a short hold at each one, like tiles resolving */
export const DIVE_STAGES = 3;
const HOLD_SEC = 0.18;
const DIVE_SECONDS = 4.8;
const SEG_SEC = (DIVE_SECONDS - HOLD_SEC * (DIVE_STAGES - 1)) / DIVE_STAGES;
const EASE = (x: number): number => x * x * (3 - 2 * x);
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};
const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY = new THREE.Quaternion();

/** 0..1 staged progress: each segment eases, then holds before the next push */
function stagedProgress(elapsed: number): number {
  let t = elapsed;
  for (let i = 0; i < DIVE_STAGES; i++) {
    if (t < SEG_SEC) return (i + EASE(t / SEG_SEC)) / DIVE_STAGES;
    t -= SEG_SEC;
    if (i < DIVE_STAGES - 1) {
      if (t < HOLD_SEC) return (i + 1) / DIVE_STAGES;
      t -= HOLD_SEC;
    }
  }
  return 1;
}

export type MarsPhase = "orbit" | "dive" | "off";

/** lat/lon -> point on the sphere, matching Three's SphereGeometry UV layout */
function latLonToPoint(latDeg: number, lonDeg: number, r: number): THREE.Vector3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = ((lonDeg + LON_ORIGIN_DEG) * Math.PI) / 180;
  return new THREE.Vector3(
    -r * Math.cos(lat) * Math.cos(lon),
    r * Math.sin(lat),
    r * Math.cos(lat) * Math.sin(lon),
  );
}

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

export function MarsScene({
  pkg,
  missions,
  activeMissionId,
  phase,
  onPick,
  onUnavailable,
  onStage,
  onDiveDone,
}: {
  pkg: LoadedPackage;
  missions: MissionLocation[];
  activeMissionId: string;
  phase: MarsPhase;
  onPick: (id: string) => void;
  onUnavailable: (id: string) => void;
  /** 1-based zoom level while diving, for the loading readout */
  onStage: (stage: number) => void;
  onDiveDone: () => void;
}): JSX.Element {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const gl = useThree((state) => state.gl);
  const texture = useTexture(GLOBE_TEXTURE);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const normalMap = useTexture("/data/mars/mars_normal_1024.png");
  normalMap.colorSpace = THREE.NoColorSpace;
  // stable uniforms: a fresh object each render would reset the fade
  const hazeUniforms = useMemo(() => ({ uOpacity: { value: 1 } }), []);
  const globeUniforms = useMemo(
    () => ({
      uMap: { value: texture },
      uNormal: { value: normalMap },
      uSun: { value: SUN_DIR.clone() },
      uOpacity: { value: 1 },
    }),
    [texture, normalMap],
  );

  const t = useMemo(() => worldTransform(pkg.terrain), [pkg]);
  // the loaded package defines where the globe must point: its centre is the
  // point under the camera, and the terrain plate is tangent there
  const lat = (pkg.region.boundsLatLon.north + pkg.region.boundsLatLon.south) / 2;
  const lon = (pkg.region.boundsLatLon.east + pkg.region.boundsLatLon.west) / 2;
  const normal = useMemo(() => latLonToPoint(lat, lon, 1).normalize(), [lat, lon]);
  const spin = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(normal, UP),
    [normal],
  );

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
  const dive = useRef<{
    elapsed: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromT: THREE.Vector3;
    toT: THREE.Vector3;
    dist0: number;
    dist1: number;
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
      const d = camera.position.distanceTo(MARS_CENTRE);
      const f = rect.height / 2 / Math.tan((camera.fov * Math.PI) / 360);
      const pr = Math.max(1, (f * MARS_RADIUS) / Math.sqrt(Math.max(d * d - MARS_RADIUS * MARS_RADIUS, 1)));
      let x = (e.clientX - (rect.left + rect.width / 2)) / pr;
      let y = (e.clientY - (rect.top + rect.height / 2)) / pr;
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      return new THREE.Vector3(x, -y, Math.sqrt(Math.max(1 - x * x - y * y, 0))).normalize();
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
      const k = Math.exp(e.deltaY * 0.0012);
      zoom.current.target = Math.min(
        Math.max(zoom.current.target * k, MARS_RADIUS * 1.35),
        MARS_RADIUS * 4.2,
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
  }, [phase, camera]);

  // ---- camera: dive to the loaded region ---------------------------------
  useEffect(() => {
    if (phase !== "dive") return;
    const end = overviewPose(t, 400);
    const from = camera.position.clone();
    const fromT = new THREE.Vector3(0, 0, 0);
    const to = new THREE.Vector3(end.position.x, end.position.y, end.position.z);
    const toT = new THREE.Vector3(end.target.x, end.target.y, end.target.z);
    dive.current = {
      elapsed: 0,
      from,
      to,
      fromT,
      toT,
      dist0: from.distanceTo(fromT),
      dist1: to.distanceTo(toT),
      done: false,
    };
  }, [phase, t, camera]);

  useFrame((_, delta) => {
    if (phase === "orbit") {
      const z = zoom.current;
      z.current += (z.target - z.current) * (1 - Math.exp(-delta * 9));
      camera.position.copy(orbitDir.current).multiplyScalar(z.current).add(MARS_CENTRE);
      camera.lookAt(MARS_CENTRE);
      setClip(camera, z.current);

    }
    if (center.current !== null) center.current.quaternion.copy(dragQ.current);
    const d = dive.current;
    if (phase === "dive" && d !== null && !d.done) {
      d.elapsed = Math.min(DIVE_SECONDS, d.elapsed + delta);
      const k = stagedProgress(d.elapsed);
      // bring the clicked mission back under the camera as we leave
      dragQ.current.slerp(IDENTITY, 1 - Math.exp(-delta * 7));

      const dist = Math.exp(Math.log(d.dist0) + (Math.log(d.dist1) - Math.log(d.dist0)) * k);
      // the path is anchored on the surface point, so the camera never enters
      // the globe; the look target swings from the globe centre (the orbit
      // view) to the terrain over the first 30% of the dive
      const look = MARS_CENTRE.clone().lerp(d.toT, smoothstep(0, 0.3, k));
      const dir = d.from
        .clone()
        .sub(d.fromT)
        .normalize()
        .lerp(d.to.clone().sub(d.fromT).normalize(), smoothstep(0.1, 0.98, k))
        .normalize();
      camera.position.copy(d.fromT).addScaledVector(dir, dist);
      camera.lookAt(look);
      setClip(camera, dist);
      // the globe gives way to the raw data grid before the texture blurs
      opacity.current = smoothstep(Math.log(30000), Math.log(70000), Math.log(dist));

      const stage = Math.min(DIVE_STAGES, Math.floor(k * DIVE_STAGES) + 1);
      if (stage !== stageRef.current) {
        stageRef.current = stage;
        onStage(stage);
      }
      if (d.elapsed >= DIVE_SECONDS) {
        d.done = true;
        onDiveDone();
      }
    }

    const mat = globeMat.current;
    if (mat !== null) {
      const o = opacity.current;
      (mat.uniforms.uOpacity as { value: number }).value = o;
      mat.visible = o > 0.01;
      if (hazeMat.current !== null) {
        (hazeMat.current.uniforms.uOpacity as { value: number }).value = o;
        hazeMat.current.visible = o > 0.01;
      }
      if (globeGroup.current !== null) globeGroup.current.visible = o > 0.01;
    }
  });

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
      <SpaceBackdrop orientation={dragQ} />
      <RegionalPlane />
      <group ref={center} position={[0, -MARS_RADIUS, 0]} name="mars-globe">
        <group ref={globeGroup} quaternion={spin}>
          <mesh ref={globeMesh}>
            <sphereGeometry args={[MARS_RADIUS, 192, 128]} />
            <shaderMaterial
              ref={globeMat}
              uniforms={globeUniforms}
              transparent
              fog={false}
              toneMapped={false}
              vertexShader={/* glsl */ `
                varying vec2 vUv;
                varying vec3 vN;
                varying vec3 vP;
                void main() {
                  vUv = uv;
                  vN = normalize(mat3(modelMatrix) * normal);
                  vec4 wp = modelMatrix * vec4(position, 1.0);
                  vP = wp.xyz;
                  gl_Position = projectionMatrix * viewMatrix * wp;
                }
              `}
              fragmentShader={/* glsl */ `
                varying vec2 vUv;
                varying vec3 vN;
                varying vec3 vP;
                uniform sampler2D uMap;
                uniform sampler2D uNormal;
                uniform vec3 uSun;
                uniform float uOpacity;

                void main() {
                  vec3 base = texture2D(uMap, vUv).rgb;
                  // keep the photo, just a little richer
                  base = mix(vec3(dot(base, vec3(0.299, 0.587, 0.114))), base, 1.12) * 1.04;
                  vec3 N = normalize(vN);
                  vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N));
                  vec3 B = normalize(cross(N, T));
                  vec3 nm = texture2D(uNormal, vUv).rgb * 2.0 - 1.0;
                  vec3 Nw = normalize(T * nm.x + B * nm.y + N * nm.z);

                  vec3 V = normalize(cameraPosition - vP);
                  float ndl = dot(Nw, normalize(uSun));
                  float day = smoothstep(-0.55, 0.5, ndl);
                  // a soft camera-side fill keeps the visible face readable
                  // while the terminator stays on the limb
                  float fill = 0.5 + 0.5 * dot(Nw, V);
                  vec3 col = base * (0.10 + 1.0 * day + 0.55 * fill);

                  vec3 H = normalize(normalize(uSun) + V);
                  float spec = pow(max(dot(Nw, H), 0.0), 28.0) * 0.05 * day;
                  col += vec3(1.0, 0.82, 0.66) * spec;

                  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
                  col += vec3(1.0, 0.5, 0.26) * fres * 0.10;

                  gl_FragColor = vec4(col, uOpacity);
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
            pins.map(({ mission, pos }) => {
              const available = mission.package === true;
              const active = mission.id === activeMissionId;
              return (
                <Html
                  key={mission.id}
                  position={[pos.x, pos.y, pos.z]}
                  center
                  occlude={[globeMesh]}
                  zIndexRange={[40, 40]}
                  style={{ pointerEvents: "auto" }}
                >
                  <button
                    type="button"
                    className={`mars-pin${available ? "" : " is-dim"}${active ? " is-active" : ""}`}
                    onClick={() => (available ? onPick(mission.id) : onUnavailable(mission.id))}
                  >
                    <b>{mission.name}</b>
                    <span>{available ? mission.label : `${mission.label} · no package`}</span>
                  </button>
                </Html>
              );
            })}
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
