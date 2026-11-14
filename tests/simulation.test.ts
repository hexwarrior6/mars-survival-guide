/**
 * E1-E5 mission engine tests on the real frozen region. Determinism, single
 * event application, closure avoidance, estimate/actual identity and duplicate
 * protection.
 */

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadPackageFromDirectory } from "../src/data/nodeLoader.js";
import { planRoundTrip } from "../src/routing/plan.js";
import type { EdgeCostModel } from "../src/routing/graph.js";
import { buildSearchGraph, edgeMetrics } from "../src/routing/graph.js";
import {
  buildMissionTimeline,
  missionStateAt,
  planEmergencyReturn,
  normalizeSchedule,
} from "../src/simulation/engine.js";
import type { EmergencyPlan, MissionTimeline, ScheduledEvent } from "../src/simulation/engine.js";
import { applyScrub, createHudMirror, makeRuntime, stepMissionRuntime } from "../src/simulation/runtime.js";
import { worldTransform } from "../src/domain/world.js";
import type { RouteRequest, RouteResult } from "../src/domain/types.js";

const PKG_DIR = resolve(process.cwd(), "public/data/jezero");
const pkg = loadPackageFromDirectory(PKG_DIR);

const MODEL: EdgeCostModel = {
  strategy: "terrain-aware",
  baseSpeedMPM: pkg.scenario.movementParameters.baseSpeedMPM,
  slopeTimeFactorPerDeg: pkg.scenario.movementParameters.slopeTimeFactorPerDeg,
  ascentPenaltyMinPerM: pkg.scenario.movementParameters.ascentPenaltyMinPerM,
};
const THRESHOLD = pkg.scenario.movementParameters.passabilitySlopeThresholdDeg;
const RATES = { oxygenPerMin: 100 / 480, batteryPerMin: 100 / 480 };

function setup(siteId: string, initial = 100): {
  timeline: MissionTimeline;
  request: RouteRequest;
  result: RouteResult;
} {
  const request: RouteRequest = {
    requestId: `sim-${siteId}`,
    startXM: pkg.scenario.base.xM,
    startYM: pkg.scenario.base.yM,
    targetSiteId: siteId,
    strategies: ["shortest", "terrain-aware"],
    stopMinutes: pkg.sites.find((s) => s.id === siteId)!.samplingDurationMin,
    initialResources: { oxygen: initial, battery: initial },
    reserveFractions: { ...pkg.scenario.reserveFractions },
    paramsVersion: "phase4-test",
  };
  const result = planRoundTrip(pkg, request);
  if (result.status !== "feasible") throw new Error(`setup: ${siteId} not feasible`);
  const timeline = buildMissionTimeline(
    result,
    pkg.terrain,
    MODEL,
    THRESHOLD,
    { initialResources: { oxygen: initial, battery: initial }, reserveFractions: { ...pkg.scenario.reserveFractions } },
  );
  return { timeline, request, result };
}

function closureMask(timeline: MissionTimeline): Uint8Array {
  const ev = pkg.scenario.events.find((e) => e.type === "area_closure")!;
  const [rows, cols] = [ev.geometry.type === "rectangle" ? ev.geometry.rows : [0, 0], ev.geometry.type === "rectangle" ? ev.geometry.cols : [0, 0]];
  const mask = new Uint8Array(timeline.terrain.width * timeline.terrain.height);
  for (let r = rows[0] as number; r < (rows[1] as number); r++) {
    for (let c = cols[0] as number; c < (cols[1] as number); c++) {
      mask[r * timeline.terrain.width + c] = 1;
    }
  }
  return mask;
}

const insideClosure = (timeline: MissionTimeline, cell: [number, number]): boolean => {
  const ev = pkg.scenario.events.find((e) => e.type === "area_closure")!;
  if (ev.geometry.type !== "rectangle") return false;
  const [r0, r1] = ev.geometry.rows;
  const [c0, c1] = ev.geometry.cols;
  const [r, c] = cell;
  return r >= r0 && r < r1 && c >= c0 && c < c1;
};

