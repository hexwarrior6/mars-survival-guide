/** Bottom mission bar: phase badge, play/pause, the scrub-able mission
 * timeline, event ticks, event log and the legend button.
 *
 * Timeline semantics (SPECIFICATION.md §5): dragging = paused playback; the
 * state at any T is DERIVED (missionStateAt is a pure function of T), so
 * scrubbing back and forth across events can never double-apply a loss or
 * re-trigger an accident; RESUME continues from the scrubbed T. Event ticks
 * are real scheduled events and clicking one jumps to that minute. The bar
 * labels whether you are looking at a replay of the deterministic simulation
 * or a live playback. */

import { useRef, useState } from "react";
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
  /** true after the user scrubbed (deterministic replay view) */
  scrubbed: boolean;
  speed: number;
}

export interface TimelineTick {
  t: number;
  kind: "battery" | "closure";
}

export interface TimelineSegments {
  outboundMin: number;
  stopMin: number;
  returnMin: number;
}

export interface ResourceChipState {
  label: string;
  value: number;
  initial: number;
  reserveFraction: number;
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

/** Scrub-able timeline: planned leg proportions, live T marker, clickable
 * event ticks, pointer + keyboard scrubbing (slider role). All values are
 * real engine state; there is no fake control here. */
function TimelineBand({
  segments,
  simMinutes,
  maxT,
  ticks,
  scrubbed,
  onScrub,
}: {
  segments: TimelineSegments | null;
  simMinutes: number;
  maxT: number;
  ticks: TimelineTick[];
  scrubbed: boolean;
  onScrub: (T: number) => void;
}): JSX.Element {
  const { t } = useLang();
  const bandRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const total = segments ? segments.outboundMin + segments.stopMin + segments.returnMin : maxT;
  const pct = (v: number): string => (maxT > 0 ? `${Math.max(0, Math.min(100, (v / maxT) * 100))}%` : "0%");

  const scrubAt = (clientX: number): void => {
    const el = bandRef.current;
    if (el === null || maxT <= 0) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onScrub(frac * maxT);
  };

  const modeLabel = scrubbed
    ? t("replay view: deterministic simulation at T+{t}", { t: simMinutes.toFixed(1) })
    : t("Mission timeline: drag to replay any moment");

  return (
    <div className="tl-slot">
      <div
        ref={bandRef}
        className={`tl-band${maxT > 0 ? " tl-live" : ""}${dragging ? " tl-dragging" : ""}`}
        role={maxT > 0 ? "slider" : "img"}
        aria-label={t("mission timeline")}
        aria-valuemin={maxT > 0 ? 0 : undefined}
        aria-valuemax={maxT > 0 ? Math.round(maxT) : undefined}
        aria-valuenow={maxT > 0 ? Math.round(simMinutes) : undefined}
        aria-valuetext={t("T+{t} of {total} minutes", { t: simMinutes.toFixed(1), total: maxT.toFixed(0) })}
        tabIndex={maxT > 0 ? 0 : -1}
        onPointerDown={(e) => {
          if (maxT <= 0) return;
          e.preventDefault();
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          setDragging(true);
          scrubAt(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging) scrubAt(e.clientX);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(e) => {
          if (maxT <= 0) return;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            onScrub(Math.max(0, simMinutes - 1));
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            onScrub(Math.min(maxT, simMinutes + 1));
          }
        }}
      >
        {segments !== null && (
          <>
            <span className="tl-seg tl-out" style={{ width: pct(segments.outboundMin) }} />
            <span className="tl-seg tl-stop" style={{ width: pct(segments.stopMin) }} />
            <span className="tl-seg tl-ret" style={{ width: pct(segments.returnMin) }} />
          </>
        )}
        {ticks.map((tk) => (
          <button
            key={`${tk.kind}-${tk.t}`}
            type="button"
            className={`tl-tick tl-tick-${tk.kind}`}
            style={{ left: pct(tk.t) }}
            title={t("jump to T+{t} min", { t: tk.t })}
            aria-label={t("jump to T+{t} min", { t: tk.t })}
            onClick={(e) => {
              e.stopPropagation();
              onScrub(tk.t);
            }}
          />
        ))}
        {maxT > 0 && <span className="tl-marker" style={{ left: pct(simMinutes) }} />}
      </div>
      <span className="tl-note">
        {t("T+{t} / {total} min", { t: simMinutes.toFixed(1), total: total.toFixed(0) })}
        {maxT > 0 ? " · " + modeLabel : ""}
      </span>
    </div>
  );
}

export function BottomBar({
  bar,
  segments,
  maxT,
  ticks,
  onScrub,
  onTogglePlay,
  onOpenLegend,
}: {
  bar: BottomBarState;
  segments: TimelineSegments | null;
  maxT: number;
  ticks: TimelineTick[];
  onScrub: (T: number) => void;
  onTogglePlay: () => void;
  onOpenLegend: () => void;
}): JSX.Element {
  const { t } = useLang();
  const phaseLabel = t(PHASE_EN[bar.phase] ?? bar.phase.toUpperCase());
  const failed = bar.phase === "no_feasible_return";
  const amber = bar.phase === "insufficient_return" || bar.emergencyActive;
  const clockLabel = bar.started || bar.phase !== "idle" ? phaseLabel : t("not started");
  const playing = bar.running && !bar.paused;
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
      {maxT > 0 && (
        <button
          type="button"
          className="small bar-play"
          aria-label={playing ? t("PAUSE") : t("RESUME")}
          onClick={onTogglePlay}
        >
          {playing ? "⏸" : "▶"}
        </button>
      )}
      <TimelineBand
        segments={segments}
        simMinutes={bar.simMinutes}
        maxT={maxT}
        ticks={ticks}
        scrubbed={bar.scrubbed && !playing}
        onScrub={onScrub}
      />
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
