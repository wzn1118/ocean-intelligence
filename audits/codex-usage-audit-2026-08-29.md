# Codex 云服务器使用审计

> 生成时间：2026-08-29T00:57:29+00:00；数据源：`/root/.codex/sessions/**/*.jsonl` 和项目源码。

## 核心统计

- 用户指令事件：**391 条**（非空 390 条，规范化后不同文本 324 条）。
- 会话文件：**76 个**；唯一会话 ID：**76 个**；任务索引记录：**45 条**。
- 时间范围：**2026-08-27T13:58:30.278Z** 至 **2026-08-29T00:57:17.738Z**。
- 工具调用记录：**6097 次**；任务开始 348 次，完成 320 次，中止 22 次。
- 结构化补丁：**113 次**，成功 113 次；涉及 75 个不同文件。

## 每日指令量

- 2026-08-27：95 条
- 2026-08-28：288 条
- 2026-08-29：8 条

## 工作目录分布

- `/opt/ocean-intelligence`：356 条
- `/workspace`：22 条
- `/workspace/.runtime/codex-users/d72f6312385430b5ee6ece30b855bb80`：5 条
- `/workspace/.runtime/codex-users/7584a35d06e54d4319d81b7c441174bc`：1 条
- `/workspace/.runtime/codex-users/c42340fb5679b5cba167f28163ee69d0`：1 条
- `/workspace/.runtime/codex-users/90943dbfb470a4beb8dbfb5acc4c4e51`：1 条
- `/workspace/.runtime/codex-users/87c69efa139badfcf1d04a66dc3ebd7b`：1 条
- `/opt/ocean-intelligence/.runtime/codex-users/3facc29d9246fd0ca1f9f734b829f697`：1 条
- `/opt/ocean-intelligence/.runtime/codex-users/4fd4296716d1f2c863e735047c040b71`：1 条
- `/opt/ocean-intelligence/.runtime/codex-users/fdc8f5e48d21bd4ab4f92d59da522086`：1 条
- `/opt/ocean-intelligence/.runtime/codex-users/ed08c7b31bab0e8bac6cc212ffb61d0a`：1 条

## 高频主题（关键词命中，可重叠）

- Codex：91 条
- 数据：81 条
- Copernicus：42 条
- 风：27 条
- 报告：23 条
- 浮标：21 条
- 前端：19 条
- Argo：17 条
- 海流：14 条
- 地图：13 条
- 简报：13 条
- 界面：13 条
- 台湾：12 条
- 速度：9 条
- 服务器：8 条
- 用户：8 条
- 内存：8 条
- 导出：6 条
- Agent：5 条
- 登录：4 条
- 测试：4 条
- 存储：4 条
- 部署：3 条
- 备份：2 条
- 天地图：2 条
- 队列：1 条
- 碳：1 条

## 工具动作

- `exec_command`：3715 次
- `write_stdin`：1416 次
- `update_plan`：643 次
- `web_search`：98 次
- `exec`：51 次
- `view_image`：44 次
- `ocean_intelligence__ocean_copernicus_wind_point`：20 次
- `ocean_intelligence__ocean_search_records`：13 次
- `ocean_intelligence__ocean_memory_search`：10 次
- `ocean_memory_search`：9 次
- `ocean_intelligence__ocean_context_manifest`：8 次
- `ocean_intelligence__ocean_copernicus_catalog_search`：7 次
- `close_agent`：6 次
- `ocean_intelligence__ocean_get_event`：6 次
- `ocean_intelligence__ocean_copernicus_dataset_analyze`：6 次
- `ocean_intelligence__ocean_source_health`：5 次
- `ocean_intelligence__ocean_copernicus_wind_region`：4 次
- `ocean_get_event`：3 次
- `ocean_intelligence__ocean_copernicus_audit`：3 次
- `spawn_agent`：2 次
- `ocean_context_manifest`：2 次
- `ocean_copernicus_wind_region`：2 次
- `read_thread_terminal`：2 次
- `ocean_copernicus_catalog_search`：2 次
- `ocean_copernicus_dataset_describe`：2 次
- `ocean_intelligence__ocean_copernicus_dataset_describe`：2 次
- `ocean_search_records`：2 次
- `open_in_codex`：2 次
- `ocean_copernicus_wave_point`：1 次
- `ocean_intelligence__ocean_list_regions`：1 次
- `ocean_copernicus_wind_point`：1 次
- `ocean_intelligence__ocean_copernicus_wave_audit`：1 次
- `list_mcp_resources`：1 次
- `list_mcp_resource_templates`：1 次
- `ocean_list_regions`：1 次
- `ocean_source_health`：1 次
- `ocean_copernicus_audit`：1 次
- `list_projects`：1 次
- `list_threads`：1 次
- `ocean_intelligence__ocean_copernicus_wave_region`：1 次

