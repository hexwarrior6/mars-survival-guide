# 视觉方向：火星探索沙盘

更新：2026-11-15（V1–V4 统一改版方向定案，见文末）。根据用户新要求，**视觉冲击、立体地形和交互动效优先于扩展科学模型的深度**。此文更新原来的二维控制台美术基线；不代表功能已实现，也不改变真实数据使用与来源说明的要求。

## 三个关键画面

图片直接见 [阶段图册](README.md)，共同使用 `visuals/stage-03.png`、`stage-04.png`、`stage-05.png`，不维护另一套 HTML 或重复图片。

1. **规划：把火星放到桌面上。** 立体剖切地形沙盘，可辨认的峡谷、沙丘、岩壁，基地和人物体现比例；选择目标后，路线沿地面展开。少量任务卡提供目标和取舍，画面主体是地形。
2. **事件：让决策发生在画面中。** 视角靠近当前位置，封闭区域和失效路线明确出现，返回基地的新路线展开。沙尘只做可关闭的情景美术，不冒充实测天气，也不阻挡关键控件。
3. **最终体验：从俯瞰进入探索。** 开场从峡谷全景进入基地，再过渡到可操作沙盘；接近科学点时弹出岩石资料，任务阶段从出发、采样推进至返回。

## 动效目标（2026-11-15 状态勾销）

- 开场：约 2–3 秒的镜头推进，可跳过；减少动画偏好下直接进入稳定视角。→ **未实现，V1**
- 沙盘：拖动旋转、滚轮缩放，限制相机穿地与迷失；提供复位和二维视图。→ **已实现（阶段 3，含用户指定的左键平移/右键旋转映射）**
- 选点：镜头平滑对准目标、标记强调、路线从基地展开；不改变真实计算路径。→ **已实现（阶段 3）**
- 执行：人物沿路线移动，时间、任务进度与资源同步；相机跟随可关闭。→ **移动与同步已实现（阶段 4）；相机跟随未实现，维持推迟**
- 事件：封路标记出现、旧路线淡出、新路线展开；以文字保留失败或返航原因，不只依赖动画。→ **部分实现（阶段 4）：封路矩形、失效灰虚线、应急琥珀线与文字横幅已有；"淡出/展开"过渡动画未实现 → V4 一并处理**
- 时间轴回看与资源边界：→ **阶段 4 时尚无此目标；2026-11-15 新增为 V2/V3，见文末统一方向**
- 视觉验收：在目标机器记录运行表现，目标平稳交互不低于 30 fps；粒子、阴影和后处理可降级。→ **阶段 3/4 实测 120 fps·11 draw calls（Apple M4 前台）；阴影/后处理尚未引入**

## 统一改版方向 V1–V4（2026-11-15 定案）

现状审查结论：控制台当前是"三栏仪表 + 灰度贴图"的工具形态——地形只占约 52% 视口宽，全部控件常驻，交互只有旋转/缩放/选点。改版把四个目标统一成一个方案：**地形是主角，时间与资源是可操作的维度，方案对比是可读的取舍**。阶段划分与验收见 [实施计划 §7](IMPLEMENTATION.md)。

### 布局骨架（V1）

- 舞台全幅：地形占满视口（目标 ≥70% 宽 @1440×900），左右面板全部改为悬浮层——左上品牌块（MARS SURVIVAL GUIDE / Jezero 标识）、左侧单张悬浮任务卡（目标/策略/滑杆合并、可折叠）、右上资源芯片（O₂/Battery 数字+迷你条）、结果与图例收纳进卡片或抽屉。删除三条全宽横条。
- 开场：2.5 s 缓动镜头推进（高空 → 总览位），可跳过；`prefers-reduced-motion` 直达总览。
- 光照与质感：保持西北向阳光与 DEM 山影约定一致；ACES + 曝光分级，冷暖补光分离切面与地表层次。显示层美术的边界见文末「显示层美术（方案 C）」。

### 时间轴（V2）

