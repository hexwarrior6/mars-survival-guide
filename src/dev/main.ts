/**
 * Minimal dev page: load the real package in the browser, plan round trips to all
 * sites with both strategies, render raw result tables. Verification output only.
 */

import { loadPackageFromFetch } from "../data/fetchLoader.js";
import { planRoundTrip } from "../routing/plan.js";
import type { RouteResult, StrategyCandidate } from "../domain/types.js";
import type { LoadedPackage } from "../domain/load.js";

const app = document.getElementById("app") as HTMLElement;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function candidateRows(c: StrategyCandidate): string {
  return `
    <tr>
      <td>${esc(c.strategy)}</td>
      <td class="status-${c.status}">${c.status}</td>
      <td>${c.outbound.distanceM.toFixed(0)} m / ${c.outbound.minutes.toFixed(0)} min</td>
      <td>${c.stopMinutes} min</td>
      <td>${c.returnRoute.distanceM.toFixed(0)} m / ${c.returnRoute.minutes.toFixed(0)} min</td>
      <td>${c.totals.oxygen.toFixed(1)} / ${c.totals.battery.toFixed(1)}</td>
      <td>${c.margins.oxygen.toFixed(1)} / ${c.margins.battery.toFixed(1)}</td>
      <td>${esc(c.reasonCodes.join(", ") || "-")}</td>
    </tr>`;
}

function siteSection(pkg: LoadedPackage, siteId: string): string {
  const site = pkg.sites.find((s) => s.id === siteId)!;
  const result: RouteResult = planRoundTrip(pkg, {
    requestId: `dev-${siteId}`,
    startXM: pkg.scenario.base.xM,
    startYM: pkg.scenario.base.yM,
    targetSiteId: siteId,
    strategies: ["shortest", "terrain-aware"],
    stopMinutes: site.samplingDurationMin,
    initialResources: { ...pkg.scenario.initialResources },
    reserveFractions: { ...pkg.scenario.reserveFractions },
    paramsVersion: "phase2-params-1",
  });
  return `
    <h2>${esc(site.id)} &mdash; ${esc(site.name)} <span class="note">(stop ${site.samplingDurationMin} min, position uncertainty ±${site.positionUncertaintyM} m)</span></h2>
    <p class="status-${result.status}">status: ${result.status} &middot; measured ${result.measuredMs.toFixed(1)} ms</p>
    <p>${esc(result.message)}</p>
    <table>
      <tr><th>strategy</th><th>status</th><th>outbound</th><th>stop</th><th>return</th><th>O2 / battery used</th><th>margins</th><th>reasons</th></tr>
      ${result.candidates.map(candidateRows).join("")}
    </table>`;
}

const pkg = await loadPackageFromFetch("/data/jezero");
const sections = pkg.scenario.availableSiteIds.map((id) => siteSection(pkg, id)).join("");
const assumptionRows = pkg.sources.assumptions.entries
  .map((a) => `<tr><td>${esc(a.id)}</td><td>${esc(a.value)}</td><td>${esc(a.range)}</td></tr>`)
  .join("");

app.innerHTML = `
  <p class="note">
    region ${esc(pkg.region.id)} | grid ${pkg.terrain.width}×${pkg.terrain.height} @ ${pkg.terrain.cellSizeM} m |
    base (simulated) at (${pkg.scenario.base.xM}, ${pkg.scenario.base.yM}) m |
    initial ${JSON.stringify(pkg.scenario.initialResources)}, reserve ${JSON.stringify(pkg.scenario.reserveFractions)} (simulated)
  </p>
  ${sections}
  <h2>Simulated planning assumptions (sources.json)</h2>
  <table>
    <tr><th>id</th><th>value</th><th>range</th></tr>
    ${assumptionRows}
  </table>
  <p class="note">Failed results say only that no candidate among the searched strategies satisfies the budget — they never claim that no path exists at all.</p>
`;
