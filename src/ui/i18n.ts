/**
 * UI language toggle (EN default; ZH reachable via a top-bar switch). When the
 * Chinese UI is active the URL carries the #CNZH suffix so the language survives
 * refresh and can be shared as a link; switching back removes it. Kernel
 * outputs (RouteResult messages, data records) are not translated — the
 * dictionary covers UI chrome only.
 */

import { createContext, useContext } from "react";

export type Lang = "en" | "zh";

export function langFromHash(): Lang {
  return location.hash.toUpperCase().includes("CNZH") ? "zh" : "en";
}

export function applyLangToUrl(lang: Lang): void {
  const hash = lang === "zh" ? "#CNZH" : "";
  history.replaceState(null, "", location.pathname + location.search + hash);
  document.title =
    lang === "zh"
      ? "Mars Survival Guide - 耶泽罗任务规划台 (CNZH)"
      : "Mars Survival Guide - Jezero mission planner";
}

const ZH: Record<string, string> = {
  // top bar
  "JEZERO / MISSION PLANNER · PHASE 4": "耶泽罗 / 任务规划台 · 第 4 阶段",
  "SIMULATED SCENARIO · REAL TERRAIN DATA": "模拟情景 · 真实地形数据",
  "Sources & assumptions": "来源与假设",
  "measuring fps…": "正在测量帧率…",
  "{fps} fps · {calls} draw calls": "{fps} 帧/秒 · {calls} 次绘制",
  "{fps} frames/s (timer mode · background tab) · {calls} draw calls":
    "{fps} 帧/秒（定时器模式 · 后台标签页）· {calls} 次绘制",
  // view toggle
  "3D sandbox": "3D 沙盘",
  "2D plan (cross-check)": "2D 平面（核对）",
  "Reset view": "复位视角",
  // load / failure states
  "Loading frozen Jezero data package…": "正在加载冻结的耶泽罗数据包…",
  "Data package failed to load: {msg}": "数据包加载失败：{msg}",
  "Retry": "重试",
  "3D rendering is unavailable right now — showing the 2D plan view. ":
    "3D 渲染暂不可用 — 已切换到 2D 平面视图。",
  "Try 3D again": "重试 3D",
  // mission panel
  "Plan your Marswalk": "规划你的火星行走",
  "stop {min} min · position ±{unc} m · landform-anchored":
    "停留 {min} 分钟 · 位置 ±{unc} 米 · 地貌锚定",
  "Shortest": "最短路径",
  "Terrain-aware": "地形感知",
  "Terrain-aware trades a little distance for less time on slopes and climbs.":
    "地形感知策略多走一点路，换取坡地与爬升上更省时间。",
  "Initial resources:": "初始资源：",
  "Starting oxygen and battery, each on the simulated 0–100 budget scale (scenario default 100).":
    "起始氧气与电池，均为 0–100 模拟预算单位（场景默认 100）。",
  "Reserve per resource:": "每类资源预留：",
  "Reserve = {pct}% of initial capacity kept aside (simulated demo value, not a NASA safety standard).":
    "预留 = 初始容量的 {pct}%（模拟演示值，非 NASA 安全标准）。",
  "Mission control (simulated)": "任务控制（模拟）",
  "START EXPEDITION": "开始远征",
  "PAUSE": "暂停",
  "RESUME": "继续",
  "RESET": "重置",
  "Speed:": "速度：",
  "BATTERY LOSS −45": "电池损失 −45",
  "CLOSE PASSAGE": "封闭通道",
  "Scenarios": "场景",
  "NOMINAL ROUND TRIP": "名义往返",
  "PASSAGE CLOSES WHILE SAMPLING": "采样中通道封闭",
  "BATTERY: RESERVE BREACHED": "电池故障：预留被击穿",
  "BATTERY: STRANDED": "电池故障：滞留",
  "scripted simulated replay · resets the mission": "脚本化模拟重放 · 会重置任务",
  "All events and scenarios are simulated replays keyed to mission minutes (deterministic).":
    "所有事件与场景均为按任务分钟键控的确定性模拟重放。",
  // results panel
  "Route & budget": "路线与预算",
  "Select a science target to plan a round trip. Nothing is computed yet — no fake numbers are shown.":
    "选择一个科学目标来规划往返。尚未计算 — 不显示任何虚构数字。",
  "FEASIBLE": "可行",
  "FEASIBLE — plan ready. Margin after return: oxygen {o2}, battery {bat} (simulated units).":
    "可行 — 计划就绪。返航后余量：氧气 {o2}、电池 {bat}（模拟单位）。",
  "OVER BUDGET": "超预算",
  "reasons: {codes}": "原因：{codes}",
  "UNREACHABLE": "不可达",
  "reason: {codes}": "原因：{codes}",
  "INVALID INPUT": "输入无效",
  "Outbound": "去程",
  "Science stop": "科学停留",
  "Return (recomputed)": "返程（独立重算）",
  "Round-trip totals": "往返合计",
  "Margins after return": "返航后余量",
  "{min} min (simulated)": "{min} 分钟（模拟）",
  "{d} m · {min} min · O₂ {o2} · battery {bat}": "{d} 米 · {min} 分钟 · O₂ {o2} · 电池 {bat}",
  "O₂ {o2} · battery {bat}": "O₂ {o2} · 电池 {bat}",
  "strategy \"{s}\" · request {id} · computed in {ms} ms · resource units are simulated 0–100 budget points":
    "策略“{s}” · 请求 {id} · 计算耗时 {ms} ms · 资源为 0–100 模拟预算单位",
  "Strategy comparison:": "策略对比：",
  "Initial resources adjustable in the mission panel (simulated units).":
    "初始资源可在任务面板中调整（模拟单位）。",
  // HUD strip
  "IDLE": "待命",
  "PLANNED": "已规划",
  "RUNNING": "行进中",
  "PAUSED": "已暂停",
  "EMERGENCY RETURN": "应急返航",
  "MISSION COMPLETE": "任务完成",
  "RETURNED · RESERVE BREACHED": "已返回 · 预留被击穿",
  "STRANDED — NO FEASIBLE RETURN": "滞留 — 无可行返航",
  "REPLANNING": "重规划中",
  "OXYGEN": "氧气",
  "BATTERY": "电池",
  "no events": "无事件",
  "all simulated": "全部为模拟",
  "T+{t} / {total} min": "T+{t} / {total} 分钟",
  "not started": "未开始",
  // legend
  "outbound route": "去程路线",
  "return route (recomputed)": "返程路线（独立重算）",
  "blocked area (simulated closure)": "封闭区（模拟事件）",
  "grid 20 m/cell · vertical relief ×3 display only": "网格 20 米/格 · 垂直起伏 ×3 仅用于显示",
  "units: meters · minutes · simulated 0–100 budget units": "单位：米 · 分钟 · 0–100 模拟预算单位",
  "terrain: MRO CTX DEM/ortho mosaic (Mangold et al. 2021) · sources: {n} records · v{v}":
    "地形：MRO CTX DEM/正射镶嵌（Mangold et al. 2021）· 来源：{n} 条记录 · v{v}",
  // sources drawer
  "Close (Esc)": "关闭 (Esc)",
  "Sources (observed)": "来源（观测）",
  "terms: {terms}": "条款：{terms}",
  "limits: {limits}": "限制：{limits}",
  "Simulated planning assumptions": "模拟规划假设",
  "observed:": "观测：",
  "derived: terrain grids, ortho extracts, alignment measurements, landform-anchored site positions":
    "派生：地形网格、正射裁剪、对齐测量、地貌锚定点位",
  "simulated: base, events, passability threshold, all EVA budget numbers":
    "模拟：基地、事件、可通行阈值、全部 EVA 预算数值",
  // 3D labels
  "BASE (simulated) · scale figure 1.7 m": "基地（模拟）· 比例人形 1.7 米",
  // 2D canvas
  "BASE (sim)": "基地（模拟）",
};

function fill(s: string, vars?: Record<string, string | number>): string {
  if (vars === undefined) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  );
}

export function makeT(lang: Lang): (en: string, vars?: Record<string, string | number>) => string {
  if (lang === "en") return (en, vars) => fill(en, vars);
  return (en, vars) => fill(ZH[en] ?? en, vars);
}

export interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (en: string, vars?: Record<string, string | number>) => string;
}

export const LangContext = createContext<LangContextValue | null>(null);

export function useLang(): LangContextValue {
  const v = useContext(LangContext);
  if (v === null) throw new Error("LangContext missing");
  return v;
}
