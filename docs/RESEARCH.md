# 调研与证据边界

调研日期：2026-11-14。范围：比赛约束、原始 README 核查、数据入口与实现可行性。**2026-11-14 阶段 1 更新：地形与影像产品已实际取得并验证，见第 2.1 节；科学地点定位方法与限制见第 2.2 节。**

## 1. 比赛要求

| 结论 | 依据与核实程度 | 对项目的影响 |
| --- | --- | --- |
| 新加坡站截止 2026-11-15 23:59 SGT，线上举行 | 11 月 13 日 briefing 邮件，前一轮已读原文；11 月 14 日 Q&A 邮件重复确认 | 开工时核对剩余时间；本计划不是按期完成保证 |
| 提交简介、详情、公开链接；演示为 30 秒视频或 7 页幻灯片 | briefing 邮件 | 阶段 5 默认制作 7 页英文材料；实际表单仍待核查 |
| 全球奖项资格需至少一个 NASA 数据集；不要求实时 API；概念或原型可接受 | briefing 邮件 | 数据可以预处理并随应用交付 |
| 题目要求整合多个 NASA 科学任务，建议至少三类数据 | 官方题目正文，前一轮浏览器已读 | 目标为 MRO + Mars 2020；三类是建议，不是硬门槛 |
| 允许代码生成等 AI 工具，须说明用途 | 官方 FAQ，前一轮浏览器已读 | 记录真实工具与用途，不编造人工贡献或使用比例 |
| 评审关注影响、创意、有效性、相关性与呈现 | briefing 邮件 | 证明数据如何改变决策，完成可重放演示 |

