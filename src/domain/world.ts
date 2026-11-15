/**
 * Grid <-> 3D world mapping for the sandbox (display layer only).
 *
 * Horizontal world coordinates are EXACT local meters (x east, z south so that
 * north = -z), shifted to center the region on the origin. Vertical world
 * coordinates use a documented display exaggeration (RELIEF_SCALE) applied
 * consistently to terrain, markers and routes; horizontal geometry and all
 * computed numbers are never distorted. The 2D plan view is undistorted.
 *
 * RELIEF_SCALE is a DISPLAY number: 210 m of real relief across 5.12 km reads as
 * a pancake at 1:1, so the plate is exaggerated. The UI states the factor.
 */

import type { TerrainGrid } from "./types.js";

export const RELIEF_SCALE = 4.5; // documented vertical display exaggeration
/** vertical display offset: lowest region elevation maps to world y = 0 */
export function datumElevationM(terrain: TerrainGrid): number {
  let min = Infinity;
  for (let i = 0; i < terrain.elevationsM.length; i++) {
    const v = terrain.elevationsM[i] as number;
    if ((terrain.validMask[i] as number) === 1 && v < min) min = v;
  }
  return Number.isFinite(min) ? min : 0;
}

export interface WorldTransform {
  /** meters per world unit horizontally (1:1) */
  cellSizeM: number;
  /** local-frame half-width/height used to center the region on the origin */
  halfWidthM: number;
  halfHeightM: number;
  datumM: number;
}

export function worldTransform(terrain: TerrainGrid): WorldTransform {
  return {
    cellSizeM: terrain.cellSizeM,
    halfWidthM: (terrain.width * terrain.cellSizeM) / 2,
    halfHeightM: (terrain.height * terrain.cellSizeM) / 2,
    datumM: datumElevationM(terrain),
  };
}

/** local meters (x east, y north) -> world x/z, region centered on origin */
export function worldXZ(t: WorldTransform, xM: number, yM: number): [number, number] {
  return [xM - t.halfWidthM, t.halfHeightM - yM];
}

/** elevation meters -> world y with the documented relief scale */
export function worldY(t: WorldTransform, elevationM: number): number {
  return (elevationM - t.datumM) * RELIEF_SCALE;
}

/**
 * Bilinear elevation sampling at local (xM, yM) in meters. Unknown cells are
 * skipped in the bilinear blend when possible, else the nearest valid sample is
 * used; fully unknown inputs return the datum. Never returns fake 0 m.
 */
export function sampleElevationM(
  terrain: TerrainGrid,
  xM: number,
  yM: number,
  datumM: number,
): number {
  const cs = terrain.cellSizeM;
  const colF = Math.min(Math.max(xM / cs - 0.5, 0), terrain.width - 1);
  const rowF = Math.min(
    Math.max(terrain.height - yM / cs - 0.5, 0),
    terrain.height - 1,
  );
  const c0 = Math.floor(colF);
  const r0 = Math.floor(rowF);
  const c1 = Math.min(c0 + 1, terrain.width - 1);
  const r1 = Math.min(r0 + 1, terrain.height - 1);
  const fc = colF - c0;
  const fr = rowF - r0;
  const idx = (r: number, c: number): number => r * terrain.width + c;
  const valid = (r: number, c: number): boolean =>
    (terrain.validMask[idx(r, c)] as number) === 1;
  const h = (r: number, c: number): number | null =>
    valid(r, c) ? (terrain.elevationsM[idx(r, c)] as number) : null;
  const h00 = h(r0, c0);
  const h01 = h(r0, c1);
  const h10 = h(r1, c0);
  const h11 = h(r1, c1);
  const known: Array<[number, number]> = [];
  if (h00 !== null) known.push([h00, (1 - fc) * (1 - fr)]);
  if (h01 !== null) known.push([h01, fc * (1 - fr)]);
  if (h10 !== null) known.push([h10, (1 - fc) * fr]);
  if (h11 !== null) known.push([h11, fc * fr]);
  if (known.length === 0) return datumM;
  let sum = 0;
  let wsum = 0;
  for (const [v, w] of known) {
    sum += v * w;
    wsum += w;
  }
  return sum / wsum;
}

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/** World position of a grid cell center (marker/route anchor, incl. relief). */
export function cellWorldPosition(
  terrain: TerrainGrid,
  t: WorldTransform,
  row: number,
  col: number,
  liftM = 0,
): WorldPoint {
  const centerXM = (col + 0.5) * terrain.cellSizeM;
  const centerYM = terrain.originYM - (row + 0.5) * terrain.cellSizeM;
  const [x, z] = worldXZ(t, centerXM, centerYM);
  const elev = sampleElevationM(terrain, centerXM, centerYM, t.datumM);
  return { x, y: worldY(t, elev) + liftM * RELIEF_SCALE, z };
}

