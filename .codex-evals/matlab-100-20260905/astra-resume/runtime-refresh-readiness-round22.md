# R22 Runtime Refresh Readiness

只读取样窗口：2026-09-06 00:25:08-00:29:04 UTC。本文是该窗口的状态快照，不是持续监控、维护锁或后续时刻的空闲保证。

## 立即决策

**已观察到的活动 turn 为 0；全局活动 turn 数仍未严格确认，不能无条件放行安全 reload。**

当前进程唯一打开的 rollout 属于此前的隔离验收 tenant，实际运行事件最后状态为 `idle`、`activeFlags=[]`，末次 turn 为 `completed`。未发现真实用户正在执行的 turn，但现有 HTTP API 没有全局 loaded/active 清单，部分历史 thread 元数据无法读取，也没有阻止新 turn 进入的排空锁。

建议主线程先建立经批准的维护窗口，阻止所有新建、续跑及其他提交入口，再立即复核；未建立入口控制时，本报告只能提供“没有发现活动”的证据，不能提供无中断保证。本轮没有重启、发送信号、创建/恢复/中断 thread、执行生成试跑、改配置或凭据。仅写本文档。

## 已核验证据

| UTC 时间 | 取样方式 | 结果及边界 |
| --- | --- | --- |
| 00:25:08 | Docker `.State` | 容器 `ocean-intelligence-codex-runtime-1` running，StartedAt=`2026-09-05T23:16:19.792586371Z`，宿主 PID=3225358。进程存在不表示空闲。 |
| 00:27:11.500 | 容器内现有 env 计算 HMAC，GET `/api/codex-runtime/status`，只输出允许名单字段 | `ready=true`、`initialized=true`、`eventSequence=409`；dynamic calls/completed/failed 均为 0。它不是全局 active-turn 计数；返回的 pid=18 是包装进程，原生 app-server PID=29。 |
| 00:27:24.895 | SQLite `mode=ro` + `PRAGMA query_only=ON`，仅选 `/workspace%` thread 元数据；rollout 只提取生命周期类型/时间 | 38 条：末事件 32 条 `task_complete`、4 条 `turn_aborted`、2 条 `task_started`。最近完成时间为 2026-09-05 23:17:01.894Z。两条未闭合记录均来自 8 月 27 日，早于本代进程，不得据此声称当前仍活动，也没有擅自清理。 |
| 00:28:04.307 | `/proc` 原生 app-server 打开的 rollout FD，解析生命周期元数据 | 仅 1 个 rollout，thread 指纹 `6263e00f1cf9`；3 次 started、1 次 aborted、2 次 complete，未闭合 turn=0；末次完成时间同上。FD 数不是完整 loaded-thread 清单，不能排除未落盘/临时状态。 |
| 00:28:36.069 | 已存在的隔离验收 tenant，GET `/events?threadId=...` 从 after=0 分页 | 390 个事件、3 次请求；末状态 sequence=406、`idle`、`activeFlags=[]`；末 turn sequence=407、`turn/completed`、`completed`。只输出状态元数据，不输出消息正文。 |
| 00:29:04.440 | 数据库只读事务取注册用户 ID，在管道内与已有 owner map 匹配；逐 thread GET events | 2 个注册用户对应 10 个归属记录：8 个 HTTP 200、0 个本代事件；2 个 HTTP 404。空事件或 404 **不等于 idle**。另外的隔离/历史归属不在注册用户映射中，不能把本次结果说成全租户清单。 |

owner map 总计 18 个 thread、10 个 tenant key；本轮不保存用户 ID、thread 原始 ID、聊天内容、请求签名或 secret。API 仅使用已有 tenant 且先确认其目录存在，没有为检查创建新 tenant。所有请求均为 GET；鉴权中既有 `ensureTenant` 会更新内存 tenant 登记并对已存在目录调用 recursive mkdir，本轮没有更改归属映射或 thread 状态。

## 为什么不能直接 GET Thread

- `codex-runtime/server/index.mjs` 的 `GET /threads/:id` 调用 `requireTenantThread(..., true)`；失败回退及 notLoaded 分支都可能 resume。因此本轮未调用此路径，也不能把它当只读空闲探针。
- `GET /threads` 会调用 `claimListedThreads`，可能写入 `codex-thread-owners.json`；本轮未调用。
- `GET /events?threadId=...` 使用 `requireTenantThread` 默认 `includeTurns=false`；该分支失败即报错，不 resume。本轮使用这条路径读取已有缓冲事件。事件缓冲上限 10000，且过滤/分页结果并非全局当前状态清单。
- `GET /status` 不返回全部运行 turn、待审批或排队请求。动态工具在途数为零、CPU 低、无子 shell、事件序号不变，都不能单独证明空闲。