底部时间轴条取代 HUD 横条：播放头 + 分段色带（去程暖白 / 停留灰 / 返程琥珀 / 应急返程红琥珀，边界来自 timeline 累计分钟）+ 事件刻度（▲电池损失 / ■封路）+ T+ 时钟与播放控件。**拖动=暂停，松手停住，回看任意 T**（语义见 SPECIFICATION §5）。回看时 3D 与 2D 同步派生状态。

### 资源边界（V3）

可返航范围以**边界等值线**呈现（不画全幅热力图）：琥珀色实线随行进与事件收缩，当前格在边界外时转红色警示；标签 "RETURNABLE LIMIT (simulated)"。收缩过渡 ≤300 ms 且不掩盖数值跳变（事件造成的收缩一步到位，不做缓动粉饰）。

### 方案对比（V4）

两策略路线同屏：选中方案实线加粗，备选半透明细线；**用线型+文字区分方案，不用颜色编码方案**，避免与既有 leg 语义冲突。路线配色语义表（改版后仍有效）：

| 元素 | 视觉 |
| --- | --- |
| 去程（outbound） | 暖白实线 |
| 返程（return） | 琥珀实线 |
| 应急返航（emergency） | 琥珀实线加粗，自事件位置展开 |
| 失效路线（invalid） | 灰色长虚线 |
| 封闭区 | 红色矩形描边 |
| 备选方案路线 | 当前方案线型 + 50% 透明度细线 |

任务卡内对比芯片：每策略一行（距离/时长/O₂/余量），点击切换选中策略；数值全部来自 RouteResult.candidates。

### 与既有验收条款的关系

阶段 3 的 U1–U7、阶段 4 的 E1–E6 在改版后必须继续通过（V1.1/V1.3 回归清单）；"不能出现假装可用的按钮"（阶段 3 边界条款）继续约束 V1 的占位设计——时间轴条在 V2 交付前不出现在界面上。

## 显示层美术（2026-11-15 决策：方案 C）

原来的「不加虚构岩石细节贴图」作废，改为**分层约定**：

- **3D 沙盘是显示层**，允许美术化：剖切块体的侧壁、层理纹理、切深、压边光、暖色补光，以及后续加入的地表调色与近景微观细节（颗粒、法线扰动、实例化岩块）。前提是——不进入任何计算，不改路线、时间、资源与地貌锚点数值。
- **2D 平面视图保持数据真相**：原样绘制发布的正射影像，不做调色与美术处理；两个视图共用同一 DEM 网格、同一路线内核、同一组数值。
- **必须标注**：图例新增「剖切块体侧壁/层理/切深/压边光为美术显示」；「来源与假设」抽屉新增「显示美术（非数据）」小节，逐项列出美术元素与「不进计算」的承诺；顶栏的 `SIMULATED SCENARIO · REAL TERRAIN DATA` 保持常驻。

实施状态：

