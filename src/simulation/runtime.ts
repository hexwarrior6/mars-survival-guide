/** Mutable runtime for an active mission (owned by the console, mutated by the
 * in-canvas SimDriver every frame). React reads a throttled mirror for the HUD;
 * the 3D layer reads this object directly each frame. */

import type { MissionTimeline, EmergencyPlan, MissionPhase } from "./engine.js";
import type { EventSchedule } from "./engine.js";
import type { RouteResult } from "../domain/types.js";

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
