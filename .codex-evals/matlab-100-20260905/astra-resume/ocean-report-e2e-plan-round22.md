# R22: 真实海区报告端到端验收缺口与下一项

## 结论

1. **当前 CI 报告是合成基准 Markdown + JSON，不是产品 HTML 报告，也不生成 DOCX。** 四张图的原生数值绑定不能替代真实海区取数、HTML 交互、产品状态接口或完整科学报告验收。
2. **生产还有一处直接接线缺口**: `reports/status` 没有调用 `inspectIllustratedReportEvidence`。它使用另一套正文/图表质量检查，MATLAB 和点交互检查还有条件开关。新报告证据合约的单元测试通过，不代表产品 `complete` 已受该合约约束。
3. **有可做有限历史回放的真实来源数据候选，但没有现成命令能完成真实海区全报告验收。** 最适合下一项的是现存 Argo 三剖面原始响应，单位、逐层 QC、时间、坐标都在；先做固定输入回放接线，不要把它扩写成九区全变量完整结论，也不要替换现有合成 fixture。

范围: 只读代码、现有 CI 隔离包和公开数据缓存；仅新增本文件。没有启动模型、调用生产 MCP、修改用户 generated 文件、重建报告、下载数值数据或提交。没有重复 HTML parser 审计。

## 1. 当前 CI 到底交付什么

