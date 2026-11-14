/**
 * Deterministic mission engine (SPECIFICATION.md §5). The mission is a pure
 * function of simulated minutes: missionStateAt(timeline, schedule, emergency,
 * T) derives the full state from T alone — identical schedules replay
 * identically (E1), events apply exactly once (E2), closures re-route from the
 * exact interpolated position and the walked path never crosses blocked cells
 * (E3), and the return estimate uses the same edge model the engine walks, so
 * estimate equals actual consumption (E4).
 *
 * Heavy work (the emergency-return A*) runs once per trigger via
 * planEmergencyReturn; missionStateAt itself is O(path) lookups per frame.
 *
 * All events are simulated. Internal units: meters, minutes, degrees, abstract
 * 0-100 budget units for oxygen/battery.
 */

import { astar } from "../routing/search.js";
import { buildSearchGraph, edgeMetrics, type EdgeCostModel, type SearchGraph } from "../routing/graph.js";
import { sampleElevationM } from "../domain/world.js";
import type { RouteResult, TerrainGrid } from "../domain/types.js";

export interface MissionTimeline {
  readonly terrain: TerrainGrid;
  readonly model: EdgeCostModel;
  readonly cellSizeM: number;
  readonly originYM: number;
  readonly unblockedGraph: SearchGraph;
  outboundCells: Array<[number, number]>;
  outboundCumMin: number[];
  outboundTotalMin: number;
  stopMinutes: number;
  returnCells: Array<[number, number]>;
  returnCumMin: number[];
  returnTotalMin: number;
  totalMinutes: number;
  initialResources: { oxygen: number; battery: number };
  reserveFractions: { oxygen: number; battery: number };
  rates: { oxygenPerMin: number; batteryPerMin: number };
  baseCell: [number, number];
}

export type MissionPhase =
  | "planned"
  | "running"
  | "paused"
  | "returning"
  | "completed"
  | "insufficient_return"
  | "no_feasible_return";

export type LegName = "outbound" | "stop" | "plannedReturn" | "emergencyReturn";

export interface MissionPosition {
  /** exact interpolated local meters (display uses this, never snapped) */
  xM: number;
  yM: number;
  /** nearest path cell — the emergency return snaps within half an edge */
  row: number;
  col: number;
  segmentIndex: number;
  fraction: number;
  leg: LegName;
}

export interface EmergencyPlan {
  /** exact interpolated event position (local meters) */
  startXM: number;
  startYM: number;
  snappedCell: [number, number];
  /** path from the snapped cell to base (inclusive) */
  cells: Array<[number, number]>;
  /** per-vertex cumulative minutes along cells (the partial step excluded) */
  cumMin: number[];
  partialMeters: number;
  partialMinutes: number;
  pathMeters: number;
  totalMinutes: number; // partial + path
  oxygen: number;
  battery: number;
  remainingAtEvent: { oxygen: number; battery: number };
  marginAfterReturn: { oxygen: number; battery: number };
  /** reaches base but breaches the reserve (amber outcome, never green) */
  insufficientReserve: boolean;
  /** remaining resources cover the full return cost; false = stranded */
  reachable: boolean;
  reason: string;
}

export interface MissionEventRecord {
  event: ScheduledEvent;
  effect: string;
}

export interface MissionState {
  phase: MissionPhase;
  simMinutes: number;
  position: MissionPosition | null;
  leg: LegName | null;
  eventsApplied: MissionEventRecord[];
  resources: { oxygen: number; battery: number };
  emergencyPlan: EmergencyPlan | null;
  stopMinutesCompleted: number;
}

export interface ScheduledEvent {
  id: string;
  type: "battery_loss" | "area_closure";
  atSimMinutes: number;
  amountUnits?: number;
}

export interface EventSchedule {
  /** at most one area_closure; battery losses may combine with it */
  closure: ScheduledEvent | null;
  batteryLosses: ScheduledEvent[];
}

const RATES = { oxygenPerMin: 100 / 480, batteryPerMin: 100 / 480 };

