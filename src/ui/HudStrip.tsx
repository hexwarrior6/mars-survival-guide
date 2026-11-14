/** Mission HUD strip: phase, simulated clock, resource bars with the reserve
 * marker, and the event log. Numbers come from the engine state mirror. */

import type { JSX } from "react";
import { useLang } from "./i18n.js";

export interface HudStripState {
  phase: string;
  legLabel: string;
  simMinutes: number;
  totalMinutes: number;
  oxygen: number;
  battery: number;
  initial: number;
  reserveFraction: number;
  events: string[];
  emergencyActive: boolean;
  running: boolean;
  paused: boolean;
  started: boolean;
}

const PHASE_EN: Record<string, string> = {
  idle: "IDLE",
  planned: "PLANNED",
  running: "RUNNING",
  paused: "PAUSED",
  returning: "EMERGENCY RETURN",
  completed: "MISSION COMPLETE",
  insufficient_return: "RETURNED · RESERVE BREACHED",
  no_feasible_return: "STRANDED — NO FEASIBLE RETURN",
  replanning: "REPLANNING",
};

function Bar({
  label,
  value,
  initial,
  reserveFraction,
}: {
  label: string;
  value: number;
  initial: number;
  reserveFraction: number;
}): JSX.Element {
  const { t } = useLang();
  const pct = Math.max(0, Math.min(100, value));
  const reservePct = reserveFraction * 100;
  const breached = value < reserveFraction * initial;
  return (
    <span className="hud-bar-wrap">
      <span className="hud-bar-label">
        {t(label)} {value.toFixed(1)}/{initial}
      </span>
      <span className="hud-bar">
        <span
          className="hud-bar-fill"
          style={{ width: `${pct}%`, background: breached ? "var(--error)" : "var(--accent)" }}
        />
        <span className="hud-bar-tick" style={{ left: `${reservePct}%` }} />
      </span>
    </span>
  );
}

export function HudStrip({ hud }: { hud: HudStripState }): JSX.Element {
  const { t } = useLang();
  const phaseLabel = t(PHASE_EN[hud.phase] ?? hud.phase.toUpperCase());
  const failed = hud.phase === "no_feasible_return";
  const amber = hud.phase === "insufficient_return" || hud.emergencyActive;
  const clock =
    hud.started || hud.phase !== "idle"
      ? t("T+{t} / {total} min", { t: hud.simMinutes.toFixed(1), total: hud.totalMinutes.toFixed(0) })
      : t("not started");
  return (
    <div
      className={`hud-strip${failed ? " hud-failed" : ""}${amber && !failed ? " hud-amber" : ""}`}
      role="status"
      aria-label="Mission status"
    >
      <span className={`hud-phase${failed ? " hud-phase-failed" : ""}`}>
        {failed ? "■ " : ""}
        {phaseLabel}
      </span>
      <span className="hud-clock">{clock}</span>
      <Bar label="OXYGEN" value={hud.oxygen} initial={hud.initial} reserveFraction={hud.reserveFraction} />
      <Bar label="BATTERY" value={hud.battery} initial={hud.initial} reserveFraction={hud.reserveFraction} />
      <span className="hud-events">
        {hud.events.length > 0
          ? hud.events.slice(-2).map((e, i) => <span key={i}>{e}</span>)
          : t("no events")}
      </span>
      <span className="hud-note">{t("all simulated")}</span>
    </div>
  );
}
