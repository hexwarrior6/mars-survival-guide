/** In-canvas mission layer: advances the deterministic simulation with the frame
 * delta, walks the astronaut along the route (exact interpolated position from
 * missionStateAt), and marks the closure region. All motion comes from the
 * engine — never invented, never teleported. */

import { useMemo, useRef } from "react";
import type { JSX } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import { stepMissionRuntime } from "../simulation/runtime.js";
import { cellWorldPosition, worldY, sampleElevationM, worldTransform, type WorldTransform } from "../domain/world.js";
import type { MissionRuntime } from "../simulation/runtime.js";
import type { HudMirror } from "../simulation/runtime.js";
import type { LoadedPackage } from "../domain/load.js";

export function MissionLayer({
  runtimeRef,
  hudRef,
  pkg,
  t,
  closureActive,
}: {
  runtimeRef: React.MutableRefObject<MissionRuntime | null>;
  hudRef: React.MutableRefObject<HudMirror>;
  pkg: LoadedPackage;
  t: WorldTransform;
  closureActive: boolean;
}): JSX.Element | null {
  const groupRef = useRef<THREE.Group | null>(null);
  const markerRef = useRef<THREE.Group | null>(null);

  useFrame((_, delta) => {
    const rt = runtimeRef.current;
    if (rt === null) return;
    stepMissionRuntime(rt, hudRef.current, t, delta);
    const hud = hudRef.current;
    if (groupRef.current !== null && hud.astronaut !== null) {
      groupRef.current.position.set(hud.astronaut.x, hud.astronaut.y + 1.2, hud.astronaut.z);
      groupRef.current.visible = true;
    }
    // the position marker rides the same exact interpolated position; the
    // astronaut model itself is true 1.7 m scale (invisible beyond ~2 km), so
    // a clearly-labelled enlarged marker makes the walk readable at overview
    if (markerRef.current !== null && hud.astronaut !== null) {
      markerRef.current.position.set(hud.astronaut.x, hud.astronaut.y, hud.astronaut.z);
      markerRef.current.visible = true;
    }
    if (markerRef.current !== null && hud.astronaut === null) {
      markerRef.current.visible = false;
    }
  });

  const start = useMemo(() => {
    const base = pkg.scenario.base;
    const p = cellWorldPosition(pkg.terrain, t, base.rowCol[0], base.rowCol[1], 0);
    return [p.x, p.y + 1.2, p.z] as [number, number, number];
  }, [pkg, t]);

  const closurePoints = useMemo(() => {
    if (!closureActive) return null;
    const ev = pkg.scenario.events.find((e) => e.type === "area_closure");
    if (!ev || ev.geometry.type !== "rectangle") return null;
    const [r0, r1] = ev.geometry.rows;
    const [c0, c1] = ev.geometry.cols;
    const corners: Array<[number, number]> = [
      [r0, c0],
      [r0, c1],
      [r1, c1],
      [r1, c0],
      [r0, c0],
    ];
    return corners.map(([r, c]) => {
      const p = cellWorldPosition(pkg.terrain, t, r, c, 14);
      return new THREE.Vector3(p.x, p.y, p.z);
    });
  }, [pkg, t, closureActive]);

  return (
    <group name="mission-layer">
      <group ref={groupRef} position={start} visible={false} name="astronaut">
        <mesh position={[0, 0.55, 0]}>
          <capsuleGeometry args={[0.34, 1.0, 4, 10]} />
          <meshStandardMaterial
            color="#ffffff"
            emissive="#554433"
            emissiveIntensity={0.4}
            roughness={0.4}
          />
        </mesh>
        <mesh position={[0, 1.42, 0]}>
          <sphereGeometry args={[0.26, 12, 10]} />
          <meshStandardMaterial color="#d8d2c6" roughness={0.35} metalness={0.3} />
        </mesh>
      </group>
      {/* enlarged position marker: slim light column + head, ~140 m tall so the
          walk reads at overview distance. Display element, called out in the
          legend — not a real object and not to scale. */}
      <group ref={markerRef} visible={false} name="task-marker">
        <mesh position={[0, 70, 0]}>
          <cylinderGeometry args={[1.6, 1.6, 140, 6]} />
          <meshBasicMaterial color="#ffd9a0" transparent opacity={0.55} depthWrite={false} />
        </mesh>
        <mesh position={[0, 146, 0]}>
          <sphereGeometry args={[10, 12, 10]} />
          <meshBasicMaterial color="#fff3dd" />
        </mesh>
      </group>
      <ClosureLine points={closurePoints} />
    </group>
  );
}

function ClosureLine({ points }: { points: THREE.Vector3[] | null }): JSX.Element | null {
  if (points === null) return null;
  return <Line points={points} color="#ff5c47" lineWidth={3} />;
}