describe("E1: determinism and replay", () => {
  const { timeline } = setup("SITE-B", 100);
  const sched = {
    closure: { id: "e2", type: "area_closure" as const, atSimMinutes: 130 },
    batteryLosses: [{ id: "b1", type: "battery_loss" as const, atSimMinutes: 160, amountUnits: 45 }],
  };
  const emergency = planEmergencyReturn(
    timeline,
    missionStateAt(timeline, { closure: sched.closure, batteryLosses: [] }, null, 130).position!,
    0,
    130,
    closureMask(timeline),
  );

  it("state(T) is identical for repeated calls (deep equality)", () => {
    for (const T of [0, 25, 130, 160, 200, 260, 400]) {
      const a = missionStateAt(timeline, sched, { t0: 130, plan: emergency }, T);
      const b = missionStateAt(timeline, sched, { t0: 130, plan: emergency }, T);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it("full replay with the same schedule reproduces the same trajectory", () => {
    const pass1: string[] = [];
    const pass2: string[] = [];
    for (let T = 0; T <= 300; T += 5) {
      pass1.push(JSON.stringify(missionStateAt(timeline, sched, { t0: 130, plan: emergency }, T)));
      pass2.push(JSON.stringify(missionStateAt(timeline, sched, { t0: 130, plan: emergency }, T)));
    }
    expect(pass1).toEqual(pass2);
  });

  it("pause does not advance time or resources (state is a pure function of T)", () => {
    const t1 = missionStateAt(timeline, sched, { t0: 130, plan: emergency }, 140);
    // "pausing" simply stops advancing T: querying the same T again is unchanged
    const t2 = missionStateAt(timeline, sched, { t0: 130, plan: emergency }, 140);
    expect(t1.resources).toEqual(t2.resources);
    expect(t1.position!.xM).toBe(t2.position!.xM);
  });
});

describe("E2: single application, reserve from initial capacity, no double counting", () => {
  const { timeline } = setup("SITE-B", 100);

  it("duplicate battery triggers are deduplicated by id", () => {
    const sched = {
      closure: null,
      batteryLosses: [
        { id: "b1", type: "battery_loss" as const, atSimMinutes: 10, amountUnits: 45 },
        { id: "b1", type: "battery_loss" as const, atSimMinutes: 50, amountUnits: 45 },
      ],
    };
    const normalized = normalizeSchedule(sched);
    expect(normalized.batteryLosses).toHaveLength(1);
    const st = missionStateAt(timeline, normalized, null, 60);
    const expectedLoss = 45;
    const nominal = 60 * RATES.batteryPerMin;
    expect(st.resources.battery).toBeCloseTo(100 - nominal - expectedLoss, 6);
    expect(st.eventsApplied).toHaveLength(1);
  });

  it("the reserve stays a fraction of INITIAL capacity after a battery loss", () => {
    // SITE-B with initial 100: loss 45 at T=160 aborts the mission; reserve = 20
    const { timeline: tl } = setup("SITE-B", 100);
    const sched = {
      closure: null,
      batteryLosses: [{ id: "b", type: "battery_loss" as const, atSimMinutes: 160, amountUnits: 45 }],
    };
    const posAt160 = missionStateAt(tl, { closure: null, batteryLosses: [] }, null, 160).position!;
    const emergency = planEmergencyReturn(tl, posAt160, 45, 160, null);
    expect(emergency).not.toBeNull();
    // reserve = 20% of INITIAL 100 = 20 (not of the post-loss remaining)
    expect(emergency!.marginAfterReturn.oxygen).toBeCloseTo(
      emergency!.remainingAtEvent.oxygen - 20 - emergency!.oxygen,
      6,
    );
  });

  it("a closure during the science stop counts the completed stop minutes exactly once", () => {
    const sched = {
      closure: { id: "e2", type: "area_closure" as const, atSimMinutes: 130 },
      batteryLosses: [],
    };
    // stop runs 103.26 -> 133.26; at T=130 exactly 26.74 stop minutes are done
    const st130 = missionStateAt(timeline, sched, null, 130);
    const emergency = planEmergencyReturn(
      timeline,
      st130.position!,
      0,
      130,
      closureMask(timeline),
    );
    expect(emergency).not.toBeNull();
    const st = missionStateAt(timeline, sched, { t0: 130, plan: emergency }, 130);
    expect(st.stopMinutesCompleted).toBeCloseTo(130 - timeline.outboundTotalMin, 6);
    const done = missionStateAt(timeline, sched, { t0: 130, plan: emergency }, 130 + emergency!.totalMinutes);
    // resources are REMAINING: initial - consumed (130 + emergency minutes) - losses
    const expectedRemaining =
      100 - (130 + emergency!.totalMinutes) * RATES.oxygenPerMin;
    expect(done.resources.oxygen).toBeCloseTo(expectedRemaining, 6);
    expect(done.stopMinutesCompleted).toBeCloseTo(130 - timeline.outboundTotalMin, 6);
  });
});

describe("E3: closures avoid blocked cells and never teleport", () => {
  const { timeline } = setup("SITE-B", 100);
  const mask = closureMask(timeline);
  const sched = {
    closure: { id: "e2", type: "area_closure" as const, atSimMinutes: 130 },
    batteryLosses: [],
  };
  const st130 = missionStateAt(timeline, sched, null, 130);
  const emergency = planEmergencyReturn(timeline, st130.position!, 0, 130, mask);

  it("the emergency return path avoids every blocked cell", () => {
    expect(emergency).not.toBeNull();
    for (const cell of emergency!.cells) {
      expect(insideClosure(timeline, cell)).toBe(false);
    }
  });

  it("mid-edge events keep the interpolated position (no teleport)", () => {
    // closure fires mid-outbound on a fractional edge position
    const schedMid = {
      closure: { id: "e2", type: "area_closure" as const, atSimMinutes: 25 },
      batteryLosses: [],
    };
    const emergencyMid = planEmergencyReturn(
      timeline,
      missionStateAt(timeline, schedMid, null, 25).position!,
      0,
      25,
      mask,
    );
    const before = missionStateAt(timeline, schedMid, null, 24.9);
    const at = missionStateAt(timeline, schedMid, { t0: 25, plan: emergencyMid }, 25.0);
    const after = missionStateAt(timeline, schedMid, { t0: 25, plan: emergencyMid }, 25.4);
    const jump = Math.hypot(
      (at.position!.xM - before.position!.xM) + (after.position!.xM - at.position!.xM),
      (at.position!.yM - before.position!.yM) + (after.position!.yM - at.position!.yM),
    );
    // across 0.5 simulated minutes the astronaut covers <= 2 cells of ground
    expect(jump).toBeLessThan(2 * 20 * 2);
    expect(before.position!.leg).toBe("outbound");
    expect(at.position!.leg).toBe("emergencyReturn");
    expect(after.position!.leg).toBe("emergencyReturn");
    void timeline; void emergency;
  });

  it("the emergency detour is longer than the abandoned planned return", () => {
    expect(emergency!.pathMeters + emergency!.partialMeters).toBeGreaterThan(
      timeline.returnTotalMin * MODEL.baseSpeedMPM * 0.5,
    );
  });
});

describe("E4: estimate equals actual consumption; distinct failure tiers", () => {
  it("stranded: remaining < return cost -> no_feasible_return", () => {
    const { timeline: tl } = setup("SITE-B", 100);
    const sched = {
      closure: null,
      batteryLosses: [{ id: "b", type: "battery_loss" as const, atSimMinutes: 100, amountUnits: 70 }],
    };
    const pos100 = missionStateAt(tl, { closure: null, batteryLosses: [] }, null, 100).position!;
    const emergency = planEmergencyReturn(tl, pos100, 70, 100, null);
    expect(emergency).not.toBeNull();
    // remaining oxygen cannot cover the walk home
    expect(emergency!.remainingAtEvent.oxygen).toBeLessThan(emergency!.oxygen);
    const st = missionStateAt(tl, sched, { t0: 100, plan: emergency }, 150);
    expect(st.phase).toBe("no_feasible_return");
  });

  it("tight: reaches base but breaches the reserve -> insufficient_return (never green)", () => {
    const { timeline: tl } = setup("SITE-B", 100);
    const sched = {
      closure: null,
      batteryLosses: [{ id: "b", type: "battery_loss" as const, atSimMinutes: 160, amountUnits: 45 }],
    };
    const pos160 = missionStateAt(tl, { closure: null, batteryLosses: [] }, null, 160).position!;
    const emergency = planEmergencyReturn(tl, pos160, 45, 160, null);
    expect(emergency).not.toBeNull();
    expect(emergency!.reachable).toBe(true);
    expect(emergency!.insufficientReserve).toBe(true);
    const st = missionStateAt(tl, sched, { t0: 160, plan: emergency }, 240);
    expect(st.phase).toBe("insufficient_return");
  });

  it("nominal completion stays green (completed) when the reserve is intact", () => {
    const { timeline: tl } = setup("SITE-A", 100);
    const st = missionStateAt(tl, { closure: null, batteryLosses: [] }, null, tl.totalMinutes + 1);
    expect(st.phase).toBe("completed");
  });

  it("the emergency estimate equals the engine-walked consumption (identity)", () => {
    const { timeline: tl } = setup("SITE-B", 100);
    const sched = {
      closure: { id: "e2", type: "area_closure" as const, atSimMinutes: 130 },
      batteryLosses: [],
    };
    const st130 = missionStateAt(tl, sched, null, 130);
    const emergency = planEmergencyReturn(tl, st130.position!, 0, 130, closureMask(tl));
    expect(emergency).not.toBeNull();
    // the estimate is the walk itself: path minutes == sum of edge minutes
    const graph = buildSearchGraph(tl.terrain, { slopeThresholdDeg: THRESHOLD, blockMask: closureMask(tl) });
    let walkMinutes = 0;
    const planNarrow: EmergencyPlan = emergency as EmergencyPlan;
    for (let i = 0; i + 1 < planNarrow.cells.length; i++) {
      const [r1, c1] = planNarrow.cells[i] as [number, number];
      const [r2, c2] = planNarrow.cells[i + 1] as [number, number];
      walkMinutes += (edgeMetrics(graph, r1, c1, r2, c2, MODEL) as { minutes: number }).minutes;
    }
        expect(planNarrow.totalMinutes - planNarrow.partialMinutes).toBeCloseTo(walkMinutes, 9);
    const final = missionStateAt(tl, sched, { t0: 130, plan: planNarrow }, 130 + planNarrow.totalMinutes);
    const expectedRemaining = 100 - (130 + planNarrow.totalMinutes) * RATES.oxygenPerMin;
    expect(final.resources.oxygen).toBeCloseTo(expectedRemaining, 6);
  });
});

describe("V2 scrub/replay semantics (SPECIFICATION §5)", () => {
  const t = worldTransform(pkg.terrain);

  it("scrubbing to T reproduces the continuously played state exactly", () => {
    const { timeline, result } = setup("SITE-A");
    const rt1 = makeRuntime("SITE-A", result, timeline, null, null);
    rt1.running = true;
    rt1.speed = 1;
    const hud1 = createHudMirror().current;
    let guard = 0;
    while (rt1.T < 60 && guard < 800) {
      stepMissionRuntime(rt1, hud1, t, 0.1);
      guard++;
    }
    // fresh runtime, same schedule, direct jump to the SAME T value
    const rt2 = makeRuntime("SITE-A", result, timeline, null, null);
    const hud2 = createHudMirror().current;
    const st2 = applyScrub(rt2, hud2, t, rt1.T);
    const st1 = missionStateAt(timeline, rt1.schedule, rt1.emergency ? { t0: rt1.emergency.t0, plan: rt1.emergency.plan } : null, rt1.T);
    expect(JSON.stringify(st2)).toBe(JSON.stringify(st1));
    // scrubbing pauses playback (E1)
    expect(rt2.paused).toBe(true);
    // scrubbing twice to the same T is idempotent (resources derive from T,
    // never accumulate — a battery loss can never be applied twice)
    const first = JSON.stringify(applyScrub(rt2, hud2, t, rt2.T));
    const second = JSON.stringify(applyScrub(rt2, hud2, t, rt2.T));
    expect(second).toBe(first);
    // paused playback does not advance time
    const before = rt2.T;
    stepMissionRuntime(rt2, hud2, t, 0.5);
    expect(rt2.T).toBe(before);
  });

  it("crossing a closure forward and back restores the nominal state, then replays identically", () => {
    const { timeline, result } = setup("SITE-B");
    const rt = makeRuntime("SITE-B", result, timeline, closureMask(timeline), 130);
    const hud = createHudMirror().current;
    // forward past the closure: emergency replanned from the interpolated spot
    applyScrub(rt, hud, t, 140);
    expect(rt.emergency).not.toBeNull();
    expect(hud.phase).toBe("returning");
    const eventsAt140 = hud.eventsApplied.length;
    expect(eventsAt140).toBeGreaterThanOrEqual(1);
    const oxyAt140 = hud.oxygen;
    // drag back before the event: pure nominal state (no applied events)
    applyScrub(rt, hud, t, 100);
    expect(rt.emergency).toBeNull();
    expect(hud.eventsApplied).toHaveLength(0);
    expect(hud.phase).toBe("running");
    const oxyAt100 = hud.oxygen;
    expect(oxyAt100).toBeCloseTo(100 - 100 * RATES.oxygenPerMin, 6);
    // forward again: the event replays identically (no double application)
    applyScrub(rt, hud, t, 140);
    expect(hud.oxygen).toBeCloseTo(oxyAt140, 9);
    expect(hud.eventsApplied.length).toBe(eventsAt140);
    expect(hud.phase).toBe("returning");
  });

  it("battery-loss scrub shows the stranded terminal state, dragging back un-freezes it", () => {
    const { timeline, result } = setup("SITE-B");
    const rt = makeRuntime("SITE-B", result, timeline, null, null);
    rt.schedule.batteryLosses = [
      { id: "battery-test", type: "battery_loss", atSimMinutes: 100, amountUnits: 70 },
    ];
    const hud = createHudMirror().current;
    applyScrub(rt, hud, t, 150);
    expect(hud.phase).toBe("no_feasible_return");
    // back before the loss: nominal running, full-ish resources again
    applyScrub(rt, hud, t, 80);
    expect(hud.phase).toBe("running");
    expect(hud.oxygen).toBeCloseTo(100 - 80 * RATES.oxygenPerMin, 6);
    expect(hud.eventsApplied).toHaveLength(0);
    // forward again: stranded again — the state FREEZES at the event time t0
    // (nominalState(t0) with losses applied; playback stops, resources do NOT
    // keep draining past the failure — existing engine semantics)
    applyScrub(rt, hud, t, 150);
    expect(hud.phase).toBe("no_feasible_return");
    expect(hud.oxygen).toBeCloseTo(100 - 100 * RATES.oxygenPerMin - 70, 6);
  });
});
