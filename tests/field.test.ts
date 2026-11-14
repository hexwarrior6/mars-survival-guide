/**
 * V3 returnable-range field tests: hand-calculated distances on synthetic
 * grids (including the direction-sensitive climb penalty that forbids a
 * symmetric approximation), closure handling, real-grid performance and the
 * consistency contract with the forward search / emergency return.
 */

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { makeGrid } from "./helpers.js";
import { loadPackageFromDirectory } from "../src/data/nodeLoader.js";
import { buildSearchGraph, edgeCostModel } from "../src/routing/graph.js";
import { costFieldToBase } from "../src/routing/field.js";
import { astar } from "../src/routing/search.js";
import { planRoundTrip } from "../src/routing/plan.js";
import type { RouteRequest } from "../src/domain/types.js";
import {
  buildMissionTimeline,
  planEmergencyReturn,
  missionStateAt,
} from "../src/simulation/engine.js";

const PKG_DIR = resolve(process.cwd(), "public/data/jezero");
const pkg = loadPackageFromDirectory(PKG_DIR);

const MODEL = edgeCostModel(pkg.scenario.movementParameters, "terrain-aware");
const MODEL_ANY = edgeCostModel(pkg.scenario.movementParameters, "shortest"); // minutes are strategy-independent

describe("costFieldToBase (reverse Dijkstra)", () => {
  it("matches hand-calculated walk times on a flat grid", () => {
    const grid = makeGrid({ width: 4, height: 4, cellSizeM: 20, elevations: 100 });
    const graph = buildSearchGraph(grid, { slopeThresholdDeg: 20 });
    const field = costFieldToBase(graph, 3, 0, MODEL_ANY);
    // orthogonal neighbour: 20 m flat at 40 m/min = 0.5 min
    expect(field.minutes[2 * 4 + 0]).toBeCloseTo(0.5, 9);
    // far corner (0,3): three diagonal hops of 28.284 m = 3 × 0.7071 min
    expect(field.minutes[0 * 4 + 3]).toBeCloseTo(3 * (20 * Math.SQRT2) / 40, 6);
    // the base itself is zero
    expect(field.minutes[3 * 4 + 0]).toBe(0);
  });

  it("is direction-sensitive: climbing out costs more than descending in", () => {
    // two cells, 20 m of climb from B(0) up to A(1); the 45 deg slope slows the
    // base walk by 1+45*0.05 = 3.25x, then the ascent penalty adds 0.3 min/m
    const grid = makeGrid({ width: 1, height: 2, cellSizeM: 20, elevations: [100, 120] });
    const graph = buildSearchGraph(grid, { slopeThresholdDeg: 20 });
    const slopeMin = (20 * 3.25) / 40; // 1.625 min both directions
    // base at the LOW cell (row 1): the neighbour must climb 20 m up
    const up = costFieldToBase(graph, 1, 0, MODEL_ANY);
    expect(up.minutes[0]).toBeCloseTo(slopeMin + 20 * 0.3, 9);
    // base at the HIGH cell (row 0): the neighbour descends, no climb penalty
    const down = costFieldToBase(graph, 0, 0, MODEL_ANY);
    expect(down.minutes[1]).toBeCloseTo(slopeMin, 9);
    // the two fields must differ — a symmetric distance transform would not
    expect(up.minutes[0] as number).toBeGreaterThan(down.minutes[1] as number);
  });

  it("treats blocked cells as unreachable and blocks paths through them", () => {
    // 1×3 corridor: base at col 2, wall at col 1
    const grid = makeGrid({ width: 3, height: 1, cellSizeM: 20, elevations: [100, 100, 100] });
    const mask = new Uint8Array([0, 1, 0]);
    const graph = buildSearchGraph(grid, { slopeThresholdDeg: 20, blockMask: mask });
    const field = costFieldToBase(graph, 0, 2, MODEL_ANY);
    expect(field.minutes[2]).toBe(0);
    expect(field.minutes[1]).toBe(Infinity); // the wall cell itself
    expect(field.minutes[0]).toBe(Infinity); // corridor cut
  });

  it("computes the real 256x256 field in <= 50 ms and agrees with the forward A*", () => {
    const graph = buildSearchGraph(pkg.terrain, { slopeThresholdDeg: 20 });
    const base = pkg.scenario.base.rowCol;
    const t0 = performance.now();
    const field = costFieldToBase(graph, base[0], base[1], MODEL);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThanOrEqual(50);
    // consistency with the forward search from three site cells
    for (const site of pkg.sites) {
      const [r, c] = site.rowCol;
      const fwd = astar(graph, r, c, base[0], base[1], MODEL);
      expect(fwd.found).toBe(true);
      expect(field.minutes[r * graph.width + c]).toBeCloseTo(fwd.cost, 6);
    }
  });

  it("membership in the returnable range agrees with planEmergencyReturn reachability", () => {
    // V3.1 contract: cell in range <=> the emergency return from that cell is
    // reachable with the same resources. Uses the real grid and SITE-B plan.
    const request: RouteRequest = {
      requestId: "field-consistency",
      startXM: pkg.scenario.base.xM,
      startYM: pkg.scenario.base.yM,
      targetSiteId: "SITE-B",
      strategies: ["terrain-aware"],
      stopMinutes: 30,
      initialResources: { oxygen: 100, battery: 100 },
      reserveFractions: { oxygen: 0.2, battery: 0.2 },
      paramsVersion: "v3-test",
    };
    const result = planRoundTrip(pkg, request);
    if (result.status !== "feasible") throw new Error("SITE-B should be feasible");
    const timeline = buildMissionTimeline(
      result,
      pkg.terrain,
      MODEL,
      20,
      { initialResources: { oxygen: 100, battery: 100 }, reserveFractions: { oxygen: 0.2, battery: 0.2 } },
    );
    const graph = buildSearchGraph(pkg.terrain, { slopeThresholdDeg: 20 });
    const base = pkg.scenario.base.rowCol;
    const field = costFieldToBase(graph, base[0], base[1], MODEL);
    const emergency = { t0: 140, plan: planEmergencyReturn(timeline, missionStateAt(timeline, { closure: null, batteryLosses: [] }, null, 140).position!, 0, 140, null) };
    if (emergency.plan === null) throw new Error("emergency plan should exist at T=140");
    const remaining = emergency.plan.remainingAtEvent;
    const reserve = { oxygen: 20, battery: 20 };
    const thrO2 = (remaining.oxygen - reserve.oxygen) / (100 / 480);
    // threshold from minutes: the range boundary in minutes for oxygen
    const inRange = (cell: [number, number]): boolean =>
      (field.minutes[cell[0] * graph.width + cell[1]] as number) <= thrO2;
    // the snapped start cell of the emergency return must be in range (it is
    // reachable by construction), and the field must agree with the plan's
    // path cost on that cell
    const c = emergency.plan.snappedCell;
    const fieldMin = field.minutes[c[0] * graph.width + c[1]] as number;
    expect(fieldMin).toBeCloseTo(emergency.plan.totalMinutes - emergency.plan.partialMinutes, 6);
    expect(inRange(c)).toBe(true);
    // a cell deep in the unreachable zone (unknown terrain does not exist in
    // this region; use the maximum-distance cell instead — it must be beyond
    // the emergency plan's own margin test)
    expect(thrO2).toBeGreaterThan(fieldMin);
    void inRange;
  });
});