function walkCumulativeMinutes(
  graph: SearchGraph,
  terrain: TerrainGrid,
  cells: Array<[number, number]>,
  model: EdgeCostModel,
): number[] {
  const cum: number[] = [0];
  for (let i = 0; i + 1 < cells.length; i++) {
    const [r1, c1] = cells[i] as [number, number];
    const [r2, c2] = cells[i + 1] as [number, number];
    const m = edgeMetrics(graph, r1, c1, r2, c2, model);
    if (m === null) throw new Error(`illegal edge (${r1},${c1})->(${r2},${c2}) in planned leg`);
    cum.push((cum[i] as number) + m.minutes);
  }
  return cum;
}

/** Build the walkable timeline from the phase-2 kernel's recommended plan. The
 * per-vertex cumulative minutes are re-walked with the identical edge model, so
 * the totals equal the kernel's leg minutes exactly (E4). */
export function buildMissionTimeline(
  result: RouteResult,
  terrain: TerrainGrid,
  model: EdgeCostModel,
  slopeThresholdDeg: number,
  extras: {
    initialResources: { oxygen: number; battery: number };
    reserveFractions: { oxygen: number; battery: number };
  },
): MissionTimeline {
  const candidate =
    result.candidates.find((c) => c.strategy === result.recommended?.strategy) ??
    result.recommended;
  if (!candidate) throw new Error("no feasible candidate to simulate");
  const unblockedGraph = buildSearchGraph(terrain, { slopeThresholdDeg });
  const outboundCum = walkCumulativeMinutes(unblockedGraph, terrain, candidate.outbound.pathCells, model);
  const returnCum = walkCumulativeMinutes(unblockedGraph, terrain, candidate.returnRoute.pathCells, model);
  const baseCell = candidate.returnRoute.pathCells[
    candidate.returnRoute.pathCells.length - 1
  ] as [number, number];
  return {
    terrain,
    model,
    cellSizeM: terrain.cellSizeM,
    originYM: terrain.originYM,
    unblockedGraph,
    outboundCells: candidate.outbound.pathCells,
    outboundCumMin: outboundCum,
    outboundTotalMin: candidate.outbound.minutes,
    stopMinutes: candidate.stopMinutes,
    returnCells: candidate.returnRoute.pathCells,
    returnCumMin: returnCum,
    returnTotalMin: candidate.returnRoute.minutes,
    totalMinutes: candidate.outbound.minutes + candidate.stopMinutes + candidate.returnRoute.minutes,
    initialResources: { ...extras.initialResources },
    reserveFractions: { ...extras.reserveFractions },
    rates: { ...RATES },
    baseCell,
  };
}

function positionOnLeg(
  timeline: MissionTimeline,
  cells: Array<[number, number]>,
  cum: number[],
  minutes: number,
  leg: LegName,
): MissionPosition {
  let i = 0;
  while (i + 1 < cum.length && (cum[i + 1] as number) < minutes) i++;
  const last = cum.length - 1;
  if (i >= last) {
    // past the end: clamp to the final vertex
    const [r, c] = cells[last] as [number, number];
    const cs = timeline.cellSizeM;
    return {
      xM: (c + 0.5) * cs,
      yM: timeline.originYM - (r + 0.5) * cs,
      row: r,
      col: c,
      segmentIndex: Math.max(0, last - 1),
      fraction: 1,
      leg,
    };
  }
  const segStart = cum[i] as number;
  const segEnd = cum[i + 1] as number;
  const span = segEnd - segStart;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (minutes - segStart) / span)) : 0;
  const [r1, c1] = cells[i] as [number, number];
  const [r2, c2] = cells[i + 1] as [number, number];
  const cs = timeline.cellSizeM;
  const x1 = (c1 + 0.5) * cs;
  const x2 = (c2 + 0.5) * cs;
  const y1 = timeline.originYM - (r1 + 0.5) * cs;
  const y2 = timeline.originYM - (r2 + 0.5) * cs;
  return {
    xM: x1 + (x2 - x1) * fraction,
    yM: y1 + (y2 - y1) * fraction,
    row: Math.round(r1 + (r2 - r1) * fraction),
    col: Math.round(c1 + (c2 - c1) * fraction),
    segmentIndex: i,
    fraction,
    leg,
  };
}

function cellsForLeg(timeline: MissionTimeline, leg: LegName): Array<[number, number]> {
  return leg === "plannedReturn" || leg === "emergencyReturn"
    ? timeline.returnCells
    : timeline.outboundCells;
}

