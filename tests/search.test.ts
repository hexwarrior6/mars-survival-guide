/**
 * R1 (hand-calculable paths; A* == Dijkstra) and R2 (rejections: no path,
 * out-of-bounds, unknown cells, steep cells, corner cutting) tests on synthetic
 * fixtures.
 */

import { describe, it, expect } from "vitest";
import { makeGrid, TEST_MOVEMENT } from "./helpers.js";
import { buildSearchGraph, edgeCostModel, edgeMetrics } from "../src/routing/graph.js";
import { astar, dijkstra } from "../src/routing/search.js";

const MODEL = edgeCostModel(TEST_MOVEMENT, "shortest");

describe("R1: hand-calculable costs and A*/Dijkstra agreement", () => {
  it("straight 4-cell row: 3 orthogonal edges = 60 m", () => {
    const grid = makeGrid({ width: 4, height: 1 });
    const g = buildSearchGraph(grid, { slopeThresholdDeg: 20 });
    const r = astar(g, 0, 0, 0, 3, MODEL);
    expect(r.found).toBe(true);
    expect(r.cost).toBeCloseTo(60, 6);
    expect(r.path!.length).toBe(4);
  });

  it("diagonal shortcut: 2 diagonal edges = 56.5685 m beats 60 m", () => {
    // 3x2 grid; from (0,0) to (0,2): straight = 40 m; via (1,1): 2 diagonals = 56.57 m
    // -> straight is better; make straight middle cell blocked so diagonal wins over
    // the 60 m detour below.
    const grid = makeGrid({ width: 3, height: 3 });
    const g = buildSearchGraph(grid, { slopeThresholdDeg: 20 });
    // block (0,1) so the direct row route is cut
    g.passable[0 * 3 + 1] = 0;
    const r = astar(g, 0, 0, 0, 2, MODEL);
    // options: (0,0)->(1,1)->(0,2) = 2 diagonals = 56.5685 m
    expect(r.found).toBe(true);
    expect(r.cost).toBeCloseTo(2 * 20 * Math.SQRT2, 6);
  });

  it("A* and Dijkstra return the same minimal cost on a maze-like grid", () => {
    const grid = makeGrid({ width: 16, height: 12 });
    const g = buildSearchGraph(grid, { slopeThresholdDeg: 20 });
    // deterministic walls: every 3rd column blocked except one gap
    for (let col = 2; col < 16; col += 3) {
      const gapRow = (col * 7) % 12;
      for (let row = 0; row < 12; row++) {
        if (row !== gapRow) g.passable[row * 16 + col] = 0;
      }
    }
    const corners: Array<[number, number, number, number]> = [
      [0, 0, 11, 15],
      [11, 0, 0, 15],
      [5, 1, 6, 13], // col 14 is a wall column (gap only at row 2), so target col 13
    ];
    for (const [r1, c1, r2, c2] of corners) {
      const a = astar(g, r1, c1, r2, c2, MODEL);
      const d = dijkstra(g, r1, c1, r2, c2, MODEL);
      expect(a.found).toBe(true);
      expect(d.found).toBe(true);
      expect(a.cost).toBeCloseTo(d.cost, 9);
    }
  });

  it("A* and Dijkstra agree with the minutes cost model too", () => {
    // rolling terrain: each row steps up 2 m, giving climb penalties
    const elevs = Array.from({ length: 64 }, (_, i) => Math.floor(i / 8) * 2);
    const grid = makeGrid({ width: 8, height: 8, elevations: elevs });
    const g = buildSearchGraph(grid, { slopeThresholdDeg: 20 });
    const minutesModel = edgeCostModel(TEST_MOVEMENT, "terrain-aware");
    const a = astar(g, 0, 0, 7, 7, minutesModel);
    const d = dijkstra(g, 0, 0, 7, 7, minutesModel);
    expect(a.cost).toBeCloseTo(d.cost, 9);
    expect(a.cost).toBeGreaterThan(0);
  });
});

describe("R2: rejections - no fake straight-line paths", () => {
  it("fully walled target: no path", () => {
    const grid = makeGrid({ width: 5, height: 5 });
    const g = buildSearchGraph(grid, { slopeThresholdDeg: 20 });
    // wall column 2 completely
    for (let row = 0; row < 5; row++) g.passable[row * 5 + 2] = 0;
    const r = astar(g, 0, 0, 0, 4, MODEL);
    expect(r.found).toBe(false);
    expect(r.path).toBeNull();
  });

  it("unknown (NoData) cells are impassable, never 0-elevation free space", () => {
    const grid = makeGrid({ width: 4, height: 1, valid: [1, 0, 0, 1] });
    const g = buildSearchGraph(grid, { slopeThresholdDeg: 20 });
    expect(g.unknownCount).toBe(2);
    const r = astar(g, 0, 0, 0, 3, MODEL);
    expect(r.found).toBe(false);
  });

  it("steep cells are impassable above the threshold", () => {
    const grid = makeGrid({ width: 4, height: 1, slopes: [0, 25, 0, 0] });
    const g = buildSearchGraph(grid, { slopeThresholdDeg: 20 });
    const r = astar(g, 0, 0, 0, 3, MODEL);
    expect(r.found).toBe(false);
    // same grid below the threshold is passable
    const g2 = buildSearchGraph(grid, { slopeThresholdDeg: 30 });
    const r2 = astar(g2, 0, 0, 0, 3, MODEL);
    expect(r2.found).toBe(true);
  });

  it("diagonal move through the corner of two blocked cells is rejected", () => {
    const grid = makeGrid({ width: 3, height: 3 });
    const g = buildSearchGraph(grid, { slopeThresholdDeg: 20 });
    // block (0,1) and (1,0); the diagonal (0,0)->(1,1) would cut their corner
    g.passable[0 * 3 + 1] = 0;
    g.passable[1 * 3 + 0] = 0;
    const edge = edgeMetrics(g, 0, 0, 1, 1, MODEL);
    expect(edge).toBeNull();
    // with one orthogonal open the diagonal is legal
    const g2 = buildSearchGraph(grid, { slopeThresholdDeg: 20 });
    g2.passable[0 * 3 + 1] = 1; // open (0,1) back
    const edge2 = edgeMetrics(g2, 0, 0, 1, 1, MODEL);
    expect(edge2).not.toBeNull();
  });

  it("event closure mask blocks cells", () => {
    const grid = makeGrid({ width: 5, height: 1 });
    const mask = new Uint8Array(5);
    mask[2] = 1;
    const g = buildSearchGraph(grid, { slopeThresholdDeg: 20, blockMask: mask });
    expect(g.blockedCount).toBe(1);
    const r = astar(g, 0, 0, 0, 4, MODEL);
    expect(r.found).toBe(false);
  });
});
