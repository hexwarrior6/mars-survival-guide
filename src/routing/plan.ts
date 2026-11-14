/**
 * Round-trip planning assembly: RouteRequest -> RouteResult (SPECIFICATION.md §3-4).
 * Candidates are the two frozen strategies only; feasibility is checked per
 * candidate; failure wording never exceeds the limited-candidate search claim.
 */

import { edgeCostModel, buildSearchGraph } from "./graph.js";
import type { EdgeCostModel, GraphOptions, SearchGraph } from "./graph.js";
import { astar } from "./search.js";
import { legMetricsFromPath, stopConsumption, checkBudget } from "./budget.js";
import { snapToCell } from "../domain/load.js";
import { PARAMS_VERSION, isFiniteNumber, checkRange, PARAM_RANGES } from "../domain/assumptions.js";
import type {
  LoadedPackage,
} from "../domain/load.js";
import type {
  ReasonCode,
  RouteLeg,
  RouteRequest,
  RouteResult,
  SnapInfo,
  Strategy,
  StrategyCandidate,
} from "../domain/types.js";

const ALL_STRATEGIES: readonly Strategy[] = ["shortest", "terrain-aware"];

function invalidResult(
  requestId: string,
  problems: string[],
  measuredMs: number,
): RouteResult {
  return {
    requestId,
    status: "invalid_input",
    candidates: [],
    recommended: null,
    reasonCodes: ["invalid_input"],
    message: `invalid input: ${problems.join("; ")}`,
    snap: null,
    dataVersions: { region: "", scenario: "", terrain: "" },
    paramsVersion: PARAMS_VERSION,
    measuredMs,
  };
}

function unreachableResult(
  requestId: string,
  reason: ReasonCode,
  detail: string,
  measuredMs: number,
  dataVersions: RouteResult["dataVersions"],
): RouteResult {
  return {
    requestId,
    status: "unreachable",
    candidates: [],
    recommended: null,
    reasonCodes: [reason],
    message: detail,
    snap: null,
    dataVersions,
    paramsVersion: PARAMS_VERSION,
    measuredMs,
  };
}

interface TargetRef {
  row: number;
  col: number;
  snap: SnapInfo;
}

function resolveTarget(
  pkg: LoadedPackage,
  request: RouteRequest,
): { ok: true; target: TargetRef } | { ok: false; problem: string } {
  if (request.targetSiteId !== undefined) {
    const site = pkg.sites.find((s) => s.id === request.targetSiteId);
    if (!site) return { ok: false, problem: `unknown targetSiteId ${request.targetSiteId}` };
    if (!pkg.scenario.availableSiteIds.includes(site.id)) {
      return { ok: false, problem: `site ${site.id} is not available in this scenario` };
    }
    const snap = snapToCell(pkg.terrain, site.xM, site.yM);
    if (!snap) return { ok: false, problem: `site ${site.id} coordinates outside grid` };
    return { ok: true, target: { row: snap.row, col: snap.col, snap: { requestedXM: site.xM, requestedYM: site.yM, ...snap } } };
  }
  if (!isFiniteNumber(request.targetXM) || !isFiniteNumber(request.targetYM)) {
    return { ok: false, problem: "target coordinates missing or not finite" };
  }
  const snap = snapToCell(pkg.terrain, request.targetXM, request.targetYM);
  if (!snap) {
    return { ok: false, problem: `target (${request.targetXM}, ${request.targetYM}) outside grid or more than one cell from any cell center` };
  }
  return { ok: true, target: { row: snap.row, col: snap.col, snap: { requestedXM: request.targetXM, requestedYM: request.targetYM, ...snap } } };
}

function whyImpassable(
  graph: SearchGraph,
  terrain: import("../domain/types.js").TerrainGrid,
  row: number,
  col: number,
  blockMask: Uint8Array | null,
): ReasonCode {
  const idx = row * graph.width + col;
  if ((terrain.validMask[idx] as number) !== 1) return "unknown_terrain";
  if (blockMask && (blockMask[idx] as number) === 1) return "event_closed";
  return "slope_blocked";
}

