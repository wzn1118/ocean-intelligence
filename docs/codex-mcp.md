# Ocean Intelligence Codex MCP

## 目标与边界

`/api/codex/mcp` 是本产品的内置 MCP Streamable HTTP JSON-RPC 入口，供项目内 Codex Runtime 以及受信任的 MCP 客户端访问海洋数据、科学诊断、事件证据、地理知识和 Agent 记忆。所有工具默认只读；唯一写入能力是显式调用 `ocean_memory_store`，且必须提供服务端签名的租户范围。

## 连接配置

Codex Runtime 通过环境变量连接：

```dotenv
OCEAN_CODEX_MCP_URL=http://app:8000/api/codex/mcp
OCEAN_CODEX_MCP_TOKEN=<随机高熵 Bearer token>
```

客户端请求必须带 `Authorization: Bearer <token>`。生产环境只允许通过私有 Docker 网络或受控反向代理访问，不要把 8000 端口直接暴露到公网。Token、数据库密码、Copernicus 密码和加密密钥必须放在 Secret Manager/部署环境中，不能提交到仓库。

## 协议面

- `initialize`：协商 MCP protocol version，返回 tools/resources/prompts/logging 能力。
- `notifications/*`、`initialized`：204，无响应体。
- `ping`：健康握手。
- `tools/list`、`tools/call`：产品工具目录和调用。
- `resources/list`、`resources/read`：产品能力、区域 manifest、波浪和风场快照。
- `prompts/list`、`prompts/get`：区域评估与事件证据审查模板。
- `logging/setLevel`：兼容性空操作。
- JSON-RPC 错误：解析错误 `-32700`、非法请求 `-32600`、未知方法 `-32601`、资源/参数错误 `-32002`。

## 工具分组

1. **产品总览**：health、metrics、observation summary、event catalog、event lifecycle、daily briefing、daily dashboard。
2. **地理与海洋知识**：marine-area resolver、marine context、marine knowledge、atlas、bathymetry、nine-zone grid、point inventory。
3. **事件与证据**：record search、event detail、source health、mainland news（明确标记为媒体上下文）。
4. **Argo**：float profile、history、regional inventory、nearest float、realtime status。
5. **Copernicus/物理海洋**：catalog search、dataset describe/analyze、wave/wind point/region/audit、history/audit、current field、physics diagnostics、global event page/index status。
6. **记忆**：memory search/store，采用 HMAC `memory\n<owner_id>` 绑定租户。

## 推荐调用链

1. `ocean_product_health` 或 `ocean_context_manifest`。
2. `ocean_resolve_marine_area`，明确用户文本地理优先级。
3. `ocean_region_nine_zone_grid`。
4. `ocean_source_health` 与 `ocean_observation_summary`，先判断数据可用性、延迟、覆盖和错误。
5. 已知数据集直接调用专用工具；未知数据集执行 `catalog_search -> dataset_describe -> dataset_analyze`。
6. 事件问题调用 `ocean_search_records -> ocean_get_event`，必要时补 Argo、风、浪、文献和历史审计。
7. `ocean_physics_diagnostics` 只使用真实输入；不能臆造梯度、密度、混合层深度、能量周期或特征尺度。
8. 输出严格区分观测、模型/再分析、派生诊断、媒体上下文和机制假设；不得把 anomaly candidate 写成 confirmed event。

## 安全与治理

- 网关层：HTTPS、IP/网络白名单、请求体大小限制、超时、限流、审计日志。
- 应用层：Bearer token 恒时比较；参数 schema 限制；区域和坐标校验；所有远程数据读取复用现有缓存/错误处理。
- 数据层：最小权限数据库账户；记忆按 owner 隔离；不返回用户 API 密钥；日志对 Authorization、Cookie、密码和完整用户内容脱敏。
- 科学治理：记录 dataset/product id、valid/fetch time、单位、空间/时间/深度范围、QC、采样和不确定性；新闻仅为上下文。
- 变更治理：MCP server version 与工具 schema 版本化；破坏性变更新增工具名或协议版本，保留旧工具至少一个发布周期。

## 验收矩阵

- 无 token：GET/POST/DELETE 均 401。
- `initialize`、`tools/list`、`resources/list`、`prompts/list` 成功。
- 非法 JSON、非法方法、未知工具、未知资源可得到 JSON-RPC 标准错误。
- 关键只读工具能在无外网缓存场景返回可解释错误，不泄露异常堆栈。
- memory store 缺少签名或签名错误必须失败；正确租户不能读取其他租户记忆。
- Codex Runtime 的 MCP status、tool call、resource read 均可完成。
- 每次发布运行后端单测、MCP 契约测试、前端构建和容器健康检查。

## 后续增强

- 引入官方 MCP SDK 的 server/transport 实现，替换当前轻量 JSON-RPC 适配层。
- 增加标准 Streamable HTTP SSE 事件通道、`Mcp-Session-Id` 生命周期和资源订阅。
- 增加 OAuth 2.1/OIDC 多租户认证、RBAC scope（read:data、run:diagnostics、write:memory）。
- 将工具注册表、schema、RBAC、审计和指标拆为独立模块；加入 OpenTelemetry trace/span。
- 增加异步长任务（Copernicus 大范围下载/分析）与 `job submit/status/cancel` 工具，避免长请求占用 HTTP 连接。

## 全量数据访问（1.6.0）

Codex 不应依赖页面上显示的某个固定数量。所有大集合均使用统一目录和分页：

- `ocean_data_catalog(region_id)`：返回聚合数据集的实时精确数量与字段。
- `ocean_data_page(region_id, dataset_id, cursor, limit, bounds...)`：分页读取事件、观测、候选、事件坐标、证据、SST 网格、Argo 浮标/剖面、来源、生命周期及全部坐标。
- `ocean_source_catalog(region_id, source)`：读取 NOAA SST、叶绿素、海流、碳、WOA 营养盐/盐度和 Argo 原始结果中的数组路径与数量。
- `ocean_source_data_page(region_id, source, collection, cursor, limit, bounds...)`：分页读取任意底层数组。
- 单页最大 `limit=1000`，因此 817 条经纬度可在一次工具调用中完整返回；更大集合按照 `next_cursor` 连续遍历。
- `ocean://regions/{region_id}/datasets` 提供同一目录的 MCP Resource 形式。

聚合数据集包括 `events`、`observations`、`anomaly_candidates`、`event_coordinates`、`event_evidence`、`sst_latest_points`、`sst_timeline`、`variable_summaries`、`argo_floats`、`argo_profiles`、`sources`、`lifecycle` 和 `all_coordinates`。

## 数据检索增强（1.7.0）

- `ocean_data_schema`：推断字段、JSON 类型、坐标能力和时间字段。
- `ocean_data_search`：同时支持全文、变量、时间区间和经纬度范围筛选。
- `ocean_coordinate_nearest`：在任意坐标数据集中按大圆距离查找最近记录。
- `ocean_data_aggregate`：对过滤后的数值字段计算完整计数、缺失数、最小值、平均值、中位数、最大值和总体标准差。
- `ocean_copernicus_global_daily_volume`、`ocean_copernicus_indexed_events`、`ocean_event_argo`、`ocean_argo_explanation`、`ocean_atlas_entry`、`ocean_performance` 补齐独立业务数据入口。
- `ocean_mcp_coverage` 返回功能覆盖与安全排除说明。
- NOAA 碳和 WOA 盐度/硝酸盐新增原始顺序分页模式；原有产品页面仍保持等距抽样，不受兼容性影响。
