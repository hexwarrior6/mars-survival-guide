/** Mutable runtime for an active mission (owned by the console, mutated by the
 * in-canvas SimDriver every frame). React reads a throttled mirror for the HUD;
 * the 3D layer reads this object directly each frame. */

import {
  firstReturnForcingEvent,
  missionStateAt,
  planEmergencyReturn,
  type EmergencyPlan,
  type MissionPhase,
  type MissionState,
  type MissionTimeline,
} from "./engine.js";
import type { EventSchedule } from "./engine.js";
import type { RouteResult } from "../domain/types.js";
import { sampleElevationM, worldY, type WorldTransform } from "../domain/world.js";

export interface MissionRuntime {
  siteId: string;
  result: RouteResult;
  timeline: MissionTimeline;
  schedule: EventSchedule;
  closureMask: Uint8Array | null;
  T: number;
  running: boolean;
  paused: boolean;
  speed: number;
  /** computed once per forcing event; plan === null means stranded */
  emergency: { t0: number; plan: EmergencyPlan | null; forId: string } | null;
}

export interface HudMirror {
  phase: MissionPhase | "idle";
  simMinutes: number;
  leg: string;
  oxygen: number;
  battery: number;
  initialOxygen: number;
  initialBattery: number;
  reserveFraction: number;
  eventsApplied: Array<{ label: string }>;
  emergencyActive: boolean;
  astronaut: { x: number; y: number; z: number } | null;
  /** travel bearing along the computed route, radians clockwise from north
   *  (0 = north, +pi/2 = east). Derived from the same deterministic state, so a
   *  scrubbed frame reports the direction the astronaut is actually walking. */
  headingRad: number | null;
  totalMinutes: number;
}

export function createHudMirror(): { current: HudMirror } {
  return {
    current: {
      phase: "idle",
      simMinutes: 0,
      leg: "-",
      oxygen: 100,
      battery: 100,
      initialOxygen: 100,
      initialBattery: 100,
      reserveFraction: 0.2,
      eventsApplied: [],
      emergencyActive: false,
      astronaut: null,
      headingRad: null,
      totalMinutes: 0,
    },
  };
}

export function makeRuntime(
  siteId: string,
  result: RouteResult,
  timeline: MissionTimeline,
  closureMask: Uint8Array | null,
  closureAtSimMinutes: number | null,
): MissionRuntime {
  return {
    siteId,
    result,
    timeline,
    closureMask,
    schedule: {
      closure:
        closureAtSimMinutes !== null
          ? { id: "area-closure", type: "area_closure" as const, atSimMinutes: closureAtSimMinutes }
          : null,
      batteryLosses: [],
    },
    T: 0,
    running: false,
    paused: false,
    speed: 8,
    emergency: null,
  };
}

/**
 * Shared emergency-cache invariant for BOTH playback (stepMissionRuntime) and
 * scrubbing (applyScrub): the plan is computed once per forcing event, keyed by
 * event id + t0; the cache is cleared when no forcing event applies at T; and
 * the cached emergency is only surfaced to missionStateAt once T has actually
 * reached t0 — dragging the timeline back before the event restores the pure
 * nominal state (E1/E2/E5; resources are derived from T, never accumulated, so
 * crossing an event back and forth can never double-apply a loss).
 */
export function ensureEmergencyPlan(
  rt: MissionRuntime,
  T: number,
): { t0: number; plan: EmergencyPlan | null } | null {
  const forcing = firstReturnForcingEvent(rt.timeline, rt.schedule, T);
  if (forcing === null) {
    rt.emergency = null;
    return null;
  }
  if (rt.emergency === null || rt.emergency.forId !== forcing.event.id || rt.emergency.t0 !== forcing.t0) {
    const losses = rt.schedule.batteryLosses
      .filter((e) => e.atSimMinutes <= forcing.t0)
      .reduce((acc, e) => acc + (e.amountUnits ?? 0), 0);
    const posAtT0 = missionStateAt(rt.timeline, rt.schedule, null, forcing.t0).position;
    if (posAtT0 === null) {
      rt.emergency = null;
      return null;
    }
    const mask = forcing.event.type === "area_closure" ? rt.closureMask : null;
    const plan = planEmergencyReturn(rt.timeline, posAtT0, losses, forcing.t0, mask);
    rt.emergency = { t0: forcing.t0, plan, forId: forcing.event.id };
  }
  return rt.T >= (rt.emergency as { t0: number }).t0 ? rt.emergency : null;
}

