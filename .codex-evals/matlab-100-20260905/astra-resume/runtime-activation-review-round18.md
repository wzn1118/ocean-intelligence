# Round 18: 内置 MATLAB 能力实际生效路径审计

审计窗口：2026-09-05 22:49-22:55 UTC；关键文件最后一次逐文件采样为 22:53:41 UTC，22:55 UTC 复核服务 PID/StartedAt 未变。当时 HEAD 为 `7fc420e23731be2244457bf3e757ea0762307a31`，提交时间 22:42:11 UTC。共享工作区仍在被其他代理修改，本记录不是后续文件状态的承诺。

本轮仅写本文档。未修改生产代码、测试、compose、deploy、README、freeze 或技能；未重启、复制覆盖容器、发起模型 turn、运行 MATLAB、提交或推送。系统取证仅输出路径、版本、时间、哈希及允许列出的非敏感配置，未输出凭据或原始会话正文。

## 结论

| 层级 | 当前可验证结论 |
| --- | --- |
| 仓库与容器磁盘 | 最新 `.m` helper、仓库技能和 JS 文件通过 bind mount 实时可见；包括尚未提交的工作区修改，不能只用 HEAD 标识实际文件。 |
| 常驻 Node 提示/路由 | 进程仍是 17:44:20 启动的一代。静态 ESM 导入没有文件重读/热更新路径，后续修改没有替换它已经导入的提示、router 模块。新建线程本身也不会刷新 Node 模块。 |
| 既有内置线程 | `turn/start` 和产品 `resume` 均不重建 MATLAB developer instructions；仅续一轮，或只重启再恢复旧线程，均不能视为基础提示已升级。 |
| 技能与 helper 使用 | 文件可读不等于技能已调用、模型已遵循或 MATLAB 已执行。全局技能与仓库技能不是同一个文件；同名交互模板仍需防止路径选错。 |
| Astra | 提示拼接代码不按模型分支，可供不同模型使用；但当前没有“内置 Astra turn 使用了新版提示/helper”的运行证据。模型列表补入 Astra 不能证明实际选择或继承。 |
| MATLAB 执行 | 本机及该容器默认 PATH 未发现 `matlab`；容器配置指向外部 MathWorks 执行。此事实不否定 GitHub MATLAB 授权或既有 CI 产物。 |

## 服务、镜像与路径

- 内置服务容器：`ocean-intelligence-codex-runtime-1`，ID `c4b5fcc9ecb5bb9572cb3f1bfa0e0b1a916fd516506aaa99760ccbac61bc3689`。创建于 17:25:40 UTC，最近启动于 17:44:20 UTC。
- 运行镜像与当前 `ocean-intelligence-codex-runtime:production` 标签一致：`sha256:0b0d5b2b7e60c771e499559f2d82fdd9cd0e0d2bcdba8fccb73fe28091b645b9`；镜像创建于 17:24:12 UTC。镜像日期不能代表挂载源码版本。
- 主进程宿主 PID `3062573`，命令入口 `/app/codex-runtime/server/index.mjs`，实际 cwd `/`。子进程 `3062626` 为 Node Codex 包入口，`3062637` 为原生 `codex app-server --stdio`，二者 cwd 均为 `/workspace`，同于 17:44:20 启动。未启用 Node `--watch`，容器进程表只有上述三个进程。
- 内置 CLI 包 `/usr/local/lib/node_modules/@openai/codex/package.json` 版本为 `0.153.4`。宿主桌面审计链路是另一进程 `3061250`，可执行文件位于 `/opt/codex-cli/...`，cwd `/root`；不能将本轮桌面会话当作产品内置会话的成功证据。
- 应用容器 `ocean-intelligence-app-1` 运行自 2026-08-30，实际 `CODEX_RUNTIME_URL=http://codex-runtime:8011`。其 `app.main:app` 使用的 `codex_runtime_proxy.py` 与仓库文件字节一致，SHA-256 为 `6ca7cdccf87fffc9d18cf1d0ccfa14d7964106488997f85e6fbca8bff96beacc`。这证明代理配置链路，不代表本轮发起过浏览器请求。

