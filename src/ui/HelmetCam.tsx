/** First-person "helmet cam" and the near-field dressing it needs.
 *
 * The camera rides the mission runtime's own interpolated position and bearing —
 * no invented path, no cinematic cheat: scrub the timeline and the view moves
 * with it, pause and it stops. Eye height and the metre-scale boulders exist
 * because the published DEM is 20 m per cell: at eye level the raw surface is a
 * handful of huge facets, so the close view needs its own detail layer. Both are
 * labelled as artistic display in the legend and the sources drawer.
 */

import { useEffect, useMemo, useRef } from "react";
import type { JSX } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { MissionRuntime, HudMirror } from "../simulation/runtime.js";
import type { LoadedPackage } from "../domain/load.js";
import type { WorldTransform } from "../domain/world.js";
import { cellWorldPosition, sampleElevationM, worldY } from "../domain/world.js";

/** eye height in world units above the walked ground point */
const EYE_HEIGHT = 3.6;
const HELMET_FOV = 68;
/** close range needs a much nearer clip plane than the 50-unit sandbox default */
const HELMET_NEAR = 1.2;

export function HelmetCam({
  active,
  runtimeRef,
  hudRef,
  controlsRef,
}: {
  active: boolean;
  runtimeRef: React.MutableRefObject<MissionRuntime | null>;
  hudRef: React.MutableRefObject<HudMirror>;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
}): null {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const saved = useRef<{
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    fov: number;
    near: number;
    target: THREE.Vector3;
  } | null>(null);
  const bob = useRef(0);

  useEffect(() => {
    const controls = controlsRef.current;
    if (active) {
      if (controls !== null) {
        saved.current = {
          position: camera.position.clone(),
          quaternion: camera.quaternion.clone(),
          fov: camera.fov,
          near: camera.near,
          target: controls.target.clone(),
        };
        controls.enabled = false;
      }
      camera.fov = HELMET_FOV;
      camera.near = HELMET_NEAR;
      camera.updateProjectionMatrix();
      return;
    }
    const back = saved.current;
    if (back === null) return;
    camera.position.copy(back.position);
    camera.quaternion.copy(back.quaternion);
    camera.fov = back.fov;
    camera.near = back.near;
    camera.updateProjectionMatrix();
    if (controls !== null && saved.current !== null) {
      controls.target.copy(back.target);
      controls.enabled = true;
      controls.update();
    }
    saved.current = null;
  }, [active, camera, controlsRef]);

  useFrame((_, delta) => {
    if (!active) return;
    const hud = hudRef.current;
    if (hud.astronaut === null) return;
    bob.current += delta;
    const heading = hud.headingRad;
    // subtle gait: the camera alone moves, the world stays put
    const sway = Math.sin(bob.current * 6.2) * 0.05;
    camera.position.set(
      hud.astronaut.x,
      hud.astronaut.y + EYE_HEIGHT + sway,
      hud.astronaut.z,
    );
    if (heading === null) {
      // standing at a stop or the end of the leg: keep the last look direction
      return;
    }
    // world: x east, z = -north; bearing 0 = north, +pi/2 = east
    const fx = Math.sin(heading);
    const fz = -Math.cos(heading);
    camera.lookAt(
      camera.position.x + fx * 40,
      camera.position.y - 2.2,
      camera.position.z + fz * 40,
    );
  });

  return null;
}

/** Metre-scale boulder field: artistic detail that gives the close view scale.
 *  Clustered around the planned route, thinner across the rest of the plate. */
export function Boulders({
  pkg,
  t,
  route,
}: {
  pkg: LoadedPackage;
  t: WorldTransform;
  route: THREE.Vector3[];
}): JSX.Element {
  const geometry = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    let seed = 20261115;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967295;
    };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) as number;
      const y = pos.getY(i) as number;
      const z = pos.getZ(i) as number;
      const j = 0.78 + rnd() * 0.44;
      pos.setXYZ(i, x * j, y * 0.66 * j, z * j);
    }
    geo.computeVertexNormals();
    return geo;
  }, []);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: 1,
        metalness: 0,
        flatShading: true,
        vertexColors: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  const mesh = useMemo(() => {
    const count = 900;
    const inst = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let seed = 7654321;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967295;
    };
    const halfW = t.halfWidthM;
    const halfH = t.halfHeightM;
    // the helmet camera rides the path, so nothing may stand on it
    const CLEARANCE = 16;
    const nearestOnRoute = (x: number, z: number): number => {
      let best = Infinity;
      for (let i = 0; i < route.length; i += 3) {
        const p = route[i] as THREE.Vector3;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < best) best = d;
      }
      return best;
    };

    for (let i = 0; i < count; i++) {
      let x = 0;
      let z = 0;
      if (route.length > 0 && rnd() < 0.62) {
        const p = route[Math.floor(rnd() * route.length)] as THREE.Vector3;
        // try a few bearings until the boulder lands clear of the walked line
        for (let k = 0; k < 5; k++) {
          const a = rnd() * Math.PI * 2;
          const r = CLEARANCE + 6 + rnd() * (k === 0 ? 170 : 70);
          x = p.x + Math.cos(a) * r;
          z = p.z + Math.sin(a) * r;
          if (nearestOnRoute(x, z) >= CLEARANCE) break;
        }
      } else {
        x = (rnd() - 0.5) * halfW * 1.94;
        z = (rnd() - 0.5) * halfH * 1.94;
      }
      const elev = sampleElevationM(pkg.terrain, x + halfW, halfH - z, t.datumM);
      const s = 0.9 + Math.pow(rnd(), 2.6) * 7;
      dummy.position.set(x, worldY(t, elev) + s * 0.3, z);
      dummy.rotation.set(rnd() * 0.6, rnd() * Math.PI * 2, rnd() * 0.6);
      dummy.scale.set(s, s * (0.5 + rnd() * 0.5), s * (0.7 + rnd() * 0.6));
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      const shade = 0.3 + rnd() * 0.38;
      color.setRGB(shade * 1.06, shade * 0.62, shade * 0.46);
      inst.setColorAt(i, color);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor !== null) inst.instanceColor.needsUpdate = true;
    inst.frustumCulled = false;
    return inst;
  }, [geometry, material, pkg, t, route]);

  useEffect(() => {
    return () => {
      mesh.dispose();
    };
  }, [mesh]);

  return <primitive object={mesh} name="boulders" />;
}

/** small helper used by Markers for the base beacon pulse */
export function usePulse(speed: number): React.MutableRefObject<number> {
  const value = useRef(0);
  useFrame((_, delta) => {
    value.current = (value.current + delta * speed) % (Math.PI * 2);
  });
  return value;
}

/** ground position of a site, used by the scan-ring dressing */
export function siteGround(pkg: LoadedPackage, t: WorldTransform, row: number, col: number) {
  return cellWorldPosition(pkg.terrain, t, row, col, 0);
}