/** World polyline for a route path (terrain-hugging, small consistent lift). */
export function routePolyline(
  terrain: TerrainGrid,
  t: WorldTransform,
  pathCells: Array<[number, number]>,
  liftM = 1.5,
): WorldPoint[] {
  return pathCells.map(([r, c]) => cellWorldPosition(terrain, t, r, c, liftM));
}

export interface CameraPose {
  position: WorldPoint;
  target: WorldPoint;
}

/** Overview pose for the whole region: an oblique framing that keeps the whole
 * tile in view but reads as terrain rather than a flat plan. */
export function overviewPose(t: WorldTransform, heightSpanY: number): CameraPose {
  // far enough that the cut-away block lands inside the frame with margin at
  // 1600x900 (the block adds visible weight below the plate edge)
  const d = 7200;
  return {
    target: { x: 0, y: heightSpanY * 0.18, z: 0 },
    position: { x: -d * 0.16, y: d * 0.62, z: d * 0.88 },
  };
}

/** Opening shot for the intro move: high and far to the south-east, so the
 * 2.5 s ease down to the overview reads as a descent onto the terrain. */
export function introPose(t: WorldTransform): CameraPose {
  return {
    target: { x: 0, y: 60, z: 0 },
    position: { x: 1500, y: 7600, z: 8300 },
  };
}

/** Camera pose that frames a WHOLE route (outbound + return): bounding sphere
 * of the world-space path points, camera pulled back along the same oblique
 * family as the overview until the sphere fits the vertical field of view with
 * margin. Vertical fov is 46° in the Sandbox camera (half = 23°). */
export function routePose(t: WorldTransform, pts: WorldPoint[]): CameraPose {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    maxZ = Math.max(maxZ, p.z);
  }
  const center = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
  };
  const radius = Math.max(400, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
  // |camera-center| must be >= radius / sin(halfFov=23°) ≈ 2.56·radius; the
  // camera offset below has length 0.877·dist (direction is unit-horizontal),
  // so dist = 3.3·radius leaves ~13% margin. Clamped to the OrbitControls
  // range — a clamp on a route longer than ~5 km radius may crop the edges
  // (the frozen Jezero scenarios stay inside the unclamped range).
  // NOTE (2026-11-15): an earlier pass pulled this back to a 34° oblique at
  // 5.6–7.25 km. That made the plate small. The close, large route framing is
  // the requested behaviour; the cut-away block reads in the overview instead.
  const dist = Math.min(8800, Math.max(2000, 3.3 * radius));
  const dirX = -0.28;
  const dirZ = 0.96; // unit-horizontal, south-east-ish like the overview
  return {
    target: center,
    position: {
      x: center.x + dirX * dist * 0.62,
      y: center.y + dist * 0.62,
      z: center.z + dirZ * dist * 0.62,
    },
  };
}

/** Pose framing a target site while keeping the base roughly in view. */
export function sitePose(
  t: WorldTransform,
  target: WorldPoint,
  base: WorldPoint,
): CameraPose {
  const dist = Math.hypot(target.x - base.x, target.z - base.z);
  const d = Math.min(3200, Math.max(1900, dist * 1.7));
  // stand on the base side of the target, elevated high enough to read the relief
  const dirX = base.x - target.x;
  const dirZ = base.z - target.z;
  const len = Math.hypot(dirX, dirZ) || 1;
  return {
    target: { ...target },
    position: {
      x: target.x + (dirX / len) * d * 0.52,
      y: target.y + d * 0.6,
      z: target.z + (dirZ / len) * d * 0.52,
    },
  };
}

export const DEFAULT_POSE = { azimuthDeg: 180 }; // look from the south by default