实际 Docker inspect 挂载：

| 宿主路径 | 容器路径 | 权限 |
| --- | --- | --- |
| `/opt/ocean-intelligence/codex-runtime` | `/app/codex-runtime` | ro |
| `/opt/ocean-intelligence` | `/workspace` | ro |
| `/root/.codex` | `/root/.codex` | rw |
| `/opt/ocean-intelligence/.runtime` | `/workspace/.runtime` | rw |
| `/opt/ocean-intelligence/generated` | `/workspace/generated` | rw |

`OCEAN_CODEX_WORKSPACE=/workspace`、`CODEX_HOME=/root/.codex` 已从运行进程的允许名单字段确认。线程创建时使用 `/workspace/.runtime/codex-users/<tenant>` 作为 cwd，绘图提示却明确注入仓库根 `/workspace`，helper 应定位到 `/workspace/codex-runtime/matlab/assets`，不能按租户 cwd 猜相对仓库路径。

## 文件证据

下表是 22:53:41 UTC 的工作区文件。每项均与容器 `/app/codex-runtime/...` 及 `/workspace/codex-runtime/...` 字节相同；“同 HEAD”只比较文件，不代表进程内存。

| 仓库内路径 | bytes | SHA-256 | 同 HEAD |
| --- | ---: | --- | --- |
| `codex-runtime/server/matlab-plotting-instructions.mjs` | 39497 | `749374e44ea974e4c59a49302ce0d6e372a74fe4f9c5043486a28cb8b2595843` | 否 |
| `codex-runtime/server/matlab-plot-router.mjs` | 133037 | `9b622b2339cb4f9bd1a641d0831aea17ea6c84cabc96329754eb09310168b08d` | 是 |
| `codex-runtime/matlab/SKILL.md` | 25634 | `b16d4c7dbece04c865230b40c45d91678f641b5d397f6cd56f82266cef963e0a` | 否 |
| `codex-runtime/matlab/assets/oi_plot_comparison.m` | 39220 | `4db32bceead30874bb2556f0e00fd9e28a7cd69c15da725ee1646c4ac82f5d78` | 否 |
| `codex-runtime/matlab/assets/oi_export_figure.m` | 44160 | `a2b0937f16d096c8ff705da767f5f9b91a44ff0079eca91ffae46a9d980b71cd` | 是 |
| `codex-runtime/matlab/assets/oi_write_manifest.m` | 43535 | `8c6f19e99a70b85c302ab5fce8f5a2653f3ce17a863a45f5f141fbb4bc55b098` | 是 |
| `codex-runtime/matlab/assets/interactive_timeseries_native_template.m` | 42304 | `792fcabcce3881ecc922ff574cd4e1353a3ff6e1e6ec4e6a7b82198554338744` | 是 |

22:52:33 UTC 全部 25 个 `assets` 文件在两处挂载均无差异。将全部文件按路径排序，以 `relative-path<TAB>bytes<TAB>sha256` 组成 LF 分隔且末尾无 LF 的目录清单，其 SHA-256 为 `f9c46c183af3a7094f06a676239bc95d2194b7150ddfb71b1188c03e43416074`。这仍仅证明磁盘内容。

用于新旧对照，进程启动前最近提交为 `30d794f48134b5065bcc7be85e5a6f6126b6e1df`，17:39:51 UTC；该提交的提示 SHA-256 为 `92b6ca464b6f13c77752df6f11fdf7a2cd4b4dc36fcec09208be6994e3698d07`，router 为 `c67c68b09cce2401e8d60a46c8f990bc8e428c90423bda2df4ffef0625218b46`。两者均与当前 HEAD 不同。该历史提交是对照样本，不是对当时 dirty 工作区或当前 Node 内存的哈希认证。

