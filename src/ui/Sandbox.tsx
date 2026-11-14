/** The 3D sandbox composition: terrain draped with the CTX ortho extract, sun
 * lighting matching the DEM hillshade convention, site/base markers with scale
 * references, terrain-hugging routes, constrained orbit controls with camera
 * transitions. Display layer only — geometry comes from the frozen package
 * through src/domain/world.ts. */

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { advance, Canvas, useFrame, useThree } from "@react-three/fiber";

/**
 * Self-driven frame loop. The Canvas runs with frameloop="never"; rendering is
 * driven from HERE, so a throttled webview (background tab, hidden pane) can
 * never leave the sandbox with a loop that never starts: rAF drives frames
 * normally, and a plain interval takes over whenever rAF stalls. advance()
 * takes a timestamp in seconds and computes useFrame deltas itself.
 */
function FrameDriver({ onLoopMode }: { onLoopMode: (m: LoopMode) => void }): null {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let mode: LoopMode = "raf";
    const tick = (now: number): void => {
      advance(now / 1000);
      last = now;
      if (mode !== "raf") {
        mode = "raf";
        onLoopMode("raf");
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const iv = window.setInterval(() => {
      if (performance.now() - last > 800) {
        advance(performance.now() / 1000);
        last = performance.now();
        if (mode !== "timer") {
          mode = "timer";
          onLoopMode("timer");
        }
      }
    }, 200);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(iv);
    };
  }, [onLoopMode]);
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
  introPose,
  overviewPose,
  routePolyline,
  routePose,
  sitePose,
  worldTransform,
  worldXZ,
  worldY,
  sampleElevationM,
  type CameraPose,
  type WorldTransform,
} from "../domain/world.js";
import type { CostField } from "../routing/field.js";
import { commandCamera, readCameraCommand } from "./cameraBus.js";
import { MissionLayer } from "./MissionLayer.js";
import type { Lang } from "./i18n.js";

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
      <meshStandardMaterial map={texture} color="#e2a877" roughness={0.93} metalness={0} />
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
  locked,
}: {
  terrain: TerrainGrid;
  t: WorldTransform;
  result: RouteResult | null;
  strategy: Strategy;
  reducedMotion: boolean;
  runtimeRef: React.MutableRefObject<MissionRuntime | null>;
  /** plan-A route (locked inputs), rendered as a subdued dashed pair */
  locked: { out: THREE.Vector3[]; ret: THREE.Vector3[] } | null;
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
  // declared before any early return: hooks must run in the same order whether
  // or not a plan is currently displayed (fixed V1 rules-of-hooks violation)
  const emergencyPoints = useMemo(() => {
    const plan = runtimeRef.current?.emergency?.plan ?? null;
    if (!candidate || plan === null) return null;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeRef.current?.emergency?.forId, terrain, t, candidate]);

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
      {/* plan A (locked inputs): subdued dashed pair so A/B differences read
          directly on the terrain; only rendered when a plan is locked */}
      {locked !== null && (
        <>
          <Line points={locked.out} color="#b9b3c9" lineWidth={2.5} dashed dashSize={40} gapSize={26} transparent opacity={0.9} />
          <Line points={locked.ret} color="#b5a894" lineWidth={2} dashed dashSize={30} gapSize={22} transparent opacity={0.9} />
        </>
      )}
      <mesh ref={headRef} visible={false}>
        <sphereGeometry args={[12, 16, 12]} />
        <meshBasicMaterial color="#fff3dd" />
      </mesh>
    </group>
  );
}

/** Terrain-hugging selection ring around the anchored site position (display
 * only: 70 m radius sampled from the same DEM, not a measurement of anything). */
function SelectionRing({
  terrain,
  t,
  xM,
  yM,
}: {
  terrain: TerrainGrid;
  t: WorldTransform;
  xM: number;
  yM: number;
}): JSX.Element {
  const pts = useMemo(() => {
    const R = 70;
    const arr: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const px = xM + Math.cos(a) * R;
      const py = yM + Math.sin(a) * R;
      const elev = sampleElevationM(terrain, px, py, t.datumM);
      const [wx, wz] = worldXZ(t, px, py);
      arr.push(new THREE.Vector3(wx, worldY(t, elev) + 6, wz));
    }
    return arr;
  }, [terrain, t, xM, yM]);
  return <Line points={pts} color="#ffb45e" lineWidth={2.5} />;
}

