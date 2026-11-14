/** Console shell (V1 terrain-first layout): the 3D sandbox or the 2D cross-check
 * view fills the viewport; brand, toolbar, resource chips, mission/results
 * cards and the bottom mission bar float above it. Data loading/failure states,
 * strategy & budget wiring, stale-result protection (request id per parameter
 * change), FPS display, watchdog and the 2D fallback are unchanged from the
 * accepted phase-3/4 behavior. */

import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { loadPackageFromFetch } from "../data/fetchLoader.js";
import { planRoundTrip } from "../routing/plan.js";
import { PARAMS_VERSION } from "../domain/assumptions.js";
import type { LoadedPackage } from "../domain/load.js";
import type { RouteRequest, RouteResult, Strategy } from "../domain/types.js";
import { Sandbox, flyToSite, makeFpsStore, type FpsStore, type LoopMode } from "./Sandbox.js";
import { PlanView2D } from "./PlanView2D.js";
import { WebglErrorBoundary } from "./WebglErrorBoundary.js";
import { LegendDrawer, MissionPanel, ResultsPanel, SourcesDrawer, type LockedPlan } from "./panels.js";
import { BottomBar, ResourceChip, type TimelineTick } from "./BottomBar.js";
import { buildMissionTimeline } from "../simulation/engine.js";
import { makeRuntime, stepMissionRuntime, applyScrub, type HudMirror, type MissionRuntime } from "../simulation/runtime.js";
import { costFieldToBase, type CostField } from "../routing/field.js";
import { buildSearchGraph, edgeCostModel } from "../routing/graph.js";
import { routePolyline } from "../domain/world.js";
import { worldTransform } from "../domain/world.js";
import { PRESETS } from "../simulation/presets.js";
import { LangContext, makeT, applyLangToUrl, langFromHash, type Lang } from "./i18n.js";
import "./theme.css";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; pkg: LoadedPackage };

const RESERVE_DEFAULT = 0.2;

