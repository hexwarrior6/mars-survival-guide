/**
 * Node-side package loader (tests, CLI, validate:data). The browser dev page uses
 * fetchLoader.ts instead; both feed the same pure parsePackage core.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePackage } from "../domain/load.js";
import type { LoadedPackage } from "../domain/load.js";

export function loadPackageFromDirectory(dir: string): LoadedPackage {
  const readJson = (name: string): unknown =>
    JSON.parse(readFileSync(join(dir, name), "utf-8"));
  const readBin = (name: string): ArrayBuffer => {
    const buf = readFileSync(join(dir, name));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  };
  return parsePackage({
    region: readJson("region.json"),
    terrainManifest: readJson("terrain/terrain.json"),
    sites: readJson("sites.json"),
    scenario: readJson("scenario.json"),
    sources: readJson("sources.json"),
    elevations: readBin("terrain/elevations.f32"),
    validMask: readBin("terrain/valid_mask.u8"),
    slopeDeg: readBin("terrain/slope_deg.f32"),
  });
}
