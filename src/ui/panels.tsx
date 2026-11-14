/** UI panels: mission settings, results, sources drawer, legend. All numbers
 * come from RouteResult (single source of truth — no panel-side formulas). */

import { useEffect, useRef } from "react";
import type { JSX } from "react";
import type { LoadedPackage } from "../domain/load.js";
import type { RouteResult, Strategy, StrategyCandidate } from "../domain/types.js";

export function MissionPanel({
  pkg,
  selectedSiteId,
  strategy,
  reserveFraction,
  initialResources,
  mission,
  presetId,
  onPreset,
  onSelectSite,
  onStrategy,
  onReserve,
  onInitialResources,
  onStart,
  onPause,
  onResume,
  onResetMission,
  onTriggerBattery,
  onTriggerClosure,
  onSpeed,
}: {
  pkg: LoadedPackage;
  selectedSiteId: string | null;
  strategy: Strategy;
  reserveFraction: number;
  initialResources: number;
  mission: {
    phase: string;
    running: boolean;
    paused: boolean;
    started: boolean;
    feasible: boolean;
    speed: number;
    closureFired: boolean;
  };
  presetId: string | null;
  onPreset: (id: string) => void;
  onSelectSite: (id: string | null) => void;
  onStrategy: (s: Strategy) => void;
  onReserve: (v: number) => void;
  onInitialResources: (v: number) => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onResetMission: () => void;
  onTriggerBattery: () => void;
  onTriggerClosure: () => void;
  onSpeed: (s: number) => void;
}): JSX.Element {
  return (
    <section className="panel mission" aria-label="Mission settings">
      <h2>Plan your Marswalk</h2>
      <ul className="site-list">
        {pkg.sites
          .filter((s) => pkg.scenario.availableSiteIds.includes(s.id))
          .map((site) => (
            <li key={site.id}>
              <button
                type="button"
                aria-pressed={selectedSiteId === site.id}
                onClick={() => onSelectSite(selectedSiteId === site.id ? null : site.id)}
              >
                <span className="sid">
                  {site.id} · {site.name}
                </span>
                <span className="sub">
                  stop {site.samplingDurationMin} min · position ±{site.positionUncertaintyM} m ·
                  landform-anchored
                </span>
              </button>
            </li>
          ))}
      </ul>

      <div className="radio-row" role="radiogroup" aria-label="Route strategy">
        {(["shortest", "terrain-aware"] as Strategy[]).map((s) => (
          <label key={s}>
            <input
              type="radio"
              name="strategy"
              checked={strategy === s}
              onChange={() => onStrategy(s)}
            />
            {s === "shortest" ? "Shortest" : "Terrain-aware"}
          </label>
        ))}
      </div>
      <p className="empty-hint">
        Terrain-aware trades a little distance for less time on slopes and climbs.
      </p>

      <div className="slider-row">
        <label htmlFor="initial-slider">
          Initial resources: <span className="val">{initialResources}</span>
        </label>
        <input
          id="initial-slider"
          type="range"
          min={20}
          max={100}
          step={5}
          value={initialResources}
          onChange={(e) => onInitialResources(Number(e.target.value))}
        />
        <p className="empty-hint">
          Starting oxygen and battery, each on the simulated 0&ndash;100 budget scale (scenario
          default 100).
        </p>
      </div>

      <div className="slider-row">
        <label htmlFor="reserve-slider">
          Reserve per resource: <span className="val">{Math.round(reserveFraction * 100)}%</span>
        </label>
        <input
          id="reserve-slider"
          type="range"
          min={0}
          max={0.5}
          step={0.05}
          value={reserveFraction}
          onChange={(e) => onReserve(Number(e.target.value))}
        />
        <p className="empty-hint">
          Reserve = {Math.round(reserveFraction * 100)}% of initial capacity kept aside (simulated
          demo value, not a NASA safety standard).
        </p>
      </div>

      <h2>Mission control (simulated)</h2>
      <div className="radio-row" role="group" aria-label="Expedition control">
        <button type="button" className="primary" disabled={mission.started || !mission.feasible} onClick={onStart}>
          START EXPEDITION
        </button>
        <button type="button" disabled={!mission.running || mission.paused} onClick={onPause}>
          PAUSE
        </button>
        <button type="button" disabled={!mission.running || !mission.paused} onClick={onResume}>
          RESUME
        </button>
        <button type="button" disabled={!mission.started} onClick={onResetMission}>
          RESET
        </button>
      </div>
      <p className="empty-hint">
        Speed:
        {[1, 4, 8, 16].map((s) => (
          <label key={s} style={{ marginRight: 8 }}>
            <input
              type="radio"
              name="speed"
              checked={mission.speed === s}
              onChange={() => onSpeed(s)}
            />
            ×{s}
          </label>
        ))}
      </p>
      <div className="radio-row" role="group" aria-label="Simulated events">
        <button
          type="button"
          disabled={!mission.running || mission.paused}
          onClick={onTriggerBattery}
        >
          BATTERY LOSS −45
        </button>
        <button
          type="button"
          disabled={!mission.running || mission.paused || mission.closureFired}
          onClick={onTriggerClosure}
        >
          CLOSE PASSAGE
        </button>
      </div>

      <h2>Scenarios</h2>
      <ul className="site-list">
        {[
          { id: "nominal", label: "NOMINAL ROUND TRIP" },
          { id: "closure", label: "PASSAGE CLOSES WHILE SAMPLING" },
          { id: "tight", label: "BATTERY: RESERVE BREACHED" },
          { id: "stranded", label: "BATTERY: STRANDED" },
        ].map((p) => (
          <li key={p.id}>
            <button type="button" aria-pressed={presetId === p.id} onClick={() => onPreset(p.id)}>
              <span className="sid">{p.label}</span>
              <span className="sub">scripted simulated replay · resets the mission</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="empty-hint">
        All events and scenarios are simulated replays keyed to mission minutes (deterministic).
      </p>
    </section>
  );
}

function fmt(c: StrategyCandidate, kind: "outbound" | "returnRoute"): string {
  const leg = c[kind];
  return `${leg.distanceM.toFixed(0)} m · ${leg.minutes.toFixed(0)} min`;
}

export function ResultsPanel({
  pkg,
  result,
  strategy,
}: {
  pkg: LoadedPackage;
  result: RouteResult | null;
  strategy: Strategy;
}): JSX.Element {
  if (result === null) {
    return (
      <section className="panel results" aria-label="Route results">
        <h2>Route &amp; budget</h2>
        <p className="empty-hint">
          Select a science target to plan a round trip. Nothing is computed yet — no fake
          numbers are shown.
        </p>
      </section>
    );
  }
  const candidate = result.candidates.find((c) => c.strategy === strategy) ?? result.candidates[0];
  const statusBanner = (): JSX.Element => {
    switch (result.status) {
      case "feasible": {
        const c = result.recommended;
        return (
          <div className="state-banner ok">
            <strong>FEASIBLE</strong> — plan ready. Margin after return: oxygen{" "}
            {c!.margins.oxygen.toFixed(1)}, battery {c!.margins.battery.toFixed(1)} (simulated
            units).
          </div>
        );
      }
      case "over_budget":
        return (
          <div className="state-banner warn">
            <strong>OVER BUDGET</strong> — {result.message}
            <br />
            <span className="code">
              reasons: {result.candidates[0]?.reasonCodes.join(", ") ?? "-"}
            </span>
          </div>
        );
      case "unreachable":
        return (
          <div className="state-banner error">
            <strong>UNREACHABLE</strong> — {result.message}
            <br />
            <span className="code">reason: {result.reasonCodes.join(", ")}</span>
          </div>
        );
      case "invalid_input":
        return (
          <div className="state-banner error">
            <strong>INVALID INPUT</strong> — {result.message}
          </div>
        );
      default:
        return <></>;
    }
  };

  return (
    <section className="panel results" aria-label="Route results">
      <h2>Route &amp; budget</h2>
      {statusBanner()}
      {candidate && (
        <>
          <table className="results-table">
            <caption className="empty-hint" style={{ textAlign: "left", captionSide: "bottom" }}>
              strategy &quot;{candidate.strategy}&quot; · request {result.requestId} · computed in{" "}
              {result.measuredMs.toFixed(1)} ms · resource units are simulated 0–100 budget points
            </caption>
            <tbody>
              <tr>
                <th>Outbound</th>
                <td>{fmt(candidate, "outbound")}</td>
              </tr>
              <tr>
                <th>Science stop</th>
                <td>{candidate.stopMinutes.toFixed(0)} min (simulated)</td>
              </tr>
              <tr>
                <th>Return (recomputed)</th>
                <td>{fmt(candidate, "returnRoute")}</td>
              </tr>
              <tr>
                <th>Round-trip totals</th>
                <td>
                  {candidate.totals.distanceM.toFixed(0)} m · {candidate.totals.minutes.toFixed(0)}{" "}
                  min · O₂ {candidate.totals.oxygen.toFixed(1)} · battery{" "}
                  {candidate.totals.battery.toFixed(1)}
                </td>
              </tr>
              <tr>
                <th>Margins after return</th>
                <td>
                  O₂ {candidate.margins.oxygen.toFixed(1)} · battery{" "}
                  {candidate.margins.battery.toFixed(1)}
                </td>
              </tr>
            </tbody>
          </table>
          {result.candidates.length > 1 && (
            <p className="empty-hint">
              Strategy comparison:{" "}
              {result.candidates
                .map(
                  (c) =>
                    `${c.strategy}: ${c.totals.distanceM.toFixed(0)} m / ${c.totals.minutes.toFixed(0)} min / O₂ ${c.totals.oxygen.toFixed(1)}`,
                )
                .join("  ·  ")}
            </p>
          )}
          <p className="empty-hint">
            Initial resources {pkg.scenario.initialResources.oxygen} /{" "}
            {pkg.scenario.initialResources.battery} (simulated units) · reserve adjustable in the
            mission panel.
          </p>
        </>
      )}
    </section>
  );
}

export function SourcesDrawer({
  pkg,
  open,
  onClose,
}: {
  pkg: LoadedPackage;
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Sources and assumptions">
        <button ref={closeRef} type="button" className="small" onClick={onClose}>
          Close (Esc)
        </button>
        <h3>Sources (observed)</h3>
        {pkg.sources.sources.map((s) => (
          <div className="src-block" key={s.id}>
            <dl>
              <dt>{s.title}</dt>
              <dd>
                {s.mission}
                {s.instrument ? ` / ${s.instrument}` : ""} · retrieved {s.retrievedAt}
                {s.productId ? ` · ${s.productId}` : ""}
              </dd>
              <dd>
                <a href={s.sourceUrl} target="_blank" rel="noreferrer">
                  {s.sourceUrl}
                </a>
              </dd>
              <dd>terms: {s.usageTerms}</dd>
              <dd>limits: {s.limitations}</dd>
            </dl>
          </div>
        ))}
        <h3>Simulated planning assumptions</h3>
        <p className="empty-hint">{pkg.sources.assumptions.note}</p>
        <table className="results-table">
          <tbody>
            {pkg.sources.assumptions.entries.map((a) => (
              <tr key={a.id}>
                <th>{a.id}</th>
                <td>
                  {a.value}
                  <br />
                  <span className="empty-hint">range: {a.range}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Classification</h3>
        <p className="empty-hint">
          observed: {pkg.sources.classification.observed.join(", ")}
          <br />
          derived: terrain grids, ortho extracts, alignment measurements, landform-anchored site
          positions
          <br />
          simulated: base, events, passability threshold, all EVA budget numbers
        </p>
      </aside>
    </>
  );
}