## Reload 影响范围

1. Node 入口是 `/app/codex-runtime/server/index.mjs`，没有 watch/hot-reload 路径。23:16 启动的进程不会因 bind mount 文件变化自动替换已静态导入的模块；新建 thread 本身也不重载 Node ESM。
2. 当前代码通过 `/opt/ocean-intelligence/codex-runtime -> /app/codex-runtime:ro` 和仓库 `/workspace:ro` 实时可见。reload 读取的是当时整个工作区，不只是 HEAD `587c382`。`codex-browser-service.mjs` 仍有他人未提交修改，主线程需确认该范围，不能撤销他人工作。
3. 已核查代码的 SIGTERM/SIGINT 处理先 `browser.close()`，transport 关闭 stdin 并 kill app-server，然后关闭 HTTP，另有 3 秒退出兜底。它没有等待 active turns 排空。增加 Docker stop timeout 不能把这条路径变成自动安全排空。
4. 重启会影响所有租户的运行中模型/工具调用及事件流；内存事件游标、待请求状态会丢失。持久化目录仍在 bind mount 上，但不能据此保证活动任务无损。既有 thread 的 developer instructions 也不会因服务 restart 自动整体升级。
5. 仅刷新挂载源码时，获准后的最小操作是仅 restart 该 runtime 容器，不是整套 compose down/up；本轮未执行。restart 不应用 Dockerfile/compose 环境变更。当前 compose/deploy 有其他未提交变更，不应顺带 recreate。

依赖实测：当前旧容器的 `NODE_PATH` 未设置，但从入口的 `createRequire` 可解析 `/app/codex-runtime/server/node_modules/parse5/dist/cjs/index.js`，版本 7.3.0。当前 reload 的依赖来自只读源码挂载内 node_modules，不是已经部署了新版镜像 `NODE_PATH` 的证明。执行前应再次检查该目录未消失。

00:28:17 容器磁盘 SHA-256，均不是内存模块哈希：

| 文件 | SHA-256 |
| --- | --- |
| `server/index.mjs` | `eb9a0e77c796306d39028700b757ef2bfc40fc1a2922f45ef5f85f6378f1901a` |
| `server/codex-browser-service.mjs` | `b1f24522bd1944cbb65cf86717b19c79658a8038030217051ca2053db34ad464` |
| `server/illustrated-report-contract.mjs` | `c2d337ebb7fbe6cea9998be2698d39c6044ae40935176eacaa26ed061e5a23a1` |
| `server/point-interaction-quality.mjs` | `43e5fe18dbab08c0c0f78d336382190453b188937851340669c6542c374f4c7d` |

## 可执行核验命令

