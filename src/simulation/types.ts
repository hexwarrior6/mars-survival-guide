/**
 * Mission simulation contract (SPECIFICATION.md §5). The mission is a pure
 * function of simulated minutes: state(T) is deterministic given the plan and
 * the event schedule — replay with the same schedule reproduces the same result.
 * All events are simulated; none represents observation.
 */

import type { ResourceKind, RouteLeg } from "../domain/types.js";

export type MissionPhase =
  | "planned" // plan feasible, expedition not started
  | "running" // outbound or science stop in progress
  | "paused"
  | "returning" // emergency return after an event
  | "completed"
  | "insufficient_return" // reached base but reserve was breached (never green)
  | "no_feasible_return"; // cannot reach base at all under the model (failure)

export type SimEventType = "battery_loss" | "area_closure";

export interface ScheduledEvent {
  id: string;
  type: SimEventType;
  /** simulated mission minute at which the event fires */
  atSimMinutes: number;
  /** battery_loss only: units removed once */
  amountUnits?: number;
}

export interface MissionPlan {
  /** recommended candidate from the phase 2 kernel (feasible only) */
  outbound: RouteLeg;
  stopMinutes: number;
  returnRoute: RouteLeg;
  strategy: Strategy_;
  initialResources: Record<ResourceKind, number>;
  reserveFractions: Record<ResourceKind, number>;
}

type Strategy_ = "shortest" | "terrain-aware";

export interface PositionSnapshot {
  /** interpolated local meters */
  xM: number;
  yM: number;
  /** nearest path cell (snap distance <= half an edge, displayed by the UI) */
  row: number;
  col: number;
  /** index of the segment [i, i+1] containing the position */
  segmentIndex: number;
  fraction: number;
}

export interface ReturnSolution {
  /** full polyline starts at the exact interpolated event position */
  pathCells: Array<[number, number]>;
  distanceM: number;
  minutes: number;
  oxygen: number;
  battery: number;
  /** true when the return reaches base but breaches the reserve */
  insufficientReserve: boolean;
  marginAfterReturn: Record<ResourceKind, number>;
  closureRowCol: { rows: [number, number]; cols: [number, number] } | null;
}

export interface MissionEventRecord {
  event: ScheduledEvent;
  simMinutes: number;
  effect: string;
}

export interface MissionState {
  phase: MissionPhase;
  simMinutes: number;
  /** interpolated position on the active route */
  position: PositionSnapshot | null;
  /** which leg is being walked: "outbound" | "stop" | "planReturn" | "emergencyReturn" */
  leg: "outbound" | "stop" | "planReturn" | "emergencyReturn" | null;
  resources: Record<ResourceKind, number>;
  eventsApplied: MissionEventRecord[];
  /** emergency return solution after an area closure (stable for T >= trigger) */
  emergencyReturn: ReturnSolution | null;
  /** battery losses applied so far (units) */
  batteryLossUnits: number;
  /** minutes of science stop already completed when the mission was aborted */
  stopMinutesCompleted: number;
}

export interface EventSchedule {
  events: ScheduledEvent[];
}