2026-09-06 00:32 UTC 查询 [CI 34001173593](https://github.com/wzn1118/ocean-intelligence/actions/runs/34001173593) 为 `in_progress`，head 为 `7d51e714a23442e7a132d257d1ec94c91c6dd669`，不能提前宣布本轮产物已生成或通过。通过 GitHub contents API 只读核对了该 head 的 builder、shell 和 workflow，三份内容均与本地实读源码一致；本地 HEAD 为 `587c382a7155c265abb82137b6e5ce47717b8de0`。

实际链路:

```text
matlab-full100.yml
  -> run_github_full100 / run_matlab_gate
  -> evaluator-runtime/{figures.json,matlab-runtime.json,fixture-inputs/,四图PNG/PDF/SVG}
  -> inspect_rendered_artifacts.py
  -> build_ocean_report.py
  -> evaluator-runtime/report.md + report-evidence.json
```

[matlab-github-full100.sh:120](/opt/ocean-intelligence/scripts/matlab-github-full100.sh:120) 依次执行 evaluator、外部图件检查、报告 builder。[build_ocean_report.py:25](/opt/ocean-intelligence/codex-runtime/matlab/evals/build_ocean_report.py:25) 固定两个输出名；[build_ocean_report.py:1823](/opt/ocean-intelligence/codex-runtime/matlab/evals/build_ocean_report.py:1823) 写入并原子替换这两个文件，不生成 HTML/DOCX。本轮没有运行这个会写文件的 builder。

builder 是**专用合成验收消费者**，不是通用海区报告生成器: [build_ocean_report.py:1111](/opt/ocean-intelligence/codex-runtime/matlab/evals/build_ocean_report.py:1111) 要求 `synthetic=true`；[build_ocean_report.py:1377](/opt/ocean-intelligence/codex-runtime/matlab/evals/build_ocean_report.py:1377) 只接受三个固定 fixture ID/文件名及其科学设计。[build_ocean_report.py:1749](/opt/ocean-intelligence/codex-runtime/matlab/evals/build_ocean_report.py:1749) 明确输出 `synthetic_benchmark`、`production_data=false`、无命名海区/经纬度。不能通过 `--fixture-dir` 塞入实测数据后仍称其为真实报告。

已存在的上一轮隔离实包 `/tmp/matlab-run-34000171748` 提供了以下实物对照:

| Release | report.md bytes | Markdown 标题数 | evaluator 图/导出 | 整个 release 包 HTML / DOCX |
| --- | ---: | ---: | --- | --- |
| R2021a | 14618 | 14 | 4 图，12 件 PNG/PDF/SVG | 0 / 0 |
| R2024b | 14619 | 14 | 4 图，12 件 PNG/PDF/SVG | 0 / 0 |
| R2026a | 13523 | 14 | 4 图，12 件 PNG/PDF/SVG | 0 / 0 |

三包 `report-evidence.json.status=passed` 的范围都是 `local_fixture_statistics_and_manifest_artifact_consistency`。本轮用只读公开 `inspectReportQuality` 检查原有 Markdown 和不存在的 `report.html`，字节/标题/HTML/图族等均不能满足产品阈值；用 `inspectIllustratedReportEvidence` 读取原包也明确失败: HTML/claim/figure 为零，缺 `ocean_report`、`matlab_ci` 和每图 `scientific_context`。这些是**不同消费者的契约差异**，不把专用 builder 按其自身设计成功误报为错误。

## 2. 产品完整路径与差距

### 生产路径

- [index.mjs:403](/opt/ocean-intelligence/codex-runtime/server/index.mjs:403): `POST /api/codex-runtime/threads/:id/turns` 的 `outputMode=illustrated_report` 创建文件契约，将说明拼到输入后交给 `browser.request('turn/start')`。它不是直接执行 CI builder 的确定性报告任务。
- [index.mjs:753](/opt/ocean-intelligence/codex-runtime/server/index.mjs:753): 模型收到优先使用 ocean MCP 的指令；取数、绘图、写 HTML/Markdown 仍由代理执行，没有看到一条已经连接并实跑的“冻结真实 snapshot -> MATLAB -> 产品报告”的生产流水线。
- [illustrated-report-contract.mjs:46](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:46): 必须生成 `generated/<reportId>.html`、`generated/<reportId>.md`，视觉资产必须用 `<reportId>-visual-` 前缀。DOCX 不在此产品契约内。
- [index.mjs:169](/opt/ocean-intelligence/codex-runtime/server/index.mjs:169): `GET /api/codex-runtime/reports/status` 先检查 tenant 对 thread 的所有权，再检查约定文件和质量，返回 `complete/artifacts/missingPaths/quality`。
- [CodexAgentSurface.tsx:781](/opt/ocean-intelligence/frontend/src/components/CodexAgentSurface.tsx:781): UI 依据 status 显示核验结果；失败时可以再启动一次 high-effort 修复模型轮次。因此无模型回放验收应直接请求隔离 status，不点击这条会自动补跑模型的工作流。
- 另一个 [codex_mcp.py:1280](/opt/ocean-intelligence/backend/app/agents/codex_mcp.py:1280) 的 `ocean_event_report` 调用 `ReportGenerationAgent.create`，返回事件级 `ScientificReport` JSON。这也不是命名海区 HTML/DOCX 生成器。

### 确切缺口

| 产品要求 | 当前 CI 报告还缺什么 |
| --- | --- |
| HTML + Markdown，20 个视觉资产，24 个分析 figure，10 种图型，28 个标题，18KB Markdown / 32KB HTML | 没有 HTML；只有 4 个合成科学图，跨格式导出不能当作 12 个独立分析图；文件名也不满足 reportId 契约 |
| 15 条分析、9 条量化比较、15 个证据标记；空间/时间图各至少 3，剖面/方向/不确定性各至少 2，物理图至少 3 | 合成报告不具有九区空间观测、风浪流生态多变量或现实物理诊断输入；不能补造数值满足图位 |
| 命名海区、范围来源、分析中心、九区及点位/QC/时效审计 | fixture 明确没有水平坐标；输入窗口不连续，没有真实海区或独立平台清单 |
| 同 snapshot 的 PNG/PDF 和至少一份完整离线 point HTML，稳定 ID、hover/focus、科学上下文 | native `paired-interactive` 是 MATLAB 图及 batch 回调断言，只导出 PNG/PDF/SVG，不是浏览器交互 HTML |
| 每图 `scientific_context` 与主 HTML 对应，报告 `ocean_report`，三版 `matlab_ci`，真实产物/视觉证据 | CI manifest 的主要科学字段是 `scientific_data_contract`，不是产品报告 schema；没有三版聚合为同一真实报告的过程，且现有视觉状态不得提升 |

阈值依据 [illustrated-report-contract.mjs:19](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:19) 和 [report-quality.mjs:18](/opt/ocean-intelligence/codex-runtime/server/report-quality.mjs:18)。很多正文规则允许如实说明数据缺口，但固定的图位/图族数量仍不能靠缺口段落自动满足。

**接线缺口须独立处理**: status 在 [index.mjs:206](/opt/ocean-intelligence/codex-runtime/server/index.mjs:206) 调用 `inspectReportQuality`，只有发现 tenant generated 根目录中的 `figures.json` 或 `.m` 才调用 `inspectMatlabPlotQuality`；只有匹配到指定 HTML 才执行 point 检查。源码没有生产调用 `inspectIllustratedReportEvidence`；`complete` 在 [index.mjs:297](/opt/ocean-intelligence/codex-runtime/server/index.mjs:297) 仅由累计 `missingPaths` 决定。应让生产所有者把已有严格证据检查器纳入 status 的必需条件，并测“缺 manifest/缺交互 HTML/缺报告科学上下文不得 complete”；这不是本轮修改任务。

此外，status 使用 tenant 级公共 `figures.json` 和两层 `.m` 扫描，而不是独立 report 目录。最小验收必须使用**新隔离 tenant/generated 根**，否则不能明确将这些文件归属到当前 report；这里只指出验收隔离依赖，没有据此断言现有用户报告已经串包。

## 3. MCP snapshot 不能直接充当报告输入证据

实际可用的工具及边界:

| 入口 | 能提供什么 | 验收必须补的绑定 |
| --- | --- | --- |
| `ocean_resolve_marine_area` / `ocean_region_nine_zone_grid` | 名称/坐标选区、九区框 | 明确选区优先级和分析框；不能把抽样包的 region_id 当作精确海区几何 |
| `ocean_context_manifest` / `ocean_data_catalog` / `ocean_source_catalog` | 区域状态、计数、集合字段 | 是发现入口，不是永久冻结且逐值校验的 MATLAB 输入 |
| `ocean_data_page` / `ocean_source_data_page` | 一致分页、snapshot ID、data_version、signed cursor | 保存全部页与原始 metadata，验证总数/游标终止，另做文件 SHA-256、行身份和导入语义 |
| `ocean_export_submit` / `ocean_export_result` | CSV/GeoJSON/NDJSON/Parquet/NetCDF | 数据导出，不生成报告 HTML/DOCX、图件 manifest 或 MATLAB 原生读取证明 |
| `ocean_statistical_diagnostics` / `ocean_physics_diagnostics` | 有明确输入时的统计/物理计算 | 必须保存工具参数、有效样本与结果；不能为了章节补造风、密度梯度或不确定度 |

代码支撑与执行限制:

- [codex_mcp.py:1236](/opt/ocean-intelligence/backend/app/agents/codex_mcp.py:1236) 的 workspace `snapshot_id` 是 `region_id:refreshed_at`；[mcp_infrastructure.py:209](/opt/ocean-intelligence/backend/app/agents/mcp_infrastructure.py:209) 的分页 snapshot 是持久库 UUID、绑定 owner/region/dataset。两者不可混用。
- [codex_mcp.py:1499](/opt/ocean-intelligence/backend/app/agents/codex_mcp.py:1499) 保证的是单个 dataset snapshot 的分页一致性，默认 TTL 为 1800 秒；各 dataset 不会因 region 相同自动组成原子跨变量快照。冻结报告输入需要另外记录每源有效时间、版本、页集合和哈希。
- `_page_metadata` 的有效时间、null 数是当前页扫描结果，不是完整原始产品 QC 分母。来源缓存可能已经过滤/抽样。[noaa_currents_client.py:78](/opt/ocean-intelligence/backend/app/data/noaa_currents_client.py:78) 会去掉非有限数和速度大于 5 的点，原始被过滤数没有保存在点清单里，不能把保留下来的有限数解释成原产品 `missing=0/QC rejected=0`。
- [codex_mcp.py:1546](/opt/ocean-intelligence/backend/app/agents/codex_mcp.py:1546) 首次 source 读取会调用源 loader。`limit=1` 只约束分页返回，不保证上游只下载一条；`refresh=false` 也不是 offline-only，缓存过期仍可能联网。carbon/WOA 首次建源快照还可能循环取至 200000 行上限。
- MCP 模块导入即构造持久状态对象；`get_snapshot` 也会执行 cleanup。为遵守本轮只读，没有导入/调用 backend 运行态、没有使用生产 token、没有创建 snapshot 或 export job。

## 4. 已核对的数据候选

### 首选: 南大西洋局部 Argo 历史回放

文件 [argo-4903822-30d.json](/tmp/argo-4903822-30d.json)，58061 bytes，SHA-256:

```text
33959a0d9296cf3d0739375d0d551550d493dddbe3aa8cc3606b67ac7df0b7fa
```

这是现存 Argovis/Argo 响应形状的数据文件，记录包含 Ifremer profile 源 URL、上游更新时间、原始 `data_info` 和数值数组，不是本轮生成的样本。逐值只读核对结果:

| Profile | UTC 时间 | 经度 / 纬度 | 原返回层数 |
| --- | --- | --- | ---: |
| 4903822_067 | 2026-08-27T04:54:30.000Z | -12.79532 / -54.679433333333336 | 595 |
| 4903822_066 | 2026-08-17T09:52:30.000Z | -12.436848333333334 / -54.64378 | 596 |
| 4903822_065 | 2026-08-07T14:51:30.000Z | -12.260258333333333 / -54.85381 | 594 |

合计 **1 平台、3 剖面、1785 层记录**，不是 1785 个独立平台。每个剖面内 pressure 严格递增；pressure/temperature/salinity 同长，三变量无 null/非有限值，三套逐层 QC 全部为 1，时间和位置 QC 也为 1。单位明确为 `decibar`、`degree_Celsius`、`psu`，原 `data_keys_mode=A` 必须保留，不擅自改为 raw/potential/conservative。pressure 总范围 2.9-1997.900024 decibar；文件没有不确定度数组、风、浪、流或独立验证平台。

建议分析框 `[-13,-55,-12,-54]`，名称仅写“南大西洋局部分析框”，不用它假冒已经解析通过的命名海域边界；区域工具可用 `global_ocean` 加显式分析框。时间覆盖是三次非连续采样，不是连续 20 日时间序列。原文件按 067/066/065 排列，任何时间升序显示都必须另保留明确排列映射。

**重要现成能力边界**: [matlab-plot-router.mjs:868](/opt/ocean-intelligence/codex-runtime/server/matlab-plot-router.mjs:868) 对 pressure profile 明确返回未解决需求；[oi_plot_profile.m:86](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_profile.m:86) 固定使用 Depth 标签。不要把 decibar 当 m 绕过此门禁。最小图先用现成 [oi_plot_ts_diagram.m:28](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_ts_diagram.m:28)，T/S 原值作坐标，pressure 只作为明确 `ColorLabel/ColorUnit` 的颜色变量；不加密度等值线、不做压力转深度、不拼接异长剖面为共用深度矩阵。这是可用 API 方案，未宣称本数据已在 MATLAB 绘制。

数据真值边界: 文件内来源声明和本地哈希支持可复现的归档回放，但不是上游签名。本轮对最新 profile 的 Ifremer HTTPS HEAD 请求失败，尚未独立重取/比对上游数值；原获取请求/响应收据也未随这份文件找到。正式“真实来源已核验”还需补原收据或经批准的小量上游核对，不能把本次本地读取时间填成历史上游抓取时间。

### 南海候选与排除项

同一分析框 `[110,10,120,20]` 内只读筛选现存 NOAA 缓存:

| 文件 / 产品 | 现有数据 | 不能承诺的内容 |
| --- | --- | --- |
| [currents 缓存](/opt/ocean-intelligence/backend/.cache/noaa_currents/northwest_pacific.json)，`noaacwBLENDEDNRTcurrentsDaily` | 全包 679 点，框内 20 个有限 u/v 对，2026-08-25T00:00:00Z；抓取时间 2026-08-28T01:43:18Z | 抽样、过滤后的归一化缓存，无原列单位/QC 分母；不是原位流速观测，也无连续时间窗 |
| [chlorophyll 缓存](/opt/ocean-intelligence/backend/.cache/noaa_chlorophyll/observations/northwest_pacific.json)，`noaacwNPPN20VIIRSDINEOFDaily` | 全包 1020 点，框内 29 点，2026-08-25T12:00:00Z | 不凭目录名 observations 认证原位/原始数据级别；需核验该具体产品处理级别、单位和掩膜。与 currents 相差 12 小时，不能当同期共址配对 |
| [chlorophyll anomaly 缓存](/opt/ocean-intelligence/backend/.cache/noaa_chlorophyll/northwest_pacific.json) | 框内 0 点，包的有效时刻为 2026-08-18T12:00:00Z | 零返回不代表该海区无异常，也不能补为零异常值 |

对两个 NOAA 产品官方 ERDDAP `info/.../index.json` 的低量元数据请求均返回 HTTP 403，未获得本轮单位/处理级别确认。因此南海缓存可列为候选，**不优先于单位/QC 更完整的 Argo 回放**。没有追加数值下载或绕过访问限制。

`/tmp/ws-south_china_sea`、`/tmp/ws-indian_ocean`、`/tmp/compact-global_ocean.json` 实际都是 36-byte `authentication required`，不是数据快照；`/tmp/copernicus-smoke/latest-points.json` 是 8 次请求全部失败、events 为空的记录，也不能用作已获风浪输入。

## 5. 下一项: 固定 Argo 输入的最小报告回放接线

**下一项应是一个明确的新实现任务，而不是重跑现有合成 builder**: 建立独立的离线真实来源候选 replay 入口，首个输入锁定上述 Argo 文件和 SHA-256；先做一张 T-S 图及对应主 HTML/Markdown/离线点视图，不追求 20 图、24 图位或满分。当前仓库没有这条现成入口，不能给出一个假装已可运行的 builder 命令。

工作与完成条件按执行顺序限定如下:

1. **输入归档与归一化**: 仅在新隔离目录复制已批准输入，输出输入清单和逐层记录映射。ID 使用可逆的 `profile_id + 原始层行号`，声明是本地派生身份；保留源 profile、SourceRow、UTC、经纬度、pressure/temperature/salinity、三份 QC、单位和 mode。断言 595/596/594 与合计 1785、全值逐项一致、原始顺序不变；哈希变化、单位缺失或层数组错位必须拒绝。不需要模型、网络或 MATLAB，可以先完成这部分。
2. **单图原生运行**: 新 `.m` 入口读取刚归档的输入，用已有 T-S helper 和统一 exporter 输出本次 PNG/PDF。ColorUnit 保留 decibar，uncertainty 未提供，禁止伪造置信区间和压力转深度。读取本次 Scatter 实际 XData/YData/CData、选中 mask 和对象身份，与 1785 行映射核对；输出真实 release、输入/源码/产物哈希。无 MATLAB 时只返回未执行状态，不塞入历史合成图。此步需要新隔离 licensed CI 执行，本机 `command -v matlab` 当前无结果。
3. **报告投影**: 同一归档数据生成 `<reportId>.html/.md` 和一份离线 temperature-point HTML；每点可追到温度/盐度/pressure、profile、层号、UTC、经纬度/QC，支持 hover 与键盘 focus。按产品 reportId/visual 前缀及 `scientific_context` 写真实报告 manifest，引用本次图件。源码里的 source 名称、归档读取时间、上游抓取时间未知必须区分；不得将待执行 runtime/visual 字段写 passed。
4. **状态验收**: 在独立测试 tenant/thread 和 generated 根中调用生产 `reports/status`，同时调用已有严格证据检查器。最小回放的预期是**产物可找到、数值谱系可校验、完整报告 `complete=false` 且缺项准确**；不得改全报告阈值让单图变成完整海区报告。正文/图件 hash、某条 point 的时间/单位/原值被改后要触发对应字段的新增失败，不能拿基线本来就是 `complete=false` 当作篡改拒绝证据；只篡改测试副本。缺 manifest 和缺 point HTML 也要单独覆盖，暴露目前 status 条件调用的接线问题。

这项的验收对象是“真实来源候选归档 -> 原生图 -> 浏览器点 -> 产品文件状态”的可执行链路，不是上游实时取数 E2E，也不继承合成 v3/4of4 评分。只有这些绑定和状态行为实跑后，才安排经批准的 MCP 在线取数重放；完整报告还需要实际多变量、时间/空间覆盖和视觉证据，不能通过扩写背景、复制图件或自动修复模型补齐。

### 明确依赖

| 依赖 | 当前状态 / 动作 |
| --- | --- |
| 固定真实来源候选数值 | 已有 Argo 58KB 输入，可先做离线逐值映射；正式来源核验需原收据或获准的小量上游对照 |
| 真实数据 replay 入口与 HTML/manifest 投影 | 尚未实现；须与合成 `build_ocean_report.py` 分开，不扩展固定 fixture allowlist 或评分 |
| MATLAB 原生执行 | 本机不可用；需主协调分配新隔离 CI stage，不能把正在运行的 34001173593 当作该新数据的执行证据 |
| 产品 status 强证据接线 | 当前缺失；生产所有者负责纳入现有 inspector 及缺证据负例，不涉及 parser 再审计 |
| tenant/thread 访问上下文 | 需要专门测试所有权及空 generated 根；不复用用户报告目录，不通过前端自动修复触发模型 |
| 在线 MCP 获取 | 本轮未调用；后续需要授权身份、隔离 MCP state/cache/export 目录和明确网络预算，避免默认 loader 刷新大范围数据 |

## 6. 本轮验证范围

实际执行了现有三版 CI 包的只读文件枚举、公开质量检查器读取、候选数据的 JSON 结构/逐值计数与 SHA-256、GitHub run/源码元数据读取、少量官方源元数据请求。没有启动模型、生成图、运行 MATLAB 或修改任何已有输入/产物。外部元数据请求失败已如实保留，不将数据候选提升为独立上游鉴真结果。

本轮实读关键版本指纹:

```text
58470b0edc580cec9f107ad6de80c02954a5eb1a222eb7badecc6ba2da37362e  /opt/ocean-intelligence/codex-runtime/matlab/evals/build_ocean_report.py
eb9a0e77c796306d39028700b757ef2bfc40fc1a2922f45ef5f85f6378f1901a  /opt/ocean-intelligence/codex-runtime/server/index.mjs
c2d337ebb7fbe6cea9998be2698d39c6044ae40935176eacaa26ed061e5a23a1  /opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs
2e33123bca5f0b648323dab642808d11a70e322a513de221a2ab825c336eeeb4  /opt/ocean-intelligence/backend/app/agents/codex_mcp.py
```
