/** The 3D sandbox composition: terrain draped with the CTX ortho extract, sun
 * lighting matching the DEM hillshade convention, site/base markers with scale
 * references, terrain-hugging routes, constrained orbit controls with camera
 * transitions. Display layer only — geometry comes from the frozen package
 * through src/domain/world.ts. */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { advance, Canvas, useFrame, useThree } from "@react-three/fiber";

/** Detects a stalled requestAnimationFrame loop (hidden/background tab) and
 * switches the canvas to a timer-driven render loop so the sandbox keeps
 * rendering (VISUAL-DIRECTION: degradation allowed; interaction stays usable). */
function RenderLoopGuard({ onStall }: { onStall: () => void }): null {
  const last = useRef(performance.now());
  useFrame(() => {
    last.current = performance.now();
  });
  useEffect(() => {
    const id = window.setInterval(() => {
      if (performance.now() - last.current > 1500) onStall();
    }, 400);
    return () => window.clearInterval(id);
  }, [onStall]);
  return null;
}
import { useTexture } from "@react-three/drei";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { LoadedPackage } from "../domain/load.js";
import type { RouteResult, Strategy, TerrainGrid } from "../domain/types.js";
import type { MissionRuntime } from "../simulation/runtime.js";
import type { HudMirror } from "../simulation/runtime.js";
import {
  cellWorldPosition,
  overviewPose,
  routePolyline,
  sitePose,
  worldTransform,
  type WorldTransform,
 worldY, sampleElevationM } from "../domain/world.js";
import { commandCamera, readCameraCommand } from "./cameraBus.js";

const LIFT_M = 1.5; // routes render 1.5 m above ground (display only)
const EASE = (x: number): number => x * x * (3 - 2 * x);

function TerrainMesh({ terrain, t }: { terrain: TerrainGrid; t: WorldTransform }): JSX.Element {
  const texture = useTexture("/data/jezero/imagery/ortho_5m.jpg");
  texture.anisotropy = 8;
  const geometry = useMemo(() => {
    const w = terrain.width;
    const h = terrain.height;
    const positions = new Float32Array(w * h * 3);
    const uvs = new Float32Array(w * h * 2);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const i = r * w + c;
        const p = cellWorldPosition(terrain, t, r, c, 0);
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = p.y;
        positions[i * 3 + 2] = p.z;
        uvs[i * 2] = ((c + 0.5) * terrain.cellSizeM) / (w * terrain.cellSizeM);
        uvs[i * 2 + 1] =
          (terrain.originYM - (r + 0.5) * terrain.cellSizeM) / (h * terrain.cellSizeM);
      }
    }
    const index: number[] = [];
    for (let r = 0; r < h - 1; r++) {
      for (let c = 0; c < w - 1; c++) {
        const a = r * w + c;
        const b = a + 1;
        const d = (r + 1) * w + c;
        const e = d + 1;
        index.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return geo;
  }, [terrain, t]);
  return (
    <mesh geometry={geometry} name="terrain">
      <meshStandardMaterial map={texture} color="#e0a476" roughness={0.96} metalness={0} />
    </mesh>
  );
}

/** structural type for the Line2 handle (geometry.instanceCount drives the unfurl) */
interface Line2Like {
  geometry: { instanceCount: number };
}

