# R22 stage-status-content 真实 CI 核查

## 范围与当前结论

- 目标：[CI 34001173593](https://github.com/wzn1118/ocean-intelligence/actions/runs/34001173593)，attempt 1，提交 `7d51e714a23442e7a132d257d1ec94c91c6dd669`。
- 2026-09-06 00:24:52 UTC 首次查询：run 为 `in_progress`、conclusion 为 `null`；本地 `/tmp/matlab-run-34001173593` 尚不存在。此状态不是成功结论。
- 2026-09-06 00:34:50 UTC 更新：收到主线程逐版下载完成通知后，已只读核验三版完整包及对应 job API/logs。三版 `stage-status-content` 实际 passed，账本合计 60/60 passed；验证 check 合计 43/48 passed、5 failed，三个 job/enforce 均 failed。run API 已为 `completed/failure`，更新时间 `00:33:35Z`。没有把中间绿色步骤、stage 全过或报告生成成功推导为整条 CI 成功。
- 本轮只写本文，不改生产、测试、workflow、summary、评分或原件；本地仅重跑只读 Python validator，未本地执行 MATLAB。

## 已证静态事实

通过 GitHub contents API 按上述 CI 提交读取四个文件并计算 SHA-256，均与当前工作区对应文件字节一致：

| 文件 | bytes | SHA-256 |
| --- | ---: | --- |
| `.github/workflows/matlab-full100.yml` | 9402 | `382d4f0219900135b72bc7f2402ebdc115f81b3cd3e65bc8fc55ff2012dfe14f` |
| `scripts/matlab-github-full100.sh` | 9127 | `8a1edfa0d12ea6f5b8c488070925a363f87efc3e1070d86e76086cf59f025ac3` |
| `codex-runtime/matlab/evals/validate_stage_status.py` | 7199 | `761a1ae87b6033a5566f0e39ae3e11317c5da47d08fd48fbfeb330a47aa77836` |
| `codex-runtime/matlab/tests/run_github_full100.m` | 11023 | `bca37f5491af0aad9b427aa1ca9218d55e239bfe89bb8919138f23fae6561e26` |

1. workflow 第 142/149 行的 MATLAB/runtime-score 两步仍设置 `continue-on-error: true`，后者还有 `if: always()`。不能把 jobs API 中对应 step 的绿色 `conclusion` 当作命令成功或 20 stage 全过。
2. workflow 第 189 行的最终 Enforce 为 `if: always()`，没有 `continue-on-error`；它打印并检查 `steps.matlab-runtime.outcome` 与 `steps.runtime-score.outcome`，任一非 `success` 均应使此步骤失败。第 200 行证据上传仍为 `always()`。这里是代码行为，尚不是本次已执行的 outcome 证据。
3. shell 第 79 行 `stage-status-file` 只查文件存在；第 80 行另行无条件 `run_check stage-status-content`，调用 validator，显式传入账本路径及预期 release。两项名称独立，内容检查不是原存在检查的改名。
4. `run_check` 将真实退出码写入失败 check 的 detail，stdout/stderr 保存在 `stage-status-content.log`，失败后返回 0 继续收证。`record_check` 同时追加 `failures`；最终 `ci-validation-summary.json` 的 `checks`/`failures`/`status` 来自这些记录，shell 第 239 行起在有失败时打印 `MATLAB_FULL100_STATUS=failed`、失败数量/明细并 exit 1。不会因为 `run_check` 返回 0 就把失败从最终门禁删除。
5. validator 检查 schema v1、精确 release、完整且唯一的 20 个已知 stage、每项状态/字段/时间戳、passed 项错误字段为空、重新统计后与 summary 精确一致；拒绝重复 JSON key、非有限数、缺失/未知字段及非整型计数。只有全 20 项 passed 才 exit 0。旧的较少 stage 历史账本不通过当前门禁，不改变历史汇总工具。
6. runner 现有 20 个 `run_stage` 调用与 validator 的 `REQUIRED_STAGES` 一致；逐项异常仍记录并继续，最后有失败则抛 `run_github_full100:StagesFailed`，并没有改成仅写账本后成功退出。

## 三版真实包与 outcome

| release / job | 日志实际 MATLAB / SCORE outcome；最终 job / enforce | stage schema / release / 重算 | 新内容检查；summary 失败项 |
| --- | --- | --- | --- |
| [R2021a / 101400290759](https://github.com/wzn1118/ocean-intelligence/actions/runs/34001173593/job/101400290759) | success / failure；failure / failure | v1 / R2021a；20 passed、0 failed/pending/running | passed；`regression-contract`、`rendered-artifacts` |
| [R2024b / 101400290734](https://github.com/wzn1118/ocean-intelligence/actions/runs/34001173593/job/101400290734) | success / failure；failure / failure | v1 / R2024b；20 passed、0 failed/pending/running | passed；`regression-contract`、`rendered-artifacts` |
| [R2026a / 101400290707](https://github.com/wzn1118/ocean-intelligence/actions/runs/34001173593/job/101400290707) | success / failure；failure / failure | v1 / R2026a；20 passed、0 failed/pending/running | passed；`regression-contract` |

包根为 `/tmp/matlab-run-34001173593/` 下的 `matlab-full100-R2021a`、`matlab-full100-R2024b`、`matlab-full100-R2026a`。job API 均核对 run ID、attempt 1 和上述 head SHA；完成时间依次为 `00:29:33Z`、`00:29:30Z`、`00:33:30Z`。

1. 原始账本逐项核验：每版均为唯一且完整的 20 个当前 required ID，全 passed，三项 error 字段均为空；重新计数与账本 summary 一致。对原路径运行当前同提交 `validate_stage_status.py --stage-status ... --expected-release ...`，三版均 exit 0、stderr 空，输出 JSON 与包内 `stage-status-content.log` 逐字段一致。不是仅观察文件存在或信任 summary。
2. 三版内容日志均包含 `scope=stage_status_declaration_only`、正确 release、完整 required_stages 和重新统计值。`source.file=ci-stage-status.json`，bytes/hash 与实际原件完全一致。R21/R24/R26 账本生成时间依次为 `00:28:35Z`、`00:28:31Z`、`00:32:06Z`；验证 summary 为 `00:28:57Z`、`00:28:51Z`、`00:32:25Z`。
3. 三版最终 summary 各有 **16 个唯一 check**，R21/R24 为 14 passed、2 failed，R26 为 15 passed、1 failed；`stage-status-file` 与 `stage-status-content` 各有独立 passed 记录。`failures` 精确等于失败 check 的 `id: detail` 列表：旧两版只有 `regression-contract` 和 `rendered-artifacts`，R26 只有 `regression-contract`，均记录 exit 1。stage 内容实际没有失败，因此不应被塞进失败列表。
4. 实际 job log：R21 第 1426-1428 行、R24 第 1456-1458 行、R26 第 1248-1250 行打印 stage count/passed/failed 为 20/20/0；R21 第 1444-1448 行、R24 第 1474-1478 行、R26 第 1268-1271 行打印各版上述失败项、`MATLAB_FULL100_STATUS=failed`、失败数量 2/2/1，并报 shell exit 1。最终 R21 第 1630-1632 行、R24 第 1649-1651 行、R26 第 1428-1430 行明确输出 `MATLAB_STEP_OUTCOME=success`、`SCORE_STEP_OUTCOME=failure`，Enforce exit 1。
5. 三个 jobs API 的第 10/11 步 conclusion 均为 success，但未提供 outcome 字段；第 11 步的真实 failure 由上述日志确认。第 16 步 Enforce 为 failure，第 17 步 Upload 为 success。不能用中间两步绿色推导全任务成功。
6. 三版失败后仍完成收证：summary 保留后续 `interaction-contract`、`evaluator-runtime`、`ocean-report` passed 记录及对应日志；inventory 收录并准确匹配这些日志和失败日志的 bytes/hash。三版 `rendered-artifacts.log` 实际均为 0 bytes，不把空 stdout 当作未执行或通过；检查结果另存 `rendered-artifact-evidence.json`。旧两版均为 8 passed/4 failed，四个 PDF 的 `pdf_font_embedding` 叶子 failed；R26 为 12 passed/0 failed，该 check 未误入失败列表。`ocean-report` 构建三版 passed 均不会清除其他失败，也不代表视觉通过。
7. 三版上传日志分别确认 artifact `9979590341`（7698674 bytes）、`9979589545`（8402390 bytes）、`9979639089`（8119132 bytes）成功上传。本轮三版真实 CI **实证内容检查通过分支，以及其他失败仍进入最终失败门禁**；没有触发 `stage-status-content` 失败分支，不能借静态接线、上一轮失败包或合成测试宣称本轮已实证该分支。

## 原件绑定

下表为本地原件 bytes/SHA-256；前三项均与对应 inventory 唯一记录匹配，inventory 本身按协议不自收录。只读 validator 前后字节未变；其他已核验日志也匹配 inventory，未重写任何原件。

| release | 文件 | bytes | SHA-256 |
| --- | --- | ---: | --- |
| R2021a | `ci-stage-status.json` | 3787 | `00bac4c360ecdef5d34674a0fe347108fd8d95cde71ba5ba64650919030ec9ae` |
| R2021a | `stage-status-content.log` | 1015 | `4f8397ed0d7aebb47c5bd9dc4faa5c7977937d36d03d06c6f97a9fd8401fd368` |
| R2021a | `ci-validation-summary.json` | 2994 | `a2f34d518d1756bab64ac6b9c32f0d87d50d1601b6abd78fa882533d1da85a98` |
| R2021a | `artifact-inventory.json` | 54225 | `2d8d5b21fdc91dfd99e4a4b55c38a91ded3cda09c0b0472662fc434bccda2fff` |
| R2024b | `ci-stage-status.json` | 3787 | `b568d0f5b54c576f098f26f96f38b23b83b2438de8daf5d4e17f264505cb26ce` |
| R2024b | `stage-status-content.log` | 1015 | `bf0609d277bfe6941e801150f33aea536df28ae696a53c7bc56d6d74fb8fae8f` |
| R2024b | `ci-validation-summary.json` | 2994 | `75fe62883116403fb4b000f71ec7a55044f7b564a4e882641607b01b4bf30035` |
| R2024b | `artifact-inventory.json` | 55991 | `e53a4c7f06f24ec4b55d9b908462711998893776a4059d80cebc754313800839` |
| R2026a | `ci-stage-status.json` | 3787 | `3696a4b44241a1f7b254d1663eebb58385489b21e5d6f5c1b568ec004e1ed151` |
| R2026a | `stage-status-content.log` | 1015 | `cbcd46e8484e63e88b953ad3f2ee8f25e568d563f2d8e13e2dae7bcab7b44eb6` |
| R2026a | `ci-validation-summary.json` | 2866 | `a912184f0f66be6598b945fbccb0072a32d05ac47823fecad69879abe3f8a60a` |
| R2026a | `artifact-inventory.json` | 56483 | `c82a1d81a92846761ac7452184efb1548edb6bb0d99ceb9a3866caefe545164c` |

GitHub job logs 只在内存读取，未另写文件；上述行号以 API 返回文本逐行计数。R21 日志 780443 bytes，SHA-256 `93dad413abe615271a61d87def05571487c20f5e63f68912b6df6030039e009f`；R24 日志 781154 bytes，SHA-256 `f24a8c33130fa231ca2ef1d4b2d6b8f7497b96acbb70afb9a811f59b55b81802`；R26 日志 876594 bytes，SHA-256 `a72f236e1e064611fa3b9bede46fe5b87da27de115f2bcc81bf8fc8af0f3457d`。

三版均在下载完成通知后审查；末次跨版复核上述 12 个文件的 hash 与初读记录完全一致，未改原件。本范围未发现新增检查被跳过、漏计或覆盖失败的实际证据；内容失败分支的本次真实 CI 覆盖仍明确保留为未触发。

## 证据可信边界

`scope=stage_status_declaration_only` 是准确的边界：检查器证明所读 JSON 的声明满足当前结构/一致性规则，不独立认证 MATLAB 执行、图件科学正确性、字体/视觉质量或人工批准。`source`/inventory 的 bytes/hash 可绑定被检查原件、检测变更，但自报 metadata 及 hash 本身不是签名或执行认证。应结合本次 commit、真实 job logs/outcome、原始账本与 validator 日志形成可追溯证据；即使该 check passed，其他 artifact 检查仍可 failed，不能据此升级全任务或视觉为 passed。
