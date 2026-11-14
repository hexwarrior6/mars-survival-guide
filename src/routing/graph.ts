/**
 * 8-neighbor search graph over the planning grid (SPECIFICATION.md §4.1):
 * - passable cells: validMask == 1 AND slopeDeg <= threshold AND not blocked by the
 *   optional event-closure mask;
 * - unknown cells are NEVER passable (they must not become 0-elevation free space);
 * - diagonal moves are rejected when BOTH adjacent orthogonal cells are impassable
 *   (no cutting through the corner of two obstacles);
 * - edges cost meters (`shortest`) or minutes (`terrain-aware`), both non-negative.
 */

import type { MovementParameters, ResourceRates, Strategy, TerrainGrid } from "../domain/types.js";

export interface SearchGraph {
  readonly width: number;
  readonly height: number;
  readonly cellSizeM: number;
  /** 1 = passable */
  readonly passable: Uint8Array;
  readonly elevationsM: Float32Array;
  readonly slopeDeg: Float32Array;
  readonly blockedCount: number;
  readonly unknownCount: number;
  readonly slopeBlockedCount: number;
}

export interface GraphOptions {
  slopeThresholdDeg: number;
  /** optional event closure overlay, 1 = blocked; same shape as the grid */
  blockMask?: Uint8Array | null;
}

export function buildSearchGraph(terrain: TerrainGrid, opts: GraphOptions): SearchGraph {
  const n = terrain.width * terrain.height;
  const passable = new Uint8Array(n);
  let blockedCount = 0;
  let unknownCount = 0;
  let slopeBlockedCount = 0;
  for (let i = 0; i < n; i++) {
    const valid = (terrain.validMask[i] as number) === 1;
    if (!valid) {
      unknownCount++;
      continue;
    }
    const slope = terrain.slopeDeg[i] as number;
    if (slope > opts.slopeThresholdDeg) {
      slopeBlockedCount++;
      continue;
    }
    if (opts.blockMask && (opts.blockMask[i] as number) === 1) {
      blockedCount++;
      continue;
    }
    passable[i] = 1;
  }
  return {
    width: terrain.width,
    height: terrain.height,
    cellSizeM: terrain.cellSizeM,
    passable,
    elevationsM: terrain.elevationsM,
    slopeDeg: terrain.slopeDeg,
    blockedCount,
    unknownCount,
    slopeBlockedCount,
  };
}

export interface EdgeCostModel {
  strategy: Strategy;
  baseSpeedMPM: number;
  slopeTimeFactorPerDeg: number;
  ascentPenaltyMinPerM: number;
}

export function edgeCostModel(movement: MovementParameters, strategy: Strategy): EdgeCostModel {
  return {
    strategy,
    baseSpeedMPM: movement.baseSpeedMPM,
    slopeTimeFactorPerDeg: movement.slopeTimeFactorPerDeg,
    ascentPenaltyMinPerM: movement.ascentPenaltyMinPerM,
  };
}

export interface EdgeMetrics {
  /** search cost: meters (`shortest`) or minutes (`terrain-aware`) */
  cost: number;
  distanceM: number;
  minutes: number;
  ascentM: number;
}

const at = (a: Float32Array | Uint8Array, i: number): number => a[i] as number;

/**
 * Metrics of one straight edge between adjacent cells. Returns null when the move
 * is illegal (either cell impassable, or a diagonal cutting a two-obstacle corner).
 */
export function edgeMetrics(
  graph: SearchGraph,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
  model: EdgeCostModel,
): EdgeMetrics | null {
  const dr = toRow - fromRow;
  const dc = toCol - fromCol;
  const adr = Math.abs(dr);
  const adc = Math.abs(dc);
  if (adr > 1 || adc > 1 || (adr === 0 && adc === 0)) return null;
  const w = graph.width;
  const from = fromRow * w + fromCol;
  const to = toRow * w + toCol;
  if ((at(graph.passable, from)) !== 1 || (at(graph.passable, to)) !== 1) return null;
  if (adr === 1 && adc === 1) {
    const orthoA = fromRow * w + toCol; // (fromRow, toCol)
    const orthoB = toRow * w + fromCol; // (toRow, fromCol)
    const aOk = (at(graph.passable, orthoA)) === 1;
    const bOk = (at(graph.passable, orthoB)) === 1;
    if (!aOk && !bOk) return null; // corner of two obstacles: forbidden
  }
  const distanceM = graph.cellSizeM * Math.hypot(dr, dc);
  const dz = (at(graph.elevationsM, to)) - (at(graph.elevationsM, from));
  const slopeDeg = (Math.atan2(Math.abs(dz), distanceM) * 180) / Math.PI;
  const timeMultiplier = 1 + slopeDeg * model.slopeTimeFactorPerDeg;
  const minutes =
    distanceM / (model.baseSpeedMPM / timeMultiplier) +
    Math.max(0, dz) * model.ascentPenaltyMinPerM;
  const cost = model.strategy === "shortest" ? distanceM : minutes;
  return { cost, distanceM, minutes, ascentM: Math.max(0, dz) };
}

/** Minimal possible cost per meter of straight-line distance for the heuristic. */
export function minUnitCost(model: EdgeCostModel): number {
  if (model.strategy === "shortest") return 1; // meters per meter
  // minutes per meter: best case = flat ground, no climb
  return 1 / model.baseSpeedMPM;
}
