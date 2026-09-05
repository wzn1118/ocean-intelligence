# Round 19: 既有线程指令刷新协议边界

调查时间：2026-09-05 23:06-23:10 UTC。只读产品代码及本地 CLI schema；除本文和获准的独立 `/tmp` schema 输出外未写文件，未改生产、index、配置，未重启，未发送任何 app-server RPC 或模型 turn。没有操作、恢复、注入、steer 或打断诊断线程 `01a073d0-59a8-7470-aef6-cbd0c7e4124b`。

## 结论

1. CLI 0.153.4 的 `thread/resume` 确实声明 `developerInstructions: string | null`，默认和 `--experimental` 输出都有。它提供整个字符串参数，不提供 MATLAB 段落的 append/patch/merge 参数；不能将其当作局部刷新接口直接填入仅 MATLAB 文本。
2. `turn/start` 的顶层 **没有** `developerInstructions`，两套 schema 均如此。实验字段 `collaborationMode.settings.developer_instructions` 是另一条模式配置路径，不能混为基础 developer instructions 的局部追加。
3. 存在两条有 schema 根据的追加候选：实验 `turn/start.additionalContext` 的具名应用上下文，及默认导出已包含的 `thread/inject_items` 历史追加。前者未在 schema 声明消息优先级，后者接受原始 items、未约束具体角色的服务端接受条件。因此本轮不能声称已验证“仅 MATLAB 开发者上下文成功刷新”。
4. 产品服务没有服务端持久化创建时的 `regionId` 或完整 developer 指令快照。最小安全方向是保留原有基础上下文，仅发送服务端生成的 MATLAB 增量；不是用默认 `global_ocean` 重新构造完整基础提示。

## CLI 与生成证据

- 本轮 Docker inspect 确认 runtime `StartedAt=2026-09-05T23:02:31.449700402Z`，宿主主进程 PID `3217845`。本轮未再调用 health 或诊断线程；health 结果不作为本轮实测。
- 容器安装包版本为 `@openai/codex 0.153.4`。容器原生 CLI 与宿主 `/opt/codex-cli/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex` 均为 258659424 bytes，SHA-256 均为 `56ef98ab4032d317ab26e9b5e5a175650717351edb16ed9cde0cb6d1734d62da`。
- 使用该字节相同的宿主 CLI，在 `env -i` 下将 HOME、CODEX_HOME、CODEX_SQLITE_HOME 全部设为 `/tmp/oi-thread-schema-round19-ssOUwh`，PATH 仅 `/usr/bin:/bin`，没有读取运行服务的密钥/config。分别运行 `app-server generate-json-schema --out /tmp/oi-thread-schema-round19-ssOUwh/stable` 和增加 `--experimental`、输出到同根 `experimental` 的版本。两个命令均退出 0；仅提示拒绝在临时 CODEX_HOME 创建 PATH helper aliases，不影响 schema 输出。
- `stable` 目录名仅表示未传 `--experimental`，不是对 API 长期稳定性的额外承诺。默认输出 304 个 JSON，实验输出 416 个 JSON，全部 720 个文件 JSON 解析成功；12 项字段/类型/方法存在性断言通过。这些是静态结构检查，不是 live RPC 或模型验证。

| 证据文件，均位于临时根目录 | bytes | SHA-256 |
| --- | ---: | --- |
| `stable/ClientRequest.json` | 196747 | `25bc001b5dfe3b35785597b8f9ad9e5aaf7e437331fa9921f041c9e0e03fc9f3` |
| `experimental/ClientRequest.json` | 275861 | `05c82ead1a820c765c23d3a1d262e4ae54889785276ee1acf7c494141fd94d70` |
| `stable/v2/ThreadResumeParams.json` | 38018 | `8ac68582a81d60940b10b330be8546123f56bfe246b56f8a4f121da00f347cf2` |
| `experimental/v2/TurnStartParams.json` | 23746 | `b36fb37326b1cf69f75c8b306f1f886d53a57c4b1b985e08e298e2407ea2ad02` |
| `stable/v2/ThreadInjectItemsParams.json` | 397 | `8d7e754402a2bb71bd817882076d2f8ac4cd75d4573306db082a83b841aa3532` |

取证未使用模型列表、外部文档或别的 CLI 版本推断协议。

## 确切参数与限制

