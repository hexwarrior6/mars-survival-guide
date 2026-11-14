/**
 * R3 (monotonicity; zero/negative/NaN/out-of-range rejection) and R4 (all legs
 * counted; exact-reserve boundary; independent return) tests.
 */

import { describe, it, expect } from "vitest";
import { makeGrid, TEST_MOVEMENT, TEST_RATES } from "./helpers.js";
import { buildSearchGraph, edgeCostModel } from "../src/routing/graph.js";
import { legMetricsFromPath, stopConsumption } from "../src/routing/budget.js";
import { planRoundTrip } from "../src/routing/plan.js";
import type { LoadedPackage } from "../src/domain/load.js";
import type { RouteRequest } from "../src/domain/types.js";

const FLAT = edgeCostModel(TEST_MOVEMENT, "shortest");

function straightCorridorGrid(cells: number, cellSizeM = 20) {
  return makeGrid({ width: cells, height: 1, cellSizeM });
}

describe("R3: monotonicity and invalid inputs", () => {
  it("longer path never costs fewer resources", () => {
    const grid = straightCorridorGrid(8);
    const g = buildSearchGraph(grid, { slopeThresholdDeg: 20 });
    const short = legMetricsFromPath(
      g,
      [
        [0, 0],
        [0, 1],
        [0, 2],
      ],
      FLAT,
      TEST_RATES,
    );
    const long = legMetricsFromPath(
      g,
      [
        [0, 0],
        [0, 1],
        [0, 2],
        [0, 3],
        [0, 4],
      ],
      FLAT,
      TEST_RATES,
    );
    expect(long.distanceM).toBeGreaterThan(short.distanceM);
    expect(long.minutes).toBeGreaterThan(short.minutes);
    expect(long.oxygen).toBeGreaterThan(short.oxygen);
    expect(long.battery).toBeGreaterThan(short.battery);
  });

  it("longer science stop never reduces total consumption; zero stop consumes nothing", () => {
    const s10 = stopConsumption(10, TEST_RATES);
    const s60 = stopConsumption(60, TEST_RATES);
    expect(s60.oxygen).toBeGreaterThan(s10.oxygen);
    expect(s60.battery).toBeGreaterThan(s10.battery);
    expect(stopConsumption(0, TEST_RATES).oxygen).toBe(0);
    expect(stopConsumption(0, TEST_RATES).battery).toBe(0);
  });

  it("a steeper grade never shortens travel time (edge grade derives from elevation)", () => {
    const flatGrid = makeGrid({ width: 2, height: 1, elevations: [0, 0] });
    // 7 m over 20 m = 19.3 deg < 20 threshold, so the cell stays passable
    const gradeGrid = makeGrid({ width: 2, height: 1, elevations: [0, 7] });
    const gFlat = buildSearchGraph(flatGrid, { slopeThresholdDeg: 20 });
    const gGrade = buildSearchGraph(gradeGrid, { slopeThresholdDeg: 20 });
    const flat = legMetricsFromPath(
      gFlat,
      [
        [0, 0],
        [0, 1],
      ],
      FLAT,
      TEST_RATES,
    );
    const grade = legMetricsFromPath(
      gGrade,
      [
        [0, 0],
        [0, 1],
      ],
      FLAT,
      TEST_RATES,
    );
    expect(grade.minutes).toBeGreaterThan(flat.minutes);
  });

  it("planRoundTrip rejects NaN, negative, zero and out-of-range inputs with invalid_input", () => {
    const pkg = makeSyntheticPackage();
    const base = {
      requestId: "t",
      startXM: pkg.scenario.base.xM,
      startYM: pkg.scenario.base.yM,
      targetSiteId: "S1",
      strategies: ["shortest" as const],
      stopMinutes: 10,
      initialResources: { oxygen: 100, battery: 100 },
      reserveFractions: { oxygen: 0.2, battery: 0.2 },
      paramsVersion: "test",
    };
    const bad: Array<Partial<RouteRequest>> = [
      { startXM: Number.NaN },
      { startYM: -5 },
      { stopMinutes: Number.NaN },
      { stopMinutes: -1 },
      { initialResources: { oxygen: 0, battery: 100 } },
      { initialResources: { oxygen: Number.NaN, battery: 100 } },
      { reserveFractions: { oxygen: -0.1, battery: 0.2 } },
      { reserveFractions: { oxygen: 0.9, battery: 0.2 } },
      { strategies: [] },
      { strategies: ["teleport" as never] },
    ];
    for (const patch of bad) {
      const r = planRoundTrip(pkg, { ...base, ...patch } as RouteRequest);
      expect(r.status, JSON.stringify(patch)).toBe("invalid_input");
      expect(r.reasonCodes).toContain("invalid_input");
    }
    // out-of-grid start
    const r2 = planRoundTrip(pkg, { ...base, startXM: 9999, startYM: 9999 });
    expect(r2.status).toBe("invalid_input");
    // target far outside the grid
    const r3 = planRoundTrip(pkg, { ...base, targetSiteId: undefined, targetXM: 3000, targetYM: 10 });
    expect(r3.status).toBe("invalid_input");
  });
});

