/** Console shell: data loading/failure states, layout, strategy & budget wiring,
 * stale-result protection (request id per parameter change), view toggles, FPS
 * display and the 2D cross-check / fallback view. */

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
import { MissionPanel, ResultsPanel, SourcesDrawer } from "./panels.js";
import { HudStrip, type HudStripState } from "./HudStrip.js";
import { buildMissionTimeline, missionStateAt, firstReturnForcingEvent, planEmergencyReturn } from "../simulation/engine.js";
import { makeRuntime, type HudMirror, type MissionRuntime } from "../simulation/runtime.js";
import { stepMissionRuntime } from "../ui/MissionLayer.js";
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
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [webglFailed, setWebglFailed] = useState(false);
  const [loopMode, setLoopMode] = useState<LoopMode>("raf");
  const [lang, setLangState] = useState<Lang>(langFromHash);
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
      requestId: `plan-${selectedSiteId}-${strategy}-${reserveFraction}-${requestId.current}`,
      startXM: load.pkg.scenario.base.xM,
      startYM: load.pkg.scenario.base.yM,
      targetSiteId: selectedSiteId,
      strategies: ["shortest", "terrain-aware"],
      stopMinutes: site.samplingDurationMin,
      initialResources: { oxygen: initialResources, battery: initialResources },
      reserveFractions: { oxygen: reserveFraction, battery: reserveFraction },
      paramsVersion: PARAMS_VERSION,
    };
    const result: RouteResult = planRoundTrip(load.pkg, request);
    return { result, request: request.requestId };
  }, [load, selectedSiteId, strategy, reserveFraction, initialResources]);

  useEffect(() => {
    if (load.kind === "ready" && selectedSiteId !== null) {
      flyToSite(load.pkg, selectedSiteId, false);
    }
  }, [load, selectedSiteId]);

  const pkgEarly = load.kind === "ready" ? load.pkg : null;
  const result = planning?.result ?? null;
  const pkg = load.kind === "ready" ? load.pkg : null;
  void pkgEarly;
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
  const setLang = (l: Lang): void => {
    setLangState(l);
    applyLangToUrl(l);
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
        <div className="stage" style={{ gridArea: "topbar" }}>
          <div className="loading-overlay">
            <div className="spinner" aria-hidden="true" />
            <p>{t("Loading frozen Jezero data package…")}</p>
          </div>
        </div>
      </div>
    );
  }
  if (load.kind === "error") {
    return (
      <div className="console">
        <div className="stage" style={{ gridArea: "topbar" }}>
          <div className="loading-overlay">
            <p>{t("Data package failed to load: {msg}", { msg: load.message })}</p>
            <button type="button" onClick={() => setReloadCounter((c) => c + 1)}>
              {t("Retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (pkg === null) {
    return (
      <div className="console">
        <div className="stage" style={{ gridArea: "topbar" }}>
          <div className="loading-overlay">
            <div className="spinner" aria-hidden="true" />
            <p>{t("Loading frozen Jezero data package…")}</p>
          </div>
        </div>
      </div>
    );
  }
  const show3d = view === "3d" && !webglFailed;
  const totalMinutes = missionRuntime.current?.timeline.totalMinutes ?? 0;

  const startMission = (): void => {
    const rt = missionRuntime.current;
    if (rt === null || result === null || result.status !== "feasible") return;
    rt.running = true;
    rt.paused = false;
    setMissionUi((ui) => ({ ...ui, started: true }));
  };
  const pauseMission = (): void => {
    const rt = missionRuntime.current;
    if (rt !== null) rt.paused = true;
  };
  const resumeMission = (): void => {
    const rt = missionRuntime.current;
    if (rt !== null) rt.paused = false;
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
      <header className="topbar">
        <span className="brand">MARS SURVIVAL GUIDE</span>
        <span className="brand-sub">{t("JEZERO / MISSION PLANNER · PHASE 4")}</span>
        <span className="badge-sim">{t("SIMULATED SCENARIO · REAL TERRAIN DATA")}</span>
        <span className="spacer" />
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
      </header>

      <section className="stage" aria-label="Terrain stage">
        <div className="view-toggle">
          <button
            type="button"
            className="small"
            aria-pressed={show3d}
            onClick={() => {
              setView("3d");
            }}
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
        </div>
        <div
          className="overlay-labels"
          ref={overlayRef}
          style={{ display: show3d ? "block" : "none" }}
        />
        {/* 2D-view mission driver: the 3D frame loop is not mounted here */}
        {!show3d && missionRuntime.current !== null && missionRuntime.current.running && !missionRuntime.current.paused
          ? null : null}
        {show3d ? (
          <WebglErrorBoundary
            onFallback={() => {
              setWebglFailed(true);
              setView("2d");
            }}
          >
            <div style={{ position: "absolute", inset: 0 }}>
              <Sandbox
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
              />
            </div>
          </WebglErrorBoundary>
        ) : (
          <div style={{ position: "absolute", inset: 0 }}>
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
            />
          </div>
        )}
        {webglFailed && view === "2d" ? (
          <div className="state-banner warn" style={{ position: "absolute", bottom: 10, left: 10, right: 10 }}>
            {t("3D rendering is unavailable right now — showing the 2D plan view. ")}{" "}
            <button
              type="button"
              className="small"
              onClick={() => {
                setWebglFailed(false);
                setView("3d");
              }}
            >
              {t("Try 3D again")}
            </button>
          </div>
        ) : null}
      </section>

      <MissionPanel
        pkg={pkg}
        selectedSiteId={selectedSiteId}
        strategy={strategy}
        reserveFraction={reserveFraction}
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
        initialResources={initialResources}
        onInitialResources={setInitialResources}
        onStart={startMission}
        onPause={pauseMission}
        onResume={resumeMission}
        onResetMission={resetMission}
        onTriggerBattery={triggerBattery}
        onTriggerClosure={triggerClosure}
        onSpeed={setSpeed}
      />

      <ResultsPanel pkg={pkg} result={result} strategy={strategy} />

      <HudStrip
        hud={{
          phase: missionUi.phase,
          legLabel: "-",
          simMinutes: missionUi.simMinutes,
          totalMinutes,
          oxygen: missionUi.oxygen,
          battery: missionUi.battery,
          initial: initialResources,
          reserveFraction: reserveFraction,
          events: missionUi.events,
          emergencyActive: missionUi.emergencyActive,
          running: missionUi.running,
          paused: missionUi.paused,
          started: missionUi.started,
        }}
      />

      <footer className="panel legend">
        <div className="legend-strip">
          <span>
            <span className="swatch" style={{ background: "var(--route-outbound)" }} />
            {t("outbound route")}
          </span>
          <span>
            <span className="swatch" style={{ background: "var(--route-return)" }} />
            {t("return route (recomputed)")}
          </span>
          <span>
            <span className="swatch" style={{ background: "var(--route-blocked)" }} />
            {t("blocked area (simulated closure)")}
          </span>
          <span className="north">N ↑</span>
          <span>{t("grid 20 m/cell · vertical relief ×3 display only")}</span>
          <span>{t("units: meters · minutes · simulated 0–100 budget units")}</span>
          <span className="units">
            {t("terrain: MRO CTX DEM/ortho mosaic (Mangold et al. 2021) · sources: {n} records · v{v}", {
              n: pkg.sources.sources.length,
              v: pkg.region.schemaVersion,
            })}
          </span>
        </div>
      </footer>

      <SourcesDrawer pkg={pkg} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
    </LangContext.Provider>
  );
}
