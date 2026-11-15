/** One-take Mars approach: a true-scale Viking globe under the same camera that
 * frames the loaded region. No second canvas and no cut — the camera descends
 * along a log-distance path while the globe fades into the terrain.
 *
 * Locations come from public/data/missions.json. An entry with a terrain
 * package can be entered; the others are drawn as future mission areas. The
 * active package's lat/lon bounds decide how the globe is oriented, so adding
 * another package with its own bounds is all it takes to make its pin real.
 *
 * Display context only: nothing here feeds routing, timing or resources.
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

const GLOBE_TEXTURE = "/data/mars/viking_mdim21_color_2048.jpg";
/** true Mars radius in metres: the globe and the terrain share one scale */
export const MARS_RADIUS = 3396190;
export const MARS_ORBIT_DIST = MARS_RADIUS * 2.35;
/** slightly off-axis so lookAt is not degenerate and the limb reads */
export const MARS_ORBIT_POS: [number, number, number] = [
  MARS_ORBIT_DIST * 0.05,
  MARS_ORBIT_DIST * 0.995,
  MARS_ORBIT_DIST * 0.09,
];
/** MDIM 2.1 is a 0–360 east product displayed from 180°W */
const LON_ORIGIN_DEG = 180;
const DIVE_SECONDS = 6.6;
const EASE = (x: number): number => x * x * (3 - 2 * x);
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

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
  onDiveDone,
}: {
  pkg: LoadedPackage;
  missions: MissionLocation[];
  activeMissionId: string;
  phase: MarsPhase;
  onPick: (id: string) => void;
  onUnavailable: (id: string) => void;
  onDiveDone: () => void;
}): JSX.Element {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const texture = useTexture(GLOBE_TEXTURE);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const t = useMemo(() => worldTransform(pkg.terrain), [pkg]);
  // the loaded package defines where the globe must point: its centre is the
  // point under the camera, and the terrain plate is tangent there
  const lat = (pkg.region.boundsLatLon.north + pkg.region.boundsLatLon.south) / 2;
  const lon = (pkg.region.boundsLatLon.east + pkg.region.boundsLatLon.west) / 2;
  const normal = useMemo(() => latLonToPoint(lat, lon, 1).normalize(), [lat, lon]);
  const spin = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(normal, new THREE.Vector3(0, 1, 0)),
    [normal],
  );

  const globeMat = useRef<THREE.MeshStandardMaterial | null>(null);
  const hazeMat = useRef<THREE.ShaderMaterial | null>(null);
  const globeGroup = useRef<THREE.Group | null>(null);
  const globeMesh = useRef<THREE.Mesh>(null!);
  const opacity = useRef(1);
  const dive = useRef<{
    t: number;
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
      missions.map((m) => {
        const dir = latLonToPoint(m.lat, m.lon, 1).normalize().applyQuaternion(spin);
        return {
          mission: m,
          pos: dir
            .clone()
            .multiplyScalar(MARS_RADIUS * 1.004)
            .add(new THREE.Vector3(0, -MARS_RADIUS, 0)),
        };
      }),
    [missions, spin],
  );

  // ---- camera: orbit pose -------------------------------------------------
  useEffect(() => {
    if (phase !== "orbit") return;
    camera.position.set(MARS_ORBIT_POS[0], MARS_ORBIT_POS[1], MARS_ORBIT_POS[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    setClip(camera, MARS_ORBIT_DIST);
    opacity.current = 1;
    dive.current = null;
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
      t: 0,
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
    const d = dive.current;
    if (phase === "dive" && d !== null && !d.done) {
      d.t = Math.min(1, d.t + delta / DIVE_SECONDS);
      const k = EASE(d.t);
      // log-distance dolly: constant perceived zoom instead of a linear rush
      const dist = Math.exp(Math.log(d.dist0) + (Math.log(d.dist1) - Math.log(d.dist0)) * k);
      const target = d.fromT.clone().lerp(d.toT, smoothstep(0.55, 1, k));
      // camera - target, not the reverse: that vector points up/outward
      const dir = d.from
        .clone()
        .sub(d.fromT)
        .normalize()
        .lerp(d.to.clone().sub(d.toT).normalize(), smoothstep(0.15, 0.98, k))
        .normalize();
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.lookAt(target);
      setClip(camera, dist);
      opacity.current = smoothstep(Math.log(2600), Math.log(9000), Math.log(dist));
      if (d.t >= 1) {
        d.done = true;
        onDiveDone();
      }
    }
    const mat = globeMat.current;
    if (mat !== null) {
      const o = opacity.current;
      mat.opacity = o;
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
      <group
        ref={globeGroup}
        quaternion={spin}
        position={[0, -MARS_RADIUS, 0]}
        name="mars-globe"
      >
        <mesh ref={globeMesh}>
          <sphereGeometry args={[MARS_RADIUS, 128, 96]} />
          <meshStandardMaterial
            ref={globeMat}
            map={texture}
            roughness={1}
            metalness={0}
            transparent
            opacity={1}
            fog={false}
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
            uniforms={{ uOpacity: { value: 1 } }}
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
      </group>

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
    </>
  );
}

/** Console hint shared by the Mars HUD. */
export function marsHint(lang: Lang, available: number, total: number): string {
  if (lang === "zh") {
    return `选择要加载的任务地点（${available}/${total} 个有地形数据）`;
  }
  return `Choose a mission area to load (${available} of ${total} have terrain data)`;
}
