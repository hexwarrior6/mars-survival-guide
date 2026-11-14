/**
 * Budget and feasibility model (SPECIFICATION.md §4):
 *   planned total   = outbound + science stop + return (return computed independently)
 *   allowed to leave = initial - planned total >= reserve
 *   reserve          = initial capacity x configured reserve fraction
 * Oxygen and battery are independent 0-100 simulated budget units.
 */

import { edgeMetrics } from "./graph.js";
import type { EdgeCostModel, SearchGraph } from "./graph.js";
import type { ReasonCode, ResourceKind, ResourceRates, RouteLeg } from "../domain/types.js";

const at = (a: Float32Array | Uint8Array, i: number): number => a[i] as number;

export function legMetricsFromPath(
  graph: SearchGraph,
  path: Array<[number, number]>,
  model: EdgeCostModel,
  rates: ResourceRates,
): RouteLeg {
  let distanceM = 0;
  let minutes = 0;
  let ascentM = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const [r1, c1] = path[i] as [number, number];
    const [r2, c2] = path[i + 1] as [number, number];
    const m = edgeMetrics(graph, r1, c1, r2, c2, model);
    if (m === null) throw new Error(`edge (${r1},${c1})->(${r2},${c2}) is illegal - corrupt path`);
    distanceM += m.distanceM;
    minutes += m.minutes;
    ascentM += m.ascentM;
  }
  return {
    pathCells: path,
    distanceM,
    minutes,
    ascentM,
    oxygen: minutes * rates.oxygenPerMin,
    battery: minutes * rates.batteryPerMin,
  };
}

export type ResourceTotals = Record<ResourceKind, number>;

export function stopConsumption(stopMinutes: number, rates: ResourceRates): ResourceTotals {
  return {
    oxygen: stopMinutes * rates.oxygenPerMin,
    battery: stopMinutes * rates.batteryPerMin,
  };
}

export interface BudgetCheck {
  feasible: boolean;
  margins: Record<ResourceKind, number>; // initial - reserve - total
  reasonCodes: ReasonCode[];
}

/** allowed to leave = initial - total >= reserve, checked per resource. */
export function checkBudget(
  totals: ResourceTotals,
  initial: Record<ResourceKind, number>,
  reserveFractions: Record<ResourceKind, number>,
): BudgetCheck {
  const margins: Record<ResourceKind, number> = { oxygen: 0, battery: 0 };
  const reasonCodes: ReasonCode[] = [];
  let feasible = true;
  for (const kind of ["oxygen", "battery"] as ResourceKind[]) {
    const reserve = initial[kind] * reserveFractions[kind];
    const margin = initial[kind] - reserve - totals[kind];
    margins[kind] = margin;
    if (margin < 0) {
      feasible = false;
      reasonCodes.push(kind === "oxygen" ? "over_budget_oxygen" : "over_budget_battery");
    }
  }
  return { feasible, margins, reasonCodes };
}

/** Verify a path never touches an impassable cell (used by tests and validators). */
export function pathIsPassable(graph: SearchGraph, path: Array<[number, number]>): boolean {
  for (const [r, c] of path) {
    const idx = r * graph.width + c;
    if (at(graph.passable, idx) !== 1) return false;
  }
  return true;
}