function closureMask(timeline: MissionTimeline, rows: [number, number], cols: [number, number]): Uint8Array {
  const mask = new Uint8Array(timeline.terrain.width * timeline.terrain.height);
  for (let r = rows[0]; r < rows[1]; r++) {
    for (let c = cols[0]; c < cols[1]; c++) {
      if (r >= 0 && r < timeline.terrain.height && c >= 0 && c < timeline.terrain.width) {
        mask[r * timeline.terrain.width + c] = 1;
      }
    }
  }
  return mask;
}

/**
 * Plan the emergency return once, when an event fires that forces a return.
 * @param mask closure mask for the area_closure event, null for a battery abort
 *   (nothing is closed, the route just starts from the current position).
 * Returns null when no path to base exists under the mask — the caller maps
 * that to no_feasible_return. The reserve is a fraction of INITIAL capacity and
 * is never reduced by the loss (E2).
 */
export function planEmergencyReturn(
  timeline: MissionTimeline,
  positionAtEvent: MissionPosition,
  batteryLossUnits: number,
  consumedEvaMinutesAtEvent: number,
  mask: Uint8Array | null,
): EmergencyPlan | null {
  const cellsForLegArr = cellsForLeg(timeline, positionAtEvent.leg);
  const segIdx = Math.min(positionAtEvent.segmentIndex, cellsForLegArr.length - 2);
  const src =
    positionAtEvent.fraction < 0.5
      ? (cellsForLegArr[segIdx] as [number, number])
      : (cellsForLegArr[Math.min(segIdx + 1, cellsForLegArr.length - 1)] as [number, number]);
  const graph =
    mask !== null
      ? buildSearchGraph(timeline.terrain, {
          slopeThresholdDeg: 20,
          blockMask: mask,
        })
      : timeline.unblockedGraph;
  const search = astar(graph, src[0], src[1], timeline.baseCell[0], timeline.baseCell[1], timeline.model);
  if (!search.found || search.path === null) return null;

  // partial first step: exact interpolated position -> snapped cell center,
  // timed with the same edge model (horizontal distance + sampled rise)
  const cs = timeline.cellSizeM;
  const sx = (src[1] + 0.5) * cs;
  const sy = timeline.originYM - (src[0] + 0.5) * cs;
  const partialMeters = Math.hypot(sx - positionAtEvent.xM, sy - positionAtEvent.yM);
  const terrain = timeline.terrain;
  const elevP = sampleElevationM(
    terrain,
    positionAtEvent.xM,
    positionAtEvent.yM,
    0,
  );
  const elevS = terrain.elevationsM[src[0] * terrain.width + src[1]] as number;
  const dz = elevS - elevP;
  const slopeDeg = partialMeters > 0 ? (Math.atan2(Math.abs(dz), partialMeters) * 180) / Math.PI : 0;
  const partialMinutes =
    partialMeters / (timeline.model.baseSpeedMPM / (1 + slopeDeg * timeline.model.slopeTimeFactorPerDeg)) +
    Math.max(0, dz) * timeline.model.ascentPenaltyMinPerM;

  let pathMeters = 0;
  const cum: number[] = [0];
  for (let i = 0; i + 1 < search.path.length; i++) {
    const [r1, c1] = search.path[i] as [number, number];
    const [r2, c2] = search.path[i + 1] as [number, number];
    const m = edgeMetrics(graph, r1, c1, r2, c2, timeline.model);
    if (m === null) return null;
    pathMeters += m.distanceM;
    cum.push((cum[i] as number) + m.minutes);
  }
  const totalMinutes = partialMinutes + search.cost;
  const remaining = {
    oxygen:
      timeline.initialResources.oxygen -
      consumedEvaMinutesAtEvent * timeline.rates.oxygenPerMin -
      batteryLossUnits,
    battery:
      timeline.initialResources.battery -
      consumedEvaMinutesAtEvent * timeline.rates.batteryPerMin -
      batteryLossUnits,
  };
  const oxygen = totalMinutes * timeline.rates.oxygenPerMin;
  const battery = totalMinutes * timeline.rates.batteryPerMin;
  const marginAfterReturn = {
    oxygen:
      remaining.oxygen -
      timeline.reserveFractions.oxygen * timeline.initialResources.oxygen -
      oxygen,
    battery:
      remaining.battery -
      timeline.reserveFractions.battery * timeline.initialResources.battery -
      battery,
  };
  const insufficientReserve = marginAfterReturn.oxygen < 0 || marginAfterReturn.battery < 0;
  const reachable = remaining.oxygen >= oxygen && remaining.battery >= battery;
  return {
    startXM: positionAtEvent.xM,
    startYM: positionAtEvent.yM,
    snappedCell: [src[0], src[1]],
    cells: search.path,
    cumMin: cum,
    partialMeters,
    partialMinutes,
    pathMeters,
    totalMinutes,
    oxygen,
    battery,
    remainingAtEvent: remaining,
    marginAfterReturn,
    insufficientReserve,
    reachable,
    reason: mask !== null ? "area_closure" : "battery_loss",
  };
}

