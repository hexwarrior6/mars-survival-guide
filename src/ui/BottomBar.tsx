/** Bottom mission bar: phase badge, simulated clock, event log, the reserved
 * timeline slot and the legend button. The timeline band displays REAL mission
 * progress (planned leg proportions + current T from the engine) but is NOT
 * interactive — scrub/replay interaction arrives in phase V2, so there is no
 * draggable thumb or button styling here (no fake controls). */

import type { JSX } from "react";
import { useLang } from "./i18n.js";

export interface BottomBarState {
  phase: string;
  simMinutes: number;
  totalMinutes: number;
  events: string[];
  emergencyActive: boolean;
  running: boolean;
  paused: boolean;
  started: boolean;
}

export interface ResourceChipState {
  label: string;
  value: number;
  initial: number;
  reserveFraction: number;
}

export interface TimelineSegments {
  outboundMin: number;
  stopMin: number;
  returnMin: number;
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

/** Top-right resource chip: numeric readout + reserve tick (real values). */
export function ResourceChip({ label, value, initial, reserveFraction }: ResourceChipState): JSX.Element {
  const { t } = useLang();
  const pct = Math.max(0, Math.min(100, value));
  const breached = value < reserveFraction * initial;
  return (
    <span className="chip" data-breached={breached || undefined}>
      <span className="chip-label">{t(label)}</span>
      <span className="chip-value">{value.toFixed(1)}</span>
      <span className="chip-unit">/{initial}</span>
      <span className="chip-bar">
        <span className="chip-bar-fill" style={{ width: `${pct}%`, background: breached ? "var(--error)" : "var(--accent)" }} />
        <span className="chip-bar-tick" style={{ left: `${reserveFraction * 100}%` }} />
      </span>
    </span>
  );
}

/** Reserved timeline slot: planned leg proportions with the live mission-time
 * marker. Display-only (V2 adds replay); never focusable, never styled as a
 * control. */
function TimelineBand({
  segments,
  simMinutes,
  totalMinutes,
}: {
  segments: TimelineSegments | null;
  simMinutes: number;
  totalMinutes: number;
}): JSX.Element {
  const { t } = useLang();
  const total = segments ? segments.outboundMin + segments.stopMin + segments.returnMin : totalMinutes;
  const pct = (v: number): string => (total > 0 ? `${Math.max(0, Math.min(100, (v / total) * 100))}%` : "0%");
  return (
    <div className="tl-slot">
      <div className="tl-band" role="img" aria-label={t("mission progress")} aria-hidden={false}>
        {segments !== null && (
          <>
            <span className="tl-seg tl-out" style={{ width: pct(segments.outboundMin) }} />
            <span className="tl-seg tl-stop" style={{ width: pct(segments.stopMin) }} />
            <span className="tl-seg tl-ret" style={{ width: pct(segments.returnMin) }} />
          </>
        )}
        {total > 0 && (
          <span className="tl-marker" style={{ left: pct(simMinutes) }} />
        )}
      </div>
      <span className="tl-note" title={t("Mission timeline: replay interaction arrives in a later phase")}>
        {t("T+{t} / {total} min", { t: simMinutes.toFixed(1), total: total.toFixed(0) })}
        {" · "}
        {t("Mission timeline: replay interaction arrives in a later phase")}
      </span>
    </div>
  );
}

export function BottomBar({
  bar,
  segments,
  onOpenLegend,
}: {
  bar: BottomBarState;
  segments: TimelineSegments | null;
  onOpenLegend: () => void;
}): JSX.Element {
  const { t } = useLang();
  const phaseLabel = t(PHASE_EN[bar.phase] ?? bar.phase.toUpperCase());
  const failed = bar.phase === "no_feasible_return";
  const amber = bar.phase === "insufficient_return" || bar.emergencyActive;
  const clockLabel = bar.started || bar.phase !== "idle" ? phaseLabel : t("not started");
  return (
    <div
      className={`bottom-bar${failed ? " bar-failed" : ""}${amber && !failed ? " bar-amber" : ""}`}
      role="status"
      aria-label="Mission status"
    >
      <span className={`bar-phase${failed ? " bar-phase-failed" : ""}`}>
        {failed ? "■ " : ""}
        {clockLabel}
      </span>
      <TimelineBand segments={segments} simMinutes={bar.simMinutes} totalMinutes={bar.totalMinutes} />
      <span className="bar-events">
        {bar.events.length > 0
          ? bar.events.slice(-2).map((e, i) => <span key={i}>{e}</span>)
          : t("no events")}
      </span>
      <span className="spacer" />
      <button type="button" className="small" onClick={onOpenLegend}>
        {t("Legend")}
      </button>
      <span className="bar-note">{t("all simulated")}</span>
    </div>
  );
}
