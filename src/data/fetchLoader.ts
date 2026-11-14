/**
 * Browser-side package loader for the dev page (same pure parsePackage core as
 * the Node loader).
 */

import { parsePackage } from "../domain/load.js";
import type { LoadedPackage } from "../domain/load.js";

export async function loadPackageFromFetch(baseUrl: string): Promise<LoadedPackage> {
  const j = async (name: string): Promise<unknown> => {
    const res = await fetch(`${baseUrl}/${name}`);
    if (!res.ok) throw new Error(`failed to fetch ${name}: ${res.status}`);
    return res.json();
  };
  const b = async (name: string): Promise<ArrayBuffer> => {
    const res = await fetch(`${baseUrl}/${name}`);
    if (!res.ok) throw new Error(`failed to fetch ${name}: ${res.status}`);
    return res.arrayBuffer();
  };
  return parsePackage({
    region: await j("region.json"),
    terrainManifest: await j("terrain/terrain.json"),
    sites: await j("sites.json"),
    scenario: await j("scenario.json"),
    sources: await j("sources.json"),
    elevations: await b("terrain/elevations.f32"),
    validMask: await b("terrain/valid_mask.u8"),
    slopeDeg: await b("terrain/slope_deg.f32"),
  });
}
