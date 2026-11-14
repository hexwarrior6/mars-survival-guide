/**
 * Phase 2 demo CLI: plan round trips to all science sites on the real frozen
 * region, print results + the assumption registry + measured planning time.
 * No product UI — evidence output for acceptance (docs/IMPLEMENTATION.md phase 2).
 */

import { join } from "node:path";
import { loadPackageFromDirectory } from "../data/nodeLoader.js";
import { planRoundTrip } from "../routing/plan.js";
import type { RouteRequest, StrategyCandidate } from "../domain/types.js";

const dir = process.argv[2] ?? join(process.cwd(), "public/data/jezero");
const pkg = loadPackageFromDirectory(dir);

console.log("=== Mars Survival Guide - Phase 2 route & budget demo ===");
console.log(`region:    ${pkg.region.id} (schemaVersion ${pkg.region.schemaVersion})`);
console.log(
  `grid:      ${pkg.terrain.width}x${pkg.terrain.height} @ ${pkg.terrain.cellSizeM} m, ` +
    `${pkg.terrain.validMask.reduce((a, v) => a + (v === 1 ? 1 : 0), 0)} valid cells`,
);
console.log(`base:      ${pkg.scenario.base.name} at local (${pkg.scenario.base.xM}, ${pkg.scenario.base.yM}) m [simulated]`);
console.log(
  `resources: initial ${JSON.stringify(pkg.scenario.initialResources)}, ` +
    `reserve ${JSON.stringify(pkg.scenario.reserveFractions)} [simulated]`,
);
console.log("");

for (const entry of pkg.sources.assumptions.entries) {
  console.log(`assumption ${entry.id}: ${entry.value} (range ${entry.range})`);
}
console.log("");

let maxMs = 0;
for (const siteId of pkg.scenario.availableSiteIds) {
  const site = pkg.sites.find((s) => s.id === siteId)!;
  const request: RouteRequest = {
    requestId: `demo-${siteId}`,
    startXM: pkg.scenario.base.xM,
    startYM: pkg.scenario.base.yM,
    targetSiteId: siteId,
    strategies: ["shortest", "terrain-aware"],
    stopMinutes: site.samplingDurationMin,
    initialResources: { ...pkg.scenario.initialResources },
    reserveFractions: { ...pkg.scenario.reserveFractions },
    paramsVersion: "phase2-params-1",
  };
  const r = planRoundTrip(pkg, request);
  maxMs = Math.max(maxMs, r.measuredMs);
  console.log(`--- ${siteId} "${site.name}" (stop ${site.samplingDurationMin} min, uncertainty ±${site.positionUncertaintyM} m) ---`);
  console.log(`status: ${r.status}   measured: ${r.measuredMs.toFixed(1)} ms`);
  console.log(`message: ${r.message}`);
  for (const c of r.candidates) {
    console.log(
      `  [${c.strategy}] ${fmtCandidate(c)}`,
    );
  }
  console.log("");
}

console.log(
  `max planning interaction time across all requests: ${maxMs.toFixed(1)} ms ` +
    "(target <= 1000 ms per SPECIFICATION.md §6)",
);

function fmtCandidate(c: StrategyCandidate): string {
  return (
    `${c.status}: outbound ${c.outbound.distanceM.toFixed(0)} m / ${c.outbound.minutes.toFixed(0)} min, ` +
    `stop ${c.stopMinutes} min, return ${c.returnRoute.distanceM.toFixed(0)} m / ${c.returnRoute.minutes.toFixed(0)} min | ` +
    `totals: ${c.totals.distanceM.toFixed(0)} m, ${c.totals.minutes.toFixed(0)} min, ` +
    `O2 ${c.totals.oxygen.toFixed(1)}, battery ${c.totals.battery.toFixed(1)} | ` +
    `margins O2 ${c.margins.oxygen.toFixed(1)}, battery ${c.margins.battery.toFixed(1)}` +
    (c.reasonCodes.length > 0 ? ` | reasons: ${c.reasonCodes.join(",")}` : "")
  );
}
