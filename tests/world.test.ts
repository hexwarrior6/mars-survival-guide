/**
 * Display-mapping tests: world coordinates must not distort horizontal geometry,
 * elevation sampling must skip unknown cells, route polylines must hug the terrain.
 */

import { describe, it, expect } from "vitest";
import { makeGrid } from "./helpers.js";
import {
  RELIEF_SCALE,
  datumElevationM,
  worldTransform,
  worldXZ,
  worldY,
  sampleElevationM,
  cellWorldPosition,
  routePolyline,
  sitePose,
  overviewPose,
} from "../src/domain/world.js";

describe("world mapping", () => {
  it("centers the region on the origin, north = -z", () => {
    const grid = makeGrid({ width: 4, height: 4, cellSizeM: 20 });
    const t = worldTransform(grid);
    // NW corner (x=0, y=heightM=80) -> (-40, -40); SE corner (x=80, y=0) -> (+40, +40)
    expect(worldXZ(t, 0, 80)).toEqual([-40, -40]);
    expect(worldXZ(t, 80, 0)).toEqual([40, 40]);
  });

  it("horizontal mapping is 1:1 (no distortion)", () => {
    const grid = makeGrid({ width: 4, height: 4, cellSizeM: 20 });
    const t = worldTransform(grid);
    const [x1, z1] = worldXZ(t, 0, 32);
    const [x2, z2] = worldXZ(t, 20, 32);
    expect(x2 - x1).toBeCloseTo(20, 9); // one cell = 20 world units horizontally
    expect(Math.hypot(z2 - z1, x2 - x1)).toBeCloseTo(20, 9);
  });

  it("vertical world y uses the documented relief scale", () => {
    const grid = makeGrid({ width: 2, height: 2, elevations: [100, 100, 100, 130] });
    const t = worldTransform(grid);
    expect(t.datumM).toBe(100);
    expect(worldY(t, 100)).toBe(0);
    expect(worldY(t, 130)).toBeCloseTo(30 * RELIEF_SCALE, 9);
  });
});

describe("elevation sampling", () => {
  it("bilinearly interpolates between cell centers", () => {
    const grid = makeGrid({ width: 2, height: 2, elevations: [0, 20, 0, 20], cellSizeM: 20 });
    const t = worldTransform(grid);
    // midpoint between the two columns of row 0: average of 0 and 20
    const mid = sampleElevationM(grid, 20, 50, t.datumM);
    expect(mid).toBeCloseTo(10, 6);
    // at cell centers the value is exact
    expect(sampleElevationM(grid, 10, 50, t.datumM)).toBeCloseTo(0, 6);
    expect(sampleElevationM(grid, 30, 50, t.datumM)).toBeCloseTo(20, 6);
  });

  it("skips unknown cells instead of reading fake 0 m", () => {
    const grid = makeGrid({ width: 2, height: 2, elevations: [0, 40, 0, 40], valid: [1, 0, 1, 0] });
    const t = worldTransform(grid);
    // east column unknown: result must equal the west-column value, never blend with 0
    expect(sampleElevationM(grid, 30, 50, t.datumM)).toBeCloseTo(0, 6);
    // fully unknown point returns the datum
    const gridAllUnknown = makeGrid({ width: 2, height: 2, valid: 0, elevations: 999 });
    expect(sampleElevationM(gridAllUnknown, 10, 10, 5)).toBe(5);
  });
});

describe("routes and poses", () => {
  it("route polyline hugs cell elevations with a small lift", () => {
    const grid = makeGrid({ width: 3, height: 1, elevations: [0, 15, 30], cellSizeM: 20 });
    const t = worldTransform(grid);
    const pts = routePolyline(grid, t, [
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    expect(pts).toHaveLength(3);
    // heights increase with the terrain, all lifted by 1.5 m * relief
    expect(pts[1]!.y - pts[0]!.y).toBeCloseTo(15 * RELIEF_SCALE, 6);
    expect(pts[2]!.y - pts[1]!.y).toBeCloseTo(15 * RELIEF_SCALE, 6);
    expect(pts[1]!.y).toBeGreaterThan(1.5 * RELIEF_SCALE);
    // horizontal step is exactly one cell (20 world units)
    expect(Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.z - pts[0]!.z)).toBeCloseTo(20, 6);
  });

  it("site pose stays above ground and inside a sane distance", () => {
    const grid = makeGrid({ width: 4, height: 4, cellSizeM: 20, elevations: 100 });
    const t = worldTransform(grid);
    const target = cellWorldPosition(grid, t, 0, 3);
    const base = cellWorldPosition(grid, t, 3, 0);
    const pose = sitePose(t, target, base);
    const d = Math.hypot(
      pose.position.x - pose.target.x,
      pose.position.z - pose.target.z,
    );
    expect(pose.position.y).toBeGreaterThan(target.y);
    expect(d).toBeGreaterThanOrEqual(1300 * 0.5);
    expect(d).toBeLessThanOrEqual(2400);
    const ov = overviewPose(t, 300);
    expect(Number.isFinite(ov.position.y)).toBe(true);
  });
});