export function planRoundTrip(pkg: LoadedPackage, request: RouteRequest): RouteResult {
  const t0 = performance.now();
  const problems: string[] = [];

  // ---- request validation (R3: zero/negative/NaN/out-of-range rejected) ----
  if (typeof request.requestId !== "string" || request.requestId.length === 0) {
    problems.push("requestId must be a non-empty string");
  }
  if (!isFiniteNumber(request.startXM) || !isFiniteNumber(request.startYM)) {
    problems.push("start coordinates must be finite numbers");
  }
  if (request.strategies === undefined || request.strategies.length === 0) {
    problems.push("at least one strategy required");
  } else {
    for (const s of request.strategies) {
      if (!ALL_STRATEGIES.includes(s)) problems.push(`unknown strategy ${String(s)}`);
    }
  }
  if (isFiniteNumber(request.stopMinutes)) {
    const e = checkRange("stopMinutes", request.stopMinutes, PARAM_RANGES.stopMinutes);
    if (e) problems.push(e);
  } else {
    problems.push("stopMinutes must be a finite number");
  }
  for (const kind of ["oxygen", "battery"] as const) {
    const v = request.initialResources?.[kind];
    if (!isFiniteNumber(v) || v <= 0) problems.push(`initialResources.${kind} must be > 0, got ${String(v)}`);
    const f = request.reserveFractions?.[kind];
    if (!isFiniteNumber(f) || f < 0 || f > 0.5) {
      problems.push(`reserveFractions.${kind} must be within [0, 0.5], got ${String(f)}`);
    }
  }
  if (problems.length > 0) return invalidResult(request.requestId ?? "", problems, performance.now() - t0);

  // ---- snapping (shown in the result, limited to one cell width) ----
  const startSnap = snapToCell(pkg.terrain, request.startXM, request.startYM);
  if (!startSnap) {
    return invalidResult(
      request.requestId,
      [`start (${request.startXM}, ${request.startYM}) outside grid or more than one cell from any cell center`],
      performance.now() - t0,
    );
  }
  const target = resolveTarget(pkg, request);
  if (!target.ok) {
    return invalidResult(request.requestId, [target.problem], performance.now() - t0);
  }

  const graphOptions: GraphOptions = {
    slopeThresholdDeg: pkg.scenario.movementParameters.passabilitySlopeThresholdDeg,
    blockMask: request.blockMask ?? null,
  };
  const graph = buildSearchGraph(pkg.terrain, graphOptions);

  const dataVersions: RouteResult["dataVersions"] = {
    region: pkg.region.schemaVersion,
    scenario: pkg.scenario.schemaVersion,
    terrain: pkg.scenario.schemaVersion,
  };

  // ---- start/target passability (deterministic reason codes) ----
  const startIdx = startSnap.row * graph.width + startSnap.col;
  const targetIdx = target.target.row * graph.width + target.target.col;
  if ((graph.passable[startIdx] as number) !== 1) {
    const reason = whyImpassable(graph, pkg.terrain, startSnap.row, startSnap.col, request.blockMask ?? null);
    return unreachableResult(
      request.requestId,
      reason,
      `start cell (row ${startSnap.row}, col ${startSnap.col}) is impassable (${reason})`,
      performance.now() - t0,
      dataVersions,
    );
  }
  if ((graph.passable[targetIdx] as number) !== 1) {
    const reason = whyImpassable(graph, pkg.terrain, target.target.row, target.target.col, request.blockMask ?? null);
    return unreachableResult(
      request.requestId,
      reason,
      `target cell (row ${target.target.row}, col ${target.target.col}) is impassable (${reason})`,
      performance.now() - t0,
      dataVersions,
    );
  }

  // ---- per-strategy candidates ----
  const rates = pkg.scenario.resourceRates;
  const candidates: StrategyCandidate[] = [];
  let sawAnyPath = false;

  for (const strategy of request.strategies) {
    const model: EdgeCostModel = edgeCostModel(pkg.scenario.movementParameters, strategy);
    const outSearch = astar(graph, startSnap.row, startSnap.col, target.target.row, target.target.col, model);
    if (!outSearch.found || outSearch.path === null) continue; // same graph for every strategy
    sawAnyPath = true;
    const backSearch = astar(graph, target.target.row, target.target.col, startSnap.row, startSnap.col, model);
    if (!backSearch.found || backSearch.path === null) {
      // cannot happen with a symmetric passability graph, but fail loudly if it ever does
      return unreachableResult(
        request.requestId,
        "target_unreachable",
        "return route not found although outbound exists - inconsistent graph",
        performance.now() - t0,
        dataVersions,
      );
    }
    const outbound: RouteLeg = legMetricsFromPath(graph, outSearch.path, model, rates);
    const returnRoute: RouteLeg = legMetricsFromPath(graph, backSearch.path, model, rates);
    const stop = stopConsumption(request.stopMinutes, rates);
    const totals = {
      distanceM: outbound.distanceM + returnRoute.distanceM,
      minutes: outbound.minutes + request.stopMinutes + returnRoute.minutes,
      oxygen: outbound.oxygen + stop.oxygen + returnRoute.oxygen,
      battery: outbound.battery + stop.battery + returnRoute.battery,
    };
    const budget = checkBudget(totals, request.initialResources, request.reserveFractions);
    candidates.push({
      strategy,
      status: budget.feasible ? "feasible" : "over_budget",
      outbound,
      returnRoute,
      stopMinutes: request.stopMinutes,
      totals,
      margins: budget.margins,
      reasonCodes: budget.reasonCodes,
    });
  }

  const measuredMs = performance.now() - t0;

  if (!sawAnyPath) {
    return {
      requestId: request.requestId,
      status: "unreachable",
      candidates,
      recommended: null,
      reasonCodes: ["target_unreachable"],
      message:
        "no spatial path from base to target on the passable grid (unknown terrain, slope or " +
        "closure blocking all routes); no route is returned",
      snap: { start: { requestedXM: request.startXM, requestedYM: request.startYM, ...startSnap }, target: target.target.snap },
      dataVersions,
      paramsVersion: PARAMS_VERSION,
      measuredMs,
    };
  }

  const feasible = candidates.filter((c) => c.status === "feasible");
  if (feasible.length === 0) {
    return {
      requestId: request.requestId,
      status: "over_budget",
      candidates,
      recommended: null,
      reasonCodes: ["no_feasible_candidate_in_current_strategies"],
      message:
        "在当前策略下未找到满足预算的方案 (no candidate among the searched strategies satisfies " +
        "the budget); this does not prove that no other path exists - the search covered the " +
        "two strategies only",
      snap: { start: { requestedXM: request.startXM, requestedYM: request.startYM, ...startSnap }, target: target.target.snap },
      dataVersions,
      paramsVersion: PARAMS_VERSION,
      measuredMs,
    };
  }

  feasible.sort((a, b) => a.totals.minutes - b.totals.minutes);
  const best = feasible[0] as StrategyCandidate;
  return {
    requestId: request.requestId,
    status: "feasible",
    candidates,
    recommended: best,
    reasonCodes: [],
    message:
      `feasible via strategy "${best.strategy}": round trip ${best.totals.distanceM.toFixed(0)} m, ` +
      `${best.totals.minutes.toFixed(0)} min, oxygen ${best.totals.oxygen.toFixed(1)}, battery ${best.totals.battery.toFixed(1)}`,
    snap: { start: { requestedXM: request.startXM, requestedYM: request.startYM, ...startSnap }, target: target.target.snap },
    dataVersions,
    paramsVersion: PARAMS_VERSION,
    measuredMs,
  };
}
