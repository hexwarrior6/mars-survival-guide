import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadPackageFromDirectory } from "../src/data/nodeLoader.js";
import { cellWorldPosition, worldTransform } from "../src/domain/world.js";
import { regionalGeometry, regionalHeight, REGIONAL_CENTRE_X, REGIONAL_SIZE } from "../src/ui/regionalGeometry.js";

const { terrain } = loadPackageFromDirectory(resolve("public/data/jezero"));
const t = worldTransform(terrain);
const hx = t.halfWidthM - terrain.cellSizeM / 2;
const hz = t.halfHeightM - terrain.cellSizeM / 2;

describe("persistent regional map containing the local DEM", () => {
  it("joins all four measured DEM edges at their actual, unanimated height", () => {
    for (let r = 0; r < terrain.height; r++) for (const c of [0, terrain.width - 1]) {
      const p = cellWorldPosition(terrain, t, r, c, 0);
      expect(regionalHeight(terrain, p.x, p.z, t)).toBeCloseTo(p.y, 5);
    }
    for (let c = 0; c < terrain.width; c++) for (const r of [0, terrain.height - 1]) {
      const p = cellWorldPosition(terrain, t, r, c, 0);
      expect(regionalHeight(terrain, p.x, p.z, t)).toBeCloseTo(p.y, 5);
    }
  });

  it("surrounds the task footprint without triangles covering or crossing it", () => {
    const geometry = regionalGeometry(terrain);
    const pos = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    const index = geometry.getIndex()!;
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const xs = ids.map(id => pos.getX(id));
      const zs = ids.map(id => pos.getZ(id));
      expect(Math.max(...xs) <= -hx || Math.min(...xs) >= hx || Math.max(...zs) <= -hz || Math.min(...zs) >= hz).toBe(true);
    }
    const seams = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      expect(uv.getX(i)).toBeCloseTo((x - REGIONAL_CENTRE_X) / REGIONAL_SIZE + 0.5, 5);
      expect(uv.getY(i)).toBeCloseTo(0.5 - z / REGIONAL_SIZE, 5);
      if ((Math.abs(x) === hx && Math.abs(z) <= hz) || (Math.abs(z) === hz && Math.abs(x) <= hx)) seams.add(`${x},${z}`);
    }
    expect(seams.size).toBe(2 * terrain.width + 2 * terrain.height - 4);
    geometry.dispose();
  });
});