以下命令只读；不打印完整 env、Docker Config、日志或 API 原始响应。不要启用 shell tracing，也不要把签名写到文件。各命令应由主线程在操作前重跑，不能复用本文时间戳替代。

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
docker inspect --format 'Status={{.State.Status}} StartedAt={{.State.StartedAt}} PID={{.State.Pid}}' ocean-intelligence-codex-runtime-1
git -C /opt/ocean-intelligence status --short -- codex-runtime/server
docker exec ocean-intelligence-codex-runtime-1 node -e 'const {createRequire}=require("node:module"); const loader=createRequire("/app/codex-runtime/server/index.mjs"); console.log(JSON.stringify({parse5:loader.resolve("parse5"),parseAvailable:typeof loader("parse5").parse==="function",nodePathConfigured:Boolean(process.env.NODE_PATH)}));'
```

以下探针**仅覆盖已有的 R18 隔离验收 tenant**，不是所有用户的空闲门禁。status 与 events 的原始响应在进程内过滤；不会使用新 R22 tenant、创建 thread 或 resume。每次 events 调用只读已有元数据；未知、404、分页不完整均不得算通过。

```bash
docker exec -i ocean-intelligence-codex-runtime-1 node <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const owner = 'matlab-capability-audit-round18';
const key = crypto.createHash('sha256').update(owner).digest('hex').slice(0, 32);
const root = `/workspace/.runtime/codex-users/${key}`;
const owners = JSON.parse(fs.readFileSync('/workspace/.runtime/codex-thread-owners.json', 'utf8'));
async function request(route, query = '') {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', String(process.env.OCEAN_CODEX_TENANT_SECRET || '').trim())
    .update(`${owner}\nGET\n${route}\n${timestamp}`).digest('hex');
  const response = await fetch(`http://127.0.0.1:${process.env.OCEAN_CODEX_PORT || 8011}/api/codex-runtime/${route}${query}`, {
    headers: { 'x-ocean-codex-user': owner, 'x-ocean-codex-timestamp': timestamp, 'x-ocean-codex-signature': signature },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}
(async () => {
  if (!fs.existsSync(`${root}/generated`) || !fs.existsSync(`${root}/.runtime/codex-uploads`)) {
    throw new Error('EXISTING_TENANT_REQUIRED');
  }
  const status = await request('status');
  const tool = status.backend?.dynamicMcp || {};
  console.log(JSON.stringify({ at: new Date().toISOString(), ready: status.ready,
    sequence: status.backend?.sequence, dynamicInFlight: tool.calls - tool.completed - tool.failed }));
  const ids = Object.keys(owners).filter(id => owners[id] === key);
  if (!ids.length) throw new Error('NO_MAPPED_THREAD');
  for (const id of ids) {
    let cursor = 0, latestStatus = null, lastTurn = null, exhausted = false;
    for (let page = 0; page < 45; page += 1) {
      const value = await request('events', `?threadId=${encodeURIComponent(id)}&after=${cursor}`);
      for (const event of value.events || []) {
        const message = event.message || {}, params = message.params || {};
        if (message.method === 'thread/status/changed') latestStatus = {
          sequence: event.sequence, type: params.status?.type, activeFlags: params.status?.activeFlags,
        };
        if (message.method === 'turn/started' || message.method === 'turn/completed') lastTurn = {
          sequence: event.sequence, method: message.method, status: params.turn?.status,
        };
      }
      if (!value.events?.length) { exhausted = true; break; }
      if (!(value.cursor > cursor)) throw new Error('CURSOR_NOT_ADVANCING');
      cursor = value.cursor;
    }
    console.log(JSON.stringify({ at: new Date().toISOString(), scope: 'existing isolated audit tenant only',
      exhausted, latestStatus, lastTurn }));
    if (!exhausted || !latestStatus || !lastTurn) process.exitCode = 2;
  }
})().catch(error => {
  const known = /^HTTP_\d+$|^EXISTING_TENANT_REQUIRED$|^NO_MAPPED_THREAD$|^CURSOR_NOT_ADVANCING$/;
  console.log(JSON.stringify({ ok: false, code: known.test(error.message) ? error.message : 'READINESS_PROBE_FAILED' }));
  process.exitCode = 1;
});
NODE
```

在主线程另外确认维护入口控制和全局无活动之后，才考虑 `docker restart ocean-intelligence-codex-runtime-1`。该命令列作后续操作说明，**本轮未执行，也不由上述局部探针自动触发**。操作后需核对 StartedAt/PID 改变、只读 status 就绪和依赖解析；不要用旧 thread GET 做健康检查，以免隐式 resume。

## 全局技能无需覆盖

`/root/.codex/skills/matlab-scientific-plotting/SKILL.md` 已含 `Ocean Intelligence Project Integration`：要求先读仓库 `codex-runtime/matlab/SKILL.md`、README 和 evals README，项目 helper/API/导出/manifest 约束优先，并明确使用项目 assets、避免混入全局同名模板。宿主与容器副本 SHA-256 同为 `5174d1defcbd771df00f1475beb13bb745cd68e348394894abeb9a6be59f472f`。

仓库技能当前 SHA-256=`0a6b53612e3419d4e0e0cfc158524ecf4d23361cc6f684dc5400e15a8f07ca72`，两处均可见。为本次刷新无需覆盖全局技能；文件已存在/转向正确不等于既有线程已重新读取或遵循。

## 与计划试跑的边界

主线程准备的 `/tmp/matlab-runtime-trial-round22.mjs` 和新 tenant `matlab-capability-audit-round22` 本轮均未执行。若经维护确认后执行，应单独报告真实内置模型/线程、文件读取、构图代码和第二轮复核证据；合成数据摘要和代码生成不是 MATLAB 原生执行、真实海区结论、完整视觉通过或“10 个可见侧边栏”证据。

本轮没有取得可覆盖所有临时/未落盘线程的全局 active/loaded 快照。任何取样结束到 restart 之间仍有新 turn、工具调用或客户端 resume 竞态；排除这些竞态需要额外的入口控制与运维授权，不能通过把 unknown 改写成 idle 来解决。