/** Deduplicate event ids (E2/E5): a repeated trigger is ignored. */
export function normalizeSchedule(schedule: EventSchedule): EventSchedule {
  const losses: ScheduledEvent[] = [];
  const seen = new Set<string>();
  for (const e of schedule.batteryLosses) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    losses.push(e);
  }
  return { closure: schedule.closure, batteryLosses: losses };
}

function consumedEvaMinutesBefore(timeline: MissionTimeline, t: number): number {
  // the mission follows the nominal timeline before the event; EVA consumption
  // is exactly rates x elapsed minutes (stops consume at the same rate)
  return Math.min(t, timeline.totalMinutes);
}

function nominalState(
  timeline: MissionTimeline,
  T: number,
  losses: number,
  eventsApplied: MissionEventRecord[],
): MissionState {
  const outT = timeline.outboundTotalMin;
  const stopEnd = outT + timeline.stopMinutes;
  const total = stopEnd + timeline.returnTotalMin;
  let pos: MissionPosition;
  let leg: LegName;
  let stopDone = 0;
  if (T < outT) {
    pos = positionOnLeg(timeline, timeline.outboundCells, timeline.outboundCumMin, T, "outbound");
    leg = "outbound";
  } else if (T < stopEnd) {
    pos = positionOnLeg(timeline, timeline.outboundCells, timeline.outboundCumMin, outT, "stop");
    leg = "stop";
    stopDone = T - outT;
  } else {
    pos = positionOnLeg(
      timeline,
      timeline.returnCells,
      timeline.returnCumMin,
      Math.min(T - stopEnd, timeline.returnTotalMin),
      "plannedReturn",
    );
    leg = "plannedReturn";
    stopDone = timeline.stopMinutes;
  }
  const eva = Math.min(T, total);
  return {
    phase: T >= total ? "completed" : "running",
    simMinutes: T,
    position: pos,
    leg,
    eventsApplied,
    resources: {
      oxygen: Math.max(0, timeline.initialResources.oxygen - eva * timeline.rates.oxygenPerMin - losses),
      battery: Math.max(0, timeline.initialResources.battery - eva * timeline.rates.batteryPerMin - losses),
    },
    emergencyPlan: null,
    stopMinutesCompleted: stopDone,
  };
}

function emergencyState(
  timeline: MissionTimeline,
  emergency: EmergencyPlan,
  t0: number,
  losses: number,
  T: number,
  eventsApplied: MissionEventRecord[],
): MissionState {
  const retMin = Math.max(0, Math.min(T - t0, emergency.totalMinutes));
  let pos: MissionPosition;
  if (retMin <= emergency.partialMinutes) {
    const f = emergency.partialMinutes > 0 ? retMin / emergency.partialMinutes : 1;
    const cs = timeline.cellSizeM;
    const sx = (emergency.snappedCell[1] + 0.5) * cs;
    const sy = timeline.originYM - (emergency.snappedCell[0] + 0.5) * cs;
    pos = {
      xM: emergency.startXM + (sx - emergency.startXM) * f,
      yM: emergency.startYM + (sy - emergency.startYM) * f,
      row: emergency.snappedCell[0],
      col: emergency.snappedCell[1],
      segmentIndex: 0,
      fraction: f,
      leg: "emergencyReturn",
    };
  } else {
    pos = positionOnLeg(
      timeline,
      emergency.cells,
      emergency.cumMin,
      retMin - emergency.partialMinutes,
      "emergencyReturn",
    );
  }
  const consumedBefore = consumedEvaMinutesBefore(timeline, t0);
  const eva = consumedBefore + retMin;
  const done = retMin >= emergency.totalMinutes;
  return {
    phase: done ? (emergency.insufficientReserve ? "insufficient_return" : "completed") : "returning",
    simMinutes: T,
    position: pos,
    leg: "emergencyReturn",
    eventsApplied,
    resources: {
      oxygen: Math.max(0, timeline.initialResources.oxygen - eva * timeline.rates.oxygenPerMin - losses),
      battery: Math.max(0, timeline.initialResources.battery - eva * timeline.rates.batteryPerMin - losses),
    },
    emergencyPlan: emergency,
    stopMinutesCompleted:
      t0 > timeline.outboundTotalMin ? Math.min(t0 - timeline.outboundTotalMin, timeline.stopMinutes) : 0,
  };
}

