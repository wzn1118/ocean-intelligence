# R23 strict stage-status 真实失败分支审计

## 结论

对象仅为 [run 34002693563](https://github.com/wzn1118/ocean-intelligence/actions/runs/34002693563)，三版完整原包位于 `/tmp/matlab-run-34002693563/`。本轮已从原始 JSON、检查日志、失败列表和后续产物实证：**旧两版内容检查真实拒绝未全过账本，失败被计入后处理总结果，收证没有提前终止**。这不是上一轮结果或合成 unit test 的替代证明。

| release | 原始 stage passed/total | stage-status-content | 后处理 passed/total | summary 精确失败集合 |
| --- | --- | --- | --- | --- |
| R2021a | 19/20 | failed，exit 1 | 13/16 | `stage-status-content`、`regression-contract`、`rendered-artifacts` |
| R2024b | 19/20 | failed，exit 1 | 13/16 | `stage-status-content`、`regression-contract`、`rendered-artifacts` |
| R2026a | 20/20 | passed | 15/16 | `regression-contract` |

合计 stage **58 passed/2 failed/60**，check **41 passed/7 failed/48**，三版后处理 summary 均 failed。主线程汇总 `/tmp/matlab-ci-summary-34002693563/summary.json` 与重新统计一致；它的 `github_status=null`、`status_source=local_artifact_evidence`，不是 GitHub 最终 outcome 的独立证据。

## 原始证据链

1. 三版 `ci-stage-status.json` 均为 schema 整数 1、对应 release、完整唯一的 20 个当前 runner ID，重算与 summary 相符。旧两版唯一失败项为 `family-b-runtime`，错误均为 `astra_comparison_trial:FontUnavailable`，栈定位模型首版第 118 行。两版 `stage-status-content.log` 明确为 `status=failed`、`scope=stage_status_declaration_only`，错误均为 `stages not passed: family-b-runtime (failed; astra_comparison_trial:FontUnavailable)`，不是 schema/release 误拒绝。
2. 旧两版 `ci-validation-summary.json` 中 `stage-status-file=passed`、`stage-status-content=failed` 各有独立记录，后者 detail 明确 `exit 1`；`failures` 与所有失败 check 的 `id: detail` 精确一致，没有丢失新增失败。R26 内容日志为 passed，source bytes/hash 与实际账本一致，未误报失败。
3. 本地只读补验执行 `python3 -B codex-runtime/matlab/evals/validate_stage_status.py --stage-status <本轮原路径> --expected-release <release>`，退出码为 **1/1/0**、stderr 均空，输出 JSON 与各版 CI 内容日志逐字段相同。此复核不是重新运行 MATLAB，也不是 CI 原始日志的替代品。validator SHA-256 为 `761a1ae87b6033a5566f0e39ae3e11317c5da47d08fd48fbfeb330a47aa77836`。
4. 原生失败后继续运行有本轮账本实证：R21/R24 的 family-b 分别结束于 `01:03:17Z`、`01:03:25Z`，随后 **11 个 stage 全 passed**，包括 export、interaction 和 evaluator，末阶段分别结束于 `01:04:06Z`、`01:04:16Z`，无 pending/running 遗留。本审计核对的是实际记录及后续产物，不独立认证每个 MATLAB assertion。
5. shell 内容检查失败后，旧两版仍有后续 **九个 check** 的真实记录：evaluator-runtime-record、runtime-release-binding、regression-manifest、regression-contract、interaction-evidence、interaction-contract、evaluator-runtime、rendered-artifacts、ocean-report。16 个 ID 均唯一完整；各日志、evaluator 结果、自动检查 JSON、报告正文/证据及 inventory 均已归档。三版 `rendered-artifacts.log` 为 0 bytes，不能据空 stdout 判断未执行或通过；状态须读 summary 与 `rendered-artifact-evidence.json`。
6. 三版 inventory 共 **919 条唯一记录，全部实际 bytes/hash 匹配**；`ocean-report.log` 声明的正文及 report-evidence bytes/hash 也均与原件一致。DISPLAY 等后续文件不都在此前生成的 inventory 内，本次对完整包另取目录指纹，不将 inventory 误说成包含所有后续文件。

## 分数与模型边界

- 逐版读取本轮 `evaluator-result.json`，并确认与本轮 `evaluator-runtime.log` JSON 相同：均 **90/100、status=runtime_pending、runtime.status=passed、visual_audit.status=pending**，原因是未提供 trusted visual audit；六项已过 gate 权重合计 90，剩余视觉 gate 权重 10。生成时间为 R21 `01:04:29Z`、R24 `01:04:40Z`、R26 `01:09:13Z`；runtime 的 manifest SHA 与各自本轮 `evaluator-runtime/figures.json` 实物一致，没有借用旧分数或重算评分。evaluator 的子集通过不代表 20 stage 全过。
- 自动产物检查为 R21/R24 **8 passed/4 failed**、R26 **12 passed/0 failed**；旧两版四个 PDF 均有 `pdf_font_embedding` failed。报告生成三版 passed，但携带的 rendered_audit_status 为 failed/failed/passed。准确区分已知自动检查失败与人工视觉 pending，不能概括成三版视觉全过，也不能把未提供人工审核写成已完成且失败。
- 模型首版固定路径 `family-b/astra-comparison-trial/astra-generated-comparison-evidence.json`：旧两版 construction failed，native/export/manifest 均 not_run，目录只有失败证据 JSON；R26 complete/passed，native 为 `passed_before_and_after_export`、export 为 completed、manifest 为 passed，PNG/PDF/SVG 均存在且与证据 bytes/hash 相符。只核验其状态与产物绑定，不重复 native reader、canvas 或实图视觉审查。三版 `visual_verified=false`，模型 provenance 明确不是模型身份认证；`execution_commit=0f6779785896bf3b2a7257ac72287d83cffec8ff` 是包内声明，未冒充本次远端取证。

## 最终 Outcome 取证限制

主线程提供 run 为 `completed/failure`；**本角色尚未独立取得本轮 GitHub job/Enforce 日志**。本地包与主线程 summary 不含该日志/API 快照；本次 `gh api .../actions/runs/34002693563/jobs` 返回 `error connecting to api.github.com`，没有重复联网或下载。故不借用 R22 的 job ID、step conclusion 或 outcome 填补 R23，也不把本地 summary 推断标成独立验真的最终 outcome。

当前只读代码仍为 `run_check` 记录失败后继续、shell 最终按 failures exit 1；workflow 最后检查 `steps.matlab-runtime.outcome` 和 `steps.runtime-score.outcome`，不是受 continue-on-error 影响的 conclusion。此为机制核对，不是本次最终 Enforce 已执行的证明。要补齐最后一环，仅需主线程已有的本轮 job API/Enforce 日志（包含 run/commit、实际 MATLAB/SCORE outcome、失败数量、exit 与上传结果）；无需重跑 MATLAB 或修改门禁。

## 原件哈希与保留

下列相对文件均在各 release 的 `matlab-full100-<release>/` 包根内，匹配该包 inventory。失败内容日志本身不含 source hash，其原件绑定来自独立重算及 inventory，不能虚称日志已自带该字段。

| release | 文件 | bytes | SHA-256 |
| --- | --- | ---: | --- |
| R2021a | `ci-stage-status.json` | 4900 | `29b5d355008dd922efa639c27d8dc5f14ab5e0bd4ca54b065fd68675e80f8a3f` |
| R2021a | `stage-status-content.log` | 223 | `c11afbe069732f9aa5979a544a033c93dbbde77a8fdcff2aa4818381e37c60bc` |
| R2021a | `ci-validation-summary.json` | 3126 | `e66a44f3b6398e90205cfef35d347acaebe9f3124db5803f9384f0c5d8b26dc2` |
| R2024b | `ci-stage-status.json` | 5585 | `f82504fcc1b299e87b519a56f932892cf2af99504f1015ad43ce2c459f968ef9` |
| R2024b | `stage-status-content.log` | 223 | `a1017328455ca68959fd81385d7a15954162eddff07b2a678650ecc6d4d9794a` |
| R2024b | `ci-validation-summary.json` | 3126 | `c6aa67d175e2251900eb8bae60dff782b6566097fdd3fec9e463b4f26e435629` |
| R2026a | `ci-stage-status.json` | 3787 | `33081810fe5d4aedbb2f3bd58cda2ea256908b7fab5fb522a4c900ba9f71ab76` |
| R2026a | `stage-status-content.log` | 1015 | `a9c44ec30ff628972947289d0322e57b7de22dddde6b5ccf07e5b2fd87b310a5` |
| R2026a | `ci-validation-summary.json` | 2866 | `3bb7cb2511c40803f42fc785edc376b7344725a82bfbbc6a1389a460d04ec3a5` |

完整包目录指纹：按相对路径字典序排列 `{path,bytes,sha256}`，对 `JSON.stringify(records)` 再取 SHA-256；不含宿主绝对路径。下列初读指纹与交付前重算完全一致，共 1099 个原始文件保持不变；所读四个门禁源文件也与初读 hash 一致。

| release | 文件数 | 总 bytes | 目录指纹 SHA-256 |
| --- | ---: | ---: | --- |
| R2021a | 376 | 24354333 | `6a8f586974c9d10f73e7a1f8146ed88ed3d292e7d8975e95c8de6e4f02924209` |
| R2024b | 364 | 24233973 | `b78d579e1a344884043191f6c77f2aa7c43e0f0fb54ac43e83a8dbf6a841e26f` |
| R2026a | 359 | 12066299 | `9e62a237964b04ac9943158572cf5b97ff3c63c004e430c805d094d1d9fe8087` |

只新增本文；源代码、评分、fixture 输入和原始包均只读，无 MATLAB 重跑、artifact 下载、提交或推送。`stage_status_declaration_only` 与自报 metadata/hash 不是执行签名、人工视觉批准或模型身份认证。