全局 `/root/.codex/skills/matlab-scientific-plotting/SKILL.md` 是普通文件，不是仓库技能的符号链接；其 SHA-256 为 `5174d1defcbd771df00f1475beb13bb745cd68e348394894abeb9a6be59f472f`，mtime 为 20:58:46 UTC，容器挂载副本相同。它新增的项目入口要求先读仓库技能/README，但没有自动执行这些文件。全局同名 `interactive_timeseries_native_template.m` 为 30792 bytes、SHA-256 `1a6bcbc186d6025c4dc126e9333856b09dfcbe04438f31d99bca3ce488ee76ab`，与仓库模板不同。

## 提示与执行链路

1. `/opt/ocean-intelligence/codex-runtime/server/index.mjs:13` 静态导入 `matlabPlottingInstructions`；`:14` 导入 runtime route service，该模块再静态导入 router。`:32` 按模块路径计算项目路径，但实际工作区被运行环境覆盖为 `/workspace`。
2. 同文件 `:153` 的 `POST /threads` 调用 `oceanDeveloperInstructions`，`:161` 通过 `thread/start.developerInstructions` 提交。`:759` 拼入 MATLAB 提示与本次路径。这是基础提示的生产注入点，并不读取 `SKILL.md` 正文。
3. `matlab-plotting-instructions.mjs:167` 的函数拼接已导入的字符串/能力路由；没有重新读取自己的源文件。所查入口、提示、router、transport 没有 watcher、动态 import 或 MATLAB 提示文件重读逻辑。
4. `index.mjs:407` 的新 turn 提交输入、cwd 等，仅在请求带有 `model` 时设置模型；没有重建 developer instructions。`:640` 的 resume 也没有该字段。`:403` 可附加报告任务说明，但它不是新版基础 MATLAB 提示的重新注入，且其模块同样常驻。
5. `matlab-plot-router.mjs:243` 生成显式 `assetDirectory` 与 `addpath(assetDirectory)`；fresh Node 进程读取当前 router、fresh MATLAB 执行选择当前 helper，与长期服务中的缓存模块是两条路径。既有 `.m`/产物不会因 git 提交自动重生成。
6. `index.mjs:108` 的 `/matlab/route` 仅返回 `routeMatlabRuntimeRequest(body)` 的路由/脚本/契约。当前 service 模块没有启动 MATLAB、提交 GitHub job 或读取外部 evidence 目录的实现；声明 `ready-for-runtime-validation` 不是已经执行。

## 会话与 Astra 证据边界

- 只读检查 `/root/.codex/sessions` 共 225 个 JSONL 首条元数据，41 个 `originator=codex-browser-host`；其中 37 个 cwd 在 `/workspace` 下。最新可见内置记录最后修改于 2026-09-02 11:28:03 UTC，没有找到本次 17:44:20 启动后的内置 rollout。没有据此推断用户从未使用服务或不存在未落盘状态。
- 最新样本是 `/root/.codex/sessions/2026/09/02/rollout-2026-09-02T11-23-53-01a061dc-77cf-7601-a609-6a9034b888a5.jsonl`。其 `turn_context` 记录 `model=gpt-5.6-sol`、`effort=medium`。产品 developer 消息 SHA-256 为 `14f01068dc84ade123c008f5899508710d9638bf52d93d7ea54955212a52515e`；所查新版 MATLAB/V3 标记不存在。本文不保存消息正文。
- `/root/.codex/state_5.sqlite` 使用 `mode=ro` 和 `PRAGMA query_only=ON` 查询 `/workspace%` 线程：37 条模型记录均为 `gpt-5.6-sol`。这些历史记录不能替代当前进程的有效配置读回。
- 当前共享 `/root/.codex/config.toml` 经 TOML 解析的非敏感字段为 `model=gpt-5.6-sol`、`model_provider=OpenAI`、`model_reasoning_effort=max`；mtime 为 21:45:57 UTC，晚于内置 app-server 启动。未测它对已加载线程/进程的即时刷新行为，不能把当前磁盘值当作内存值。
- 内置原生进程命令没有 `model`/`model_provider` 覆盖，只有所查 `features.code_mode_host=true`；运行环境也未配置服务自有模型 provider。`codex-browser-service.mjs:190` 仅在 provider 配置存在时强制模型；`:320` 只是向 `model/list` 补入 `gpt-6-astra`，该条目的 `isDefault=false`。列表存在不是后端授权、实际模型或提示继承证明。
- 可证明的是模型无关的代码路径：基础绘图提示没有 Astra 特例，显式 turn 模型字段不负责重新拼接提示。不可证明的是本次真实 Astra turn、其技能发现结果以及新版 helper 使用记录。未获取进程内存模块哈希，未主动调用会产生租户/会话副作用的 API；官方文档查询亦未成功，因此不对该 CLI 版本的技能缓存刷新规则作额外断言。