| 方法/字段 | 本地 schema 结果 | 不能据此推断的事项 |
| --- | --- | --- |
| `thread/resume.developerInstructions` | 默认/实验均为可选 `string | null`；`threadId` 必填 | 无局部段落合并承诺，也未说明 null/空串对旧指令的清除或保留语义 |
| `thread/resume.baseInstructions` | 同样为可选 `string | null` | 不能为刷新 MATLAB 而改变模型基础指令 |
| `turn/start.developerInstructions` | 两套顶层 properties 均不存在 | 不可因任意 JSON 能序列化或 schema 接受未知键而声称支持 |
| `turn/start.additionalContext` | 仅实验输出；可选 `object | null`，按 opaque source identifier 分组 | schema 未说明消息 role/优先级、同 key 替换/去重、是否持续到下一轮或经过压缩后保留 |
| `additionalContext[source]` | 必填 `kind`、`value`；`kind` 仅 `untrusted` 或 `application`；`value` 是 string | `kind: "developer"` 不在声明中；`application` 不等于本轮已证实的 developer role |
| `turn/steer.additionalContext` | 实验输出也有同一结构 | 它作用于指定在途 turn，不适用于本轮禁止干预的诊断线程 |
| `thread/inject_items` | 默认/实验 ClientRequest 均列出；必填 `threadId`、`items: array`；描述明确为 append 到 model-visible history | items 是任意 JSON，schema 不验证具体角色的服务端允许集合、线程状态前提、优先级、持久化/压缩行为或幂等性 |
| `thread/settings/update` | 仅实验输出；没有顶层 developerInstructions；有 collaborationMode | 不提供独立的 MATLAB 或基础 developer 段落 setter |
| `turn/settings/update` | 仅实验输出；仅在途 turn 的模型/effort/reviewer/tier/summary 等 | 既不是未来轮次刷新，也没有指令追加参数 |

重要细节：这几个参数对象没有声明 `additionalProperties: false`。因此不能用“给 turn/start 多塞一个 developerInstructions 后通用 JSON-schema 校验通过”证明 CLI 识别该字段；是否忽略或报错本轮没有实测。

`ThreadResumeParams` 的 schema 顶层说明还明确区分：非 running 线程可以从磁盘按 ID 恢复；若 ID 已对应 running 线程，app-server 会 rejoin。它没有承诺对已加载线程重新应用 developerInstructions。不能把“当前无活跃 turn”直接等同于“线程未加载”，也不能把 resume 返回成功直接作为指令替换成功证据。实验 `history` 标明 FOR CODEX CLOUD - DO NOT USE；`path` 标明 UNSTABLE，并可能改变 threadId 的选择优先级，不应拿来重写旧线程历史。

实验 `collaborationMode.settings` 要求 `model`，可带 `developer_instructions`；描述明示其优先于 model、reasoning_effort 和 developer instructions，null 使用所选模式内置指令。为 MATLAB 刷新改变此对象会混入模式/模型设置变更，不是窄范围方案。

`ThreadReadResponse.thread` 无已声明的 `regionId` 或完整 developerInstructions；实验 `extra` 只是无具体字段契约的 implementation-specific 对象。`ThreadResumeResponse.instructionSources` 仅为已加载指令源文件的路径数组，不是内联 developer 字符串、其内容哈希或刷新成功证明。不能依靠这些字段无损重建旧提示。

关键行号：`stable/v2/ThreadResumeParams.json:1435`、`experimental/v2/TurnStartParams.json:8`、`:23`、`:705`、`:744`、`stable/v2/ThreadInjectItemsParams.json:4`、`experimental/v2/ThreadResumeResponse.json:2983`，均位于上述独立临时根。

## 当前产品连接边界

- `/opt/ocean-intelligence/codex-runtime/server/index.mjs:154` 只在创建线程时读取 `regionId`，默认 `global_ocean`；`:155` 构造整段 `oceanDeveloperInstructions`，`:161` 随 thread/start 注入。`:751` 将海区写成提示文本。
- `index.mjs:712` 的 `claimThread` 仅保存 `owners[threadId] = tenant.key`，没有保存 region、非 MATLAB 指令快照或版本。直接把现有 map 值改成对象会破坏当前严格字符串归属比较，不是无关紧要的元数据修改。
- `index.mjs:640` 的 `resumeTenantThread` 仅发送 ID、租户 cwd/runtimeWorkspaceRoots、approvalPolicy、sandbox，没有 developerInstructions。`index.mjs:407` 的 turn 参数也没有该字段，但 `:418` 已透传客户端 `body.additionalContext`。
- `/opt/ocean-intelligence/codex-runtime/server/codex-app-server-transport.mjs:16` 默认初始化 capabilities 为 `{ experimentalApi: true }`，因此实验字段有产品代码的协商入口。此事实不等于本轮测过上下文优先级。
- `/opt/ocean-intelligence/codex-runtime/server/codex-canonical-adapter.mjs:103` 起的 toRawRequest 保留原 params，并允许不在别名表中的原方法名继续交给 transport。`thread/inject_items` 不在产品 harness allowlist，也未看到专门 HTTP 入口；将来应由服务端受控调用，不能为了刷新开放任意 RPC/raw items 给浏览器。
- `/opt/ocean-intelligence/frontend/src/codexApi.ts:185` 的 resume body 为空；`:198` 的普通 startTurn 不传 additionalContext。仅服务端已有透传，不表示当前 UI 正在构造 MATLAB 增量。
- `/opt/ocean-intelligence/frontend/src/components/CodexAgentSurface.tsx:658` 和 `:665` 确实有按当前 region.id 保存 active thread ID 的 localStorage，但这只是客户端当前选择记录，不是服务器可信的线程创建海区；不能用于自动改写历史基础提示。