export function App(): JSX.Element {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [reloadCounter, setReloadCounter] = useState(0);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy>("terrain-aware");
  const [reserveFraction, setReserveFraction] = useState(RESERVE_DEFAULT);
  const [initialResources, setInitialResources] = useState(100);
  const [stopMinutes, setStopMinutes] = useState(30);
  const [locked, setLocked] = useState<LockedPlan | null>(null);
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [webglFailed, setWebglFailed] = useState(false);
  const [loopMode, setLoopMode] = useState<LoopMode>("raf");
  const [lang, setLangState] = useState<Lang>(langFromHash);
  const [sandboxEpoch, setSandboxEpoch] = useState(0);
  const missionRuntime = useRef<MissionRuntime | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [missionUi, setMissionUi] = useState({
    phase: "idle",
    running: false,
    paused: false,
    started: false,
    simMinutes: 0,
    oxygen: 100,
    battery: 100,
    events: [] as string[],
    emergencyActive: false,
    speed: 8,
    closureFired: false,
    scrubbed: false,
  });
  const fpsStore = useRef<FpsStore>(makeFpsStore()).current;
  const [fpsTick, setFpsTick] = useState(0);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const requestId = useRef(0);
  const hudMirror = useRef<HudMirror>({
    phase: "idle",
    simMinutes: 0,
    leg: "-",
    oxygen: 100,
    battery: 100,
    initialOxygen: 100,
    initialBattery: 100,
    reserveFraction: RESERVE_DEFAULT,
    eventsApplied: [],
    emergencyActive: false,
    astronaut: null,
    totalMinutes: 0,
  });
  const speedRef = useRef(8);

  useEffect(() => {
    let alive = true;
    setLoad({ kind: "loading" });
    loadPackageFromFetch("/data/jezero")
      .then((pkg) => {
        if (alive) setLoad({ kind: "ready", pkg });
      })
      .catch((err: Error) => {
        if (alive) setLoad({ kind: "error", message: err.message });
      });
    return () => {
      alive = false;
    };
  }, [reloadCounter]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyLangToUrl(lang);
    const onHash = (): void => setLangState(langFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setFpsTick((t) => (t + 1) % 1000), 600);
    return () => clearInterval(timer);
  }, []);

  // watchdog: if the 3D canvas produces no frames within 6 s, fall back to 2D
  useEffect(() => {
    if (view !== "3d" || load.kind !== "ready") return;
    const timer = setTimeout(() => {
      if (fpsStore.current.frames === 0 && !webglFailed) {
        setWebglFailed(true);
        setView("2d");
      }
    }, 6000);
    return () => clearTimeout(timer);
  }, [view, load, fpsStore, webglFailed]);

  const planning = useMemo(() => {
    if (load.kind !== "ready" || selectedSiteId === null) return null;
    requestId.current += 1;
    const site = load.pkg.sites.find((s) => s.id === selectedSiteId);
    if (!site) return null;
    const request: RouteRequest = {
      requestId: `plan-${selectedSiteId}-${strategy}-${reserveFraction}-${stopMinutes}-${requestId.current}`,
      startXM: load.pkg.scenario.base.xM,
      startYM: load.pkg.scenario.base.yM,
      targetSiteId: selectedSiteId,
      strategies: ["shortest", "terrain-aware"],
      stopMinutes,
      initialResources: { oxygen: initialResources, battery: initialResources },
      reserveFractions: { oxygen: reserveFraction, battery: reserveFraction },
      paramsVersion: PARAMS_VERSION,
    };
    const result: RouteResult = planRoundTrip(load.pkg, request);
    return { result, request: request.requestId };
  }, [load, selectedSiteId, strategy, reserveFraction, initialResources, stopMinutes]);

  useEffect(() => {
    if (load.kind === "ready" && selectedSiteId !== null) {
      // two-stage fly: focus the site, then pull back to frame the round trip;
      // planning changes (strategy/sliders) intentionally do NOT re-fly
      flyToSite(load.pkg, selectedSiteId, false, planning?.result ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, selectedSiteId]);

  const pkg = load.kind === "ready" ? load.pkg : null;
  const result = planning?.result ?? null;
  const closureMask = useMemo(() => {
    if (load.kind !== "ready") return null;
    const ev = load.pkg.scenario.events.find((e) => e.type === "area_closure");
    if (!ev || ev.geometry.type !== "rectangle") return null;
    const mask = new Uint8Array(load.pkg.terrain.width * load.pkg.terrain.height);
    for (let r = ev.geometry.rows[0]; r < ev.geometry.rows[1]; r++) {
      for (let c = ev.geometry.cols[0]; c < ev.geometry.cols[1]; c++) {
        mask[r * load.pkg.terrain.width + c] = 1;
      }
    }
    return mask;
  }, [load]);

  const preset = presetId !== null ? PRESETS.find((p) => p.id === presetId) ?? null : null;
  const t = useMemo(() => makeT(lang), [lang]);

  // ---- V3 returnable range ----
  // the reverse-Dijkstra field only changes when the closure graph changes;
  // everything else (threshold from remaining resources) derives per render
  const rtForClosure = missionRuntime.current;
  const closureLive =
    rtForClosure?.schedule.closure !== undefined &&
    rtForClosure !== null &&
    rtForClosure.schedule.closure !== null &&
    rtForClosure.T >= rtForClosure.schedule.closure.atSimMinutes;
  const [costField, setCostField] = useState<CostField | null>(null);
  const [fieldComputing, setFieldComputing] = useState(false);
  useEffect(() => {
    if (load.kind !== "ready" || pkg === null) {
      setCostField(null);
      return;
    }
    const model = edgeCostModel(pkg.scenario.movementParameters, "terrain-aware");
    const graph = buildSearchGraph(pkg.terrain, {
      slopeThresholdDeg: pkg.scenario.movementParameters.passabilitySlopeThresholdDeg,
      blockMask: closureLive ? closureMask : null,
    });
    setFieldComputing(true);
    // synchronous on purpose (~30-45 ms measured): the state flip is one frame
    const field = costFieldToBase(graph, pkg.scenario.base.rowCol[0], pkg.scenario.base.rowCol[1], model);
    setCostField(field);
    setFieldComputing(false);
  }, [load, pkg, closureLive, closureMask]);
  // threshold in walk-minutes from the CURRENT remaining resources (single
  // source of truth: the same engine state the HUD shows), quantised to 1 min
  const returnableThreshold = useMemo(() => {
    if (costField === null) return Number.POSITIVE_INFINITY;
    const rate = 100 / 480;
    const reserve = reserveFraction * initialResources;
    const o2Min = (hudMirror.current.oxygen - reserve) / rate;
    const batMin = (hudMirror.current.battery - reserve) / rate;
    return Math.floor(Math.max(0, Math.min(o2Min, batMin)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costField, missionUi.oxygen, missionUi.battery, reserveFraction, initialResources]);
  const returnable =
    costField !== null && Number.isFinite(returnableThreshold) && returnableThreshold < 200
      ? { field: costField, threshold: returnableThreshold }
      : null;
  // ---- V4 plan A/B comparison ----
  const lockPlanA = (): void => {
    if (result === null || result.status !== "feasible" || selectedSiteId === null) return;
    setLocked({
      label: `${selectedSiteId} · ${strategy} · stop ${stopMinutes} min · res ${initialResources}`,
      result,
      strategy,
    });
  };
  const lockedCells = useMemo(() => {
    if (locked === null) return null;
    const a = locked.result.candidates.find((c) => c.strategy === locked.strategy) ?? locked.result.candidates[0];
    if (a === undefined) return null;
    return {
      out: a.outbound.pathCells,
      ret: a.returnRoute.pathCells,
    };
  }, [locked]);
  const lockedPolylines = useMemo(() => {
    if (lockedCells === null || load.kind !== "ready") return null;
    return {
      out: routePolyline(load.pkg.terrain, worldTransform(load.pkg.terrain), lockedCells.out, 1.5),
      ret: routePolyline(load.pkg.terrain, worldTransform(load.pkg.terrain), lockedCells.ret, 1.5),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedCells, load]);
  const setLang = (l: Lang): void => {
    setLangState(l);
    applyLangToUrl(l);
  };
  /** Enter the 3D view with a fresh canvas instance: every entry remounts the
   * Sandbox (new <canvas> element => new WebGL context) and resets the frame
   * counter so the watchdog judges this mount on its own merits. This is what
   * fixed "first 3D click never opens without a 2D-detour + retry". */
  const enter3d = (): void => {
    fpsStore.current.frames = 0;
    setSandboxEpoch((e) => e + 1);
    setWebglFailed(false);
    setView("3d");
  };

  // build the mission runtime whenever a feasible plan (or preset) exists
  useEffect(() => {
    if (load.kind !== "ready" || result === null || result.status !== "feasible" || selectedSiteId === null) {
      missionRuntime.current = null;
      return;
    }
    const model = {
      strategy: "terrain-aware" as const,
      baseSpeedMPM: load.pkg.scenario.movementParameters.baseSpeedMPM,
      slopeTimeFactorPerDeg: load.pkg.scenario.movementParameters.slopeTimeFactorPerDeg,
      ascentPenaltyMinPerM: load.pkg.scenario.movementParameters.ascentPenaltyMinPerM,
    };
    const timeline = buildMissionTimeline(
      result,
      load.pkg.terrain,
      model,
      load.pkg.scenario.movementParameters.passabilitySlopeThresholdDeg,
      { initialResources: { oxygen: initialResources, battery: initialResources }, reserveFractions: { oxygen: reserveFraction, battery: reserveFraction } },
    );
    const rt = makeRuntime(selectedSiteId, result, timeline, closureMask, preset?.closureAtSimMinutes ?? null);
    if (preset?.batteryLoss) {
      rt.schedule.batteryLosses = [
        { id: `battery-${preset.id}`, type: "battery_loss", atSimMinutes: preset.batteryLoss.atSimMinutes, amountUnits: preset.batteryLoss.amountUnits },
      ];
    }
    rt.speed = speedRef.current;
    missionRuntime.current = rt;
    setMissionUi((ui) => ({ ...ui, phase: "planned", running: false, paused: false, started: false, simMinutes: 0, oxygen: initialResources, battery: initialResources }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, result, presetId, closureMask]);

  // HUD mirror sync (5 Hz)
  useEffect(() => {
    const timer = setInterval(() => {
      const rt = missionRuntime.current;
      const hud = hudMirror.current;
      if (rt === null) {
        setMissionUi((ui) => ({ ...ui, phase: selectedSiteId === null ? "idle" : ui.phase }));
        return;
      }
      setMissionUi((ui) => ({
        ...ui,
        phase: rt.paused ? "paused" : !rt.running && rt.T === 0 ? "planned" : hud.phase,
        running: rt.running,
        paused: rt.paused,
        started: rt.T > 0 || rt.running,
        simMinutes: hud.simMinutes,
        oxygen: hud.oxygen,
        battery: hud.battery,
        events: hud.eventsApplied.map((e) => e.label),
        emergencyActive: hud.emergencyActive,
        closureFired: rt.schedule.closure !== null,
      }));
    }, 250);
    return () => clearInterval(timer);
  }, [load, selectedSiteId]);

  // 2D-view mission driver: advances the simulation when the 3D loop is unmounted
  useEffect(() => {
    if (view !== "2d" || pkg === null) return;
    const timer = setInterval(() => {
      const rt = missionRuntime.current;
      if (rt === null || !rt.running || rt.paused) return;
      stepMissionRuntime(
        rt,
        hudMirror.current,
        worldTransform(pkg.terrain),
        0.25,
      );
      setFpsTick((t) => (t + 1) % 1000);
    }, 250);
    return () => clearInterval(timer);
  }, [view, hudMirror]);

  if (load.kind === "loading") {
    return (
      <div className="console">
        <div className="loading-overlay">
          <div className="spinner" aria-hidden="true" />
          <p>{t("Loading frozen Jezero data package…")}</p>
        </div>
      </div>
    );
  }
  if (load.kind === "error") {
    return (
      <div className="console">
        <div className="loading-overlay">
          <p>{t("Data package failed to load: {msg}", { msg: load.message })}</p>
          <button type="button" onClick={() => setReloadCounter((c) => c + 1)}>
            {t("Retry")}
          </button>
        </div>
      </div>
    );
  }
  if (pkg === null) {
    return (
      <div className="console">
        <div className="loading-overlay">
          <div className="spinner" aria-hidden="true" />
          <p>{t("Loading frozen Jezero data package…")}</p>
        </div>
      </div>
    );
  }

  const show3d = view === "3d" && !webglFailed;
  const totalMinutes = missionRuntime.current?.timeline.totalMinutes ?? 0;
  const tl = missionRuntime.current?.timeline ?? null;
  const timelineSegments = tl
    ? { outboundMin: tl.outboundTotalMin, stopMin: tl.stopMinutes, returnMin: tl.returnTotalMin }
    : null;
  // scrub range: nominal plan length, extended to cover an active emergency
  const rtNow = missionRuntime.current;
  const emergencyEnd =
    rtNow?.emergency && rtNow.emergency.plan !== null
      ? rtNow.emergency.t0 + rtNow.emergency.plan.totalMinutes
      : 0;
  const timelineMaxT = Math.max(totalMinutes, emergencyEnd);
  const timelineTicks: TimelineTick[] = [];
  if (rtNow !== null) {
    for (const e of rtNow.schedule.batteryLosses) {
      timelineTicks.push({ t: e.atSimMinutes, kind: "battery" });
    }
    if (rtNow.schedule.closure !== null) {
      timelineTicks.push({ t: rtNow.schedule.closure.atSimMinutes, kind: "closure" });
    }
  }
  const handleScrub = (T: number): void => {
    const rt = missionRuntime.current;
    if (rt === null || pkg === null) return;
    applyScrub(rt, hudMirror.current, worldTransform(pkg.terrain), T);
    setMissionUi((ui) => ({
      ...ui,
      phase: hudMirror.current.phase,
      running: rt.running,
      paused: rt.paused,
      started: true,
      simMinutes: hudMirror.current.simMinutes,
      oxygen: hudMirror.current.oxygen,
      battery: hudMirror.current.battery,
      events: hudMirror.current.eventsApplied.map((e) => e.label),
      emergencyActive: hudMirror.current.emergencyActive,
      scrubbed: true,
    }));
    setFpsTick((v) => (v + 1) % 1000); // force a 2D canvas redraw
  };
  const handleTogglePlay = (): void => {
    const rt = missionRuntime.current;
    if (rt === null) return;
    if (rt.running && !rt.paused) {
      rt.paused = true;
    } else {
      rt.running = true;
      rt.paused = false;
    }
    setMissionUi((ui) => ({ ...ui, scrubbed: false, running: rt.running, paused: rt.paused }));
    setFpsTick((v) => (v + 1) % 1000);
  };

  const startMission = (): void => {
    const rt = missionRuntime.current;
    if (rt === null || result === null || result.status !== "feasible") return;
    rt.running = true;
    rt.paused = false;
    setMissionUi((ui) => ({ ...ui, started: true, scrubbed: false }));
  };
  const pauseMission = (): void => {
    const rt = missionRuntime.current;
    if (rt !== null) rt.paused = true;
  };
  const resumeMission = (): void => {
    const rt = missionRuntime.current;
    if (rt !== null) rt.paused = false;
    setMissionUi((ui) => ({ ...ui, scrubbed: false, paused: false }));
  };
  const resetMission = (): void => {
    const rt = missionRuntime.current;
    if (rt === null) return;
    rt.T = 0;
    rt.running = false;
    rt.paused = false;
    rt.emergency = null;
    rt.schedule = preset
      ? {
          closure:
            preset.closureAtSimMinutes != null
              ? { id: "area-closure", type: "area_closure" as const, atSimMinutes: preset.closureAtSimMinutes }
              : null,
          batteryLosses: preset.batteryLoss
            ? [
                {
                  id: `battery-${preset.id}`,
                  type: "battery_loss" as const,
                  atSimMinutes: preset.batteryLoss.atSimMinutes,
                  amountUnits: preset.batteryLoss.amountUnits,
                },
              ]
            : [],
        }
      : { closure: null, batteryLosses: [] };
    const hud = hudMirror.current;
    hud.phase = "planned";
    hud.eventsApplied = [];
    hud.astronaut = null;
    setMissionUi((ui) => ({ ...ui, scrubbed: false, paused: false, running: false, started: false, simMinutes: 0 }));
  };
  const triggerBattery = (): void => {
    const rt = missionRuntime.current;
    if (rt === null || !rt.running || rt.paused) return;
    rt.schedule.batteryLosses.push({
      id: `battery-manual-${rt.schedule.batteryLosses.length + 1}`,
      type: "battery_loss",
      atSimMinutes: rt.T,
      amountUnits: 45,
    });
  };
  const triggerClosure = (): void => {
    const rt = missionRuntime.current;
    if (rt === null || !rt.running || rt.paused || rt.schedule.closure !== null) return;
    rt.schedule.closure = { id: "area-closure-manual", type: "area_closure", atSimMinutes: rt.T };
  };
  const setSpeed = (s: number): void => {
    speedRef.current = s;
    const rt = missionRuntime.current;
    if (rt !== null) rt.speed = s;
    setMissionUi((ui) => ({ ...ui, speed: s }));
  };

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      <div className="console">
        <section className="stage" aria-label="Terrain stage">
          {/* full-bleed canvas layer + in-canvas labels */}
          <div className="overlay-labels" ref={overlayRef} style={{ display: show3d ? "block" : "none" }} />
          {show3d ? (
            <WebglErrorBoundary
              onFallback={() => {
                setWebglFailed(true);
                setView("2d");
              }}
            >
              <div className="canvas-holder">
                <Sandbox
                  key={`sandbox-${sandboxEpoch}`}
                  pkg={pkg}
                  result={result}
                  strategy={strategy}
                  selectedSiteId={selectedSiteId}
                  reducedMotion={reducedMotion}
                  fpsStore={fpsStore}
                  overlayRef={overlayRef}
                  onLoopMode={setLoopMode}
                  runtimeRef={missionRuntime}
                  hudRef={hudMirror}
                  lang={lang}
                  returnable={returnable}
                  lockedRoute={lockedPolylines}
                />
              </div>
            </WebglErrorBoundary>
          ) : (
            <div className="canvas-holder">
              <PlanView2D
                pkg={pkg}
                result={result}
                strategy={strategy}
                selectedSiteId={selectedSiteId}
                runtimeRef={missionRuntime}
                redrawKey={fpsTick}
                astronaut={hudMirror.current.astronaut !== null ? {
                  xM: hudMirror.current.astronaut.x + worldTransform(pkg.terrain).halfWidthM,
                  yM: worldTransform(pkg.terrain).halfHeightM - hudMirror.current.astronaut.z,
                } : null}
                returnable={returnable}
                lockedCells={lockedCells}
              />
            </div>
          )}
          {webglFailed && view === "2d" ? (
            <div className="state-banner warn fallback-banner">
              {t("3D rendering is unavailable right now — showing the 2D plan view. ")}{" "}
              <button
                type="button"
                className="small"
                onClick={enter3d}
              >
                {t("Try 3D again")}
              </button>
            </div>
          ) : null}
        </section>

        {/* floating overlay UI: positioned over the stage on desktop, stacked
            below it on narrow screens (CSS only — same DOM) */}
        <div className="brand-block">
          <div className="brand">MARS SURVIVAL GUIDE</div>
          <div className="brand-sub">
            {t("JEZERO / EXPEDITION 01")}
            <span className="badge-sim">{t("SIMULATED SCENARIO · REAL TERRAIN DATA")}</span>
          </div>
        </div>

        <div className="toolbar" role="toolbar" aria-label="View and data controls">
          <button
            type="button"
            className="small"
            aria-pressed={show3d}
            onClick={enter3d}
          >
            {t("3D sandbox")}
          </button>
          <button
            type="button"
            className="small"
            aria-pressed={!show3d}
            onClick={() => {
              setView("2d");
            }}
          >
            {t("2D plan (cross-check)")}
          </button>
          <button
            type="button"
            className="small"
            onClick={() => {
              setSelectedSiteId(null);
              flyToSite(pkg, null, reducedMotion);
            }}
          >
            {t("Reset view")}
          </button>
          <span className="toolbar-sep" aria-hidden="true" />
          <button
            type="button"
            className="small"
            aria-pressed={lang === "zh"}
            onClick={() => {
              setLang(lang === "zh" ? "en" : "zh");
            }}
          >
            {lang === "zh" ? "EN" : "中文"}
          </button>
          <button
            type="button"
            className="small"
            onClick={() => {
              setDrawerOpen(true);
            }}
          >
            {t("Sources & assumptions")}
          </button>
        </div>

        <div className="chips-row">
          <ResourceChip
            label="OXYGEN"
            value={missionUi.oxygen}
            initial={initialResources}
            reserveFraction={reserveFraction}
          />
          <ResourceChip
            label="BATTERY"
            value={missionUi.battery}
            initial={initialResources}
            reserveFraction={reserveFraction}
          />
          <span className="fps" aria-live="off">
            {fpsStore.current.fps > 0
              ? t(
                  loopMode === "raf"
                    ? "{fps} fps · {calls} draw calls"
                    : "{fps} frames/s (timer mode · background tab) · {calls} draw calls",
                  { fps: fpsStore.current.fps.toFixed(0), calls: fpsStore.current.calls },
                )
              : t("measuring fps…")}
            <span hidden>{fpsTick}</span>
          </span>
        </div>

        <MissionPanel
          pkg={pkg}
          selectedSiteId={selectedSiteId}
          strategy={strategy}
          reserveFraction={reserveFraction}
          initialResources={initialResources}
          stopMinutes={stopMinutes}
          mission={{
            phase: missionUi.phase,
            running: missionUi.running,
            paused: missionUi.paused,
            started: missionUi.started,
            feasible: result?.status === "feasible",
            speed: missionUi.speed,
            closureFired: missionUi.closureFired,
          }}
          presetId={presetId}
          onPreset={(id) => {
            setPresetId(id);
            const p = PRESETS.find((x) => x.id === id);
            if (p) {
              setSelectedSiteId(p.siteId);
            }
          }}
          onSelectSite={(id) => {
            setSelectedSiteId(id);
            // camera handled by the effect above
          }}
          onStrategy={setStrategy}
          onReserve={setReserveFraction}
          onInitialResources={setInitialResources}
          onStopMinutes={setStopMinutes}
          onStart={startMission}
          onPause={pauseMission}
          onResume={resumeMission}
          onResetMission={resetMission}
          onTriggerBattery={triggerBattery}
          onTriggerClosure={triggerClosure}
          onSpeed={setSpeed}
        />

        <ResultsPanel
          pkg={pkg}
          result={result}
          strategy={strategy}
          locked={locked}
          onLock={lockPlanA}
          onUnlock={() => setLocked(null)}
        />

        <BottomBar
          bar={{
            phase: missionUi.phase,
            simMinutes: missionUi.simMinutes,
            totalMinutes,
            events: missionUi.events,
            emergencyActive: missionUi.emergencyActive,
            running: missionUi.running,
            paused: missionUi.paused,
            started: missionUi.started,
            scrubbed: missionUi.scrubbed,
            speed: missionUi.speed,
          }}
          segments={timelineSegments}
          maxT={timelineMaxT}
          ticks={timelineTicks}
          onScrub={handleScrub}
          onTogglePlay={handleTogglePlay}
          onOpenLegend={() => setLegendOpen(true)}
        />

        <LegendDrawer
          pkg={pkg}
          open={legendOpen}
          onClose={() => setLegendOpen(false)}
          returnableThreshold={returnable === null ? null : returnable.threshold}
        />
        <SourcesDrawer pkg={pkg} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </div>
    </LangContext.Provider>
  );
}
