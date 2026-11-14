/**
 * Synthetic grid fixtures for algorithm tests. These are TEST fixtures only —
 * they never pass as scientific data (docs/IMPLEMENTATION.md phase 2 boundary).
 */

import type { TerrainGrid, MovementParameters, ResourceRates } from "../src/domain/types.js";

export interface GridSpec {
  width: number;
  height: number;
  cellSizeM?: number;
  /** elevation in meters per cell, or a constant */
  elevations?: number[] | number;
  /** 1 = valid, 0 = unknown; default all valid */
  valid?: number[] | number;
  /** slope in degrees per cell, or a constant */
  slopes?: number[] | number;
}

export function makeGrid(spec: GridSpec): TerrainGrid {
  const n = spec.width * spec.height;
  const elevations = new Float32Array(n);
  const valid = new Uint8Array(n);
  const slopes = new Float32Array(n);
  const fill = (arr: Float32Array | Uint8Array, v: number[] | number | undefined, def: number): void => {
    if (Array.isArray(v)) {
      for (let i = 0; i < n; i++) {
        (arr as unknown as number[])[i] = v[i] ?? def;
      }
    } else if (typeof v === "number") {
      arr.fill(v);
    } else {
      arr.fill(def);
    }
  };
  fill(elevations, spec.elevations, 0);
  fill(valid, spec.valid, 1);
  fill(slopes, spec.slopes, 0);
  return {
    width: spec.width,
    height: spec.height,
    cellSizeM: spec.cellSizeM ?? 20,
    originYM: spec.height * (spec.cellSizeM ?? 20),
    elevationsM: elevations,
    validMask: valid,
    slopeDeg: slopes,
    sourceIds: ["test-fixture"],
  };
}

export const TEST_MOVEMENT: MovementParameters = {
  passabilitySlopeThresholdDeg: 20,
  baseSpeedMPM: 40, // m/min -> 20 m flat cell = 0.5 min, diagonal = 0.7071 min
  slopeTimeFactorPerDeg: 0.05,
  ascentPenaltyMinPerM: 0.3,
};

export const TEST_RATES: ResourceRates = {
  oxygenPerMin: 0.2, // 100 units / 500 min
  batteryPerMin: 0.2,
};
