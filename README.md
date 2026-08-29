# 海洋智能分析平台

> **使用文档：** 面向业务用户、研究人员、开发者与运维人员的完整操作说明见 [《海洋智能分析平台全量使用手册》](docs/USER_MANUAL.md)。

> 项目状态：截至 2026 年 8 月 29 日，系统已经具备多源数据接入、异常筛查、事件档案、Argo 剖面调查、每日简报、账户隔离和 Ubuntu 生产部署能力。

这个项目做的事情很具体：**把散落在 Argo、NOAA、Copernicus Marine 等系统里的观测，整理成可以持续跟踪、逐条核对证据的海洋事件档案。**

它不生产浮标，不替代 Argo 数据中心，也不是另一个通用地图或聊天框架。Argo 负责“测到海里发生了什么”，各类数据服务负责“把数据提供出来”，本项目负责“把不同来源放到同一个海域、时间和事件上下文中，说明哪些只是观测，哪些值得继续核查，以及结论依据是什么”。

## 一、项目定位、比较与核心问题

### 1. 与 Argo 的关系

[Argo](https://argo.ucsd.edu/) 是全球海洋观测计划。它依靠自主剖面浮标采集温度、盐度、压力以及部分生物地球化学变量，并通过国际数据中心分发经过质量控制的数据。Argo 是本项目最重要的现场观测来源之一，但二者不在同一层级：

| 对比项 | Argo | 本项目 |
| --- | --- | --- |
| 核心职责 | 建设和运行全球剖面浮标观测网络 | 组织多源观测并形成区域态势与事件档案 |
| 主要数据 | 浮标位置、温盐深剖面、部分 BGC 变量 | Argo + NOAA + Copernicus Marine + 海洋背景 + 文献 |
| 基本对象 | 平台、Cycle、Profile、参数与 QC | 区域、观测、异常候选、证据、事件生命周期 |
| 判断边界 | 提供观测及质量标识 | 在保留 QC 的前提下做筛查、交叉核查和解释 |
| 使用方式 | 下载文件、访问数据中心或第三方接口 | 地图点选、事件关联、剖面对比、简报和 API |

本项目不会修改 Argo 的原始观测，也不会把单个 Argo 剖面直接宣布为区域异常。它保留原始值/调整值模式和 QC，在事件周边寻找浮标，用现场垂向结构回答一个更具体的问题：**遥感或模式看到的表层信号，在水下是否存在相符或相反的证据？**

### 2. 与数据平台和开源组件的关系

本项目大量使用现有数据基础设施和开源软件，但它们各自只解决链路中的一段。

| 项目或服务 | 原有能力 | 在本项目中的用途 | 本项目增加的部分 |
| --- | --- | --- | --- |
| [Argovis](https://argovis.colorado.edu/) | 浏览和访问 Argo 等海洋观测 | 获取活动平台目录、完整剖面和最近浮标 | 将剖面关联到区域、事件、证据和用户关注列表 |
| [NOAA CoastWatch ERDDAP](https://coastwatch.noaa.gov/erddap/) | 以统一接口发布卫星和海洋格点产品 | 获取近期 SST、误差、海冰和质量字段 | 邻域稳健筛查、持续性检查、候选事件和来源健康状态 |
| [Copernicus Marine](https://marine.copernicus.eu/) | 提供海洋观测、模式和分析产品 | 获取海流、风、浪、历史点位和全球产品数据量 | 视窗海流场、跨产品索引、区域事件上下文和每日简报 |
| [OpenAlex](https://openalex.org/) / Crossref | 提供学术作品元数据和检索能力 | 按事件动态查询相关论文 | 将检索词、论文和 DOI 固定到具体事件的文献依据页 |
| [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) | 开源 Web 地图渲染 | 绘制底图、事件、浮标、探针和海流图层 | 中国地图图层规则、事件交互、海洋业务状态与数据新鲜度 |
| [React](https://react.dev/) / [Recharts](https://recharts.org/) / [Three.js](https://threejs.org/) | 界面、图表和图形渲染 | 构建工作台、剖面图、证据图和动态效果 | 海洋事件工作流和统一交互，不修改这些项目的底层能力 |
| [FastAPI](https://fastapi.tiangolo.com/) / [Pydantic](https://docs.pydantic.dev/) | API 服务与数据模型校验 | 建立 BFF、接口契约、认证和静态站点 | 海洋领域模型、缓存调度、来源降级和生产部署约束 |
| [LangGraph](https://docs.langchain.com/oss/python/langgraph/overview) | 有状态工作流编排 | 组织内置科学 Agent 和检查点 | 领域证据工具、事件状态约束和海洋研究上下文 |
| [Codex CLI](https://github.com/openai/codex) | 通用代码与任务执行环境 | 提供线程、流式执行和工具调用界面 | Ocean MCP、用户隔离、海洋数据工具和生成结果工作区 |

这里的关系是“组合”而不是“包装”：上游系统仍然是数据和通用能力的权威来源，本项目保存来源身份、观测时间、质量字段和错误状态，只在其上增加海洋业务语义。

### 3. 本项目的特点

#### 以“事件档案”而不是“图层”组织数据

常见海洋数据门户以数据集、变量或图层为入口。本项目以事件为入口：一个事件同时包含位置、时间、半径及其依据、状态、严重度、变量、来源、证据、推理链、附近 Argo、文献和生命周期。地图只是事件的一个入口，不是数据结构本身。

#### 把“观测”“候选”和“确认”分开

系统在模型层区分普通观测与异常候选，并继续区分 `screening`、`corroborated`、`confirmed` 和 `scenario`。高温格点、异常 Z 分数或模型生成的一段文字都不能绕过这些状态。这个约束比“检测到一个极值就画红点”更保守，也更适合需要复核的海洋业务。

#### 同一坐标可以进入完整调查链路

点击海面不是只显示经纬度。系统会寻找附近 Argo，读取剖面和 QC，并可继续查询水深、海流、风浪、海洋背景、事件和文献。这个“坐标—现场剖面—环境场—事件证据”的连续入口，是项目区别于单一 Argo 浏览器或单一遥感图层的重要部分。

#### 专门处理上游数据不稳定

区域请求采用 single-flight，快照落盘，过期后可先返回最近可信结果再后台更新。每个来源都有独立健康状态、观测时间、缓存模式和错误信息。项目不会用零值掩盖缺失，也不会把缓存页面写成实时观测。

#### 面向中文海洋业务，而非简单翻译界面

系统内置中国近海与全球主要海域、中文变量和事件术语、物种中文名称、中文报告结构以及中国标准地图图层规则。它处理的是海洋业务语义和地图发布边界，不只是把按钮名称翻译成中文。

#### 模型是可选解释层，不是判定核心

异常检测、QC、距离计算、缓存、事件状态和来源健康都由确定性代码完成。没有模型密钥时，核心数据、筛查、地图、Argo 和规则化解释仍能运行。模型只在证据已经组织好之后参与问答、归纳和报告，不负责改写原始数值或擅自提升事件状态。

### 4. 一条事件如何在系统中成档

以“南海出现持续偏暖信号”为例，系统的处理顺序不是先生成一段结论，而是逐步建立档案：

1. 从 NOAA SST 读取近期格点，同时读取分析误差、水体和海冰质量字段；
2. 排除不合格格点，检查异常方向、邻域稳健统计、连续日时次和持续时间；
3. 满足条件后生成 `screening` 候选，并记录触发阈值、样本量、时间范围和证据编号；
4. 在候选中心附近查找 Argo，读取最近剖面的温盐结构、原始/调整值模式和 QC；
5. 查询同位置的 Copernicus 海流、风浪和海洋背景，判断表层信号是否可能受到平流、混合或局地环境影响；
6. 将支持证据、反证、缺失项和来源错误一起写入事件，而不是只保留支持结论的数据；
7. 达到交叉核查条件后才进入 `corroborated`；是否成为 `confirmed` 仍取决于更严格证据或人工复核；
8. 后续刷新继续更新同一事件的生命周期，而不是每天重新生成一个没有上下文的新红点。

这条链路是项目的核心产品：上游数据平台提供原料，地图组件提供显示，模型可以帮助归纳，但**事件档案、验证状态和证据边界由本项目负责维护**。

### 5. 本项目不做什么

- 不替代 Argo、NOAA、Copernicus Marine 或其官方数据分发渠道；
- 不声称自动筛查结果等同于业务主管部门或科研团队的正式认定；
- 不用单个浮标代表整个海域，也不把缺失变量填成零；
- 不把海流粒子动画解释为真实漂移轨迹；
- 不要求依赖大模型才能查看数据或运行检测；
- 不适合作为未经复核的航行安全、灾害预警或执法依据。

### 6. 要解决的核心问题

归纳起来，本项目需要解决四类核心问题：

1. **数据问题**：海洋数据分散在不同机构和产品中，格式、变量、时空分辨率、质量字段和更新时间不一致，需要统一接入、标准化、缓存和来源健康管理；
2. **判定问题**：单个高值、模式格点或浮标剖面不能直接等同于海洋事件，需要基线、质量控制、持续性、空间邻域和多源证据共同约束；
3. **解释问题**：分析结果必须说明数据来自哪里、触发了什么规则、有哪些支持或反对证据、当前属于什么验证状态，以及仍存在哪些不确定性；
4. **落地问题**：系统不仅要能演示，还要具备账户、权限隔离、密钥保护、数据库、部署、备份、监控、测试和故障降级能力。

后续章节分别回答这些问题：第二至四章说明解决方案与数据链路，第五章说明完成度，第六至十六章说明使用和运行方式，第十七章说明下一步建设重点。

## 二、总体解决方案

平台采用“数据接入层—科学计算层—业务服务层—智能体层—交互展示层”的分层方案。

```text
NOAA / Argo / Copernicus Marine / WOA / OpenAlex / Crossref
                           │
                           ▼
              数据抓取、标准化与质量控制
                           │
                           ▼
        区域快照缓存、异常筛查、生命周期与证据对象
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
      FastAPI 业务接口             Ocean MCP 工具
             │                           │
             ▼                           ▼
 React + MapLibre 工作台       Codex / 外部模型 Agent
             │                           │
             └─────────────┬─────────────┘
                           ▼
              地图、事件、解释、报告与问答
```

### 方案原则

1. **确定性计算优先**：异常是否成立首先由可测试的科学规则和质量条件判断，大模型不负责篡改数值结果。
2. **证据约束输出**：解释、报告和问答尽量引用系统内的观测、证据编号、来源状态和参考文献。
3. **验证状态显式化**：区分 `observed`、`screening`、`corroborated`、`confirmed` 和 `scenario`。
4. **普通观测保持中性**：只有 `event_kind=anomaly` 的记录才属于异常候选；候选不会自动升级为已确认事件。
5. **可降级运行**：实时源失败时优先返回最近可信快照，并明确标注缓存状态和来源错误。
6. **前后端密钥隔离**：模型密钥、Copernicus 账户、会话密钥和 MCP 令牌只保存在服务端。
7. **生产同源访问**：生产环境由 FastAPI 同源提供前端和 `/api`，减少跨域与凭据暴露面。

## 三、系统架构

### 前端

- React 19 + TypeScript + Vite；
- MapLibre GL 展示标准地图、区域、事件和实时海流粒子；
- Recharts 展示证据序列、观测矩阵和统计信息；
- Three.js 支持部分动态视觉效果；
- Playwright 覆盖地图、数据管线、探针、主题和性能架构测试；
- 开发环境通过 Vite 将 `/api` 代理到 FastAPI，将 Codex 运行时请求代理到本地 sidecar。

### 后端

- FastAPI 提供 REST API、静态前端、认证、缓存和调度服务；
- Pydantic 定义事件、证据、浮标、解释、报告和 Agent 数据契约；
- NumPy 与 NetCDF4 处理异常序列和海洋网格数据；
- LangGraph 管理旧版科学 Agent 流程和 SQLite 检查点；
- PostgreSQL 在生产环境保存账户、会话和加密后的用户 API 配置；
- 本地 SQLite 保存领域长期记忆与部分智能体状态；
- `copernicusmarine` 客户端和 ARCO 数据块负责 Copernicus Marine 产品访问。

### Codex 运行时

`codex-runtime/server/index.mjs` 在本地默认监听 `127.0.0.1:8011`，负责浏览器端 Codex 工作台与本机 Codex CLI `app-server` 之间的协议适配。它提供线程、轮次、流式执行、停止、模型列表、MCP 状态等能力，同时保留 Codex 原生线程存储，不另建一套重复的聊天历史。

### 生产基础设施

- Docker 多阶段构建前端和 Python 运行时；
- Docker Compose 编排应用、PostgreSQL、Caddy 或 Cloudflare Tunnel；
- `direct` 模式由 Caddy 对外提供 `80/443`；
- `tunnel` 模式通过 Cloudflare Tunnel 发布服务，无需开放源站 Web 端口；
- 数据库仅处于 Compose 私有网络，不暴露 `5432`；
- 应用内部端口 `8000` 不直接暴露到公网。

## 四、数据与分析链路

### 1. 区域模型

当前内置七个区域：

| 区域 ID | 显示名称 | 主要覆盖范围 |
| --- | --- | --- |
| `global_ocean` | 全球海洋 | 南北纬 70 度之间的主要海洋 |
| `northwest_pacific` | 中国近海及西北太平洋 | 中国近海、黑潮延伸体、日本海和副热带西北太平洋 |
| `south_china_sea` | 南海及邻近海域 | 南海、吕宋海峡、北部湾和巽他陆架北部 |
| `indian_ocean` | 印度洋 | 阿拉伯海、孟加拉湾、赤道和南印度洋 |
| `north_atlantic` | 北大西洋 | 湾流、副热带环流和亚极地海域 |
| `south_pacific` | 南太平洋 | 南太平洋副热带环流、珊瑚海和东南太平洋 |
| `mediterranean` | 地中海 | 西地中海、亚得里亚海、爱琴海和东地中海 |

### 2. 主要数据源

| 数据源 | 用途 | 处理方式 |
| --- | --- | --- |
| NOAA OISST / ERDDAP | 海表温度与区域异常筛查 | 读取近期格点，检查质量、误差、水体和海冰条件 |
| Argovis / Argo | 温度、盐度和 BGC 浮标剖面 | 读取活跃平台目录、完整剖面、最近点和区域统计 |
| Copernicus Marine | 海流、风、浪及全球产品 | 点查询、视窗矢量场、每日事件索引和数据量统计 |
| WOA | 盐度、硝酸盐等气候参考 | 为区域和点位提供背景基线 |
| NOAA 碳数据 | 碳循环与相关观测 | 标准化为证据和区域事件记录 |
| OpenAlex / Crossref | 事件相关文献 | 动态构造检索词，OpenAlex 失败时回退 Crossref |
| 标准地图与天地图 | 中国地图和中文注记 | 开发环境可诊断回退，生产构建要求天地图密钥 |

### 3. 实时区域快照

前端首屏不再分别请求事件、指标、来源、覆盖率、观测矩阵和 Argo 数据，而是调用统一 BFF 接口：

```text
GET /api/workspace/snapshot?region=global_ocean
```

后端为每个区域生成统一快照，包含：

- 事件与普通观测；
- 事件数量和核心指标；
- 数据源健康状态；
- 数据覆盖情况；
- 区域观测摘要；
- Argo 活跃网快照；
- 缓存状态、刷新时间和降级错误。

同一区域并发读取采用 single-flight，避免多个请求重复访问外部接口。快照持久化到 `backend/.cache/realtime`。进程重启或缓存过期时，系统可先返回上一次可信快照，再在后台更新，即 stale-while-revalidate。

### 4. 异常检测

`POST /api/detect` 接收带时区、时间不重复且数值有限的时间序列。检测逻辑包括：

- 按时间排序观测；
- 计算观测值相对基线的异常；
- 使用中位数和 MAD 生成稳健 Z 分数；
- 检查方向阈值、最小样本数、连续样本数和持续时间；
- 对 SST 检查 12–36 小时的日尺度采样节律；
- 根据基线类型决定能否进入交叉印证状态；
- 限制筛查阶段的严重度和置信度上限。

对于 SST，只有明确使用逐日历气候上分位或下分位阈值，并满足至少 5 个连续日尺度样本、连续跨度不少于 96 小时等条件时，才可返回海洋热浪或冷异常的交叉印证结果。普通气候均值、参考序列或空间基线只能形成海温异常筛查，不能冒充正式海洋热浪判定。

### 5. 事件模型与生命周期

系统支持以下记录类型：

- 海表观测、水文观测、生物地球化学观测；
- 海洋热浪、冷异常、海温异常；
- 中尺度涡和海流异常；
- 浮游植物、叶绿素和营养盐异常；
- 碳异常、盐度异常；
- 风、浪异常和台风预警。

事件对象包含位置、半径及其依据、开始与结束时间、状态、严重度、置信度、变量、来源、证据、推理链、时间线、潜在影响和不确定性。生命周期状态包括发现、监测、交叉印证、确认、减弱和关闭，便于连续刷新后跟踪同一事件，而不是每次生成互不关联的新记录。

### 6. Argo 实时观测

平台按区域读取最近 35 天的 Argo 活跃观测目录，并按需获取完整剖面。主要能力包括：

- 区域活跃浮标和 BGC 浮标统计；
- 温度、盐度、叶绿素、硝酸盐等可用率；
- 原始值与调整值模式；
- 典型和最大剖面深度；
- 单个平台最新快照、历史和自动解释；
- 地图任意海面坐标的最近浮标选择。

坐标探针接口：

```text
GET /api/argo/nearest?longitude=114.2&latitude=18.3&region=south_china_sea
```

### 7. Copernicus Marine 海流、风浪与索引

海流粒子使用 Copernicus Marine 全球表层合成海流，不使用程序化噪声。后端根据当前地图视窗读取 `utotal` 和 `vtotal`，选择不晚于当前时刻的最新有效场，下采样后返回前端：

```text
GET /api/copernicus/currents/field?west=100&south=0&east=140&north=35&width=96&height=64
```

前端用真实矢量控制粒子方向和相对速度，播放时间仅用于视觉加速。系统还提供点位风浪查询、全球数据量统计、Copernicus 每日事件索引和分页读取。

### 8. 每日海洋简报

后端按照配置时区自动生成和发布每日简报。默认流程为：

1. 北京时间 08:00 强制刷新全球海洋快照；
2. 汇总 Copernicus Marine 当日全球网格、每日事件索引和 Argo 活跃目录；
3. 生成结构化、可追溯的简报成稿；
4. 北京时间 09:00 发布到站内；
5. 前端每分钟检查状态并切换到当天成稿；
6. 如配置 Webhook，则向企业微信、钉钉、飞书或自建桥接服务推送完整 JSON。

成稿保存在 `backend/.cache/daily_briefings`，服务重启不会丢失；若服务在发布时间之后启动，会自动补生成并发布。

## 五、完成度与已完成内容

### 1. 当前完成度判断

项目已经完成从“多源数据进入系统”到“形成可追溯事件档案并提供界面、API 和智能体分析”的核心闭环，当前可定义为：**核心产品能力已完成，工程化与单机生产部署基本完成，面向正式业务运行的科学阈值治理、人工复核、组织权限和集中运维仍需继续建设。**

完成度不使用单一百分比描述，因为数据接入、科学可信度、产品交互和生产运维的验收标准不同。按能力域评估如下：

| 能力域 | 完成度 | 判断依据 | 尚需完成 |
| --- | --- | --- | --- |
| 核心分析闭环 | 已完成 | 已具备数据接入、质量控制、异常筛查、证据关联、事件详情、解释和报告 | 继续用真实历史案例校准规则和结论等级 |
| 前端研究工作台 | 已完成 | 已具备区域态势、地图、事件队列、观测矩阵、Argo 探针、Agent 和简报入口 | 增加批注、审批、导出和多人协作体验 |
| Argo/NOAA 数据接入 | 已完成 | 已实现区域读取、剖面、QC、SST 候选与缓存降级 | 扩大历史回溯范围并持续跟踪上游接口变化 |
| Copernicus Marine | 基本完成 | 已实现海流、风浪、历史点位、每日索引和数据量统计 | 补充更多产品、版本血缘和大范围任务调度 |
| 科学事件判定 | 基本完成 | 已区分普通观测、筛查候选和交叉印证，并约束 SST 持续性 | 建设正式气候阈值库、专家复核流程和案例基准集 |
| 智能体能力 | 基本完成 | 已实现 LangGraph 流程、Codex Runtime、Ocean MCP、会话和记忆隔离 | 增加自动评测、提示词版本、引用完整性和报告验收 |
| 账户与安全 | 基本完成 | 已实现登录、Session、CSRF、配置加密和生产同源访问 | 增加组织、角色、审计日志和细粒度权限 |
| 部署与可观测性 | 基本完成 | 已提供 Docker Compose、PostgreSQL、HTTPS 发布、备份和进程内性能指标 | 增加集中日志、Prometheus、告警、恢复演练和高可用方案 |
| 自动化测试 | 基本完成 | 已覆盖核心后端逻辑、认证、数据链路、地图和端到端交互 | 增加离线固定数据集、外部服务契约测试和持续集成门禁 |

从里程碑角度看：

- **原型验证阶段：已完成**，关键页面、地图、数据源和分析链路均已落地；
- **可用产品阶段：已完成**，可在本地完成区域查看、事件调查、Argo 查询、Agent 分析和简报查看；
- **单机生产部署阶段：基本完成**，已具备账户、数据库、HTTPS、备份和两种公网发布方式；
- **正式业务运营阶段：进行中**，仍需完成专家复核、权限审计、集中监控、数据血缘和长期稳定性验证；
- **规模化平台阶段：尚未完成**，消息队列、多节点任务、组织协作和高可用不属于当前已完成范围。

### 2. 海洋态势总览

### 1. 海洋态势总览

- 七个海域快速切换；
- 地图事件队列、严重度、置信度和验证状态展示；
- 观测、异常候选和事件分开展示；
- 数据覆盖、来源健康和最后更新时间展示；
- 区域指标和事件生命周期统计；
- 全球 Copernicus 事件索引分页加载。

### 3. 地图与交互

- 中国标准地图离线矢量数据；
- 国界、省界、海岸线、南海断续线、重要岛点和中文注记；
- 天地图底图和注记接入；
- 全球参考边界与街道级底图分层；
- 真实海流粒子动画；
- Argo 浮标、异常点和事件范围展示；
- 海面坐标探针和最近浮标选择。

### 4. 科学分析

- 稳健异常检测模型；
- NOAA SST 候选的质量、误差、水体和海冰过滤；
- 连续时次、持续性和空间邻域约束；
- 海洋热浪与普通海温异常的语义隔离；
- 事件证据、推理链、时间线和不确定性模型；
- 事件报告和证据约束解释；
- Argo 剖面解释、海洋环境背景和水深剖面查询。

### 5. 海洋数据 Agent

- Codex 原生线程列表和持久会话；
- 流式执行轨迹、停止操作、模型和推理强度选择；
- Ocean MCP 工具发现与状态展示；
- 区域、事件、观测、证据、来源、Argo 和记忆工具；
- 旧版 LangGraph 科学流程兼容入口；
- 外部 Responses API 主路由与 Chat Completions 热备；
- 重试、故障转移、负载压缩和熔断恢复；
- 用户、线程和长期记忆隔离。

### 6. 文献与知识辅助

- 根据事件海域、类型和变量实时生成检索词；
- OpenAlex 实时检索；
- Crossref 自动回退；
- DOI、作者、期刊、开放获取和被引次数展示；
- 海洋百科、物种中文名、海域知识和本地知识快照。

### 7. 工程化能力

- BFF 区域快照；
- 内存与磁盘多级缓存；
- single-flight 与后台刷新任务合并；
- 最多两个区域并行刷新；
- 浏览器请求取消，避免旧响应覆盖新区域；
- 请求 ID、响应耗时和 P95 性能统计；
- 用户注册、登录、退出、会话 Cookie 和 CSRF 防护；
- PostgreSQL 持久化与 Fernet 加密；
- Docker 多阶段构建；
- Cloudflare Tunnel 和 Caddy 两种生产发布模式；
- PostgreSQL 备份脚本与 Ubuntu 22.04 部署文档。

### 8. 自动化测试

后端测试覆盖异常检测、API、认证、Argo 最近点与区域快照、Copernicus 优先级和每日索引、每日简报、Agent、MCP、用户隔离、海洋知识、NOAA、WOA、地图资源和性能架构。

前端 Playwright 测试覆盖中国标准地图、街道底图、数据管线、地图标记清晰度、海流动画、坐标探针、海洋知识、视觉主题和性能架构。

## 六、界面使用方式

### 1. 查看区域态势

1. 打开首页；
2. 在区域选择器中选择全球海洋或目标海域；
3. 等待区域快照加载；
4. 查看事件队列、观测矩阵、来源健康和地图分布；
5. 点击刷新按钮可提交后台全量刷新任务。

### 2. 查看事件详情

选择事件后，可以查看：

- 事件摘要、位置、时间、状态和影响范围；
- 观测值、基线、异常值和单位；
- 样本量、持续时间、质量通过率和不确定性；
- 证据序列和证据编号；
- 分步科学推理；
- 生命周期时间线；
- 自动解释、科学报告和实时文献。

### 3. 使用海面坐标探针

1. 在地图工具中开启探针；
2. 点击目标海面位置；
3. 系统查询附近最近的 Argo 浮标；
4. 查看距离、平台编号、最新剖面和变量；
5. 继续打开浮标历史或自动解释。

### 4. 使用海洋数据 Agent

1. 打开 Agent 工作台；
2. 新建或选择一个 Codex 线程；
3. 选择模型和推理强度；
4. 提问时明确区域、变量和时间范围；
5. Agent 通过 Ocean MCP 按需读取领域数据；
6. 查看流式执行轨迹、工具调用和最终回答；
7. 只有在明确要求“记住”时，偏好或研究焦点才会写入长期记忆。

推荐问题示例：

```text
总结南海当前高置信度异常候选，并说明每个结论的证据来源。

比较西北太平洋最新海温异常与 Argo 温盐剖面是否一致。

检查当前事件中哪些仍处于 screening，为什么不能标记为 confirmed？

为选中事件生成一份包含不确定性和文献依据的简报。
```

### 5. 查看每日简报

访问每日简报页面或接口：

```text
GET /api/daily-briefing
GET /api/daily-briefing/dashboard
```

返回内容包括生成状态、发布时间、当日全球态势、主要事件、Argo 活跃情况、来源状态和可追溯元数据。

## 七、本地运行

### 方式一：Windows 一键启动

环境要求：

- Python 3.10 或更高版本；
- Node.js 20 或更高版本；
- npm；
- 如需 Codex 工作台，需安装并可运行 Codex CLI。

双击：

```text
run_ocean_intelligence.bat
```

或在 PowerShell 执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\start_ocean_intelligence.ps1
```

启动脚本会检查依赖，按需安装 Python 和 npm 包，并依次启动：

- FastAPI：`http://127.0.0.1:8000`；
- Codex sidecar：`http://127.0.0.1:8011`；
- Vite 前端：`http://127.0.0.1:5173`。

常用地址：

| 功能 | 地址 |
| --- | --- |
| 应用首页 | `http://127.0.0.1:5173/` |
| API 文档 | `http://127.0.0.1:8000/docs` |
| 健康检查 | `http://127.0.0.1:8000/api/health` |
| Codex 状态 | `http://127.0.0.1:8011/api/codex-runtime/status` |

停止服务：

```powershell
powershell -ExecutionPolicy Bypass -File .\stop_ocean_intelligence.ps1
```

### 方式二：手动启动

安装并启动后端：

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Windows 激活虚拟环境时使用：

```powershell
.\.venv\Scripts\Activate.ps1
```

另开终端启动 Codex sidecar；如果不使用 Codex 工作台，可以跳过：

```bash
node codex-runtime/server/index.mjs
```

另开终端启动前端：

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

### 开发环境说明

- 开发环境默认 `AUTH_REQUIRED=false`，便于本地调试；
- 生产 Compose 固定设置 `AUTH_REQUIRED=true`；
- 未配置实时外部服务时，部分功能会使用缓存、内置证据或情景数据，并在数据模式中明确标记；
- Vite 会把普通 `/api` 请求代理到 `8000`，Codex 相关请求代理到 `8011`。

## 八、环境变量配置

### 1. 前端配置

复制示例文件：

```bash
cp frontend/.env.example frontend/.env.local
```

主要变量：

```dotenv
VITE_TIANDITU_TOKEN=你的天地图浏览器端密钥
VITE_API_ROOT=
```

生产构建必须配置 `VITE_TIANDITU_TOKEN`。建议在天地图控制台中把密钥限制到实际生产域名。

### 2. Copernicus Marine

```dotenv
COPERNICUSMARINE_USERNAME=
COPERNICUSMARINE_PASSWORD=
COPERNICUSMARINE_WAVE_DATASET_ID=cmems_mod_glo_wav_anfc_0.083deg_PT3H-i
COPERNICUSMARINE_WIND_DATASET_ID=cmems_obs-wind_glo_phy_nrt_l4_0.125deg_PT1H
COPERNICUSMARINE_CURRENT_DATASET_ID=cmems_mod_glo_phy_anfc_merged-uv_PT1H-i
COPERNICUSMARINE_CURRENT_U_VARIABLE=utotal
COPERNICUSMARINE_CURRENT_V_VARIABLE=vtotal
```

实时海流默认读取官方 time-chunked ARCO 数据块，避免冷请求加载完整时间轴。数据集、变量和 ARCO 地址均可通过环境变量覆盖。

### 3. 每日简报

```dotenv
DAILY_BRIEF_TIME_ZONE=Asia/Shanghai
DAILY_BRIEF_GENERATE_HOUR=8
DAILY_BRIEF_PUBLISH_HOUR=9
DAILY_BRIEF_POLL_SECONDS=30
DAILY_BRIEF_WEBHOOK_URL=
```

Webhook 推送失败时会重试，但不会阻塞站内发布。

### 4. 事件解释模型

不配置外部模型时，事件解释接口使用内置证据约束引擎。配置兼容 Chat Completions JSON 输出的服务后自动切换：

```dotenv
OCEAN_EXPLANATION_API_URL=
OCEAN_EXPLANATION_API_KEY=
OCEAN_EXPLANATION_API_MODEL=
```

外部调用失败时会回退到内置解释，不中断事件详情接口。

### 5. 海洋 Agent 模型

```dotenv
OCEAN_AGENT_API_URL=https://HOST/v1/responses
OCEAN_AGENT_API_KEY=
OCEAN_AGENT_API_MODEL=
OCEAN_AGENT_API_TIMEOUT_SECONDS=45
OCEAN_AGENT_API_ATTEMPTS=4
OCEAN_AGENT_REASONING_EFFORT=high
OCEAN_AGENT_CIRCUIT_FAILURES=2
OCEAN_AGENT_CIRCUIT_COOLDOWN_SECONDS=30
```

Responses API 为主路由，Chat Completions 为热备。模型健康状态可通过以下接口查看，响应不会返回密钥或上游地址：

```text
GET /api/agent/model-health
```

### 6. 认证与数据库

生产环境至少需要配置：

```dotenv
POSTGRES_DB=ocean_intelligence
POSTGRES_USER=ocean
POSTGRES_PASSWORD=使用高强度随机值
DATABASE_URL=postgresql://ocean:密码@database:5432/ocean_intelligence
ENCRYPTION_KEY=Fernet兼容密钥
AUTH_REQUIRED=true
SESSION_COOKIE_SECURE=true
SESSION_TTL_SECONDS=2592000
ALLOWED_HOSTS=你的域名
ALLOWED_ORIGINS=https://你的域名
```

真实密钥只能写入未提交版本库的环境文件，不应写入前端代码、镜像层、日志或项目说明。

## 九、主要 API

### 状态与区域

```text
GET /api/health
GET /api/regions
GET /api/performance
```

### 工作台与刷新

```text
GET  /api/workspace/snapshot?region=global_ocean
POST /api/refresh?region=global_ocean
POST /api/refresh/jobs?region=global_ocean
GET  /api/refresh/jobs/{job_id}
```

### 事件与观测

```text
GET  /api/events?region=south_china_sea&mode=live
GET  /api/signals?region=south_china_sea
GET  /api/observations?region=south_china_sea
GET  /api/events/{event_id}
GET  /api/events/{event_id}/timeline
GET  /api/events/{event_id}/report
GET  /api/events/{event_id}/explanation
GET  /api/events/{event_id}/literature
POST /api/detect
```

### 指标与来源

```text
GET /api/metrics?region=south_china_sea
GET /api/event-stats?region=south_china_sea
GET /api/event-lifecycle?region=south_china_sea
GET /api/data-coverage?region=south_china_sea
GET /api/sources?region=south_china_sea
GET /api/observations/summary?region=south_china_sea
```

### Argo 与海洋环境

```text
GET /api/argo/region?region=south_china_sea
GET /api/argo/nearest?longitude=114.2&latitude=18.3
GET /api/argo/float/{platform}
GET /api/argo/float/{platform}/history
GET /api/argo/float/{platform}/explanation
GET /api/marine/context?longitude=114.2&latitude=18.3
GET /api/marine/bathymetry?longitude=114.2&latitude=18.3
```

### Copernicus Marine

```text
GET /api/copernicus/currents/field
GET /api/copernicus/waves/point
GET /api/copernicus/wind/point
GET /api/copernicus/global/daily-volume
GET /api/copernicus/events/page
GET /api/copernicus/index/status
```

### Agent、MCP 与记忆

```text
GET    /api/agent/context
POST   /api/agent/chat
GET    /api/agent/sessions
POST   /api/agent/sessions
GET    /api/agent/sessions/{session_id}
PATCH  /api/agent/sessions/{session_id}
DELETE /api/agent/sessions/{session_id}
GET    /api/agent/memories
POST   /api/agent/memories
PATCH  /api/agent/memories/{memory_id}
DELETE /api/agent/memories/{memory_id}
GET    /api/codex/mcp
POST   /api/codex/mcp
DELETE /api/codex/mcp
```

完整请求参数和响应模型以运行后的 Swagger 文档 `http://127.0.0.1:8000/docs` 为准。

## 十、生产部署

当前生产方案面向 Ubuntu 22.04 单机。

### 1. 准备配置

```bash
cp deploy/production.env.example deploy/production.env
chmod 600 deploy/production.env
```

至少填写：

- `SITE_HOST`、`SITE_ADDRESS`、`SITE_ORIGIN`；
- `VITE_TIANDITU_TOKEN`；
- `POSTGRES_PASSWORD`；
- `ENCRYPTION_KEY`；
- `DEPLOY_TRANSPORT`；
- tunnel 模式下的 `TUNNEL_TOKEN`；
- 如启用实时 Copernicus Marine，则填写其账户信息。

### 2. 执行部署

```bash
./deploy/deploy.sh
```

脚本会：

1. 校验生产环境文件；
2. 校验 `direct` 或 `tunnel` 模式；
3. 停止另一种传输模式的服务；
4. 拉取基础镜像并构建应用；
5. 启动 PostgreSQL、应用和选定的入口服务；
6. 输出 Compose 服务状态。

完整服务器初始化、HTTPS、安全组、临时 IP 验收、备份和恢复流程见 `deploy/UBUNTU_22_04.md`。

### 3. 备份

PostgreSQL 备份脚本：

```bash
./deploy/backup-postgres.sh
```

默认备份目录为 `backups/postgres`。恢复前应先确认数据库版本、目标库名、用户和停机窗口。

## 十一、测试与构建

### 后端测试

```bash
cd backend
python -m pytest tests
```

运行单个测试文件：

```bash
python -m pytest tests/test_anomaly_detection.py
```

### 前端构建

```bash
cd frontend
npm run build
```

### 前端端到端测试

先启动前后端服务，再执行：

```bash
cd frontend
npx playwright test
```

## 十二、项目目录

```text
ocean-intelligence/
├── backend/
│   ├── app/
│   │   ├── agents/                 # Agent 图、解释、报告、MCP 和记忆
│   │   ├── data/                   # NOAA、Argo、Copernicus、WOA、知识数据
│   │   ├── scientific_models/      # 确定性异常检测
│   │   ├── auth.py                 # 用户、会话、CSRF 和凭据加密
│   │   ├── daily_briefing.py       # 每日简报生成与发布
│   │   ├── copernicus_daily_index.py
│   │   ├── main.py                 # FastAPI 入口和主要路由
│   │   └── models.py               # Pydantic 数据模型
│   ├── scripts/                    # 知识索引和数据处理脚本
│   ├── tests/                      # 后端测试
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/             # 地图、事件、观测和 Agent 组件
│   │   ├── App.tsx                 # 主工作台
│   │   ├── api.ts                  # 业务 API 客户端
│   │   ├── codexApi.ts             # Codex 运行时客户端
│   │   └── styles.css
│   ├── tests/                      # Playwright 测试
│   └── package.json
├── codex-runtime/                  # 浏览器与 Codex app-server 适配层
├── deploy/                         # 生产配置、部署、Caddy 和备份脚本
├── generated/                      # 生成的简报、报告和辅助产物
├── audits/                         # 数据采集或能力审计结果
├── scripts/                        # 地图和演示素材构建脚本
├── compose.prod.yaml
├── Dockerfile
├── start_ocean_intelligence.ps1
└── stop_ocean_intelligence.ps1
```

## 十三、缓存与持久化位置

| 路径或服务 | 内容 |
| --- | --- |
| `backend/.cache/realtime` | 区域实时快照 |
| `backend/.cache/daily_briefings` | 每日简报成稿 |
| `backend/.cache` | 其他上游数据和计算缓存 |
| `.runtime/agent_memory.sqlite3` | Agent 长期领域记忆 |
| `CODEX_HOME` | Codex 原生线程和运行状态 |
| PostgreSQL | 生产账户、会话和加密后的用户 API 配置 |
| `backups/postgres` | 数据库备份文件 |

这些目录中可能包含运行数据或用户信息。生产备份、迁移和故障排查时应按敏感数据处理，不应直接提交到版本库。

## 十四、性能与可观测性

所有 API 响应包含：

- `X-Request-ID`：请求追踪标识；
- `X-Response-Time-Ms`：服务端响应耗时。

性能接口：

```text
GET /api/performance
```

它按路由统计请求数、错误数、平均耗时、P95 和最大耗时。前端生产构建将地图、图表、Three.js、图标和 React 运行时拆分为独立缓存块，避免业务入口形成单个超大脚本。

## 十五、安全与合规说明

### 密钥安全

- 不要提交 `deploy/production.env`、`frontend/.env.local` 或真实凭据；
- 模型和 Copernicus Marine 密钥只应进入服务端环境；
- 生产环境应启用安全 Cookie、HTTPS、允许域名和来源限制；
- `ENCRYPTION_KEY` 丢失后，已加密的用户 API 配置无法正常解密，应安全备份。

### 地图合规

项目内中国离线底图来源于自然资源部标准地图服务系统，界面标注审图号 `GS(2023)2767号` 并提供原图入口。公开发布、裁切、修改或生成新的地图成果前，应根据实际使用方式复核地图审核、审图号标注和数据服务授权要求。

生产环境固定使用天地图提供中国大陆和台湾省底图及简体中文注记。缺少 `VITE_TIANDITU_TOKEN` 时，生产构建会失败；开发环境的离线后备仅用于研发和诊断。

### 科学结论边界

- 系统输出用于观测汇总、异常筛查和辅助研判，不替代主管部门预警、业务会商或同行评议；
- `screening` 表示候选筛查，不等于正式事件确认；
- `scenario` 表示情景或演示数据，不能作为实时事实引用；
- 来源降级、样本不足、时间跨度不足或基线不合格时，应保留不确定性，不应提高结论等级；
- 影响面积只在证据足以支持空间范围时提供，缺失值不会用零填充。

## 十六、常见问题

### 页面打开但没有实时数据

先检查：

```text
GET /api/health
GET /api/sources?region=global_ocean
GET /api/workspace/snapshot?region=global_ocean
```

若来源状态为降级，系统可能正在返回最近可信缓存。确认服务器能够访问外部数据服务，并检查后端日志和相应账户配置。

### 地图没有真实海流动画

检查 Copernicus Marine 用户名、密码、数据集 ID 和 ARCO 地址。接口 `/api/copernicus/currents/field` 必须能返回有效矢量场。

### Agent 工作台不可用

确认：

- Codex CLI 已安装且可在当前用户下运行；
- `node codex-runtime/server/index.mjs` 正在监听 `8011`；
- `http://127.0.0.1:8011/api/codex-runtime/status` 返回就绪状态；
- 后端 Ocean MCP 接口可访问；
- 模型配置存在，或当前 Codex 账户可正常使用。

### 生产登录后仍返回 401

检查 `AUTH_REQUIRED`、`SESSION_COOKIE_SECURE`、站点是否使用 HTTPS、代理头是否正确传递、`SITE_ORIGIN` 与实际域名是否一致，以及浏览器是否接受会话 Cookie。

### 生产构建提示缺少天地图密钥

在 `deploy/production.env` 中设置真实的 `VITE_TIANDITU_TOKEN`，再重新执行 `./deploy/deploy.sh`。该变量属于浏览器端地图服务密钥，应在服务商控制台限制允许域名。

## 十七、下一步实施路线

下一步不应优先继续堆叠页面或模型能力，而应先把已经完成的核心闭环提升为可长期验证、可人工接管、可稳定运营的业务系统。

### P0：补齐科学可信度与人工复核

| 任务 | 目标 | 验收标准 |
| --- | --- | --- |
| 正式气候阈值库 | 为海温、盐度、叶绿素等变量提供版本化区域/季节基线 | 每个事件可追溯阈值来源、时间范围、版本和计算方法 |
| 历史案例基准集 | 用已知海洋事件与普通时期评估误报、漏报和状态升级规则 | 形成可重复运行的离线评测集和指标报告 |
| 人工复核流程 | 支持专家批注、驳回、升级、确认和关闭事件 | 所有人工操作记录人员、时间、理由和前后状态 |
| 数据与模型血缘 | 固定数据产品版本、处理参数、模型配置和生成报告之间的关系 | 任意结论可回溯到输入数据、代码/规则版本和执行时间 |

### P1：增强生产运维与质量保障

| 任务 | 目标 | 验收标准 |
| --- | --- | --- |
| 独立任务队列 | 将大范围刷新、索引和报告生成移出 Web 进程 | 任务可重试、限流、取消，并能查看进度和失败原因 |
| 集中监控告警 | 接入 Prometheus、集中日志和来源健康告警 | 能发现接口错误率、延迟、数据陈旧和任务积压 |
| CI 质量门禁 | 自动运行后端、前端构建、端到端和固定数据集测试 | 主分支变更必须通过核心检查才能发布 |
| 备份恢复演练 | 验证 PostgreSQL、缓存、配置和生成结果的恢复流程 | 在独立环境完成恢复并记录恢复时间与数据丢失窗口 |

### P1：补齐业务协作能力

| 任务 | 目标 | 验收标准 |
| --- | --- | --- |
| 组织与角色权限 | 支持管理员、分析员、复核员和只读用户 | API、页面和数据范围按角色执行一致权限控制 |
| 报告导出 | 增加固定模板、PDF/文档导出和版本留档 | 导出内容保留证据、来源、时间、不确定性和审阅状态 |
| 通知适配器 | 对接企业微信、钉钉、飞书、邮件或业务 Webhook | 可按区域、严重度和状态变化配置通知策略 |
| 审计日志 | 记录登录、配置变更、事件复核、导出和敏感操作 | 管理员可查询且普通用户不可篡改 |

### P2：扩展数据覆盖与规模

- 接入更多卫星海色、潮位、海冰、台风路径和沿岸站点产品；
- 增加多年历史回溯、跨区域对比和批量点位分析；
- 支持多节点任务执行、对象存储和更大规模缓存；
- 增加事件相似性检索、报告模板库和领域评测面板；
- 根据真实用户反馈继续优化移动端、无障碍和大屏展示。

### 推荐实施顺序

1. 先完成阈值库、历史案例和人工复核，明确系统能对哪些事件给出多强的结论；
2. 再建设任务队列、监控告警、CI 和恢复演练，保证已有能力可以稳定运行；
3. 随后增加组织权限、审计、导出和通知，使系统进入多人协作业务流程；
4. 最后扩大数据源和计算规模，避免在质量与运维基础不足时过早扩张。

---

如需快速了解项目，建议按以下顺序阅读：本 README → `backend/app/main.py` → `backend/app/models.py` → `backend/app/data/realtime_service.py` → `backend/app/scientific_models/anomaly.py` → `frontend/src/App.tsx` → `deploy/UBUNTU_22_04.md`。

## 十一、Codex 全量 MCP 入口

本产品内置 MCP 入口为 `POST /api/codex/mcp`，由 `codex-runtime` 通过私有网络自动挂载。完整工具、资源、提示词、协议、鉴权、科学证据规则和验收矩阵见 `docs/codex-mcp.md`。

生产环境必须设置高熵 `OCEAN_CODEX_MCP_TOKEN`；该 token 只作为 Bearer 凭证传输，不写入前端、不写入日志、不提交 Git。入口提供产品健康、区域指标、事件证据、海洋地理、Argo、Copernicus、物理诊断、日报、资源读取和受签名保护的记忆工具。

### MCP 全量数据访问

当前内置 MCP 版本为 1.7.0。Codex 可通过 `ocean_data_catalog`、`ocean_data_schema`、`ocean_data_page`、`ocean_data_search`、`ocean_coordinate_nearest` 和 `ocean_data_aggregate` 获取、筛选和分析全部产品聚合数据；通过 `ocean_source_catalog` 与 `ocean_source_data_page` 遍历 NOAA、WOA 和 Argo 底层数组。大集合必须根据 `next_cursor` 分页读取，单页最大 1000 条。

账户密码、Cookie、API Key 明文、数据库凭证和部署 Secret 明确不通过 MCP 暴露。