- 第一批（2026-11-15 已实现）：剖切块体（侧壁 + 层理 + 压边 + 底座）；标签碰撞避让（位移优先、必要时隐藏，并把计划路线当障碍物）；总览取景拉到能看见块体厚度。**选点后的镜头保持贴近**（路线占满画面，不改大远景——用户明确要求）。
- 第三批（2026-11-15 已实现）：头盔/第一人称视角（沿真实模拟位置与行进方位、极简 HUD、近景岩块）、基地信标呼吸光、路线移动光点、事件红脉冲；2D 视图与数值不变。
- 第二批（2026-11-15 已实现）：加载期一次性烘焙"显示地表"（真实正射亮度 × 坡度/曲率配色、DEM horizon-scan 长阴影、微观起伏法线、反锐化细节）、天空渐变与雾、尘粒、ACES 色调映射、泛光链（首 1.6 s 平均低于 30 fps 时自动关闭）；垂直起伏由 ×3 提升到 ×4.5 并改标注。2D 视图保持原生正射不变。参数与验收见 [3D 视觉升级方案](VISUAL-UPGRADE-PLAN.md)。
- 第四批（2026-11-15 已实现）：地表回归卫星影像。反照率以正射灰度作为明暗与结构的唯一来源，配色改为近中性暖灰色带，坡度/曲率只做 6%–10% 的提示，烘焙长阴影降到 0.10；主光由 2.8 降到 0.45、环境光承担基础照明，法线强度与泛光同步降低，剖切层理降饱和。卫星图上的三角洲前缘、河道与陨石坑在 3D 中可逐一对上。
- 第五批（2026-11-15 已实现）：开场"从火星一镜到底到任务区域"。真实比例的 Viking MDIM 2.1 球体与地形共用一个相机，任务地点来自 `public/data/missions.json`；点击有数据包的地点后，相机沿对数距离从行星轨道落到该区域的整块 `overviewPose`，球体在 9–2.6 km 高度区间淡出，无切镜。Jezero 可用，Gale / Mawrth / Eberswalde 作为未来地点标注 `NO PACKAGE`；新增地点只需清单条目 + 数据包。左下角任务清单与球面引脚同步；球体是可任意拖动旋转的轨道相机（Google Earth 式），滚轮缩放，俯冲分 3 级并显示加载进度，从竖直视角连续转到斜视；中间用 60 km 的真实 CTX 区域影像接管，避免把全球图放大成糊片；太空背景为程序化星场 + 银河带 + 冷色星云 + 太阳辉光（显示层装饰，不是星表）；落地后一条扫描光带扫过完整显示地表（不切换数据栅格，避免跳变）。

## 美术与科学的边界

- 生成图为完整界面概念稿，不是可直接使用的三维模型、DEM、材质贴图或 NASA 数据。
- 显示层美术的允许范围以「显示层美术（方案 C）」为准：3D 可美术化并标注，2D 保持数据真相。
- 后续可分别制作地形材质、基地/人物资产与背景；不要把整张截图铺成背景后宣称完成交互产品。
- 规划模式的几何应绑定可验证地形与路径坐标；戏剧化全景可以作为明确标注的艺术开场，不混进科学层。
- 图中的岩石照片同样为生成美术；实际科学卡片应替换成有来源的真实素材。
- 白/琥珀路线表达候选方案，红色表达阻断；生成图的路线连接和地貌细节不是导航依据。实现时必须用计算结果重新绘制。
- 光谱处理、辐射空间模型、多目标优化、AI 助手不抢占首版视觉体验时间；核心路线、资源与数据归属仍需准确。

## 图片制作记录与提示词

制作方式：内置 `image_gen`，未使用外部付费 CLI。先生成最终体验，再以其作为应急与规划场景的风格参考。三个文件均为直接生成输出，没有将生成内容描述成实机截图。

### 最终体验 / stage-05.png

生成提示词：

> Create one breathtaking high-fidelity visual concept of a desktop web application called MARS SURVIVAL GUIDE. Landscape 16:9 composition. The user wants an instantly impressive cinematic interactive 3D Mars exploration sandbox, not a boring map/dashboard. Main viewport 80 percent: physically textured photoreal miniature Martian canyon terrain seen from an elevated oblique camera, dramatic layered cliffs, dune ripples, eroded delta, a deep crater, vivid burnt-orange sunset rim lighting, atmospheric depth, deep charcoal shadows, restrained dust particles. A tiny white-suited astronaut and a small futuristic white habitat provide scale. A beautifully drawn luminous warm-white route physically hugs the terrain from habitat across a valley to a geological sampling marker; an alternative amber route climbs a ridge. The 3D terrain looks like a spectacular real-time WebGL environment, NOT a contour-line illustration, no topographic contour rings. Overlay a refined premium minimal mission UI, readable intentional editorial typography and small frosted dark instrument panels around viewport edges, do not obscure terrain. Top left brand text exactly 'MARS SURVIVAL GUIDE', small adjacent 'JEZERO / EXPEDITION 01'. A beautiful slim left mission card says 'THE DELTA CROSSING' and 'Explore the ancient lakebed', contains a photographic rock close-up thumbnail and 'START EXPEDITION'. Bottom a slim elegant timeline with three labeled steps 'DEPART', 'SAMPLE', 'RETURN'. Top right compact resources 'OXYGEN 82' and 'POWER 76'. Small near marker label 'A / LAYERED OUTCROP'. Lower right discreet text exactly 'VISUAL CONCEPT / SIMULATED SCENE'. Build sophisticated fine linework, premium aerospace instrument aesthetics, generous space, restrained white and amber UI accents. Deliver a polished full-frame screenshot-style concept with crisp UI and stunning scene art, not a monitor on a desk, not a collage, not a poster, no NASA logo, no claims of actual telemetry. The terrain and values are fictional design imagery. High visual drama, tangible relief, beautiful material lighting. Focus on unforgettable environmental beauty plus believable frontend layout.

