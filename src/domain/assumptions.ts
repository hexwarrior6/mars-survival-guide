/**
 * Central registry of planning assumptions (SPECIFICATION.md §4: defaults must be
 *集中记录). Every value here is a simulated planning assumption for the demo
 * scenario — none is validated astronaut or life-support guidance. The ids mirror
 * the "assumptions" section of public/data/jezero/sources.json.
 */

import type { MovementParameters, ResourceRates, ResourceKind } from "./types.js";

export const PACKAGE_SCHEMA_VERSION = "1.1";
export const PARAMS_VERSION = "phase2-params-1";

export const RESOURCE_KINDS: readonly ResourceKind[] = ["oxygen", "battery"];

export interface ParameterRange {
  min: number;
  max: number;
  /** inclusive upper bound */
  inclusiveMax: boolean;
}

export const PARAM_RANGES = {
  passabilitySlopeThresholdDeg: { min: 5, max: 45, inclusiveMax: true },
  baseSpeedMPM: { min: 10, max: 100, inclusiveMax: true },
  slopeTimeFactorPerDeg: { min: 0, max: 0.15, inclusiveMax: true },
  ascentPenaltyMinPerM: { min: 0, max: 1, inclusiveMax: true },
  oxygenPerMin: { min: 0.001, max: 1, inclusiveMax: true },
  batteryPerMin: { min: 0.001, max: 1, inclusiveMax: true },
  initialResource: { min: 1, max: 1000, inclusiveMax: true },
  reserveFraction: { min: 0, max: 0.5, inclusiveMax: true },
  stopMinutes: { min: 0, max: 240, inclusiveMax: true },
  /** a planned leg may not exceed a full nominal EVA */
  legMinutes: { min: 0, max: 1440, inclusiveMax: true },
} as const satisfies Record<string, ParameterRange>;

/** ids referenced by scenario.json.assumptionIds and sources.json.assumptions */
export const ASSUMPTIONS: ReadonlyMap<string, string> = new Map([
  ["sim-passability-threshold", "slope <= 20 deg passable (20 m planning grid; demo threshold)"],
  ["sim-reserve-20pct", "reserve = 20% of initial capacity per resource (demo value, not a NASA standard)"],
  ["sim-stop-duration", "30 min science stop per site (uniform placeholder)"],
  ["sim-speed-base", "40 m/min (2.4 km/h) flat suited walking"],
  ["sim-speed-slope", "edge time x(1 + slopeDeg*0.05); 20 deg -> 2.0x slower"],
  ["sim-climb-penalty", "+0.3 min per meter of net ascent; descent unpenalized in v1"],
  ["sim-resource-rates", "oxygen 0.2083/min, battery 0.2083/min (100 units / 480 min nominal EVA)"],
]);

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function checkRange(name: string, v: number, r: ParameterRange): string | null {
  if (v < r.min || v > r.max || (r.inclusiveMax === false && v === r.max)) {
    return `${name}=${v} outside allowed range [${r.min}, ${r.inclusiveMax ? "" : "exclusive "}${r.max}]`;
  }
  return null;
}

export function validateMovementParameters(p: MovementParameters): string[] {
  const errors: string[] = [];
  const checks: Array<[string, number, ParameterRange]> = [
    ["passabilitySlopeThresholdDeg", p.passabilitySlopeThresholdDeg, PARAM_RANGES.passabilitySlopeThresholdDeg],
    ["baseSpeedMPM", p.baseSpeedMPM, PARAM_RANGES.baseSpeedMPM],
    ["slopeTimeFactorPerDeg", p.slopeTimeFactorPerDeg, PARAM_RANGES.slopeTimeFactorPerDeg],
    ["ascentPenaltyMinPerM", p.ascentPenaltyMinPerM, PARAM_RANGES.ascentPenaltyMinPerM],
  ];
  for (const [name, value, range] of checks) {
    if (!isFiniteNumber(value)) errors.push(`${name} must be a finite number, got ${String(value)}`);
    else {
      const e = checkRange(name, value, range);
      if (e) errors.push(e);
    }
  }
  return errors;
}

export function validateResourceRates(r: ResourceRates): string[] {
  const errors: string[] = [];
  const checks: Array<[string, number, ParameterRange]> = [
    ["oxygenPerMin", r.oxygenPerMin, PARAM_RANGES.oxygenPerMin],
    ["batteryPerMin", r.batteryPerMin, PARAM_RANGES.batteryPerMin],
  ];
  for (const [name, value, range] of checks) {
    if (!isFiniteNumber(value)) errors.push(`${name} must be a finite number, got ${String(value)}`);
    else {
      const e = checkRange(name, value, range);
      if (e) errors.push(e);
    }
  }
  return errors;
}

export function validateResourceAmount(
  name: string,
  value: number,
  capacity: number,
): string | null {
  if (!isFiniteNumber(value)) return `${name} must be a finite number, got ${String(value)}`;
  if (value < PARAM_RANGES.initialResource.min) return `${name}=${value} must be >= ${PARAM_RANGES.initialResource.min}`;
  if (value > capacity) return `${name}=${value} exceeds capacity ${capacity}`;
  return null;
}

export function validateReserveFraction(name: string, value: number): string | null {
  if (!isFiniteNumber(value)) return `${name} must be a finite number, got ${String(value)}`;
  const e = checkRange(name, value, PARAM_RANGES.reserveFraction);
  return e;
}
