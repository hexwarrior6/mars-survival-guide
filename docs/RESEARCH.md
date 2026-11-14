# 调研与证据边界

调研日期：2026-11-14。范围：比赛约束、原始 README 核查、数据入口与实现可行性。尚未下载和解析完整科学数据产品，尚未运行应用。

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
| 首选：Jezero HiRISE DTM 与正射影像（MRO） | [科学团队制图研究](https://authors.library.caltech.edu/records/a7qs5-xhq84)描述 1 m/pixel DTM 和 25 cm/pixel 底图；[HiRISE DTM 目录](https://hirise.lpl.arizona.edu/dtm/)本轮可读 | 裁剪同一区域，生成坡度、阴影和规划网格 | 产品 ID、下载、覆盖、投影、垂直基准、NoData、大小、使用条款；论文描述不等于已取得文件 |
| 备选：Mars 2020 CTX DEM（MRO） | [USGS 产品页](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic)搜索索引列出 20 m DEM；正文抓取 403 | 区域尺度规划，明确精度限制 | 文件读取、影像配准；不能上采样后宣称米级导航 |
| 必需：Perseverance 影像与地点科学资料（Mars 2020） | 官方题目资源指向 [Raw Images](https://mars.nasa.gov/mars2020/multimedia/raw-images/) | 至少 3 个有来源的科学地点及考察目的 | 图片 ID、目标位置与拍摄位置的区别、坐标来源、素材条款 |
| 增强：MEDA 历史环境记录（Mars 2020） | [PDS MEDA](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html)与[产品检索说明](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/retrieving_mars2020.html)本轮可读 | 注明 sol/UTC 的背景曲线，或带假设的场景输入 | 产品、质量标志、缺失值、单位、时间对齐；不生成实测空间天气图 |
| 后续：Curiosity RAD | [NASA 仪器说明](https://science.nasa.gov/mission/msl-curiosity/science-instruments/)前一轮已读 | 背景参考；以后考虑有依据的暴露估计 | 跨位置迁移假设、剂量定义；不能直接生成 Jezero 实测热力图 |

CTX 索引给出的[候选 GeoTIFF](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif)尚未确认下载或解析成功。网页预览图不能代替数值 DEM。

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