function Markers({
  pkg,
  t,
  selectedSiteId,
  overlayRef,
  lang,
}: {
  pkg: LoadedPackage;
  t: WorldTransform;
  selectedSiteId: string | null;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  lang: Lang;
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
              <sphereGeometry args={[selected ? 16 : 10, 20, 14]} />
              <meshBasicMaterial color={selected ? "#ffb45e" : "#f5ead9"} />
            </mesh>
            <mesh position={[0, 6, 0]}>
              <cylinderGeometry args={[0.9, 0.9, 14, 8]} />
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
      {/* selection ring lives at the markers-group level: its points are WORLD
          coordinates (site xM/yM -> worldXZ/worldY), so it must NOT sit inside
          a group already translated to the marker position (V1 bug: double
          translation sent the ring into the sky). Center = the site's nominal
          coordinates from sites.json — same point the label anchors to. */}
      {(() => {
        const selectedSite = pkg.sites.find((s) => s.id === selectedSiteId) ?? null;
        if (selectedSite === null) return null;
        return (
          <SelectionRing terrain={pkg.terrain} t={t} xM={selectedSite.xM} yM={selectedSite.yM} />
        );
      })()}
      <group name="base" position={[basePos.x, basePos.y, basePos.z]}>
        <mesh position={[0, 6, 0]}>
          <sphereGeometry args={[11, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#e8e2d6" roughness={0.55} metalness={0.15} />
        </mesh>
        <mesh position={[16, 1.6, 6]}>
          <boxGeometry args={[12, 3.2, 6]} />
          <meshStandardMaterial color="#cfc8ba" roughness={0.7} metalness={0.1} />
        </mesh>
        {/* small flag as a base landmark (marker geometry, not a measurement) */}
        <mesh position={[10, 3.5, -8]}>
          <cylinderGeometry args={[0.14, 0.14, 7, 6]} />
          <meshStandardMaterial color="#cfc8ba" roughness={0.6} />
        </mesh>
        <mesh position={[11.4, 5.8, -8]}>
          <boxGeometry args={[2.6, 1.6, 0.08]} />
          <meshStandardMaterial color="#ffb45e" roughness={0.6} />
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
          position={[34, 42, 0]}
          center
          portal={overlayRef as never}
          zIndexRange={[20, 0]}
        >
          <div className="site-label base-label">{lang === "zh" ? "基地（模拟）· 比例人形 1.7 米" : "BASE (simulated) · scale figure 1.7 m"}</div>
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
    durationSec: number;
    instant: boolean;
    then: { pose: CameraPose; durationMs?: number } | null;
  } | null>(null);

  // opening shot: mount at the high/far intro pose, then ease down to the
  // overview over ~2.5 s. Any user drag cancels the running move — this is
  // also the "skip intro" gesture. reduced-motion mounts straight at the
  // overview with no move.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    // user-requested mapping: left-drag pans the view, right-drag orbits
    // (azimuth + pitch), wheel zooms (three OrbitControls default is the swap)
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    const pose = reducedMotion ? overviewPose(t, 400) : introPose(t);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    controls.target.set(pose.target.x, pose.target.y, pose.target.z);
    controls.update();
    lastSeq.current = 0;
    const cancelOnDrag = (): void => {
      transition.current = null;
    };
    controls.addEventListener("start", cancelOnDrag);
    let introTimer = 0;
    if (!reducedMotion) {
      introTimer = window.setTimeout(() => {
        commandCamera(overviewPose(t, 400), false, 2500);
      }, 350);
    }
    return () => {
      controls.removeEventListener("start", cancelOnDrag);
      window.clearTimeout(introTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const cmd = readCameraCommand();
    if (cmd && cmd.seq !== lastSeq.current) {
      lastSeq.current = cmd.seq;
      const instant = cmd.instant || reducedMotion;
      transition.current = {
        fromP: controls.object.position.clone(),
        fromT: controls.target.clone(),
        toP: new THREE.Vector3(cmd.pose.position.x, cmd.pose.position.y, cmd.pose.position.z),
        toT: new THREE.Vector3(cmd.pose.target.x, cmd.pose.target.y, cmd.pose.target.z),
        t: instant ? 1 : 0,
        durationSec: (cmd.durationMs ?? 1250) / 1000,
        instant,
        then: cmd.then ?? null,
      };
    }
    const tr = transition.current;
    if (tr === null) return;
    tr.t = Math.min(1, tr.t + delta / tr.durationSec);
    const k = EASE(tr.t);
    controls.object.position.lerpVectors(tr.fromP, tr.toP, k);
    controls.target.lerpVectors(tr.fromT, tr.toT, k);
    controls.update();
    if (tr.t >= 1) {
      const follow = tr.then;
      const wasInstant = tr.instant;
      transition.current = null;
      // two-stage fly: once the focus leg lands, pull back to frame the whole
      // route. A user grab cleared transition.current above and this never
      // runs — the camera is never yanked away from the user.
      if (follow) commandCamera(follow.pose, wasInstant || reducedMotion, follow.durationMs);
    }
  });
  return null;
}

function FpsMeter({ fpsStore }: { fpsStore: FpsStore }): null {
  // accumulate in refs: component re-renders (HUD tick) would otherwise reset
  // the closure locals and the fps readout would never settle
  const acc = useRef(0);
  const n = useRef(0);
  useFrame((state, delta) => {
    acc.current += delta;
    n.current += 1;
    fpsStore.current.frames += 1;
    if (acc.current >= 0.5) {
      fpsStore.current.fps = n.current / acc.current;
      fpsStore.current.calls = state.gl.info.render.calls;
      acc.current = 0;
      n.current = 0;
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

/**
 * Returnable-range overlay (V3): the boundary of the set of cells from which
 * the astronaut could still walk back to base with the CURRENT remaining
 * resources (reverse-Dijkstra cost field + resource threshold), plus a faint
 * fill over those cells. Both are real computed geometry — the field is
 * recomputed only when the closure state changes, and the boundary/fill are
 * re-derived whenever the resource threshold moves.
 */
function ReturnableLayer({
  field,
  threshold,
  terrain,
  t,
}: {
  field: CostField;
  threshold: number;
  terrain: TerrainGrid;
  t: WorldTransform;
}): JSX.Element | null {
  const n = terrain.width * terrain.height;
  const cs = terrain.cellSizeM;
  // per-cell world height (centre sample), computed once per mapping
  const heights = useMemo(() => {
    const h = new Float32Array(n);
    for (let r = 0; r < terrain.height; r++) {
      for (let c = 0; c < terrain.width; c++) {
        const xM = (c + 0.5) * cs;
        const yM = terrain.originYM - (r + 0.5) * cs;
        h[r * terrain.width + c] = worldY(t, sampleElevationM(terrain, xM, yM, t.datumM));
      }
    }
    return h;
  }, [terrain, t, n, cs]);

  const lineRef = useRef<THREE.LineSegments | null>(null);
  const fillRef = useRef<THREE.InstancedMesh | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // useLayoutEffect: fix the instance count before first paint (an InstancedMesh
  // starts with count = capacity, which would paint all 65k identity quads once)
  useLayoutEffect(() => {
    // boundary segments: every in-range cell with an out-of-range (or blocked)
    // orthogonal neighbour contributes one centre-to-centre segment
    const segs: number[] = [];
    let count = 0;
    for (let r = 0; r < terrain.height; r++) {
      for (let c = 0; c < terrain.width; c++) {
        const i = r * terrain.width + c;
        const m = field.minutes[i] as number;
        if (m > threshold) continue;
        count++;
        const hHere = heights[i] as number + 0.8;
        const [xHere, zHere] = worldXZ(t, (c + 0.5) * cs, terrain.originYM - (r + 0.5) * cs);
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const r2 = r + dr;
          const c2 = c + dc;
          let out = true;
          if (r2 >= 0 && r2 < terrain.height && c2 >= 0 && c2 < terrain.width) {
            out = (field.minutes[r2 * terrain.width + c2] as number) > threshold;
          }
          if (!out) continue;
          const i2 = r2 * terrain.width + c2;
          const hThere = r2 >= 0 && r2 < terrain.height && c2 >= 0 && c2 < terrain.width
            ? (heights[i2] as number) + 0.8
            : hHere;
          const [xThere, zThere] = r2 >= 0 && r2 < terrain.height && c2 >= 0 && c2 < terrain.width
            ? worldXZ(t, (c2 + 0.5) * cs, terrain.originYM - (r2 + 0.5) * cs)
            : [xHere + dc * cs, zHere + dr * cs];
          segs.push(xHere, hHere, zHere, xThere, hThere, zThere);
        }
        // fill quad transform for this in-range cell
        if (fillRef.current !== null && count <= n) {
          dummy.position.set(xHere, hHere, zHere);
          dummy.rotation.set(-Math.PI / 2, 0, 0);
          dummy.updateMatrix();
          fillRef.current.setMatrixAt(count - 1, dummy.matrix);
        }
      }
    }
    if (fillRef.current !== null) {
      fillRef.current.count = count;
      fillRef.current.instanceMatrix.needsUpdate = true;
    }
    if (lineRef.current !== null) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segs), 3));
      const old = lineRef.current.geometry;
      lineRef.current.geometry = geom;
      old.dispose();
    }
  }, [field, threshold, heights, terrain, t, n, cs, dummy]);

  if (threshold === Number.POSITIVE_INFINITY) return null;
  return (
    <group name="returnable-layer">
      <instancedMesh ref={fillRef} args={[undefined, undefined, n]} frustumCulled={false}>
        <planeGeometry args={[cs, cs]} />
        <meshBasicMaterial color="#ffb45e" transparent opacity={0.13} depthWrite={false} side={THREE.DoubleSide} />
      </instancedMesh>
      <lineSegments ref={lineRef} frustumCulled={false}>
        <lineBasicMaterial color="#ffb45e" transparent opacity={0.85} />
      </lineSegments>
    </group>
  );
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
  lang,
  returnable,
  lockedRoute,
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
  lang: Lang;
  /** computed returnable-range field + current resource threshold in minutes */
  returnable: { field: CostField; threshold: number } | null;
  /** plan-A (locked) route polylines for the A/B comparison */
  lockedRoute: { out: { x: number; y: number; z: number }[]; ret: { x: number; y: number; z: number }[] } | null;
}): JSX.Element {
  const t = useMemo(() => worldTransform(pkg.terrain), [pkg]);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  // closure rectangle shows once the scheduled closure event has actually fired
  const rtNow = runtimeRef.current;
  const closureActive = !!(rtNow?.schedule.closure && rtNow.T >= rtNow.schedule.closure.atSimMinutes);
  return (
    <>
    <FrameDriver onLoopMode={onLoopMode} />
    <Canvas
      frameloop="never"
      camera={{ fov: 46, near: 1, far: 30000, position: [1500, 7600, 8300] }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={(state) => {
        state.gl.toneMappingExposure = 1.5;
      }}
    >
      <color attach="background" args={["#0d0a08"]} />
      <hemisphereLight args={["#c9905e", "#241708", 0.7]} />
      <ambientLight intensity={0.26} />
      {/* key light: azimuth matches the DEM hillshade convention (NW) */}
      <directionalLight position={[-2800, 5600, -2600]} intensity={2.8} color="#ffdfc0" />
      {/* warm display-only fill from the opposite quarter to lift the shadows */}
      <directionalLight position={[3200, 1600, 3400]} intensity={0.4} color="#b98a5e" />
      <Suspense fallback={null}>
        <TerrainMesh terrain={pkg.terrain} t={t} />
      </Suspense>
      <Markers pkg={pkg} t={t} selectedSiteId={selectedSiteId} overlayRef={overlayRef} lang={lang} />
      <RouteLines
        terrain={pkg.terrain}
        t={t}
        result={result}
        strategy={strategy}
        reducedMotion={reducedMotion}
        runtimeRef={runtimeRef}
        locked={lockedRoute === null ? null : {
          out: lockedRoute.out.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
          ret: lockedRoute.ret.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
        }}
      />
      {/* mission layer: astronaut walk + closure rectangle + position marker.
          Was never mounted before (phase-4 gap surfaced by user review). */}
      <MissionLayer
        runtimeRef={runtimeRef}
        hudRef={hudRef}
        pkg={pkg}
        t={t}
        closureActive={closureActive}
      />
      {returnable !== null && (
        <ReturnableLayer
          field={returnable.field}
          threshold={returnable.threshold}
          terrain={pkg.terrain}
          t={t}
        />
      )}
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
      <FpsMeter fpsStore={fpsStore} />
    </Canvas>
    </>
  );
}

/** Command the camera from the UI: fly to a site (or back to the overview).
 * With a feasible `result`, the fly is two-stage — first focus the site, then
 * pull back to frame the WHOLE round trip. reduced-motion (instant) jumps
 * straight to the final framing; grabbing the camera mid-fly cancels the pull. */
export function flyToSite(
  pkg: LoadedPackage,
  siteId: string | null,
  instant = false,
  result?: RouteResult | null,
): void {
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
  const candidate =
    result && result.status === "feasible"
      ? result.recommended ?? result.candidates[0] ?? null
      : null;
  if (!candidate) {
    commandCamera(sitePose(t, target, base), instant);
    return;
  }
  const cells = [...candidate.outbound.pathCells, ...candidate.returnRoute.pathCells];
  const framing = routePose(t, routePolyline(pkg.terrain, t, cells, 0));
  if (instant) {
    commandCamera(framing, true);
    return;
  }
  commandCamera(sitePose(t, target, base), false, undefined, {
    pose: framing,
    durationMs: 1500,
  });
}