export interface ActiveEmergency {
  /** trigger time of the event that forced the return */
  t0: number;
  /** null = no path to base exists (no_feasible_return) */
  plan: EmergencyPlan | null;
}

/** The first event (chronologically) that forces a return from the current
 * trajectory: an area closure, or a battery loss after which the remaining
 * capacity can no longer finish the nominal mission plus the reserve. */
export function firstReturnForcingEvent(
  timeline: MissionTimeline,
  schedule: EventSchedule,
  T: number,
): { t0: number; event: ScheduledEvent } | null {
  const sched = normalizeSchedule(schedule);
  const candidates: Array<{ t0: number; event: ScheduledEvent }> = [];
  if (sched.closure && sched.closure.atSimMinutes <= T) {
    candidates.push({ t0: sched.closure.atSimMinutes, event: sched.closure });
  }
  let appliedLoss = 0;
  const losses = [...sched.batteryLosses].sort((a, b) => a.atSimMinutes - b.atSimMinutes);
  for (const e of losses) {
    if (e.atSimMinutes > T) break;
    const remainingAtEvent =
      timeline.initialResources.oxygen -
      e.atSimMinutes * timeline.rates.oxygenPerMin -
      appliedLoss -
      (e.amountUnits ?? 0);
    const finishCost =
      (timeline.totalMinutes - e.atSimMinutes) * timeline.rates.oxygenPerMin;
    const reserve =
      timeline.reserveFractions.oxygen * timeline.initialResources.oxygen;
    if (remainingAtEvent < finishCost + reserve) {
      candidates.push({ t0: e.atSimMinutes, event: e });
    }
    appliedLoss += e.amountUnits ?? 0;
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.t0 - b.t0);
  return candidates[0] ?? null;
}

/**
 * Full state at simulated minute T.
 * @param emergency the precomputed return for the first forcing event (from
 *   firstReturnForcingEvent + planEmergencyReturn at that event's position and
 *   time), or null when no forcing event is active. plan === null inside means
 *   no path to base exists (no_feasible_return at t0).
 */
export function missionStateAt(
  timeline: MissionTimeline,
  schedule: EventSchedule,
  emergency: { t0: number; plan: EmergencyPlan | null } | null,
  T: number,
): MissionState {
  const sched = normalizeSchedule(schedule);
  const eventsApplied: MissionEventRecord[] = [];
  const losses = sched.batteryLosses
    .filter((e) => e.atSimMinutes <= T)
    .reduce((acc, e) => acc + (e.amountUnits ?? 0), 0);
  for (const e of sched.batteryLosses) {
    if (e.atSimMinutes <= T) {
      eventsApplied.push({
        event: e,
        effect: `battery -${e.amountUnits} units (applied once at T+${e.atSimMinutes} min)`,
      });
    }
  }
  const closure = sched.closure;
  if (closure && closure.atSimMinutes <= T) {
    eventsApplied.push({
      event: closure,
      effect: "area closed: mission aborted, return replanned from current position",
    });
  }

  if (emergency !== null) {
    const t0 = emergency.t0;
    if (emergency.plan === null || !emergency.plan.reachable) {
      // no path to base, or the remaining resources cannot cover the walk home:
      // playback stops with an explicit failure (no invented safe exit)
      const st = nominalState(timeline, t0, losses, eventsApplied);
      st.phase = "no_feasible_return";
      st.simMinutes = T;
      st.emergencyPlan = emergency.plan;
      return st;
    }
    return emergencyState(timeline, emergency.plan, t0, losses, T, eventsApplied);
  }
  return nominalState(timeline, T, losses, eventsApplied);
}