### 应急返航 / stage-04.png

以 stage-05.png 为风格参考，生成提示词：

> Create a second screen in exactly this same Mars Survival Guide visual design system, for the emergency return experience. Preserve premium cinematic photoreal 3D Martian canyon rendering, burnt-orange light, fine elegant edge UI and tiny astronaut/base scale. Change camera to a closer elevated perspective on an astronaut midway through the canyon; the white habitat is visible in the distance, clearly the return destination. Dramatic incoming dust front in the upper right distance, drifting dust across the ground, not obscuring the entire scene. Terrain dominates 80 percent. Show a clean curved luminous warm-white return route hugging a safe valley towards the habitat, and a short broken red-orange route ending at a rocky blocked passage, with a restrained red hatched polygon over the blocked passage. Add compact tasteful warning band near top center reading exactly 'ROUTE BLOCKED · RETURN PLAN READY'. Change left mission card to 'GET HOME SAFELY', smaller 'Science objective deferred', show a small inset terrain overview with astronaut and habitat, and button 'FOLLOW RETURN ROUTE'. Resource chips 'OXYGEN 58' and 'POWER 36'. Route annotation 'BASE / 18 MIN'. Bottom timeline labels 'INCIDENT', 'REPLAN', 'RETURN'. Keep main brand 'MARS SURVIVAL GUIDE'. Small lower right label 'VISUAL CONCEPT / SIMULATED SCENE'. No full-screen red tint, no excessive widgets, no illegible decorative text, no NASA logo. This is a bold astonishing frontend concept showing the narrative climax of an expedition, not a scientific claim or actual screenshot. Landscape same ratio as reference.

### 规划沙盘 / stage-03.png

以 stage-05.png 为风格参考，生成提示词：

> Generate the interactive route planning screen of this same premium MARS SURVIVAL GUIDE application. Keep its beautiful burnt-orange physical textures, fine white typography, elegant restrained dark panels and amber route accents. Change main scene decisively to an astonishing oblique 3D terrain sandbox, a floating cutaway square tile of Mars terrain with dramatic canyon relief and visible geological strata on its cut edges, isolated in dark charcoal space. Entire terrain tile fully in frame with generous dark margin, dominates center/right 75 percent. Warm raking light creates beautiful cliff shadows, detailed dunes and rocks, subtle ambient occlusion, realistic miniature rendering. Tiny white habitat and astronaut on the valley floor. Two visibly separate physically terrain-following routes connect base to one science target, white valley route and amber ridge route, with round waypoint pins. Subtle orbit arc and small compass below tile suggest mouse rotation. No contour line rings. Minimal left task panel title 'PLAN YOUR MARSWALK'; exact labels 'A / LAYERED OUTCROP', 'VALLEY ROUTE', 'RIDGE ROUTE', 'PREVIEW EXPEDITION'. Small rock thumbnail and concise labels, avoid dense text and chart grids. Slim bottom compare strip reading 'DISTANCE 2.4 KM', 'DURATION 82 MIN', 'RESERVE 20'. Header 'MARS SURVIVAL GUIDE' and 'JEZERO / MISSION PLANNER'. Small annotation 'Drag to orbit · Scroll to explore'. Discreet bottom right 'VISUAL CONCEPT / SIMULATED SCENE'. Must look like a memorable polished real-time 3D frontend concept, tangible sculptural terrain with cinematic material quality, not a flat map or generic dashboard. Landscape 16:9. No NASA logo or real measurement claim. All data fictional.