## MATLAB 与 CI

容器允许名单配置实测：`OCEAN_MATLAB_RUNTIME=external-mathworks-only`、`OCEAN_MATLAB_RELEASE=R2026a`、`OCEAN_MATLAB_EXECUTABLE` 为空、`OCEAN_MATLAB_EVIDENCE_DIR=/workspace/.runtime/matlab-ci`。该 evidence 目录在宿主对应路径不存在。PATH 查找有 `octave`/`octave-cli`，没有 `matlab`；未执行任何解释器渲染测试。

`/opt/ocean-intelligence/.github/workflows/matlab-full100.yml:71` 明确列 R2021a/R2024b/R2026a，`:87` 使用 `matlab-actions/setup-matlab@v3`，`:135` 使用 `matlab-actions/run-command@v3`。这与本地可执行文件是否存在是不同事实。本轮未重新核验 CI 授权或运行结果，既不能因本地缺 MATLAB 否认已有 licensed CI，也不能因 CI 成功宣布内置服务已执行或已热部署。环境中的 evidence 目录名本身不构成同步机制。

## 最小后续步骤（本轮均未执行）

1. 主线程先确认要启用的已审阅工作区版本与 dirty 修改范围，再重新核对上表文件哈希。当前是源码 bind mount，重启会读到整个当时工作区，而非自动只读 HEAD；不要为此覆盖用户文件或盲目按 dirty compose 重建。
2. 获准并确认内置服务没有在途任务后，仅重启 `docker restart ocean-intelligence-codex-runtime-1`。这会同时更新 Node ESM 与其 app-server 子进程；就当前挂载的提示/router 源码而言不需要复制容器或重建镜像。重启后核对 PID/StartedAt、挂载和文件哈希；若另有镜像/环境变更，应由部署负责人另行处理，单纯 restart 不更新容器环境定义。
3. 用产品新建一个独立验收线程，验证实际注入的新版 MATLAB 提示、路径和关键标记，不能只看 `model/list` 或磁盘哈希。保留原多轮线程，不删除历史。若必须继续原线程，可在新 turn 明确要求重新读取仓库技能/README/helper 并核对版本，这是新增任务上下文，不是基础 developer 提示已整体刷新；产品现有 resume 路径没有自动升级该提示的能力。
4. 要验 Astra，应通过受支持的请求显式选择 `model: "gpt-6-astra"`，检查实际 turn 返回/落盘 `turn_context.model`，再核对同一线程的提示与文件读取证据。不要为一次验收修改所有宿主/容器共享的全局配置，也不要用模型自报替代执行元数据。若要求后续轮次继承，再发一轮不指定模型并读回结果，不能未经验证声称继承。
5. helper 使用验收先定位 `/workspace/codex-runtime/matlab/assets`；在真正 MATLAB 执行环境中以 `which(..., '-all')` 核查交互模板和 exporter 的解析路径，用 fresh 进程/输出运行选定的小用例并核验 manifest/产物。外部 CI 的工作区路径应使用 CI 实际路径而非容器路径。无执行入口时仅报告源码与提示验证，不用 Octave 冒充 MATLAB；需要产品读取 CI 证据时再显式配置受控路径和验证流程，不把目录变量当作已有桥接。

完成标准分别记录为“文件可见”“常驻模块重载”“本线程提示已注入”“实际模型已确认”“helper 原生执行与产物核验”，不得合并成一个未经证实的“全部生效”。