本轮确认 index、transport、adapter 工作区与容器挂载字节一致。index SHA-256 为 `eb9a0e77c796306d39028700b757ef2bfc40fc1a2922f45ef5f85f6378f1901a`；这证明所分析调用代码的磁盘版本，不是本文执行过请求的证明。

## 最小实现候选，尚未实施

### A. 按 turn 追加 MATLAB 应用上下文

这是当前服务改动最少的候选：在经过线程归属检查、下一次用户 turn 正常开始前，由服务端构造 `matlabPlottingInstructions`，仅添加保留 source key 的上下文片段。不重新调用整段 `oceanDeveloperInstructions`，不传 baseInstructions、developerInstructions、collaborationMode 或新的 region/model。保留原 input、其他允许的上下文、海区、租户、安全规范、非 MATLAB 报告规范与历史。

仅示意参数片段，本轮未发送：

```json
{
  "additionalContext": {
    "ocean.matlab.instructions": {
      "kind": "application",
      "value": "<服务端生成的 MATLAB 专用指令、明确作用域及版本/哈希>"
    }
  }
}
```

value 的路径只能来自当前已认证 tenant/workspace，不能接受客户端传入的根目录、完整 developer 文本或对保留 key 的覆盖。现有客户端上下文需按原约定验证并合并，不能为加入 MATLAB 而替换其他来源。片段应明确只更新 MATLAB 绘图规范，不更改已有海区、安全与报告基础规范。

由于 schema 没有说明 application 的消息优先级，A 目前只能称“受支持的具名上下文输入候选”，不能声称它能覆盖旧 developer 级 MATLAB 规则。其跨轮继承、同 key 行为、压缩后可见性必须先在另外获准的独立验收线程确认；未验证前不能只注入一次就宣称整个旧线程永久升级。

### B. 明确 role 的历史追加候选

若要求显式 developer 消息，默认导出中的 `thread/inject_items` 是更直接的历史追加原语。通用 `ResponseItem` 声明允许 `type: "message"`、字符串 role，以及 `content` 内的 `input_text`；但该方法的 items 自身没有引用此类型，实际 handler 的角色校验本轮未知。

仅示意待验证的候选，不能作为已成功的调用样例：

```json
{
  "threadId": "<已授权且空闲的验收线程>",
  "items": [
    {
      "type": "message",
      "role": "developer",
      "content": [
        {
          "type": "input_text",
          "text": "<仅 MATLAB 的服务端增量，不包含替换整个基础提示的内容>"
        }
      ]
    }
  ]
}
```

先验证 handler 确实接受 developer 角色且保留原上下文，再考虑服务端使用。该方法没有已声明的 source key/去重/局部替换参数；重复或并发刷新、超时结果不明、restart/resume/compaction 后行为均不能假定。若采用，应在同一线程排队串行处理，确认 idle 后追加并在成功后记录版本；不能干预 active turn、盲目重试或直接修改 rollout/SQLite。

### 完整基础指令刷新不是本轮最小方案

新线程未来可在现有归属记录之外，用小型服务端上下文记录保存已确认 regionId、提示版本/hash、原非 MATLAB 指令片段及必要路径依据。应保持当前归属 map 兼容。旧线程缺少这些记录时标为 unknown，不默认 global_ocean，不把模型总结、客户端 localStorage 或当前 UI 海区当作原始事实。

只有来源可信且完整上下文可重建，并另行验证 resume 对所处加载状态的覆盖/持久化语义后，才讨论整体 developerInstructions 更新。若缺资料，保留原基础上下文、选择获准且已验证的增量路径；不要仅因为 schema 存在字符串字段就覆盖老线程。

最小验收应分别确认：原 thread ID/历史不变、海区不被重置、租户与非 MATLAB 规范保留、只增加预期 MATLAB 片段、客户端不能覆盖受信片段、重复刷新/失败不伪报已生效，以及后续轮次实际读取到版本。schema 支持、RPC 接受、模型可见和持续有效是不同检查项；本轮仅完成第一项的静态调查。
