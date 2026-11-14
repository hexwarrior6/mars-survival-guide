/** Floating overlay cards: mission settings, route results, sources and legend
 * drawers. All numbers come from RouteResult (single source of truth — no
 * panel-side formulas). V1 layout: cards float over the full-bleed terrain and
 * collapse to their header to stay out of the way; the results card only
 * appears once a plan actually exists. */

import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { LoadedPackage } from "../domain/load.js";
import { useLang } from "./i18n.js";
import type { RouteResult, Strategy, StrategyCandidate } from "../domain/types.js";

/** Collapsible floating-card header: the whole header is the toggle, with an
 * aria-expanded state and a textual caret (not color-only). */
function CardHead({
  title,
  collapsed,
  onToggle,
  subtitle,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  subtitle?: string;
}): JSX.Element {
  const { t } = useLang();
  return (
    <button
      type="button"
      className="card-head"
      aria-expanded={!collapsed}
      onClick={onToggle}
      title={collapsed ? t("Expand") : t("Collapse")}
    >
      <span className="card-caret" aria-hidden="true">
        {collapsed ? "▸" : "▾"}
      </span>
      <span className="card-title">{title}</span>
      {subtitle !== undefined && <span className="card-sub">{subtitle}</span>}
    </button>
  );
}

export function MissionPanel({
  pkg,
  selectedSiteId,
  strategy,
  reserveFraction,
  initialResources,
  stopMinutes,
  mission,
  presetId,
  onPreset,
  onSelectSite,
  onStrategy,
  onReserve,
  onInitialResources,
  onStopMinutes,
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
  stopMinutes: number;
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
  onStopMinutes: (v: number) => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onResetMission: () => void;
  onTriggerBattery: () => void;
  onTriggerClosure: () => void;
  onSpeed: (s: number) => void;
}): JSX.Element {
  const { t } = useLang();
  const [collapsed, setCollapsed] = useState(false);
  const selectedSite = pkg.sites.find((s) => s.id === selectedSiteId) ?? null;
  return (
    <section className="float-card mission-card" aria-label="Mission settings">
      <CardHead
        title={t("Plan your Marswalk")}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        subtitle={
          selectedSite !== null
            ? `${selectedSite.id} · ${selectedSite.name}`
            : t("no target selected")
        }
      />
      {!collapsed && (
        <div className="card-body">
          <h3>{t("Science targets")}</h3>
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
                      {t("stop {min} min · position ±{unc} m · landform-anchored", {
                        min: site.samplingDurationMin,
                        unc: site.positionUncertaintyM,
                      })}
                    </span>
                  </button>
                </li>
              ))}
          </ul>

          <h3>{t("Route strategy")}</h3>
          <div className="radio-row" role="radiogroup" aria-label="Route strategy">
            {(["shortest", "terrain-aware"] as Strategy[]).map((s) => (
              <label key={s} className={strategy === s ? "checked" : undefined}>
                <input
                  type="radio"
                  name="strategy"
                  checked={strategy === s}
                  onChange={() => onStrategy(s)}
                />
                {s === "shortest" ? t("Shortest") : t("Terrain-aware")}
              </label>
            ))}
          </div>
          <p className="hint">
            {t("Terrain-aware trades a little distance for less time on slopes and climbs.")}
          </p>

          <h3>{t("Budget settings")}</h3>
          <p className="hint">
            {t("Changing any of these parameters creates a NEW mission plan (resets playback).")}
          </p>
          <div className="slider-row">
            <label htmlFor="stop-slider">
              {t("Science stop duration:")} <span className="val">{stopMinutes}</span>
            </label>
            <input
              id="stop-slider"
              type="range"
              min={0}
              max={120}
              step={5}
              value={stopMinutes}
              onChange={(e) => onStopMinutes(Number(e.target.value))}
            />
          </div>
          <div className="slider-row">
            <label htmlFor="initial-slider">
              {t("Initial resources:")} <span className="val">{initialResources}</span>
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
            <p className="hint">
              {t("Starting oxygen and battery, each on the simulated 0–100 budget scale (scenario default 100).")}
            </p>
          </div>

          <div className="slider-row">
            <label htmlFor="reserve-slider">
              {t("Reserve per resource:")} <span className="val">{Math.round(reserveFraction * 100)}%</span>
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
            <p className="hint">
              {t("Reserve = {pct}% of initial capacity kept aside (simulated demo value, not a NASA safety standard).", { pct: Math.round(reserveFraction * 100) })}
            </p>
          </div>

          <h3>{t("Mission control (simulated)")}</h3>
          <div className="radio-row" role="group" aria-label="Expedition control">
            <button type="button" className="primary" disabled={mission.started || !mission.feasible} onClick={onStart}>
              {t("START EXPEDITION")}
            </button>
            <button type="button" disabled={!mission.running || mission.paused} onClick={onPause}>
              {t("PAUSE")}
            </button>
            <button type="button" disabled={!mission.running || !mission.paused} onClick={onResume}>
              {t("RESUME")}
            </button>
            <button type="button" disabled={!mission.started} onClick={onResetMission}>
              {t("RESET")}
            </button>
          </div>
          <p className="hint">
            {t("Speed:")}
            {[1, 4, 8, 16].map((s) => (
              <label key={s} className={mission.speed === s ? "checked" : undefined} style={{ marginLeft: 10 }}>
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
              {t("BATTERY LOSS −45")}
            </button>
            <button
              type="button"
              disabled={!mission.running || mission.paused || mission.closureFired}
              onClick={onTriggerClosure}
            >
              {t("CLOSE PASSAGE")}
            </button>
          </div>

          <h3>{t("Scenarios")}</h3>
          <ul className="site-list compact">
            {[
              { id: "nominal", label: t("NOMINAL ROUND TRIP") },
              { id: "closure", label: t("PASSAGE CLOSES WHILE SAMPLING") },
              { id: "tight", label: t("BATTERY: RESERVE BREACHED") },
              { id: "stranded", label: t("BATTERY: STRANDED") },
            ].map((p) => (
              <li key={p.id}>
                <button type="button" aria-pressed={presetId === p.id} onClick={() => onPreset(p.id)}>
                  <span className="sid">{p.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="hint">{t("All events and scenarios are simulated replays keyed to mission minutes (deterministic).")}</p>
        </div>
      )}
    </section>
  );
}

function fmt(c: StrategyCandidate, kind: "outbound" | "returnRoute"): string {
  const leg = c[kind];
  return `${leg.distanceM.toFixed(0)} m · ${leg.minutes.toFixed(0)} min`;
}

export interface LockedPlan {
  label: string;
  result: RouteResult;
  strategy: Strategy;
}

function compareRow(
  t: (en: string, vars?: Record<string, string | number>) => string,
  name: string,
  a: string,
  b: string,
  delta: string,
): JSX.Element {
  return (
    <tr>
      <th>{name}</th>
      <td>{a}</td>
      <td>{b}</td>
      <td className="delta">{delta}</td>
    </tr>
  );
}

const fmtDiff = (b: number, a: number, unit: string): string => {
  const d = b - a;
  if (Math.abs(d) < 0.05) return "±0";
  return `${d > 0 ? "+" : ""}${d.toFixed(0)}${unit}`;
};

export function ResultsPanel({
  pkg,
  result,
  strategy,
  locked,
  onLock,
  onUnlock,
}: {
  pkg: LoadedPackage;
  result: RouteResult | null;
  strategy: Strategy;
  locked: LockedPlan | null;
  onLock: () => void;
  onUnlock: () => void;
}): JSX.Element | null {
  const { t } = useLang();
  const [collapsed, setCollapsed] = useState(false);
  // no plan -> no card: the default screen shows terrain, not an empty table
  if (result === null) return null;
  const candidate = result.candidates.find((c) => c.strategy === strategy) ?? result.candidates[0];
  const statusBanner = (): JSX.Element => {
    switch (result.status) {
      case "feasible": {
        const c = result.recommended;
        return (
          <div className="state-banner ok">
            <strong>{t("FEASIBLE")}</strong> — {t("FEASIBLE — plan ready. Margin after return: oxygen {o2}, battery {bat} (simulated units).", { o2: c!.margins.oxygen.toFixed(1), bat: c!.margins.battery.toFixed(1) })}
          </div>
        );
      }
      case "over_budget":
        return (
          <div className="state-banner warn">
            <strong>{t("OVER BUDGET")}</strong> — {result.message}
            <br />
            <span className="code">
              {t("reasons: {codes}", { codes: result.candidates[0]?.reasonCodes.join(", ") ?? "-" })}
            </span>
          </div>
        );
      case "unreachable":
        return (
          <div className="state-banner error">
            <strong>{t("UNREACHABLE")}</strong> — {result.message}
            <br />
            <span className="code">{t("reason: {codes}", { codes: result.reasonCodes.join(", ") })}</span>
          </div>
        );
      case "invalid_input":
        return (
          <div className="state-banner error">
            <strong>{t("INVALID INPUT")}</strong> — {result.message}
          </div>
        );
      default:
        return <></>;
    }
  };

  return (
    <section className="float-card results-card" aria-label="Route results">
      <CardHead
        title={t("Route & budget")}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        subtitle={result.status === "feasible" ? t("FEASIBLE") : undefined}
      />
      {!collapsed && (
        <div className="card-body">
          {statusBanner()}
          {candidate && (
            <>
              <table className="results-table">
                <caption className="hint" style={{ textAlign: "left", captionSide: "bottom" }}>
                  {t("strategy \"{s}\" · request {id} · computed in {ms} ms · resource units are simulated 0–100 budget points", { s: candidate.strategy, id: result.requestId, ms: result.measuredMs.toFixed(1) })}
                </caption>
                <tbody>
                  <tr>
                    <th>{t("Outbound")}</th>
                    <td>{fmt(candidate, "outbound")}</td>
                  </tr>
                  <tr>
                    <th>{t("Science stop")}</th>
                    <td>{t("{min} min (simulated)", { min: candidate.stopMinutes.toFixed(0) })}</td>
                  </tr>
                  <tr>
                    <th>{t("Return (recomputed)")}</th>
                    <td>{fmt(candidate, "returnRoute")}</td>
                  </tr>
                  <tr>
                    <th>{t("Round-trip totals")}</th>
                    <td>
                      {t("{d} m · {min} min · O₂ {o2} · battery {bat}", {
                        d: candidate.totals.distanceM.toFixed(0),
                        min: candidate.totals.minutes.toFixed(0),
                        o2: candidate.totals.oxygen.toFixed(1),
                        bat: candidate.totals.battery.toFixed(1),
                      })}
                    </td>
                  </tr>
                  <tr>
                    <th>{t("Margins after return")}</th>
                    <td>
                      {t("O₂ {o2} · battery {bat}", {
                        o2: candidate.margins.oxygen.toFixed(1),
                        bat: candidate.margins.battery.toFixed(1),
                      })}
                    </td>
                  </tr>
                </tbody>
              </table>
              {result.candidates.length > 1 && (
                <p className="hint">
                  {t("Strategy comparison:")}{" "}
                  {result.candidates
                    .map(
                      (c) =>
                        `${c.strategy}: ${c.totals.distanceM.toFixed(0)} m / ${c.totals.minutes.toFixed(0)} min / O₂ ${c.totals.oxygen.toFixed(1)}`,
                    )
                    .join("  ·  ")}
                </p>
              )}
              <p className="hint">
                {t("Initial resources {a} / {b} (simulated units) · reserve adjustable in the mission card.", {
                  a: pkg.scenario.initialResources.oxygen,
                  b: pkg.scenario.initialResources.battery,
                })}
              </p>
              <div className="radio-row">
                {locked === null ? (
                  <button
                    type="button"
                    disabled={result.status !== "feasible"}
                    onClick={onLock}
                    title={result.status === "feasible" ? t("Lock this plan as plan A, then change inputs to compare") : undefined}
                  >
                    {t("Lock as plan A")}
                  </button>
                ) : (
                  <button type="button" onClick={onUnlock}>
                    {t("Unlock plan A")}
                  </button>
                )}
              </div>
              {locked !== null && (() => {
                const a = locked.result.candidates.find((c) => c.strategy === locked.strategy) ?? locked.result.candidates[0];
                const b = candidate;
                if (a === undefined || b === undefined) return null;
                return (
                  <table className="results-table compare">
                    <caption className="hint" style={{ textAlign: "left", captionSide: "top" }}>
                      {t("Plan A (locked): {a} · Plan B (current inputs): {b}", {
                        a: locked.label,
                        b: `${result.candidates[0]?.strategy ?? ""} · stop ${b.stopMinutes.toFixed(0)} min`,
                      })}
                    </caption>
                    <thead>
                      <tr>
                        <th />
                        <th>{t("Plan A (locked)")}</th>
                        <th>{t("Plan B (current)")}</th>
                        <th>{t("Δ (B − A)")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareRow(t, t("Round-trip totals"),
                        `${a.totals.distanceM.toFixed(0)} m / ${a.totals.minutes.toFixed(0)} min`,
                        `${b.totals.distanceM.toFixed(0)} m / ${b.totals.minutes.toFixed(0)} min`,
                        fmtDiff(b.totals.distanceM - a.totals.distanceM, 0, " m") + " / " + fmtDiff(b.totals.minutes - a.totals.minutes, 0, " min"))}
                      {compareRow(t, t("OXYGEN"),
                        a.totals.oxygen.toFixed(1), b.totals.oxygen.toFixed(1),
                        fmtDiff(b.totals.oxygen - a.totals.oxygen, 0, ""))}
                      {compareRow(t, t("BATTERY"),
                        a.totals.battery.toFixed(1), b.totals.battery.toFixed(1),
                        fmtDiff(b.totals.battery - a.totals.battery, 0, ""))}
                      {compareRow(t, t("Margins after return"),
                        `O₂ ${a.margins.oxygen.toFixed(1)}`, `O₂ ${b.margins.oxygen.toFixed(1)}`,
                        fmtDiff(b.margins.oxygen - a.margins.oxygen, 0, ""))}
                      {compareRow(t, t("Feasible"),
                        a.status === "feasible" ? t("FEASIBLE") : t("OVER BUDGET"),
                        b.status === "feasible" ? t("FEASIBLE") : t("OVER BUDGET"),
                        b.status === a.status ? "=" : "≠")}
                    </tbody>
                  </table>
                );
              })()}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Legend drawer (opened from the bottom bar). Content is unchanged wording —
 * units, data provenance and display-only transforms stay discoverable. */
export function LegendDrawer({
  pkg,
  open,
  onClose,
  returnableThreshold,
}: {
  pkg: LoadedPackage;
  open: boolean;
  onClose: () => void;
  returnableThreshold: number | null;
}): JSX.Element | null {
  const { t } = useLang();
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
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Legend">
        <button ref={closeRef} type="button" className="small" onClick={onClose}>
          {t("Close (Esc)")}
        </button>
        <h3>{t("Legend")}</h3>
        <dl className="legend-list">
          <dt>
            <span className="swatch" style={{ background: "var(--route-outbound)" }} />
            {t("outbound route")}
          </dt>
          <dt>
            <span className="swatch" style={{ background: "var(--route-return)" }} />
            {t("return route (recomputed)")}
          </dt>
          <dt>
            <span className="swatch" style={{ background: "var(--route-blocked)" }} />
            {t("blocked area (simulated closure)")}
          </dt>
          <dt>
            <span
              className="swatch"
              style={{ width: 12, height: 12, border: "2px solid var(--accent)", borderRadius: "50%", background: "transparent" }}
            />
            {t("selection ring: 70 m display marker around the selected site (not a measurement)")}
          </dt>
          <dt>
            <span
              className="swatch"
              style={{ width: 12, height: 12, border: "2px solid var(--accent)", borderRadius: "50%", background: "transparent" }}
            />
            {t("selection ring: 70 m display marker around the selected site (not a measurement)")}
          </dt>
          <dt>
            <span
              className="swatch"
              style={{ width: 4, height: 14, background: "#ffd9a0", borderRadius: 2 }}
            />
            {t("mission position marker: light column at the walking position, enlarged for visibility (not to scale)")}
          </dt>
          <dt>
            <span
              className="swatch"
              style={{ width: 12, height: 12, border: "1.5px solid var(--accent)", background: "rgba(255,180,94,0.13)" }}
            />
            {t("returnable-range boundary: region reachable within {min} walk-minutes of base (simulated, ±1–2 cells)", { min: returnableThreshold === null ? "—" : String(Math.min(returnableThreshold, 200)) })}
          </dt>
        </dl>
        <h3>{t("Returnable range")}</h3>
        <p className="hint">
          {t("returnable range: walking-minutes back to base (reverse-Dijkstra field, simulated). It answers “can I still get home NOW” — not “can the mission finish”. The boundary is honest to ±1–2 planning cells (20 m grid + alignment uncertainty).")}
        </p>
        <h3>{t("Reading the terrain")}</h3>
        <p className="hint">{t("controls: left-drag pan · right-drag rotate/pitch · wheel zoom")}</p>
        <p className="hint">{t("grid 20 m/cell · vertical relief ×3 display only")}</p>
        <p className="hint">{t("units: meters · minutes · simulated 0–100 budget units")}</p>
        <p className="hint">{t("lighting: key-light azimuth matches the DEM hillshade (NW) · warm fill is display only")}</p>
        <p className="hint">
          {t("terrain: MRO CTX DEM/ortho mosaic (Mangold et al. 2021) · sources: {n} records · v{v}", {
            n: pkg.sources.sources.length,
            v: pkg.region.schemaVersion,
          })}
        </p>
      </aside>
    </>
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
  const { t } = useLang();
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
          {t("Close (Esc)")}
        </button>
        <h3>{t("Sources (observed)")}</h3>
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
              <dd>{t("terms: {terms}", { terms: s.usageTerms })}</dd>
              <dd>{t("limits: {limits}", { limits: s.limitations })}</dd>
            </dl>
          </div>
        ))}
        <h3>{t("Simulated planning assumptions")}</h3>
        <p className="hint">{pkg.sources.assumptions.note}</p>
        <table className="results-table">
          <tbody>
            {pkg.sources.assumptions.entries.map((a) => (
              <tr key={a.id}>
                <th>{a.id}</th>
                <td>
                  {a.value}
                  <br />
                  <span className="hint">range: {a.range}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>{t("Classification")}</h3>
        <p className="hint">
          {t("observed:")} {pkg.sources.classification.observed.join(", ")}
          <br />
          {t("derived: terrain grids, ortho extracts, alignment measurements, landform-anchored site positions")}
          <br />
          {t("simulated: base, events, passability threshold, all EVA budget numbers")}
        </p>
      </aside>
    </>
  );
}