function RouteLines({
  terrain,
  t,
  result,
  strategy,
  reducedMotion,
  runtimeRef,
}: {
  terrain: TerrainGrid;
  t: WorldTransform;
  result: RouteResult | null;
  strategy: Strategy;
  reducedMotion: boolean;
  runtimeRef: React.MutableRefObject<MissionRuntime | null>;
}): JSX.Element | null {
  const rt = runtimeRef.current;
  const emergencyActive = !!(rt !== null && rt.emergency !== null && rt.emergency.plan !== null);
  const plannedInvalid = emergencyActive;
  const candidate = result?.candidates.find((c) => c.strategy === strategy) ?? null;
  const outbound = useMemo(
    () =>
      candidate
        ? routePolyline(terrain, t, candidate.outbound.pathCells, LIFT_M).map(
            (p) => new THREE.Vector3(p.x, p.y, p.z),
          )
        : null,
    [candidate, terrain, t],
  );
  const ret = useMemo(
    () =>
      candidate
        ? routePolyline(terrain, t, candidate.returnRoute.pathCells, LIFT_M).map(
            (p) => new THREE.Vector3(p.x, p.y, p.z),
          )
        : null,
    [candidate, terrain, t],
  );

  const outRef = useRef<Line2Like | null>(null);
  const headRef = useRef<THREE.Mesh | null>(null);
  const unfurl = useRef(reducedMotion ? 1 : 0);
  const requestId = useRef<string | null>(null);
  if (requestId.current !== (result?.requestId ?? null)) {
    requestId.current = result?.requestId ?? null;
    unfurl.current = reducedMotion ? 1 : 0;
  }

  useFrame((_, delta) => {
    if (unfurl.current < 1 && !reducedMotion) {
      unfurl.current = Math.min(1, unfurl.current + delta / 1.1);
    }
    if (outRef.current && outbound) {
      const total = outbound.length - 1;
      outRef.current.geometry.instanceCount = Math.max(1, Math.round(unfurl.current * total));
    }
    if (headRef.current && outbound && outbound.length > 1) {
      const v = unfurl.current;
      headRef.current.visible = v < 1;
      const total = outbound.length - 1;
      const f = v * total;
      const i = Math.min(Math.floor(f), total - 1);
      const a = outbound[i] as THREE.Vector3;
      const b = outbound[i + 1] as THREE.Vector3;
      headRef.current.position.lerpVectors(a, b, f - i);
    }
  });

  if (!candidate || !outbound || !ret) return null;
  const emergencyPoints = useMemo(() => {
    const plan = runtimeRef.current?.emergency?.plan ?? null;
    if (plan === null) return null;
    const cs = terrain.cellSizeM;
    const wx = plan.startXM - (terrain.width * cs) / 2;
    const wz = (terrain.height * cs) / 2 - plan.startYM;
    const wy = worldY(t, sampleElevationM(terrain, plan.startXM, plan.startYM, 0)) + 1.5 * 3;
    const pts = [new THREE.Vector3(wx, wy, wz)];
    for (const [r, c] of plan.cells) {
      const p = cellWorldPosition(terrain, t, r, c, 1.5);
      pts.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    return pts;
  }, [runtimeRef.current?.emergency?.forId, terrain, t]);
  return (
    <group name="routes">
      <Line
        ref={outRef as never}
        points={outbound}
        color={plannedInvalid ? "#8a8078" : "#fff3dd"}
        lineWidth={3.5}
        dashed={plannedInvalid}
        dashSize={40}
        gapSize={28}
      />
      <Line
        points={ret}
        color={plannedInvalid ? "#8a8078" : "#ffb45e"}
        lineWidth={2.5}
        dashed={plannedInvalid}
        dashSize={40}
        gapSize={28}
      />
      {emergencyActive && emergencyPoints !== null && (
        <Line points={emergencyPoints} color="#ffb45e" lineWidth={3} />
      )}
      <mesh ref={headRef} visible={false}>
        <sphereGeometry args={[12, 16, 12]} />
        <meshBasicMaterial color="#fff3dd" />
      </mesh>
    </group>
  );
}

function Markers({
  pkg,
  t,
  selectedSiteId,
  overlayRef,
}: {
  pkg: LoadedPackage;
  t: WorldTransform;
  selectedSiteId: string | null;
  overlayRef: React.RefObject<HTMLDivElement | null>;
}): JSX.Element {
  const siteMarkers = useMemo(
    () =>
      pkg.sites.map((site) => ({
        site,
        pos: cellWorldPosition(pkg.terrain, t, site.rowCol[0], site.rowCol[1], 0),
      })),
    [pkg, t],
  );
  const basePos = useMemo(
    () =>
      cellWorldPosition(
        pkg.terrain,
        t,
        pkg.scenario.base.rowCol[0],
        pkg.scenario.base.rowCol[1],
        0,
      ),
    [pkg, t],
  );
  return (
    <group name="markers">
      {siteMarkers.map(({ site, pos }) => {
        const selected = site.id === selectedSiteId;
        return (
          <group key={site.id} position={[pos.x, pos.y, pos.z]}>
            <mesh position={[0, 16, 0]}>
              <sphereGeometry args={[selected ? 14 : 9, 20, 14]} />
              <meshBasicMaterial color={selected ? "#ffb45e" : "#f5ead9"} />
            </mesh>
            <mesh position={[0, 6, 0]}>
              <cylinderGeometry args={[0.9, 0.9, 12, 8]} />
              <meshBasicMaterial color={selected ? "#ffb45e" : "#f5ead9"} />
            </mesh>
            <Html
              position={[0, 44, 0]}
              center
              portal={overlayRef as never}
              zIndexRange={[20, 0]}
            >
              <div className="site-label">
                <b>{site.id}</b> {site.name} ±{site.positionUncertaintyM} m
              </div>
            </Html>
          </group>
        );
      })}
      <group name="base" position={[basePos.x, basePos.y, basePos.z]}>
        <mesh position={[0, 6, 0]}>
          <sphereGeometry args={[11, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#e8e2d6" roughness={0.55} metalness={0.15} />
        </mesh>
        <mesh position={[16, 1.6, 6]}>
          <boxGeometry args={[12, 3.2, 6]} />
          <meshStandardMaterial color="#cfc8ba" roughness={0.7} metalness={0.1} />
        </mesh>
        <group position={[-14, 0, 8]}>
          <mesh position={[0, 0.85, 0]}>
            <capsuleGeometry args={[0.32, 1.1, 4, 10]} />
            <meshStandardMaterial color="#ffffff" roughness={0.4} />
          </mesh>
          <mesh position={[0, 1.72, 0]}>
            <sphereGeometry args={[0.24, 12, 10]} />
            <meshStandardMaterial color="#d8d2c6" roughness={0.35} metalness={0.3} />
          </mesh>
        </group>
        <Html
          position={[0, 36, 0]}
          center
          portal={overlayRef as never}
          distanceFactor={1500}
          zIndexRange={[20, 0]}
        >
          <div className="site-label base-label">BASE (simulated) · scale figure 1.7 m</div>
        </Html>
      </group>
    </group>
  );
}

function CameraDirector({
  controlsRef,
  t,
  reducedMotion,
}: {
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  t: WorldTransform;
  reducedMotion: boolean;
}): null {
  const camera = useThree((state) => state.camera);
  const lastSeq = useRef(0);
  const transition = useRef<{
    fromP: THREE.Vector3;
    fromT: THREE.Vector3;
    toP: THREE.Vector3;
    toT: THREE.Vector3;
    t: number;
    instant: boolean;
  } | null>(null);

  // fly to the region overview once the controls exist
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const pose = overviewPose(t, 400);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    controls.target.set(pose.target.x, pose.target.y, pose.target.z);
    controls.update();
    lastSeq.current = 0; // the initial mount already shows the overview
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const cmd = readCameraCommand();
    if (cmd && cmd.seq !== lastSeq.current) {
      lastSeq.current = cmd.seq;
      transition.current = {
        fromP: controls.object.position.clone(),
        fromT: controls.target.clone(),
        toP: new THREE.Vector3(cmd.pose.position.x, cmd.pose.position.y, cmd.pose.position.z),
        toT: new THREE.Vector3(cmd.pose.target.x, cmd.pose.target.y, cmd.pose.target.z),
        t: cmd.instant || reducedMotion ? 1 : 0,
        instant: cmd.instant || reducedMotion,
      };
    }
    const tr = transition.current;
    if (tr === null) return;
    tr.t = tr.instant || reducedMotion ? 1 : Math.min(1, tr.t + delta / 1.25);
    const k = EASE(tr.t);
    controls.object.position.lerpVectors(tr.fromP, tr.toP, k);
    controls.target.lerpVectors(tr.fromT, tr.toT, k);
    controls.update();
    if (tr.t >= 1) transition.current = null;
  });
  return null;
}

function FpsMeter({ fpsStore }: { fpsStore: FpsStore }): null {
  let acc = 0;
  let n = 0;
  useFrame((state, delta) => {
    acc += delta;
    n++;
    fpsStore.current.frames++;
    if (acc >= 0.5) {
      fpsStore.current.fps = n / acc;
      fpsStore.current.calls = state.gl.info.render.calls;
      acc = 0;
      n = 0;
    }
  });
  return null;
}

export interface FpsStore {
  current: { fps: number; calls: number; frames: number };
}
export function makeFpsStore(): FpsStore {
  return { current: { fps: 0, calls: 0, frames: 0 } };
}

export type LoopMode = "raf" | "timer";

export function Sandbox({
  pkg,
  result,
  strategy,
  selectedSiteId,
  reducedMotion,
  fpsStore,
  overlayRef,
  onLoopMode,
  runtimeRef,
  hudRef,
}: {
  pkg: LoadedPackage;
  result: RouteResult | null;
  strategy: Strategy;
  selectedSiteId: string | null;
  reducedMotion: boolean;
  fpsStore: FpsStore;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  onLoopMode: (mode: LoopMode) => void;
  runtimeRef: React.MutableRefObject<MissionRuntime | null>;
  hudRef: React.MutableRefObject<HudMirror>;
}): JSX.Element {
  const t = useMemo(() => worldTransform(pkg.terrain), [pkg]);
  const [frameloop, setFrameloop] = useState<"always" | "never">("always");

  // timer-driven rendering once rAF stalls (hidden/background webviews)
  const advanceTimer = useRef<number | null>(null);
  useEffect(() => {
    if (frameloop === "never") {
      onLoopMode("timer");
      advanceTimer.current = window.setInterval(() => advance(0.2), 200);
      return () => {
        if (advanceTimer.current !== null) window.clearInterval(advanceTimer.current);
      };
    }
    onLoopMode("raf");
    return undefined;
  }, [frameloop, onLoopMode]);

  const handleStall = useMemo(() => () => setFrameloop("never"), []);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  return (
    <Canvas
      camera={{ fov: 46, near: 1, far: 30000, position: [0, 3300, 5400] }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={(state) => {
        state.gl.toneMappingExposure = 1.45;
        (window as unknown as Record<string, unknown>).__mg = {
          camera: state.camera,
          controls: null,
          info: state.gl.info,
          renderer: state.gl,
        };
      }}
    >
      <color attach="background" args={["#0d0a08"]} />
      <hemisphereLight args={["#d9a06b", "#4a3320", 0.85]} />
      <ambientLight intensity={0.32} />
      <directionalLight position={[-3000, 4600, -3000]} intensity={3.0} color="#ffe3c4" />
      <Suspense fallback={null}>
        <TerrainMesh terrain={pkg.terrain} t={t} />
      </Suspense>
      <Markers pkg={pkg} t={t} selectedSiteId={selectedSiteId} overlayRef={overlayRef} />
      <RouteLines
        terrain={pkg.terrain}
        t={t}
        result={result}
        strategy={strategy}
        reducedMotion={reducedMotion}
        runtimeRef={runtimeRef}
      />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.12}
        minDistance={350}
        maxDistance={9000}
        maxPolarAngle={Math.PI * 0.46}
        target={[0, 150, 0]}
      />
      <CameraDirector controlsRef={controlsRef} t={t} reducedMotion={reducedMotion} />
      <RenderLoopGuard onStall={handleStall} />
      <FpsMeter fpsStore={fpsStore} />
    </Canvas>
  );
}

/** Command the camera from the UI: fly to a site (or back to the overview). */
export function flyToSite(pkg: LoadedPackage, siteId: string | null, instant = false): void {
  const t = worldTransform(pkg.terrain);
  if (!siteId) {
    commandCamera(overviewPose(t, 400), instant);
    return;
  }
  const site = pkg.sites.find((s) => s.id === siteId);
  if (!site) return;
  const target = cellWorldPosition(pkg.terrain, t, site.rowCol[0], site.rowCol[1], 0);
  const base = cellWorldPosition(
    pkg.terrain,
    t,
    pkg.scenario.base.rowCol[0],
    pkg.scenario.base.rowCol[1],
    0,
  );
  commandCamera(sitePose(t, target, base), instant);
}
