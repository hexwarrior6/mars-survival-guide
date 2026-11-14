/**
 * Grid <-> 3D world mapping for the sandbox (display layer only).
 *
 * Horizontal world coordinates are EXACT local meters (x east, z south so that
 * north = -z), shifted to center the region on the origin. Vertical world
 * coordinates use a documented display exaggeration (RELIEF_SCALE) applied
 * consistently to terrain, markers and routes; horizontal geometry and all
 * computed numbers are never distorted. The 2D plan view is undistorted.
 */

import type { TerrainGrid } from "./types.js";

export const RELIEF_SCALE = 3; // documented vertical display exaggeration
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

/** Overview pose for the whole region. */
export function overviewPose(t: WorldTransform, heightSpanY: number): CameraPose {
  const d = 6600;
  return {
    target: { x: 0, y: heightSpanY * 0.3, z: 0 },
    position: { x: 0, y: d * 0.7, z: d },
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
