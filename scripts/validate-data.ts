/**
 * validate:data — full validation of the frozen data package:
 * - all JSON contracts parse and cross-check (schemaVersion, dims, bounds, params)
 * - binary sizes match the grid
 * - published checksums.json matches the actual files on disk
 * Exits non-zero with a problem list on any failure.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadPackageFromDirectory } from "../src/data/nodeLoader.js";

const dir = process.argv[2] ?? join(process.cwd(), "public/data/jezero");

function sha256File(path: string): string {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

function allFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (statSync(p).isDirectory()) out.push(...allFiles(p));
    else out.push(p);
  }
  return out;
}

const problems: string[] = [];

try {
  const pkg = loadPackageFromDirectory(dir);
  console.log(`region:        ${pkg.region.id} (${pkg.region.name})`);
  console.log(
    `grid:          ${pkg.terrain.width}x${pkg.terrain.height} @ ${pkg.terrain.cellSizeM} m`,
  );
  const validCells = pkg.terrain.validMask.reduce((acc, v) => acc + (v === 1 ? 1 : 0), 0);
  console.log(`valid cells:   ${validCells} / ${pkg.terrain.width * pkg.terrain.height}`);
  console.log(`sites:         ${pkg.sites.map((s) => s.id).join(", ")}`);
  console.log(
    `resources:     initial ${JSON.stringify(pkg.scenario.initialResources)}, ` +
      `reserve ${JSON.stringify(pkg.scenario.reserveFractions)}`,
  );
  console.log(
    `movement:      threshold ${pkg.scenario.movementParameters.passabilitySlopeThresholdDeg} deg, ` +
      `speed ${pkg.scenario.movementParameters.baseSpeedMPM} m/min`,
  );
  console.log(`assumptions:   ${pkg.scenario.assumptionIds.join(", ")}`);

  // checksums.json vs disk
  const checksums = JSON.parse(readFileSync(join(dir, "checksums.json"), "utf-8")) as {
    files: Record<string, { bytes: number; sha256: string }>;
  };
  for (const [rel, meta] of Object.entries(checksums.files)) {
    const abs = join(dir, rel);
    try {
      const actual = sha256File(abs);
      if (actual !== meta.sha256) {
        problems.push(`checksum mismatch: ${rel}`);
      }
      const bytes = statSync(abs).size;
      if (bytes !== meta.bytes) problems.push(`size mismatch: ${rel}`);
    } catch {
      problems.push(`missing file listed in checksums.json: ${rel}`);
    }
  }
  const listed = new Set(Object.keys(checksums.files));
  for (const abs of allFiles(dir)) {
    const rel = relative(dir, abs).replaceAll("\\", "/");
    if (rel === "checksums.json") continue;
    if (!listed.has(rel)) problems.push(`file on disk not listed in checksums.json: ${rel}`);
  }
  const nChecksummed = Object.keys(checksums.files).length;
  console.log(`checksums:     ${nChecksummed} published files verified`);
} catch (err) {
  problems.push(`package validation failed: ${(err as Error).message}`);
}

if (problems.length > 0) {
  console.error("PROBLEMS:");
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log("OK: data package valid");