// ---- synthetic one-target package for planner tests -------------------------

export function makeSyntheticPackage(): LoadedPackage {
  // 5x5 flat grid, base at (2,0), site at (2,4): 80 m straight line
  const terrain = makeGrid({ width: 5, height: 5, cellSizeM: 20 });
  return {
    region: {
      schemaVersion: "1.1",
      id: "test-region",
      name: "test region",
      projection: {} as never,
      horizontalDatum: "test",
      verticalDatum: "test",
      boundsLocalM: { originXM: 0, originYM: 100, widthM: 100, heightM: 100 },
      boundsLatLon: { north: 0, south: 0, west: 0, east: 0 },
      transform: "test",
      grid: {
        widthCells: 5,
        heightCells: 5,
        cellSizeM: 20,
        rowOrder: "row 0 = north",
        colOrder: "col 0 = west",
        cellCenterLocalM: "test",
      },
      sourceIds: ["test"],
      frozenAt: "test",
    },
    terrain,
    sites: [
      {
        id: "S1",
        name: "test site",
        xM: 90,
        yM: 10,
        rowCol: [2, 4],
        objective: "test",
        positionUncertaintyM: 0,
        positioningMethod: "test",
        sourceIds: [],
        imageIds: [],
        samplingDurationMin: 30,
      },
    ],
    scenario: {
      schemaVersion: "1.1",
      id: "test-scenario",
      base: { id: "BASE", name: "test base", xM: 10, yM: 10, rowCol: [2, 0], note: "simulated" },
      availableSiteIds: ["S1"],
      initialResources: { oxygen: 100, battery: 100 },
      reserveFractions: { oxygen: 0.2, battery: 0.2 },
      movementParameters: TEST_MOVEMENT,
      resourceRates: TEST_RATES,
      events: [],
      assumptionIds: [],
    },
    sources: {
      schemaVersion: "1.1",
      rawInputFiles: {},
      sources: [],
      assumptions: { note: "test", entries: [] },
      classification: { observed: [], derived: [], simulated: [] },
    },
  };
}

/** Exact-binary variant: rates 0.25/min so boundary arithmetic is exact in FP. */
function makeExactRatePackage(): LoadedPackage {
  const pkg = makeSyntheticPackage();
  return {
    ...pkg,
    scenario: { ...pkg.scenario, resourceRates: { oxygenPerMin: 0.25, batteryPerMin: 0.25 } },
  };
}

