# 视觉方向：火星探索沙盘

更新：2026-11-14。根据用户新要求，**视觉冲击、立体地形和交互动效优先于扩展科学模型的深度**。此文更新原来的二维控制台美术基线；不代表功能已实现，也不改变真实数据使用与来源说明的要求。

## 三个关键画面

图片直接见 [阶段图册](README.md)，共同使用 `visuals/stage-03.png`、`stage-04.png`、`stage-05.png`，不维护另一套 HTML 或重复图片。

1. **规划：把火星放到桌面上。** 立体剖切地形沙盘，可辨认的峡谷、沙丘、岩壁，基地和人物体现比例；选择目标后，路线沿地面展开。少量任务卡提供目标和取舍，画面主体是地形。
2. **事件：让决策发生在画面中。** 视角靠近当前位置，封闭区域和失效路线明确出现，返回基地的新路线展开。沙尘只做可关闭的情景美术，不冒充实测天气，也不阻挡关键控件。
3. **最终体验：从俯瞰进入探索。** 开场从峡谷全景进入基地，再过渡到可操作沙盘；接近科学点时弹出岩石资料，任务阶段从出发、采样推进至返回。

## 动效目标（待实现）

- 开场：约 2–3 秒的镜头推进，可跳过；减少动画偏好下直接进入稳定视角。
- 沙盘：拖动旋转、滚轮缩放，限制相机穿地与迷失；提供复位和二维视图。
- 选点：镜头平滑对准目标、标记强调、路线从基地展开；不改变真实计算路径。
- 执行：人物沿路线移动，时间、任务进度与资源同步；相机跟随可关闭。
- 事件：封路标记出现、旧路线淡出、新路线展开；以文字保留失败或返航原因，不只依赖动画。
- 视觉验收：在目标机器记录运行表现，目标平稳交互不低于 30 fps；粒子、阴影和后处理可降级。图片里逼真的离线光照不作为逐像素复刻承诺。

这些是交互设计目标。本轮只交付静态图片，没有可旋转模型、动画文件或 WebGL 实现。

## 美术与科学的边界

- 生成图为完整界面概念稿，不是可直接使用的三维模型、DEM、材质贴图或 NASA 数据。
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