## Shell 动作类别（可重叠）

- 包含 apply_patch：700 次
- Docker Compose：556 次
- 构建命令：273 次
- HTTP/下载检查：259 次
- 测试命令：218 次
- Git 命令：110 次
- 服务运维命令：10 次

## 代码改动

- 变更条目：219；新增 42；更新 177。
- 改动次数最多的文件：
  - `/opt/ocean-intelligence/frontend/src/components/CodexAgentSurface.tsx`：20 次
  - `/opt/ocean-intelligence/frontend/src/components/OceanMap.tsx`：14 次
  - `/opt/ocean-intelligence/backend/app/data/realtime_service.py`：13 次
  - `/opt/ocean-intelligence/frontend/src/App.tsx`：12 次
  - `/opt/ocean-intelligence/codex-runtime/server/index.mjs`：11 次
  - `/opt/ocean-intelligence/backend/app/data/copernicus_client.py`：11 次
  - `/opt/ocean-intelligence/frontend/src/styles.css`：10 次
  - `/opt/ocean-intelligence/README.md`：9 次
  - `/opt/ocean-intelligence/frontend/src/codexApi.ts`：7 次
  - `/opt/ocean-intelligence/frontend/src/api.ts`：6 次
  - `/opt/ocean-intelligence/backend/app/copernicus_daily_collect.py`：6 次
  - `/opt/ocean-intelligence/frontend/src/types.ts`：5 次
  - `/opt/ocean-intelligence/compose.prod.yaml`：5 次
  - `/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs`：5 次
  - `/opt/ocean-intelligence/backend/app/agents/codex_mcp.py`：4 次
  - `/opt/ocean-intelligence/backend/app/copernicus_daily_index.py`：4 次
  - `/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.test.mjs`：4 次
  - `/opt/ocean-intelligence/frontend/src/components/EventQueue.tsx`：3 次
  - `/opt/ocean-intelligence/backend/app/main.py`：3 次
  - `/opt/ocean-intelligence/backend/app/data/copernicus_universal.py`：2 次
  - `/opt/ocean-intelligence/frontend/src/components/ExplorerHome.tsx`：2 次
  - `/opt/ocean-intelligence/backend/app/models.py`：2 次
  - `/opt/ocean-intelligence/backend/app/data/regions.py`：2 次
  - `/opt/ocean-intelligence/backend/tests/test_api.py`：2 次
  - `/opt/ocean-intelligence/frontend/src/components/CurrentFieldLayer.tsx`：2 次

## 已落地功能（源码与 README 可验证）

- 多源海洋数据接入：Argo、NOAA、Copernicus Marine、文献与海洋知识数据。
- Copernicus 海流、风浪、历史点位、每日索引、全球数据量统计、缓存和降级链路。
- Argo 浮标地图、浮标列表、最近浮标、剖面调查、质量控制与数据导出。
- 每日海洋智能简报，将 Argo 与 Copernicus 数据组织为可追溯报告。
- 中国标准地图、天地图底图、南海要素、中文注记、海流粒子动画和坐标探针。
- 观测、异常候选、事件档案、证据链、时间线、不确定性和报告解释。
- Codex 海洋数据 Agent：线程、流式轨迹、Ocean MCP、记忆隔离和报告质量约束。
- 登录、Session、CSRF、用户/线程隔离、PostgreSQL 持久化与生产同源访问。
- Docker Compose、Caddy/HTTPS、Ubuntu 部署、备份、缓存、性能指标和自动化测试。

## 明细

- 全部指令逐条清单：`/opt/ocean-intelligence/audits/codex-instructions-2026-08-29.csv`。
- CSV 中疑似密钥和邮箱已遮盖；原始记录仍保留在 Codex 本地会话文件中。
- 统计是日志事件审计，不等于计费请求数；分支、重试和后台任务会增加会话与工具调用记录。
