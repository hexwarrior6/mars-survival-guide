/** Helmet HUD for the first-person view: a fixed DOM overlay on top of the
 *  canvas (no WebGL cost, readable at any DPR). Every number comes from the
 *  mission runtime; the heading is the direction the astronaut is actually
 *  walking along the computed route, not a decorative compass. */

import type { JSX } from "react";
import { useLang } from "./i18n.js";

export interface HelmetHudProps {
  oxygen: number;
  battery: number;
  minutes: number;
  headingRad: number | null;
  phase: string;
  /** the leg the runtime says we are walking (outbound / stop / return …) */
  leg: string;
  /** "1" once the mission is running or scrubbed, "0" for the preview state */
  live: boolean;
}

const LEG_LABEL: Record<string, string> = {
  outbound: "outbound",
  stop: "science stop",
  plannedReturn: "return",
  emergencyReturn: "emergency return",
  "-": "—",
};

const PHASE_LABEL: Record<string, string> = {
  idle: "not started",
  planned: "planned",
  running: "running",
  paused: "paused",
  returning: "returning",
  completed: "completed",
  insufficient_return: "insufficient reserve",
  no_feasible_return: "no feasible return",
};

export function HelmetHud({
  oxygen,
  battery,
  minutes,
  headingRad,
  phase,
  leg,
  live,
}: HelmetHudProps): JSX.Element {
  const { t } = useLang();
  const bearing =
    headingRad === null ? "—" : `${Math.round(((headingRad * 180) / Math.PI + 360) % 360)}°`;
  const phaseLabel = PHASE_LABEL[phase] ?? phase;
  return (
    <div className="helmet-hud" aria-hidden="true">
      <div className="helmet-scan" />
      <div className="helmet-vignette" />
      <div className="helmet-bracket b1" />
      <div className="helmet-bracket b2" />
      <div className="helmet-bracket b3" />
      <div className="helmet-bracket b4" />
      <div className="helmet-reticle" />
      <div className="helmet-tag">
        {t("HELMET CAM · SIMULATED POSITION · NEAR-FIELD DETAIL ARTISTIC")}
      </div>
      <div className="helmet-phase">
        {t("leg")}: {t(LEG_LABEL[leg] ?? leg)} · {t("phase")}: {t(phaseLabel)} · T+
        {Math.round(minutes)} {t("min")}
      </div>
      <div className="helmet-readout">
        <span>
          O₂ <em>{oxygen.toFixed(1)}</em>
        </span>
        <span>
          PWR <em>{battery.toFixed(1)}</em>
        </span>
        <span>
          HDG <em>{bearing}</em>
        </span>
        <span>
          {t("eye height")} <em>1.7</em> m
        </span>
      </div>
      {!live && <div className="helmet-hint">{t("Start the expedition to walk with the astronaut.")}</div>}
    </div>
  );
}