/**
 * Advance the runtime clock by delta minutes of real time (shared by the 3D
 * frame loop and the 2D-view interval driver). The clock advances only while
 * running and unpaused (E1); the state derivation ALWAYS runs so paused and
 * reset states stay reflected in the HUD. Emergency cache semantics live in
 * ensureEmergencyPlan and are shared with scrubbing.
 */
/** bearing (radians, clockwise from north) from T to T + lookAheadMin */
function deriveHeading(
  rt: MissionRuntime,
  t: WorldTransform,
  T: number,
  lookAheadMin: number,
): number | null {
  const now = missionStateAt(rt.timeline, rt.schedule, ensureEmergencyPlan(rt, T), T);
  if (now.position === null) return null;
  const ahead = missionStateAt(
    rt.timeline,
    rt.schedule,
    ensureEmergencyPlan(rt, T + lookAheadMin),
    T + lookAheadMin,
  );
  if (ahead.position === null) return null;
  const dx = ahead.position.xM - now.position.xM; // east positive
  const dy = ahead.position.yM - now.position.yM; // north positive
  if (Math.hypot(dx, dy) < 0.5) return null;
  // world: x east, z = -north -> bearing 0 = north, clockwise positive
  return Math.atan2(dx, dy);
}

export function stepMissionRuntime(
  rt: MissionRuntime,
  hud: HudMirror,
  t: WorldTransform,
  delta: number,
): void {
  if (rt.running && !rt.paused) {
    rt.T += Math.min(delta, 0.12) * rt.speed;
  }
  const emergency = ensureEmergencyPlan(rt, rt.T);
  const st = missionStateAt(rt.timeline, rt.schedule, emergency, rt.T);
  hud.phase = st.phase;
  hud.simMinutes = st.simMinutes;
  hud.leg = st.leg ?? "-";
  hud.oxygen = st.resources.oxygen;
  hud.battery = st.resources.battery;
  hud.eventsApplied = st.eventsApplied.map((e) => ({
    label: `T+${e.event.atSimMinutes} min · ${e.effect}`,
  }));
  hud.emergencyActive = emergency !== null && emergency.plan !== null;
  if (st.position !== null) {
    const wx = st.position.xM - t.halfWidthM;
    const wz = t.halfHeightM - st.position.yM;
    const elev = sampleElevationM(rt.timeline.terrain, st.position.xM, st.position.yM, t.datumM);
    hud.astronaut = { x: wx, y: worldY(t, elev), z: wz };
    const heading = deriveHeading(rt, t, rt.T, 0.6);
    if (heading !== null) hud.headingRad = heading; // standstill keeps the last bearing
  } else {
    hud.headingRad = null;
  }
}

/**
 * Scrub / replay (SPECIFICATION.md §5 timeline semantics): jump the mission to
 * an arbitrary T and derive the FULL state from T alone. Scrubbing pauses
 * playback (E1: nothing accumulates while paused); crossing an event boundary
 * forward computes the emergency plan once and caches it; dragging back before
 * the event returns the nominal state, and re-crossing replays it without
 * double-applying anything. The HUD mirror is updated exactly like the frame
 * driver so every view stays in sync.
 */
export function applyScrub(
  rt: MissionRuntime,
  hud: HudMirror,
  t: WorldTransform,
  T: number,
): MissionState {
  // scrubbing = paused playback session: RESUME continues from the scrubbed T
  rt.paused = true;
  rt.running = true;
  rt.T = Math.max(0, T);
  const emergency = ensureEmergencyPlan(rt, rt.T);
  const st = missionStateAt(rt.timeline, rt.schedule, emergency, rt.T);
  hud.phase = st.phase;
  hud.simMinutes = st.simMinutes;
  hud.leg = st.leg ?? "-";
  hud.oxygen = st.resources.oxygen;
  hud.battery = st.resources.battery;
  hud.eventsApplied = st.eventsApplied.map((e) => ({
    label: `T+${e.event.atSimMinutes} min · ${e.effect}`,
  }));
  hud.emergencyActive = emergency !== null && emergency.plan !== null;
  if (st.position !== null) {
    const wx = st.position.xM - t.halfWidthM;
    const wz = t.halfHeightM - st.position.yM;
    const elev = sampleElevationM(rt.timeline.terrain, st.position.xM, st.position.yM, t.datumM);
    hud.astronaut = { x: wx, y: worldY(t, elev), z: wz };
    const heading = deriveHeading(rt, t, rt.T, 0.6);
    if (heading !== null) hud.headingRad = heading;
  } else {
    hud.astronaut = null;
    hud.headingRad = null;
  }
  return st;
}