公开来源：[本届活动](https://www.spaceappschallenge.org/2026/)、[题目正文](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/)、[题目资源](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/?tab=resources)、[FAQ](https://www.spaceappschallenge.org/resources/participant-faqs/)。本轮网页抓取题目、FAQ 及尝试的 submission-guide 路径返回 502；不能据此认定页面不存在，未读到的提交指南不作为证据。

私人邮件链接、会议口令与账户信息不纳入公开产品资产。提交前核对官方表单的新要求。原 README 中 Liang-Tzu 是概念署名，未验证登录账户的团队关系。

## 2. 数据候选与获取顺序

| 数据 | 已知依据 | 计划用途 | 待验证 |
| --- | --- | --- | --- |
| **已取得**：Mars 2020 Science Investigation CTX DEM mosaic，20 m/px（MRO/CTX，Mangold et al. 2021） | USGS Astrogeology 发布，PDS4 LID `urn:nasa:pds:mars2020_ctx_basemap_2021:data:m20_ctxdem_mosaic` v1.0；PDS4 标签与 GeoTIFF 已下载解析 | 规划网格地形源（阶段 1 已冻结区域并生成网格） | ~~产品 ID、下载、覆盖、投影、垂直基准、NoData、大小、使用条款~~ 已验证，见 2.1 |
| **已取得**：同批 CTX 正射影像 mosaic，约 5 m/px | 同一 USGS 发布目录 `ScienceInvestigationMaps_JPL` | 底图对齐检查与后续纹理源 | 已验证，见 2.1 |
| **已取得**：HiRISE DTM `DTEEC_045994_1985_046060_1985_U01`，约 1 m/px（MRO/HiRISE，University of Arizona） | PDS3 数据集 `MRO-M-HIRISE-5-DTM-V1.0`，标注 "Candidate landing site for 2020 mission in Jezero Crater"，足迹覆盖规划区域 | 仅作独立交叉验证（见 2.1 的跨年代偏移发现） | 已下载解析（380 MB IMG） |
| 必需：Perseverance 影像与地点科学资料（Mars 2020） | 官方题目资源指向 [Raw Images](https://mars.nasa.gov/mars2020/multimedia/raw-images/)；本轮已用 NASA/JPL 任务页与新闻稿建立科学目标 | 至少 3 个有来源的科学地点（阶段 1 已按陆标锚定交付，见 2.2） | 逐样品点精确坐标仍无机器可读官方来源；图片素材条款待逐张核对 |
| 增强：MEDA 历史环境记录（Mars 2020） | [PDS MEDA](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html) | 注明 sol/UTC 的背景曲线，或带假设的场景输入 | 产品、质量标志、缺失值、单位、时间对齐；不生成实测空间天气图 |
| 后续：Curiosity RAD | NASA 仪器说明 | 背景参考 | 跨位置迁移假设、剂量定义；不能直接生成 Jezero 实测热力图 |

HiRISE DTM 目录（uahirise.org/dtm）为分页网页目录，无机器可读清单；本轮通过网页目录 + PDS 目录路径定位到覆盖 Jezero 落点区的 DTEEC 产品并完成下载验证，"优先验证 HiRISE"已完成（产品标签、单位、投影、NoData 可追溯），规划网格仍按备选约定使用 CTX DEM。

### 2.1 阶段 1 实际取得与验证记录（2026-11-14）

以下为实际执行的下载与解析结果，命令与脚本见 `scripts/data/`：

- **M20_JezeroCrater_CTXDEM_20m.tif**（90,345,300 字节）：float32、4456×5067、20 m/px、等距圆柱投影（火星球体 r=3396190 m，标准纬线 18.4663°）、NoData=-3.4028234663852886e+38；投影坐标即米制。裁剪区 256×256 无 NoData。
- **M20_JezeroCrater_CTXortho_mosaic_5m.tif**（359,599,280 字节）：uint8 单波段，约 5 m/px，与 DEM 同投影（栅格原点有亚像元差异，按地理参考取样处理）。
- **DTEEC_045994_1985_046060_1985_U01.IMG**（380,814,764 字节）：PDS3 附带标签，14266×6673、1.0097 m/px、高程单位为 Mars 2000 Datum 米；GDAL PDS 驱动直接解析。
- **交叉验证发现（重要）**：HiRISE DTM 与 CTX DEM 之间存在 **约 +93 m 的系统性南北向配准差**（三角洲前缘三条剖面 +90/+105/+85 m 一致；1D 剖面相关将 RMS 从 9.7–17.3 m 降至 5.6–8.8 m）。这是 2017 HiRISE 解算与 2021 CTX 镶嵌之间控制网代际差的体现：**规划网格保留 CTX 地理参考**，HiRISE DTM 只用于高程交叉验证（9 个采样点平均绝对差 10.2 m，最大 25.4 m），不得当作像素级锚点。
- **CTX 正射 ↔ CTX DEM 对齐**（规划配对）：高通纹理联合平移扫描（144 个有纹理 patch）峰值位于已发布地理参考处（亚格精化后偏移 dx≈-2.4 m、dy≈-5.1 m），确认两者同基准配准；逐邻域偏移 5.4–25.6 m，RMS 17.8 m，其中 2 个邻域超出一个规划格（详见数据包 alignment_report.json，按约定以不确定度呈现而非伪装通过）。

### 2.2 科学地点定位方法与限制（2026-11-14）

- NASA/JPL 官方页面可核实**科学目标**（Jezero 古湖泊/三角洲、三角洲沉积岩样品、有机质检出），但**逐样品点的精确坐标没有机器可读官方来源**（Where-is-the-rover 地图接口不可抓取，新闻稿只有叙述性距离；PDS 检索 API 未返回 traverse 产品）。
- 按约定采用**陆标锚定**：3 个地点分别锚定于 unmistakable 的真实地貌（三角洲前缘陡坎脚下、扇顶分流河道交汇、湖底新鲜小陨石坑），位置不确定度 50–200 m 并记录定位方法；不虚构"Wildcat Ridge/Kodiak"等样品点的精确坐标。它们的逐点坐标留待后续从 PDS traverse 产品或地理参考图件核实。

题目还推荐 [Mars Trek](https://trek.nasa.gov/mars/) 和 [USGS 火星地质图](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars)。用它们发现产品、核对地理位置；不把门户名称当成数据产品标识，也不要求应用运行时访问这些服务。

## 3. 原始设想修正

1. **观测时间与模拟时间分开。** 地图为历史观测及派生结果，HUD 为模拟资源；实时仅指本地交互，不声称火星天气直播或宇航员遥测。
2. **修正 MEDA 链接与仪器含义。** 原链接指向 MSL/RAD。MEDA 入口见上表；其光学 Radiation and Dust Sensor 不等于人体电离辐射剂量仪。[Perseverance 仪器说明](https://science.nasa.gov/mission/mars-2020-perseverance/science-instruments/)
3. **不凭观感绘制辐射场。** 没有空间模型就不生成热力图；统一背景剂量率只能体现暴露时间差异，不能证明局部屏蔽。
4. **坡度和障碍有精度边界。** DEM 不能保证识别小于分辨率的岩块、裂缝。未知区域不可当作平坦可通行。
5. **返航取决于返回消耗。** 20% 只能作为可配置演示预留量，不是 NASA 安全标准。
6. **矿物与元素标签须有对应记录。** CRISM/PIXL 不统一包装成任意位置的矿物光谱。第一版允许用有来源的地质解释代替未经处理的光谱图层。
7. **限定最优性。** A* 求给定图和代价函数的路径，不等于现实最安全路线。资源可行性单独检查。
8. **静态部署保留开发工具。** 类型、构建和测试有价值；无需数据库、账户或常驻后端。[Vite 静态部署](https://vite.dev/guide/static-deploy.html)

## 4. 实施决策与停止条件

- Jezero 为首选。阶段 1 按共同覆盖选择小区域、基地与可达科学点，不先锁死坐标再拼凑资料。基地明确为虚构设施。
- 用 MRO 与 Mars 2020 建立跨任务联系。多个网址不能代替多个科学任务的数据。
- HiRISE 不可得时可使用验证后的 CTX，但必须调整尺度和描述。真实 DEM 未取得时阶段 1 受阻，随机地形不能通过验收。
- 坐标不精确的科学目标可显示为有依据的区域与不确定范围；不能虚构精确采样点。核心场景无法成立时提出区域调整方案。
- 本轮调研交付开发路线与证据边界。数据资产、空间对齐和性能均属于开发阶段验收，不提前声明成功。
