# 海洋智能分析平台全量使用手册

> 文档版本：2026-08-29  
> 适用对象：业务用户、海洋研究人员、数据分析人员、开发人员、系统管理员  
> 适用范围：本地开发版、Windows 一键启动版、Docker Compose 生产版、Ocean MCP / Codex 工作台

## 目录

1. [平台概述](#一平台概述)
2. [核心概念](#二核心概念)
3. [首次使用快速指南](#三首次使用快速指南)
4. [账户、登录与模型配置](#四账户登录与模型配置)
5. [主工作台完整操作说明](#五主工作台完整操作说明)
6. [事件调查完整流程](#六事件调查完整流程)
7. [Argo 浮标与坐标探针](#七argo-浮标与坐标探针)
8. [海洋数据 Agent 与 Codex 工作台](#八海洋数据-agent-与-codex-工作台)
9. [每日海洋简报](#九每日海洋简报)
10. [数据来源、数据模式与可信度](#十数据来源数据模式与可信度)
11. [本地安装与启动](#十一本地安装与启动)
12. [环境变量参考](#十二环境变量参考)
13. [HTTP API 使用手册](#十三http-api-使用手册)
14. [Ocean MCP 使用手册](#十四ocean-mcp-使用手册)
15. [生产部署](#十五生产部署)
16. [运维、备份、恢复与升级](#十六运维备份恢复与升级)
17. [开发、构建与测试](#十七开发构建与测试)
18. [安全与合规](#十八安全与合规)
19. [常见问题与故障排查](#十九常见问题与故障排查)
20. [目录与持久化数据说明](#二十目录与持久化数据说明)

---

## 一、平台概述

海洋智能分析平台把 Argo、NOAA、Copernicus Marine、海洋地理背景、离线海洋图谱、文献元数据和新闻背景统一到一个区域化工作台中，重点解决以下问题：

- 在同一海域中组织多来源观测，而不是只展示孤立图层；
- 区分普通观测、异常候选和经过交叉核查的事件；
- 保存事件证据、质量标识、来源状态和生命周期；
- 使用 Argo 温盐深剖面核查表层遥感或模式信号；
- 为选中海域、坐标、浮标或事件生成可追溯分析；
- 通过 HTTP API 和 Ocean MCP 向外部程序或 Codex 提供领域数据；
- 在实时来源不可用时明确展示缓存、降级或情景数据状态。

平台不是 Argo 数据中心的替代品，也不会把单一观测自动宣布为科学事实。它是一套“观测整理—异常筛查—证据关联—事件调查—报告生成”的工作系统。

### 1. 主要组成

| 组成 | 默认端口 | 用途 |
| --- | ---: | --- |
| FastAPI 本地生产应用 | `8000` | 托管生产前端、数据聚合、认证、事件、Argo、Copernicus、Agent 和 MCP |
| Codex sidecar | `8011` | Codex 线程、流式执行、工具调用和报告任务 |
| Vite 开发服务器 | `5173` | 仅手动开发模式使用，不属于一键入口 |
| PostgreSQL | 生产容器内部 | 用户、会话、模型密钥、监测浮标和租户状态 |
| SQLite / 文件缓存 | 本地或容器卷 | Agent 检查点、实时缓存、MCP 作业和导出结果 |

### 2. 典型用户路径

1. 选择目标海域；
2. 查看区域指标、事件队列和来源健康；
3. 选择异常候选或事件；
4. 核对观测值、基线、异常、QC 和时间线；
5. 查看附近 Argo 浮标及完整剖面；
6. 读取自动解释和实时文献；
7. 让 Agent 做跨来源比较或生成报告；
8. 保存研究偏好、归档会话或导出结果。

---

## 二、核心概念

### 1. 区域

区域是所有查询的第一层上下文。区域定义通常包含标识、中文名、简称、经纬度边界和数据源配置。`global_ocean` 表示全球海洋；其他区域用于缩小数据范围和提高分析针对性。

### 2. 观测、信号与事件

| 对象 | 含义 | 使用建议 |
| --- | --- | --- |
| 观测 `observation` | 数据源提供的记录或聚合记录 | 用于查看事实值、时间、位置和 QC |
| 信号 `signal` | 经过规则筛查、值得关注的异常候选 | 需要继续检查持续性、空间支持和来源一致性 |
| 事件 `event` | 已形成证据链和生命周期的调查对象 | 用于报告、复核、跟踪和协作 |

### 3. 事件状态

界面和 API 会区分候选、筛查、持续监测、确认或结束等生命周期状态。状态表达的是调查进度，不等同于自然现象本身的确定性。任何自动解释都应结合来源健康、样本量、QC、时间差、空间距离和不确定性阅读。

### 4. 严重度与置信度

- **严重度**用于表示相对影响或偏离程度，常用于队列排序和筛选；
- **置信度**用于表示现有证据对当前判断的支持程度；
- 高严重度不必然意味着高置信度；
- 高置信度也不代表结论可以脱离原始数据独立使用。

### 5. 数据模式

系统可能返回以下模式之一：

- `live`：实时或近实时上游数据；
- `cached`：之前成功获取的缓存；
- `degraded`：部分来源失败，使用可用子集；
- `scenario` / `demo`：内置情景或演示数据；
- `unavailable`：当前无可用数据。

使用报告或截图时，应同时记录数据模式、抓取时间和来源错误，不要只记录数值。

### 6. Ocean MCP

Ocean MCP 是平台向 Codex 或其他 MCP 客户端暴露的领域工具接口。它提供区域、事件、Argo、Copernicus、海洋背景、统计诊断、物理诊断、批处理、导出和审计能力。除显式记忆写入工具外，工具以只读为主。

---

## 三、首次使用快速指南

### 1. Windows 一键启动

确保已安装 Python 3.11+、Node.js 20+、npm、Codex CLI，且已完成 Copernicus Marine 账号验证和环境变量配置，然后双击：

```text
run_ocean_intelligence.bat
```

或执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\start_ocean_intelligence.ps1
```

启动完成后访问：

```text
http://127.0.0.1:8000/
```

一键脚本会创建仓库级 `.venv`、按需安装依赖、执行前端生产构建，并只在 `127.0.0.1:8000/8011` 启动。它不会启动 `5173`，也不会把服务暴露到公网。首次打开页面时先注册本地研究账户并登录。

停止服务：

```powershell
powershell -ExecutionPolicy Bypass -File .\stop_ocean_intelligence.ps1
```

### 2. Linux / macOS 手动启动

终端一：

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

终端二，可选：

```bash
node codex-runtime/server/index.mjs
```

终端三：

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

### 3. 首次进入后的推荐操作

1. 确认页面右上角没有持续的来源错误；
2. 在区域选择器选择目标海域；
3. 等待工作区快照加载完成；
4. 从左侧事件队列选择最高优先级记录；
5. 在右侧依次查看概览、观测、证据、时间线、Argo 和文献；
6. 在地图上开启探针并点击海面位置；
7. 如需模型分析，打开账户设置并配置模型 API；
8. 打开 Agent 工作台，使用“快速检索”或“深度研判”。

### 4. 常用地址

| 功能 | 地址 |
| --- | --- |
| 本地生产应用 | `http://127.0.0.1:8000/` |
| 后端健康检查 | `http://127.0.0.1:8000/api/health` |
| Codex runtime 状态（登录后） | `http://127.0.0.1:8000/api/codex-runtime/status` |
| FastAPI 文档 | 一键生产模式关闭；仅手动开发模式开放 |

---

## 四、账户、登录与模型配置

### 1. 开发与生产认证差异

- 本地开发默认可使用 `AUTH_REQUIRED=false`，便于直接查看工作台；
- Windows 一键入口属于本地生产模式，固定使用 `AUTH_REQUIRED=true`；
- 生产 Compose 固定启用认证；
- 生产账户、会话和模型配置存入 PostgreSQL；
- 用户模型 API 密钥使用 `ENCRYPTION_KEY` 加密后保存；
- Agent 会话、记忆、浮标关注列表和 Codex 租户上下文按用户隔离。

### 2. 注册

注册需要：

- 显示名称：1–80 个字符；
- 合法电子邮箱；
- 密码：8–128 个字符。

注册成功后系统立即创建会话。注册和登录都执行同源校验与尝试次数限制；频繁失败会返回 `429`，应等待 `Retry-After` 指示的秒数。

### 3. 登录与退出

- 登录成功后浏览器保存 HttpOnly 会话 Cookie；
- 修改配置、退出、写入记忆等写操作需要 CSRF Token；
- 前端会自动处理 CSRF Token 轮换；
- 使用脚本调用写接口时，需要同时发送 Cookie 和 `X-CSRF-Token`；
- 会话默认有效期由 `SESSION_TTL_SECONDS` 控制。

### 4. 配置模型 API

打开“账户与模型 API 设置”，选择：

- `openai`：OpenAI 兼容预设；
- `deepseek`：DeepSeek 兼容预设；
- `custom`：自定义 HTTPS 模型网关。

需要填写或选择：

- 服务商；
- API Base URL；
- API Key；
- API 模式：`responses` 或 `chat_completions`；
- 模型名称。

建议先执行“发现模型”，再执行“测试连接”，最后保存。自定义 Base URL 必须使用 HTTPS，不能包含用户名、密码、查询参数或 URL Fragment。

### 5. 未配置模型时

内置海洋数据 Agent 仍可使用本地检索和规则化回答；依赖外部模型的解释或复杂生成会显示模型不可用、降级或本地检索状态。Codex 工作台还要求本机或容器内存在可执行的 Codex CLI。

---

## 五、主工作台完整操作说明

### 1. 页面布局

主工作台通常由以下区域组成：

- 顶部命令栏：品牌、区域、指标、搜索、主题、账户和工作台入口；
- 左侧事件队列：筛选、排序和选择观测/信号/事件；
- 中央地图：底图、事件、浮标、坐标探针和海流场；
- 右侧详情：选中事件的概览、观测、证据、时间线、Argo、解释和文献；
- Agent 面板：内置数据 Agent 或 Codex 线程工作区。

桌面宽屏优先使用停靠布局。较窄窗口会切换为流式布局。左右面板可隐藏、显示或拖动调整宽度。

### 2. 区域选择

切换区域后，系统会重新加载工作区快照，包括：

- 区域事件列表；
- 事件统计；
- 数据覆盖；
- 来源健康；
- Argo 区域快照；
- Copernicus 全局或区域索引状态；
- 观测汇总。

切换期间旧请求会被取消，避免不同区域的数据互相覆盖。

### 3. 搜索与命令面板

“查找海洋信息”可用于过滤或定位当前工作区记录。命令面板提供快捷操作：

- 打开最高优先级事件；
- 显示全部事件类型；
- 打开账户与模型设置；
- 切换明暗视觉主题；
- 打开区域观测概览；
- 显示或隐藏事件队列；
- 显示或隐藏事件详情；
- 直接打开证据或文献视图。

### 4. 事件队列筛选

队列支持按以下维度查看：

- 全部记录；
- 普通观测；
- 异常信号；
- 调查事件；
- 事件类型；
- 严重度；
- 文本关键词。

如果持久化 Copernicus 事件索引还有更多数据，可继续加载下一页。分页加载不会重复加入已有事件。

### 5. 刷新数据

普通页面加载优先使用缓存。需要强制更新时可点击刷新：

- 同步刷新：等待本次区域刷新完成；
- 后台刷新任务：立即返回任务编号，再轮询任务状态；
- 接口中的 `refresh=true`：绕过对应模块缓存；
- 不要高频强制刷新，以免触发上游限流或增加 Copernicus 下载量。

### 6. 来源健康和覆盖率

来源健康区应重点查看：

- 来源名称和当前状态；
- 最近成功时间；
- 数据模式；
- 延迟或缓存年龄；
- 错误和降级原因；
- 区域、变量和时间覆盖。

当结论依赖的来源处于降级状态时，应降低结论强度，并在报告中保留这一限制。

### 7. 视觉主题与显示偏好

平台提供浅蓝和深色潮汐主题。主题、面板折叠状态、宽度、事件视图和详情标签等偏好保存在浏览器本地存储中。清除站点数据后这些偏好会重置。

---

## 六、事件调查完整流程

### 1. 打开事件

在事件队列中选择记录后，右侧详情加载完整事件。建议先确认：

- 事件编号、标题、类型和状态；
- 所属区域、中心坐标和影响半径；
- 首次发现、最后更新和观测时间；
- 当前严重度、置信度和数据模式。

### 2. 核对观测

观测页通常展示：

- 变量名称与标准单位；
- 当前值、参考基线和异常值；
- 原始值或调整值模式；
- 样本数、有效样本数和缺失比例；
- QC 通过率；
- 空间支持、持续时间和数据延迟。

必须先核对单位和时间，再比较异常幅度。不要把不同深度、不同产品或不同时间分辨率的数据直接混为一组。

### 3. 阅读证据链

证据视图用于回答“当前判断依赖什么”。每条证据应能追溯到来源、时间、位置、变量或分析步骤。建议按以下顺序检查：

1. 原始或调整后的观测值；
2. 基线及其时间范围；
3. QC 和缺失情况；
4. 邻域或空间支持；
5. 持续性；
6. 独立来源是否一致；
7. Argo 是否提供垂向支持或反证；
8. 自动解释是否超出证据范围。

### 4. 时间线

时间线记录事件从发现、筛查、证据增加、状态变化到结束的过程。它适合用于复盘：

- 哪个来源首先触发候选；
- 何时增加第二来源；
- 为什么状态发生变化；
- 是否存在长时间未更新；
- 结论是否建立在过期数据上。

### 5. 自动解释与科学报告

- “解释”面向快速阅读，说明可能机制、证据和限制；
- “报告”是结构化事件输出，适合归档或后续加工；
- 外部模型不可用时，系统可能退回本地解释；
- 模型输出不能替代原始数据和人工复核；
- 报告中必须保留数据时间、来源、单位、不确定性和降级信息。

### 6. 文献依据

事件文献接口根据事件变量、区域和主题查询 OpenAlex / Crossref 等元数据源。文献结果用于提供研究背景，不自动证明当前事件。阅读时应核对：

- 论文是否研究相同海域；
- 时间尺度和空间尺度是否可比；
- 变量和观测方法是否一致；
- DOI、作者、发表年份和来源是否完整；
- 文献中的机制是否只是可选假设。

### 7. 事件确认建议

只有在以下条件多数满足时，才适合提高状态或置信度：

- QC 合格且样本量足够；
- 异常相对稳健基线显著；
- 时间上具有持续性；
- 空间上不是单像元或边缘伪影；
- 至少一个独立来源提供支持；
- Argo、现场或其他垂向资料没有明显反证；
- 数据延迟、缺失和上游错误已被说明；
- 人工复核确认单位、坐标、时间和物理解释合理。

---

## 七、Argo 浮标与坐标探针

### 1. 使用坐标探针

1. 在地图工具中开启海面坐标探针；
2. 点击目标海面位置；
3. 系统解析海域、地理背景和水深；
4. 查询目标点附近最近的 Argo 浮标；
5. 查看平台编号、距离、位置、Cycle、时间和变量；
6. 打开完整浮标快照、历史或自动解释。

纬度通常限制在海洋数据服务支持范围内；部分接口将有效纬度限制为 `-80` 到 `80`。

### 2. 浮标快照

浮标快照可包含：

- 平台编号；
- 最近位置和观测时间；
- Cycle / Profile 信息；
- 温度、盐度、压力和可用 BGC 变量；
- 原始值、调整值和 QC；
- 数据提供者和缓存状态；
- 自动生成的剖面解释。

### 3. 浮标历史

历史接口按日期或 Cycle 返回多次剖面，用于比较：

- 混合层变化；
- 温跃层或盐跃层位置；
- 表层和次表层异常是否同步；
- 浮标漂移路径；
- 数据是否存在时间断档。

`date_count` 应设置为满足研究问题的最小值，避免一次获取过多历史记录。

### 4. 事件关联 Argo

事件详情的 Argo 视图根据事件中心、影响半径、区域边界和候选平台寻找附近浮标。距离近不代表直接验证，仍需比较：

- 观测时间差；
- 水平距离；
- 深度是否匹配；
- 变量是否匹配；
- 来源是否独立；
- 浮标 QC 是否通过。

### 5. 关注浮标

登录用户可以启用或停用浮标关注。关注列表属于个人账户，不会自动公开给其他用户。

---

## 八、海洋数据 Agent 与 Codex 工作台

平台包含两类互补的智能工作区。

### 1. 内置海洋数据 Agent

内置 Agent 通过 `/api/agent/chat` 工作，支持：

- `quick`：快速检索，适合查记录、来源、变量和状态；
- `research`：深度研判，适合跨来源比较、证据审查和报告草拟。

提问时建议明确四个要素：海域、时间、变量、目标。例如：

```text
比较南海最近 7 天海温异常与附近 Argo 温盐剖面是否一致，并列出时间差、距离、QC 和限制。
```

避免只问“这里怎么了”。模糊问题会导致检索范围过宽、结果冗长或依赖默认区域。

### 2. 会话管理

- 新建会话时可绑定区域和选中事件；
- 会话保存标题、摘要、消息数和更新时间；
- 可以重命名、归档、恢复查看或删除；
- 默认消息历史窗口有限，长期研究应把稳定偏好写入记忆；
- 删除会话是持久化操作，执行前确认不再需要。

### 3. 长期记忆

记忆分为：

- `preference`：回答偏好；
- `instruction`：长期操作要求；
- `focus`：持续关注的海域、变量或课题。

记忆内容最长 500 字，可设置置信度、启用或停用。只保存稳定、明确、可长期复用的信息，不要把临时数据值或未经验证的结论写成长期记忆。

### 4. Codex 工作台

Codex sidecar 提供：

- 新建和选择 Codex 线程；
- 模型与推理强度选择；
- 流式运行状态；
- Ocean MCP 工具调用轨迹；
- 文件和报告生成；
- 线程恢复与用户隔离。

本地使用前应确认：

```text
http://127.0.0.1:8011/api/codex-runtime/status
```

如果状态接口提示找不到 Codex，请安装 Codex CLI，或通过 `OCEAN_CODEX_BIN` 指定可执行文件。

### 5. 推荐分析链

一个完整区域报告通常应：

1. 解析用户文本中的海域；
2. 建立区域中心点和九区网格；
3. 获取工作区快照、来源健康和覆盖率；
4. 查询所需 Copernicus 数据集；
5. 获取 Argo 或其他点观测；
6. 做九区点位盘点和统计诊断；
7. 做异常点位关联；
8. 在输入充分时做物理诊断；
9. 区分事实、统计结果、机制假设和新闻背景；
10. 生成带来源、单位、时间和限制的报告。

### 6. 高质量提问示例

```text
总结西北太平洋当前处于 screening 的高严重度异常。每条列出变量、当前值、基线、异常值、样本数、QC、最近更新时间和不能确认的原因。
```

```text
以 120°E–125°E、18°N–23°N 为范围建立九区网格，统计可用 Argo 平台和 Copernicus 风浪记录，并比较九区覆盖差异。
```

```text
为当前选中事件生成研究简报。必须区分直接观测、统计推断、物理机制假设和文献背景，不得把新闻作为海洋证据。
```

---

## 九、每日海洋简报

### 1. 内容

每日简报可包含：

- 当日生成和发布时间；
- 全球或主要区域态势；
- 重点异常与事件；
- Argo 活跃情况；
- 数据来源状态；
- Copernicus 产品量或索引状态；
- 可追溯元数据和限制。

### 2. 调度

生产默认按 `Asia/Shanghai` 调度：

- `08:00` 生成；
- `09:00` 发布；
- 后台轮询间隔默认 30 秒。

具体时间由 `DAILY_BRIEF_TIME_ZONE`、`DAILY_BRIEF_GENERATE_HOUR`、`DAILY_BRIEF_PUBLISH_HOUR` 和 `DAILY_BRIEF_POLL_SECONDS` 控制。

### 3. 查看方式

```http
GET /api/daily-briefing
GET /api/daily-briefing?date=2026-08-29
GET /api/daily-briefing/dashboard
GET /api/daily-briefing/dashboard?refresh=true
```

### 4. Webhook

设置 `DAILY_BRIEF_WEBHOOK_URL` 后，可把发布结果交给企业微信、钉钉、飞书或自建消息桥。Webhook 目标应支持 HTTPS、鉴权和失败重试；不要把内网敏感数据发送到未经批准的第三方地址。

---

## 十、数据来源、数据模式与可信度

### 1. 主要来源

| 来源 | 主要用途 |
| --- | --- |
| Argovis / Argo | 浮标目录、最近浮标、完整温盐深与 BGC 剖面 |
| NOAA CoastWatch ERDDAP | SST、误差、海冰、海色和质量字段 |
| Copernicus Marine | 海流、风、浪、历史点位、目录和全球产品数据量 |
| OpenAlex / Crossref | 事件相关文献元数据 |
| GEBCO 等水深服务 | 点位水深和局地地形 |
| FAO / ASFIS、本地索引 | 渔业、生物和物种背景 |
| 离线海洋图谱 | 海、海峡、海湾等百科和检索 |
| 中国大陆公开媒体 | 报告中的新闻背景，不作为海洋观测证据 |

### 2. 缓存

系统对实时来源使用 TTL 缓存，以降低延迟和上游压力。`refresh=true` 只应在确有必要时使用。缓存响应应保留：

- 抓取时间；
- 缓存年龄；
- 数据提供者；
- 是否实时获取；
- 上次错误；
- 当前降级说明。

### 3. 科学使用边界

- 单点异常不能代表整个海域；
- 模式分析和卫星产品不能自动替代现场观测；
- 附近 Argo 浮标只有在时间、距离、深度和变量匹配时才可能构成直接支持；
- 新闻、百科和人文背景不能作为异常确认依据；
- 自动生成的机制解释必须标注为解释或假设；
- 业务决策、航行安全、生态执法或灾害预警应使用主管部门正式数据。

---

## 十一、本地安装与启动

### 1. 环境要求

| 软件 | 最低建议版本 | 用途 |
| --- | ---: | --- |
| Python | 3.11+ | FastAPI、数据处理、测试 |
| Node.js | 20+ | 前端与 Codex sidecar |
| npm | 随 Node.js | 安装前端依赖 |
| Codex CLI | 一键入口必需 | Codex 工作台 |
| Git | 可选 | 版本管理 |

NetCDF、PyArrow、NumPy 等依赖由 `backend/requirements.txt` 安装。

### 2. 后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Windows 激活：

```powershell
.\.venv\Scripts\Activate.ps1
```

### 3. 前端

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

开发模式下 Vite 把普通 `/api` 请求代理到 `8000`，Codex runtime 请求代理到 `8011`。

### 4. Codex sidecar

在项目根目录运行：

```bash
node codex-runtime/server/index.mjs
```

常用本地变量：

```bash
export OCEAN_CODEX_HOST=127.0.0.1
export OCEAN_CODEX_PORT=8011
export OCEAN_CODEX_WORKSPACE="$PWD"
export OCEAN_CODEX_MCP_URL=http://127.0.0.1:8000/api/codex/mcp
export OCEAN_CODEX_BIN=/path/to/codex
```

### 5. 天地图

复制配置并填写浏览器端密钥：

```dotenv
VITE_TIANDITU_TOKEN=你的天地图密钥
VITE_API_ROOT=
```

公网生产构建必须配置天地图密钥，并在天地图控制台限制允许使用的生产域名。Windows 一键本地生产构建使用 `local-production` 模式；未配置天地图密钥时使用仓库内标准地图和离线边界数据，不影响公网生产要求。

---

## 十二、环境变量参考

### 1. 站点与部署

| 变量 | 是否必需 | 说明 |
| --- | --- | --- |
| `SITE_HOST` | 生产必需 | 对外域名 |
| `SITE_ADDRESS` | direct 模式必需 | Caddy 站点地址 |
| `SITE_ORIGIN` | 生产建议 | 完整站点 Origin |
| `DEPLOY_TRANSPORT` | 是 | `direct` 或 `tunnel` |
| `TUNNEL_TOKEN` | tunnel 必需 | Cloudflare Tunnel Token |
| `VITE_TIANDITU_TOKEN` | 公网生产必需；本地可选 | 浏览器端天地图密钥；本地 `local-production` 无此值时使用仓库内标准地图 |
| `DEPLOY_HEALTH_TIMEOUT_SECONDS` | 否 | 发布健康检查超时，默认 180 秒 |

### 2. 数据库与认证

| 变量 | 说明 |
| --- | --- |
| `POSTGRES_DB` | 数据库名，默认 `ocean_intelligence` |
| `POSTGRES_USER` | 数据库用户，默认 `ocean` |
| `POSTGRES_PASSWORD` | 强随机数据库密码 |
| `DATABASE_URL` | 后端数据库连接串，Compose 自动生成 |
| `ENCRYPTION_KEY` | 用户 API Key 和租户令牌加密密钥 |
| `AUTH_REQUIRED` | 是否强制登录 |
| `SESSION_COOKIE_SECURE` | HTTPS 生产环境应为 `true` |
| `SESSION_TTL_SECONDS` | 会话有效期，生产示例为 2592000 秒 |
| `ALLOWED_ORIGINS` | 允许的额外认证 Origin，逗号分隔 |
| `TRUST_PROXY_HEADERS` | 是否信任反向代理来源地址 |
| `AUTH_REGISTER_ATTEMPTS` | 注册限流次数 |
| `AUTH_REGISTER_WINDOW_SECONDS` | 注册限流窗口 |
| `AUTH_LOGIN_ATTEMPTS` | 登录限流次数 |
| `AUTH_LOGIN_WINDOW_SECONDS` | 登录限流窗口 |

生成数据库密码：

```bash
openssl rand -hex 32
```

生成 Fernet 格式加密密钥：

```bash
python3 -c "import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
```

### 3. Copernicus Marine

| 变量 | 说明 |
| --- | --- |
| `COPERNICUSMARINE_USERNAME` | Copernicus Marine 用户名 |
| `COPERNICUSMARINE_PASSWORD` | Copernicus Marine 密码 |
| `COPERNICUSMARINE_WAVE_DATASET_ID` | 波浪产品 ID |
| `COPERNICUSMARINE_WIND_DATASET_ID` | 风产品 ID |
| `COPERNICUSMARINE_CURRENT_DATASET_ID` | 海流产品 ID |
| `COPERNICUSMARINE_CURRENT_ARCO_URL` | 海流 ARCO 数据地址覆盖 |
| `COPERNICUSMARINE_CURRENT_U_VARIABLE` | 东向流速变量名 |
| `COPERNICUSMARINE_CURRENT_V_VARIABLE` | 北向流速变量名 |
| `COPERNICUSMARINE_POINT_CACHE_TTL_SECONDS` | 点查询缓存 TTL |
| `COPERNICUSMARINE_CURRENT_CACHE_TTL_SECONDS` | 海流场缓存 TTL |
| `COPERNICUSMARINE_GLOBAL_VOLUME_CACHE_TTL_SECONDS` | 全球数据量缓存 TTL |
| `COPERNICUS_DAILY_TARGET` | 每日索引目标记录数 |

默认产品 ID 以 `deploy/production.env.example` 为准。Copernicus 产品可能发生版本变化，升级前应先验证产品 ID、变量名、时间维度和授权范围。

### 4. 实时任务与每日简报

| 变量 | 说明 |
| --- | --- |
| `REALTIME_CACHE_TTL_SECONDS` | 区域实时缓存 TTL |
| `ARGO_REALTIME_INTERVAL_SECONDS` | Argo 实时任务间隔 |
| `ARGO_REALTIME_REGIONS` | 实时轮询区域 |
| `ARGO_REALTIME_SAMPLE_LIMIT` | 单轮样本限制 |
| `EVENT_TYPE_RECORD_TARGET` | 事件类型目标记录数 |
| `DAILY_BRIEF_TIME_ZONE` | 简报调度时区 |
| `DAILY_BRIEF_GENERATE_HOUR` | 生成小时 |
| `DAILY_BRIEF_PUBLISH_HOUR` | 发布时间 |
| `DAILY_BRIEF_POLL_SECONDS` | 调度轮询间隔 |
| `DAILY_BRIEF_WEBHOOK_URL` | 可选发布 Webhook |

### 5. Codex runtime

| 变量 | 说明 |
| --- | --- |
| `OCEAN_CODEX_HOST` | sidecar 监听地址 |
| `OCEAN_CODEX_PORT` | sidecar 端口，默认 `8011` |
| `OCEAN_CODEX_WORKSPACE` | Codex 工作目录 |
| `OCEAN_CODEX_BIN` | Codex 可执行文件路径 |
| `OCEAN_CODEX_MCP_URL` | Ocean MCP 地址 |
| `OCEAN_CODEX_MCP_TOKEN` | MCP Bearer Token |
| `OCEAN_CODEX_TENANT_SECRET` | 用户租户令牌签名密钥 |
| `OCEAN_CODEX_RUNTIME_ROOT` | runtime 状态目录覆盖 |
| `OCEAN_TIME_ZONE` | 报告与任务时区 |

### 6. MCP 治理

| 变量 | 默认示例 | 说明 |
| --- | ---: | --- |
| `OCEAN_MCP_SNAPSHOT_TTL_SECONDS` | 1800 | 数据快照 TTL |
| `OCEAN_MCP_TOOL_TIMEOUT_SECONDS` | 45 | 单工具超时 |
| `OCEAN_MCP_MAX_RESPONSE_BYTES` | 8388608 | 最大响应字节数 |
| `OCEAN_MCP_RATE_WINDOW_SECONDS` | 60 | 限流窗口 |
| `OCEAN_MCP_RATE_CALLS` | 120 | 窗口调用次数 |
| `OCEAN_MCP_TENANT_CONCURRENCY` | 4 | 单租户并发 |
| `OCEAN_MCP_TOOL_CONCURRENCY` | 8 | 全局工具并发 |
| `OCEAN_MCP_JOB_WORKERS` | 4 | 后台作业工作线程 |
| `OCEAN_MCP_SOURCE_SNAPSHOT_MAX_RECORDS` | 200000 | 来源快照记录上限 |

---

## 十三、HTTP API 使用手册

### 1. 通用约定

- API 前缀为 `/api`；
- 开发环境可直接访问 `http://127.0.0.1:8000`；
- 生产环境通常与前端同域；
- 时间使用 ISO 8601；
- 经纬度顺序为 `longitude, latitude`；
- 错误通常返回 `{"detail": "..."}`；
- 上游数据失败通常返回 `502`；
- 未登录返回 `401`，CSRF 失败返回 `403`；
- 参数校验失败返回 `422`；
- 登录限流返回 `429`。

### 2. 认证调用示例

注册并保存 Cookie：

```bash
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"change-me-123","display_name":"研究员"}' \
  http://127.0.0.1:8000/api/auth/register
```

读取会话与 CSRF Token：

```bash
curl -b cookies.txt http://127.0.0.1:8000/api/auth/session
```

写接口需添加返回的 CSRF Token：

```bash
curl -b cookies.txt -X POST \
  -H 'X-CSRF-Token: <token>' \
  http://127.0.0.1:8000/api/auth/logout
```

### 3. 状态与区域

| 方法 | 路径 | 主要参数 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/health` | 无 | 健康检查 |
| GET | `/api/regions` | 无 | 区域列表 |
| GET | `/api/metrics` | `region` | 区域指标 |
| GET | `/api/observations/summary` | `region` | 区域观测汇总 |
| GET | `/api/event-stats` | `region` | 事件计数 |
| GET | `/api/event-lifecycle` | `region` | 生命周期记录 |
| GET | `/api/data-coverage` | `region` | 数据覆盖 |
| GET | `/api/sources` | `region`, `context` | 来源健康 |
| GET | `/api/performance` | 无 | 进程内性能与错误指标 |

### 4. 工作区与刷新

| 方法 | 路径 | 主要参数 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/workspace/snapshot` | `region`, `refresh`, `compact` | 一次获取工作台主要数据 |
| POST | `/api/refresh` | `region` | 同步刷新区域 |
| POST | `/api/refresh/jobs` | `region` | 创建后台刷新任务 |
| GET | `/api/refresh/jobs/{job_id}` | 路径参数 | 查询刷新任务 |

示例：

```bash
curl 'http://127.0.0.1:8000/api/workspace/snapshot?region=global_ocean&compact=true'
```

### 5. 观测、信号与事件

| 方法 | 路径 | 主要参数 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/events` | `event_type`, `min_severity`, `region`, `mode`, `kind`, `refresh` | 综合记录列表 |
| GET | `/api/signals` | `region`, `event_type`, `min_severity`, `refresh` | 异常信号 |
| GET | `/api/observations` | `region`, `variable`, `min_severity`, `refresh` | 普通观测 |
| GET | `/api/events/{event_id}` | 路径参数 | 事件详情 |
| GET | `/api/events/{event_id}/timeline` | 路径参数 | 时间线 |
| GET | `/api/events/{event_id}/report` | 路径参数 | 结构化报告 |
| GET | `/api/events/{event_id}/explanation` | `refresh` | 自动解释 |
| GET | `/api/events/{event_id}/literature` | `refresh` | 文献元数据 |
| GET | `/api/events/{event_id}/argo` | `platform`, `refresh` | 事件附近 Argo |
| POST | `/api/detect` | JSON 检测请求 | 运行异常检测 |

### 6. Argo

| 方法 | 路径 | 主要参数 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/argo/float/{platform}` | `refresh` | 浮标最新快照 |
| GET | `/api/argo/float/{platform}/explanation` | `refresh` | 浮标解释 |
| GET | `/api/argo/float/{platform}/history` | `date_count`, `refresh` | 浮标历史 |
| GET | `/api/argo/region` | `region`, `refresh` | 区域浮标快照 |
| GET | `/api/argo/nearest` | `longitude`, `latitude`, `region`, `platform`, `refresh`, `include_context` | 最近浮标和点位上下文 |
| GET | `/api/argo/realtime/status` | 无 | 实时 Argo 任务状态 |

示例：

```bash
curl 'http://127.0.0.1:8000/api/argo/nearest?longitude=121.5&latitude=22.2&include_context=true'
```

### 7. 海洋背景和知识

| 方法 | 路径 | 主要参数 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/marine/context` | `longitude`, `latitude`, `refresh` | 海域、人文地理、渔业背景 |
| GET | `/api/marine/bathymetry` | `longitude`, `latitude`, `refresh` | 水深与局地地形 |
| GET | `/api/marine/knowledge` | `longitude`, `latitude`, `refresh` | 海洋知识卡片 |
| GET | `/api/marine/atlas` | `query`, `limit` | 离线海洋图谱检索 |

### 8. Copernicus Marine

| 方法 | 路径 | 主要参数 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/copernicus/waves/point` | `longitude`, `latitude`, `days` | 点位波浪 |
| GET | `/api/copernicus/wind/point` | `longitude`, `latitude`, `days` | 点位海面风 |
| GET | `/api/copernicus/currents/field` | `west`, `south`, `east`, `north`, `width`, `height`, `refresh` | 海流矢量场 |
| GET | `/api/copernicus/global/daily-volume` | `refresh` | 当日全球格点记录量 |
| GET | `/api/copernicus/history/point` | `source`, `longitude`, `latitude`, `limit`, `offset`, `sync` | 波浪或风历史分页 |
| GET | `/api/copernicus/events/page` | `cursor`, `limit`, `view`, `area`, `geography` | 持久化事件索引分页 |
| GET | `/api/copernicus/index/status` | 无 | 每日索引状态 |

海流场范围允许跨日期变更线，宽度限制为 24–160，高度限制为 16–120。历史点位 `limit` 最大 5000。

### 9. 每日简报

| 方法 | 路径 | 主要参数 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/daily-briefing` | `date` | 指定日期简报与调度信息 |
| GET | `/api/daily-briefing/dashboard` | `refresh` | 每日态势仪表板 |

### 10. 内置 Agent

| 方法 | 路径 | 主要参数或请求体 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/agent/context` | `region`, `context` | Agent 上下文清单 |
| GET | `/api/agent/model-health` | `context` | 模型可用性 |
| POST | `/api/agent/chat` | `region_id`, `question`, `selected_event_id`, `session_id`, `remember`, `analysis_mode`, `history` | 提问 |
| GET | `/api/agent/sessions` | `region`, `include_archived`, `limit` | 会话列表 |
| POST | `/api/agent/sessions` | `region_id`, `title`, `selected_event_id` | 新建会话 |
| GET | `/api/agent/sessions/{session_id}` | 路径参数 | 会话详情 |
| PATCH | `/api/agent/sessions/{session_id}` | `title`, `archived` | 修改会话 |
| DELETE | `/api/agent/sessions/{session_id}` | 路径参数 | 删除会话 |
| GET | `/api/agent/memories` | `region`, `include_disabled`, `limit` | 记忆列表 |
| POST | `/api/agent/memories` | `kind`, `content`, `region_id`, `confidence` | 新建记忆 |
| PATCH | `/api/agent/memories/{memory_id}` | `content`, `enabled`, `confidence` | 修改记忆 |
| DELETE | `/api/agent/memories/{memory_id}` | 路径参数 | 删除记忆 |

提问示例：

```bash
curl -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"region_id":"global_ocean","question":"列出当前高严重度异常及其证据限制","analysis_mode":"research","remember":false}' \
  http://127.0.0.1:8000/api/agent/chat
```

### 11. 账户 API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/auth/session` | 当前会话和 CSRF Token |
| GET | `/api/auth/csrf` | 轮换 CSRF Token |
| POST | `/api/auth/logout` | 退出 |
| GET | `/api/account/provider-presets` | 模型服务商预设 |
| GET | `/api/account/api-config` | 已保存模型配置，不返回明文密钥 |
| PUT | `/api/account/api-config` | 保存模型配置 |
| POST | `/api/account/api-config/test` | 测试模型连接 |
| POST | `/api/account/api-config/models` | 发现模型 |
| DELETE | `/api/account/api-config` | 删除模型配置 |
| GET | `/api/account/monitored-buoys` | 关注浮标列表 |
| PUT | `/api/account/monitored-buoys/{platform}` | 用 `enabled=true/false` 设置关注状态 |

---

## 十四、Ocean MCP 使用手册

详细协议和实现说明还可参阅 `docs/codex-mcp.md` 与 `docs/MCP_IMPLEMENTATION.md`。

### 1. 连接

MCP 地址：

```text
http://127.0.0.1:8000/api/codex/mcp
```

生产环境应设置 `OCEAN_CODEX_MCP_TOKEN`，客户端通过 Bearer Token 访问。GET 可用于能力和状态检查，POST 用于 JSON-RPC，DELETE 用于关闭会话或清理对应连接状态。

### 2. 推荐工具组

**区域与空间**

`ocean_list_regions`、`ocean_resolve_marine_area`、`ocean_region_nine_zone_grid`、`ocean_nine_zone_point_inventory`、`ocean_coordinate_nearest`

**上下文与检索**

`ocean_context_manifest`、`ocean_search_records`、`ocean_data_catalog`、`ocean_data_schema`、`ocean_data_page`、`ocean_data_search`、`ocean_data_changes`、`ocean_data_aggregate`

**事件与产品状态**

`ocean_get_event`、`ocean_event_catalog`、`ocean_event_lifecycle`、`ocean_event_report`、`ocean_event_explanation`、`ocean_event_literature`、`ocean_product_health`、`ocean_product_metrics`、`ocean_observation_summary`、`ocean_source_health`

**Argo**

`ocean_get_argo_profile`、`ocean_argo_float_history`、`ocean_argo_region`、`ocean_argo_nearest`、`ocean_event_argo`、`ocean_argo_explanation`、`ocean_argo_realtime_status`

**Copernicus**

`ocean_copernicus_catalog_search`、`ocean_copernicus_dataset_describe`、`ocean_copernicus_dataset_analyze`、`ocean_copernicus_wave_point`、`ocean_copernicus_wave_region`、`ocean_copernicus_wave_audit`、`ocean_copernicus_wind_point`、`ocean_copernicus_wind_region`、`ocean_copernicus_history`、`ocean_copernicus_audit`、`ocean_current_field`、`ocean_copernicus_global_daily_volume`、`ocean_copernicus_event_page`、`ocean_copernicus_indexed_events`、`ocean_copernicus_index_status`

**科学计算**

`ocean_detect_anomaly`、`ocean_statistical_diagnostics`、`ocean_anomaly_point_linkage`、`ocean_physics_diagnostics`

**海洋背景**

`ocean_marine_context`、`ocean_marine_knowledge`、`ocean_bathymetry`、`ocean_marine_atlas`、`ocean_atlas_entry`、`ocean_mainland_news`

**简报、工作区与刷新**

`ocean_workspace_snapshot`、`ocean_daily_briefing`、`ocean_daily_dashboard`、`ocean_refresh`、`ocean_refresh_job_submit`、`ocean_refresh_job_status`

**Agent、会话与记忆**

`ocean_agent_context`、`ocean_agent_model_health`、`ocean_agent_chat`、`ocean_agent_sessions`、`ocean_agent_session_get`、`ocean_agent_session_create`、`ocean_agent_session_update`、`ocean_agent_session_delete`、`ocean_memories`、`ocean_memory_search`、`ocean_memory_store`、`ocean_memory_update`、`ocean_memory_delete`

**后台任务与导出**

`ocean_job_submit`、`ocean_job_status`、`ocean_job_result_page`、`ocean_job_cancel`、`ocean_batch_points_submit`、`ocean_export_submit`、`ocean_export_result`

**治理与审计**

`ocean_source_catalog`、`ocean_source_data_page`、`ocean_audit_page`、`ocean_performance`、`ocean_mcp_coverage`

### 3. 标准 JSON-RPC 示例

列出工具：

```bash
curl -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  http://127.0.0.1:8000/api/codex/mcp
```

调用区域列表：

```bash
curl -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ocean_list_regions","arguments":{}}}' \
  http://127.0.0.1:8000/api/codex/mcp
```

### 4. 长任务和导出

耗时分析应使用异步作业：

1. `ocean_job_submit` 提交允许的工具和参数；
2. `ocean_job_status` 查询状态；
3. 完成后用 `ocean_job_result_page` 分页读取；
4. 不再需要时可用 `ocean_job_cancel` 请求取消。

批量坐标最多 500 个点，可组合执行海域解析、海洋上下文、水深、最近 Argo、知识、波浪或风查询。

导出支持：`csv`、`geojson`、`ndjson`、`parquet`、`netcdf`。导出完成后用 `ocean_export_result` 按偏移和字节上限分块读取。

### 5. MCP 使用原则

- 先解析海域，再查询数据；
- 区域报告先建立九区网格；
- 目录中未知的数据集先搜索、再描述、后分析；
- 对统计结果保留样本数、缺失、权重和时间间隔；
- 物理诊断只在输入充分时执行，不得虚构梯度、密度、混合层深度或尺度；
- 新闻只能标为背景；
- `ocean_memory_store` 是显式写入，应只在用户明确要求记忆时调用；
- 使用 `ocean_audit_page` 和 `ocean_mcp_coverage` 检查调用范围与审计记录。

---

## 十五、生产部署

### 1. 推荐环境

- Ubuntu 22.04；
- Docker Engine 与 Docker Compose Plugin；
- 受控域名；
- Cloudflare Tunnel，或公网 80/443 端口；
- 至少满足 PostgreSQL、FastAPI、Node sidecar 和缓存任务的资源；
- 独立备份目录和日志保留策略。

完整公网部署步骤见 `deploy/UBUNTU_22_04.md`。

### 2. 创建生产配置

```bash
cp deploy/production.env.example deploy/production.env
chmod 600 deploy/production.env
```

至少替换：

- `SITE_HOST`、`SITE_ADDRESS`、`SITE_ORIGIN`；
- `VITE_TIANDITU_TOKEN`；
- `POSTGRES_PASSWORD`；
- `ENCRYPTION_KEY`；
- `OCEAN_CODEX_MCP_TOKEN`；
- tunnel 模式下的 `TUNNEL_TOKEN`；
- **必须填写** Copernicus Marine 账户信息；实时海流、风、浪和全球数据量功能依赖该账号。

### 3. 选择网络模式

**Cloudflare Tunnel：**

```dotenv
DEPLOY_TRANSPORT=tunnel
TUNNEL_TOKEN=真实Token
```

不需要直接开放 80/443，但 Cloudflare Tunnel 必须把公开主机名转发到应用。

**Caddy 直连：**

```dotenv
DEPLOY_TRANSPORT=direct
SITE_ADDRESS=ocean.example.com
```

服务器需开放 80/443，并确保 DNS 指向服务器。Caddy 自动处理 HTTPS。

### 4. 执行发布

```bash
./deploy/deploy.sh
```

或指定配置文件：

```bash
./deploy/deploy.sh /secure/path/production.env
```

发布脚本会：

1. 校验配置和 transport；
2. 保存当前镜像作为回滚镜像；
3. 校验 Compose；
4. 构建生产镜像；
5. 记录镜像摘要；
6. 在可用时生成 SBOM 和 Trivy 漏洞报告；
7. 启动数据库、应用、Codex runtime 和入口服务；
8. 等待应用与 runtime 健康；
9. 失败时尝试回滚上一镜像。

### 5. 服务检查

```bash
docker compose --env-file deploy/production.env -f compose.prod.yaml --profile tunnel ps
docker compose --env-file deploy/production.env -f compose.prod.yaml logs -f app
docker compose --env-file deploy/production.env -f compose.prod.yaml logs -f codex-runtime
```

direct 模式把 `--profile tunnel` 改为 `--profile direct`。

### 6. 运行 Copernicus 每日索引

索引器位于 `jobs` profile：

```bash
docker compose --env-file deploy/production.env -f compose.prod.yaml --profile jobs run --rm copernicus-indexer
```

也可以安装 `deploy/copernicus-daily-index.cron` 或调用 `scripts/run-copernicus-daily-index.sh` 建立定时任务。

---

## 十六、运维、备份、恢复与升级

### 1. PostgreSQL 备份

```bash
./deploy/backup-postgres.sh
```

默认输出到：

```text
backups/postgres/ocean-<UTC时间>.sql.gz
```

可设置：

```bash
export BACKUP_DIR=/secure/backups/ocean
export BACKUP_RETENTION_DAYS=30
./deploy/backup-postgres.sh
```

### 2. 恢复 PostgreSQL

恢复前应停止写流量并额外备份当前数据库：

```bash
gunzip -c backups/postgres/ocean-YYYYMMDDTHHMMSSZ.sql.gz | \
docker compose --env-file deploy/production.env -f compose.prod.yaml exec -T database \
psql -U ocean ocean_intelligence
```

如果自定义了 `POSTGRES_USER` 或 `POSTGRES_DB`，同步替换命令参数。恢复后重启应用并检查登录、会话、模型配置和 Agent 数据。

### 3. 需要备份的非数据库数据

除 PostgreSQL 外，还应按需要备份：

- `agent_runtime` 卷：Agent / MCP 状态；
- `realtime_cache` 卷：实时和 Copernicus 缓存；
- `.runtime/`：本地线程和运行时状态；
- `generated/`：用户生成报告；
- `audits/`：镜像摘要、SBOM 和漏洞报告；
- `deploy/production.env`：应加密离线保存，不应进入源码仓库。

### 4. 日志

Compose 默认使用 Docker 日志。常用命令：

```bash
docker compose --env-file deploy/production.env -f compose.prod.yaml logs --since=1h app
docker compose --env-file deploy/production.env -f compose.prod.yaml logs --tail=200 database
docker compose --env-file deploy/production.env -f compose.prod.yaml logs --tail=200 cloudflared
```

排障时同时记录 UTC 时间、请求路径、用户操作、区域、事件编号和上游来源。

### 5. 升级

建议流程：

1. 备份 PostgreSQL、运行时卷和生产配置；
2. 阅读变更并检查环境变量新增项；
3. 在预发布环境构建；
4. 运行后端测试、前端构建和关键 Playwright 测试；
5. 执行 `deploy/deploy.sh`；
6. 检查健康、登录、工作区、Agent、MCP 和外部来源；
7. 观察日志和性能指标；
8. 出现严重问题时使用脚本保留的回滚镜像恢复。

### 6. 密钥轮换

- PostgreSQL 密码轮换需同步数据库和应用连接；
- `OCEAN_CODEX_MCP_TOKEN` 轮换需同时更新应用和 runtime；
- `ENCRYPTION_KEY` 直接更换会导致已加密的用户模型密钥无法解密，应先实施迁移；
- 天地图和 Copernicus 密钥轮换后应清理旧凭据并验证域名限制；
- 泄露后不要只删除日志，应立即吊销原密钥。

---

## 十七、开发、构建与测试

### 1. 后端测试

```bash
cd backend
python -m pytest -q
```

指定测试：

```bash
python -m pytest tests/test_api.py -q
python -m pytest tests/test_auth.py -q
python -m pytest tests/test_codex_mcp.py -q
python -m pytest tests/test_argo_nearest.py -q
```

### 2. 前端构建

```bash
cd frontend
npm install
npm run build
```

生产构建前设置：

```bash
export VITE_TIANDITU_TOKEN=真实密钥
npm run build
```

### 3. 前端端到端测试

首次安装浏览器：

```bash
cd frontend
npx playwright install chromium
```

运行全部测试：

```bash
npx playwright test
```

运行单个测试：

```bash
npx playwright test tests/probe-ui.spec.ts
```

Playwright 配置会启动或复用 `http://127.0.0.1:5173/`。

### 4. Codex runtime 测试

```bash
node --test codex-runtime/server/*.test.mjs
```

### 5. 生产镜像构建

```bash
docker build \
  --build-arg VITE_TIANDITU_TOKEN="$VITE_TIANDITU_TOKEN" \
  -t ocean-intelligence:production .
```

### 6. 修改 API 后的检查清单

- 更新 Pydantic 请求/响应模型；
- 更新前端 `api.ts` 或 `codexApi.ts`；
- 更新本手册 API 表；
- 检查认证与 CSRF；
- 检查 MCP 是否需要增加覆盖；
- 增加或更新测试；
- 验证错误状态和降级显示。

---

## 十八、安全与合规

### 1. 密钥安全

- 不要提交 `deploy/production.env`、API Key、数据库密码或 Tunnel Token；
- 生产配置权限应为 `600`；
- 模型 API Key 只通过账户设置或受控环境变量配置；
- API 返回不会显示已保存密钥明文；
- 导出文件、日志和错误堆栈不得包含密钥。

### 2. Cookie、CSRF 与同源策略

- 生产使用 HTTPS 和 `SESSION_COOKIE_SECURE=true`；
- 写请求必须携带有效 CSRF Token；
- 不要在第三方页面跨域嵌入登录接口；
- 使用反向代理时只在可信代理环境启用 `TRUST_PROXY_HEADERS`；
- `ALLOWED_ORIGINS` 只加入确需访问的 HTTPS Origin。

### 3. 地图合规

中国大陆及台湾省相关地图展示应使用符合业务要求的底图、边界与中文注记。生产环境使用受域名限制的天地图浏览器密钥，不应把诊断性后备地图当作正式发布底图。

### 4. 数据与结论合规

- 保留来源署名、许可和数据时间；
- 不把模型输出包装成官方预警；
- 不把新闻或百科作为观测证据；
- 对敏感业务数据实施最小权限、租户隔离和审计；
- 对外发布前进行人工科学复核与合规复核。

---

## 十九、常见问题与故障排查

### 1. 前端打不开

检查：

```powershell
Invoke-WebRequest http://127.0.0.1:8000/ -UseBasicParsing
```

然后检查 Python/Node.js 版本、`.runtime/backend.err.log`、`.runtime/codex.err.log`，以及 `8000/8011` 端口是否被其他程序占用。`5173` 只用于手动开发模式，不应出现在一键生产链路中。

### 2. 页面打开但 API 全部失败

```bash
curl http://127.0.0.1:8000/api/health
```

如果失败，检查 Python 虚拟环境、依赖安装、8000 端口和后端日志。如果直接访问生产镜像，确认 FastAPI 已包含前端构建目录。

### 3. 页面没有实时数据

依次检查：

1. `/api/sources` 的来源状态；
2. `/api/data-coverage` 的覆盖范围；
3. 是否正在使用缓存或情景数据；
4. 上游网络、DNS 和代理；
5. Copernicus 账户和产品 ID；
6. 是否被上游限流；
7. 强制刷新后是否返回 `502`。

### 4. 地图没有真实海流动画

- 检查当前视窗是否在支持纬度内；
- 检查 `/api/copernicus/currents/field`；
- 确认海流产品 ID 和 U/V 变量；
- 缩小地图范围或降低网格宽高；
- 查看是否显示降级海流或静态后备效果。

### 5. 天地图空白或生产构建失败

- 确认 `VITE_TIANDITU_TOKEN` 在构建阶段设置；
- 确认密钥允许当前域名；
- 检查浏览器网络请求和 Referer 限制；
- 修改密钥后必须重新构建前端，而不只是重启容器。

### 6. 登录后仍返回 401

- 检查浏览器是否保存 Cookie；
- 生产必须通过 HTTPS；
- 检查 `SESSION_COOKIE_SECURE`；
- 检查域名、反向代理和站点 Origin；
- 检查服务器时间是否正确；
- 检查 PostgreSQL 是否持久化并可写。

### 7. 写操作返回 403

通常是 CSRF 或 Origin 问题：

- 重新调用 `/api/auth/session` 或 `/api/auth/csrf`；
- 同时发送会话 Cookie 和 `X-CSRF-Token`；
- 确认请求 Origin 与站点一致；
- 不要复用过期 Token。

### 8. Agent 只能返回本地检索

- 检查账户模型配置；
- 执行模型发现和连接测试；
- 确认 Base URL 使用 HTTPS；
- 确认模型名称存在且 API Key 有权限；
- 查看 `/api/agent/model-health`；
- 检查供应商额度、限流和网络。

### 9. Codex 工作台不可用

检查：

```bash
curl http://127.0.0.1:8011/api/codex-runtime/status
```

然后确认：

- `node codex-runtime/server/index.mjs` 正在运行；
- `OCEAN_CODEX_BIN` 指向有效 Codex；
- `OCEAN_CODEX_MCP_URL` 可访问；
- 生产中的 `OCEAN_CODEX_MCP_TOKEN` 两端一致；
- runtime 对工作区和 `.runtime` 有正确权限。

### 10. MCP 返回 401、429 或超时

- `401`：检查 Bearer Token；
- `429`：降低调用频率或检查租户并发；
- 超时：缩小空间、时间、变量和记录范围，或改用后台作业；
- 响应过大：使用分页、快照或导出；
- 用 `ocean_audit_page` 检查被拒绝或失败的调用。

### 11. Copernicus 历史查询很慢

- 首次 `sync=true` 需要同步完整可用历史；
- 后续使用 `limit` 和 `offset` 分页；
- 避免同时对大量点执行同步；
- 批量任务使用 `ocean_batch_points_submit` 或后台作业；
- 为常用点保留缓存。

### 12. Docker 发布健康检查失败

```bash
docker compose --env-file deploy/production.env -f compose.prod.yaml ps
docker compose --env-file deploy/production.env -f compose.prod.yaml logs --tail=300 app
docker compose --env-file deploy/production.env -f compose.prod.yaml logs --tail=300 codex-runtime
```

重点检查数据库健康、缺失环境变量、前端构建密钥、镜像源、目录权限和 Codex 可执行文件挂载。

---

## 二十、目录与持久化数据说明

| 路径 | 内容 | 是否建议纳入备份 |
| --- | --- | --- |
| `backend/app/` | FastAPI、数据客户端、Agent 和业务模型 | 是，源码仓库 |
| `backend/tests/` | 后端测试 | 是，源码仓库 |
| `backend/.cache/` | 本地实时与数据缓存 | 视恢复目标而定 |
| `frontend/src/` | React 前端 | 是，源码仓库 |
| `frontend/tests/` | Playwright 测试 | 是，源码仓库 |
| `codex-runtime/server/` | Codex sidecar 和报告规范 | 是，源码仓库 |
| `docs/` | 项目文档 | 是，源码仓库 |
| `deploy/` | 部署脚本、Caddy、生产配置示例 | 脚本是；真实密钥文件单独加密备份 |
| `scripts/` | 索引、审计、素材和辅助脚本 | 是，源码仓库 |
| `.runtime/` | 本地 Agent / MCP / Codex 状态 | 是，如需保留会话和任务 |
| `generated/` | 生成的报告和结果 | 是 |
| `artifacts/` | 演示、截图、数据产物 | 按业务需要 |
| `audits/` | 镜像摘要、SBOM、漏洞扫描 | 是 |
| `backups/` | 数据库和项目备份 | 是，并复制到异机 |

### 最终建议

日常使用时始终遵循以下顺序：**先看来源健康，再看观测和 QC；先确认时间、位置、深度和单位，再讨论异常；先区分直接证据和背景信息，再形成结论。**