describe("R4: full round trip accounting and reserve boundary", () => {
  const pkg = makeSyntheticPackage();
  // outbound+return over 80 m straight = 2 min each at 40 m/min; stop 30 min
  // oxygen total = (2 + 30 + 2) * 0.2 = 6.8; reserve = 20 -> feasible
  const base = {
    requestId: "r4",
    startXM: pkg.scenario.base.xM,
    startYM: pkg.scenario.base.yM,
    targetSiteId: "S1",
    strategies: ["shortest" as const],
    stopMinutes: 30,
    initialResources: { oxygen: 100, battery: 100 },
    reserveFractions: { oxygen: 0.2, battery: 0.2 },
    paramsVersion: "test",
  };

  it("outbound, stop and return are all counted", () => {
    const r = planRoundTrip(pkg, base);
    expect(r.status).toBe("feasible");
    const c = r.recommended!;
    expect(c.outbound.distanceM).toBeCloseTo(80, 6);
    expect(c.returnRoute.distanceM).toBeCloseTo(80, 6);
    expect(c.stopMinutes).toBe(30);
    expect(c.totals.minutes).toBeCloseTo(c.outbound.minutes + 30 + c.returnRoute.minutes, 9);
    expect(c.totals.oxygen).toBeCloseTo((c.outbound.minutes + 30 + c.returnRoute.minutes) * 0.2, 9);
    expect(c.totals.battery).toBeCloseTo(c.totals.oxygen, 9); // equal rates in the fixture
  });

  it("exactly meeting the reserve is feasible with margin 0 (exact FP construction)", () => {
    // rates 0.25/min; corridor minutes: outbound 2 + stop 44 + return 2 = 48
    // totals = 48 * 0.25 = 12 (exact); initial 16, reserve 16*0.25 = 4 (exact)
    // allowed = 12 = totals -> margin exactly 0 -> feasible
    const pkgExact = makeExactRatePackage();
    const r = planRoundTrip(pkgExact, {
      ...base,
      stopMinutes: 44,
      initialResources: { oxygen: 16, battery: 16 },
      reserveFractions: { oxygen: 0.25, battery: 0.25 },
    });
    expect(r.status).toBe("feasible");
    expect(r.recommended!.margins.oxygen).toBe(0);
    expect(r.recommended!.margins.battery).toBe(0);
  });

  it("just under the reserve is over_budget with a clear reason", () => {
    const pkgExact = makeExactRatePackage();
    const r = planRoundTrip(pkgExact, {
      ...base,
      stopMinutes: 44,
      initialResources: { oxygen: 15.999, battery: 15.999 },
      reserveFractions: { oxygen: 0.25, battery: 0.25 },
    });
    expect(r.status).toBe("over_budget");
    expect(r.recommended).toBeNull();
    expect(r.reasonCodes).toContain("no_feasible_candidate_in_current_strategies");
    const c = r.candidates[0]!;
    expect(c.status).toBe("over_budget");
    expect(c.reasonCodes).toContain("over_budget_oxygen");
    expect(c.margins.oxygen).toBeLessThan(0);
    // honest wording: limited-candidate claim only
    expect(r.message).toContain("在当前策略下未找到满足预算的方案");
    expect(r.message).not.toContain("no possible path");
  });

  it("return route is computed independently, not reversed (asymmetric climb cost)", () => {
    // 1x6 corridor with the base at the hill foot (cell 0, elev 0) and the target on
    // the hill top (cell 2, elev 20): outbound climbs (ascent penalty + slow grades),
    // return descends (no climb penalty, still slowed by grade) -> minutes differ
    // even though the geometry is the same corridor.
    const terrain = makeGrid({
      width: 6,
      height: 1,
      cellSizeM: 20,
      elevations: [0, 10, 20, 20, 10, 0],
    });
    terrain.slopeDeg.fill(0); // passability flat; edge grades come from elevation
    const pkgHill: LoadedPackage = { ...makeSyntheticPackage(), terrain };
    const r = planRoundTrip(pkgHill, {
      requestId: "hill",
      startXM: 10,
      startYM: 10,
      targetSiteId: undefined,
      targetXM: 50, // cell (0,2), elevation 20 m
      targetYM: 10,
      strategies: ["terrain-aware"],
      stopMinutes: 0,
      initialResources: { oxygen: 100, battery: 100 },
      reserveFractions: { oxygen: 0.2, battery: 0.2 },
      paramsVersion: "test",
    });
    expect(r.status).toBe("feasible");
    const c = r.recommended!;
    expect(c.outbound.minutes).toBeGreaterThan(c.returnRoute.minutes);
    expect(c.outbound.ascentM).toBe(20);
    expect(c.returnRoute.ascentM).toBe(0);
    expect(c.outbound.oxygen).toBeGreaterThan(c.returnRoute.oxygen);
  });
});
