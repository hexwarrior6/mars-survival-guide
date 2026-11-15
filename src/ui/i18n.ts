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
  // brand block
  "JEZERO / EXPEDITION 01": "耶泽罗 / 远征 01",
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
  "From Mars": "从火星看",
  // load / failure states
  "Loading frozen Jezero data package…": "正在加载冻结的耶泽罗数据包…",
  "Preparing the terrain surface… {pct}%": "正在生成地表显示层… {pct}%",
  "Data package failed to load: {msg}": "数据包加载失败：{msg}",
  "Retry": "重试",
  "3D rendering is unavailable right now — showing the 2D plan view. ":
    "3D 渲染暂不可用 — 已切换到 2D 平面视图。",
  "Try 3D again": "重试 3D",
  // mission card
  "Plan your Marswalk": "规划你的火星行走",
  "Collapse": "收起",
  "Expand": "展开",
  "Mission card": "任务卡",
  "no target selected": "未选择目标",
  "Science targets": "科学目标",
  "Route strategy": "路线策略",
  "Budget settings": "预算参数",
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
  // results card
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
  "Initial resources {a} / {b} (simulated units) · reserve adjustable in the mission card.":
    "初始资源 {a} / {b}（模拟单位）· 预留可在任务卡中调整。",
  "Results card": "结果卡",
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
  // legend
  "Legend": "图例",
  "outbound route": "去程路线",
  "return route (recomputed)": "返程路线（独立重算）",
  "blocked area (simulated closure)": "封闭区（模拟事件）",
  "selection ring: 70 m display marker around the selected site (not a measurement)":
    "选中环：围绕所选科学目标的 70 米显示标记（非测量结果）",
  "returnable-range boundary: region reachable within {min} walk-minutes of base (simulated, ±1–2 cells)":
    "返航范围边界：距基地 {min} 步行分钟内可达的区域（模拟值，±1–2 格）",
  "resources are sufficient: the whole region stays returnable (boundary hidden)":
    "资源充裕：整个区域均可返航（边界隐藏）",
  "returnable range: walking-minutes back to base (reverse-Dijkstra field, simulated). It answers “can I still get home NOW” — not “can the mission finish”. The boundary is honest to ±1–2 planning cells (20 m grid + alignment uncertainty).":
    "返航范围：返回基地的步行分钟数（反向 Dijkstra 成本场，模拟值）。它回答“此刻能否回家”，而非“任务能否完成”。边界按 ±1–2 个规划格呈现（20 米格 + 对齐不确定度）。",
  "mission position marker: light column at the walking position, enlarged for visibility (not to scale)":
    "任务位置光标：行进位置上的光柱标记，放大以便远距可见（非真实比例）",
  "grid 20 m/cell · vertical relief ×4.5 display only": "网格 20 米/格 · 垂直起伏 ×4.5 仅用于显示",
  "controls: left-drag pan · right-drag rotate/pitch · wheel zoom": "操作：左键拖动平移 · 右键拖动旋转/俯仰 · 滚轮缩放",
  "units: meters · minutes · simulated 0–100 budget units": "单位：米 · 分钟 · 0–100 模拟预算单位",
  "lighting: key-light azimuth matches the DEM hillshade (NW) · warm fill is display only":
    "光照：主光方位与 DEM 山影一致（西北）· 暖色补光仅用于显示",
  "terrain: MRO CTX DEM/ortho mosaic (Mangold et al. 2021) · sources: {n} records · v{v}":
    "地形：MRO CTX DEM/正射镶嵌（Mangold et al. 2021）· 来源：{n} 条记录 · v{v}",
  // bottom bar: scrub-able mission timeline (V2)
  "mission timeline": "任务时间轴",
  "T+{t} of {total} minutes": "T+{t} / 共 {total} 分钟",
  "jump to T+{t} min": "跳转到 T+{t} 分钟",
  "replay view: deterministic simulation at T+{t}": "回放查看：T+{t} 时刻的确定性模拟",
  "Mission timeline: drag to replay any moment": "任务时间轴：拖动可回看任意时刻",
  "Science stop duration:": "科学停留时长：",
  "Changing any of these parameters creates a NEW mission plan (resets playback).":
    "更改以下任一参数都会生成新的推演计划（并重置回放）。",
  // V4 plan A/B comparison
  "Lock as plan A": "锁定为方案 A",
  "Unlock plan A": "解锁方案 A",
  "Lock this plan as plan A, then change inputs to compare": "把当前计划锁定为方案 A，然后调整条件进行对比",
  "Plan A (locked)": "方案 A（锁定）",
  "Plan B (current)": "方案 B（当前）",
  "Plan A (locked): {a} · Plan B (current inputs): {b}": "方案 A（锁定）：{a} ｜ 方案 B（当前输入）：{b}",
  "Δ (B − A)": "Δ（B − A）",
  "Feasible": "可行",
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
  // helmet cam
  "Helmet cam": "头盔视角",
  "Ride the astronaut's eye level along the computed route": "沿计算出的路线，用宇航员视角行走",
  "Start the expedition first": "请先开始远征",
  "HELMET CAM · SIMULATED POSITION · NEAR-FIELD DETAIL ARTISTIC": "头盔视角 · 位置为模拟 · 近景细节为美术表现",
  "Start the expedition to walk with the astronaut.": "开始远征后即可沿宇航员视角行走。",
  "leg": "航段",
  "phase": "状态",
  "outbound": "去程",
  "science stop": "科学停留",
  "return": "返程",
  "emergency return": "应急返航",
  "min": "分钟",
  "eye height": "视高",
  "not started": "未开始",
  "planned": "已规划",
  "running": "行进中",
  "paused": "已暂停",
  "returning": "返程中",
  "completed": "已完成",
  "insufficient reserve": "返航余量不足",
  "no feasible return": "无法返航",
  // display-art boundary (3D sandbox)
  "cut-away block: side faces, strata, depth and lit rim are artistic display — the top edge follows the real DEM cells":
    "剖切块体：侧壁、岩层纹理、切深与压边光均为美术显示，顶边跟随真实 DEM 网格",
  "surface colour, baked sun shadows, micro-relief, haze, boulders and glow are artistic display; the 2D plan view is the unmodified CTX ortho":
    "地表配色、烘焙日照阴影、微观起伏、雾、岩块与辉光均为美术显示；2D 平面视图为未经处理的正射影像",
  "2D plan view draws the published CTX ortho unchanged; the 3D view is a display layer on the same data (see Display art in Sources & assumptions)":
    "2D 平面视图原样绘制发布的正射影像；3D 是同一份数据上的显示层（见“来源与假设”中的“显示美术”）",
  "Display art (not data)": "显示美术（非数据）",
  "The 3D sandbox is a display layer on the published package. Artistic here: the cut-away block sides, their strata pattern and depth, the lit rim, the warm fill light, the derived surface colour, the baked sun shadows, the micro-relief, the haze, the scattered boulders and the glow. None of it feeds route, time, resource or landform-anchor values; vertical relief is exaggerated ×4.5 and labelled.":
    "3D 沙盘是发布数据包之上的显示层。其中剖切块体的侧壁、岩层纹理与切深、压边光、暖色补光、派生地表配色、烘焙日照阴影、微观起伏、雾与辉光，均为美术表达；它们不参与路线、时间、资源或地貌锚点数值。垂直起伏按 ×4.5 显示并已标注。",
  "The 2D plan view draws the published CTX ortho unchanged and stays the data-truth view; both views use the same DEM grid, the same route kernel and the same numbers.":
    "2D 平面视图原样绘制发布的正射影像，保持“数据真相视图”；两个视图使用同一 DEM 网格、同一路线内核与同一组数值。",
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
