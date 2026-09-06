# Round 20: CI step 绿色与真实阶段失败的边界

只读复核时间：2026-09-05 23:45-23:50 UTC。对象为 [run 33999054663](https://github.com/wzn1118/ocean-intelligence/actions/runs/33999054663)，attempt 1，head SHA `85ab9d20b9fcdecff39e7b2632a1250da6195a6d`。只新增本文；未改 workflow、summary、评分或原始产物，未查看凭据/私有线程，未提交。

## 结论

**最终 enforce 没有放过失败。** 三版各为 19/20 阶段通过、1 个失败，并非执行全过；MATLAB action 和验证脚本都实际退出 1。GitHub jobs API 的绿色 step 是 `continue-on-error: true` 处理后的 `conclusion=success`，不能替代处理前的 `outcome=failure`。

| Release / job | API step 10 / 11 conclusion | 日志 MATLAB / SCORE outcome | step 16 enforce / job conclusion | 原始阶段统计 |
| --- | --- | --- | --- | --- |
| [R2021a / 101394625930](https://github.com/wzn1118/ocean-intelligence/actions/runs/33999054663/job/101394625930) | success / success | failure / failure | failure / failure | passed=19, failed=1, total=20 |
| [R2024b / 101394625990](https://github.com/wzn1118/ocean-intelligence/actions/runs/33999054663/job/101394625990) | success / success | failure / failure | failure / failure | passed=19, failed=1, total=20 |
| [R2026a / 101394625952](https://github.com/wzn1118/ocean-intelligence/actions/runs/33999054663/job/101394625952) | success / success | failure / failure | failure / failure | passed=19, failed=1, total=20 |

核查期间 R26 于 23:46:06 UTC 完成 failure，整次 run 于 23:46:12 UTC 更新为 completed/failure；随后已补核 R26 日志和完整包。三版合计 passed=57、failed=3、total=60，无 pending/running，与 `/tmp/matlab-ci-summary-33999054663/summary.json` 的本地汇总一致。该汇总明确 `status_source=local_artifact_evidence`、`github_status=null`，不是远端 API 证据；本文另行交叉核对了真实 jobs/run。`Visual review bundle ready` job 为 success，仅表示该通知任务完成，不是 runtime/视觉验收通过。

## 真实日志与固定版本代码

通过 `gh api .../actions/jobs/<id>/logs` 只读取得完整日志，在内存中提取相关行，没有覆盖下载目录。jobs API 的 step 对象实测只含 name/status/conclusion/number/时间，没有 outcome 字段；真实 outcome 来自 enforce 输出。

- R2021a：日志第 1436 行，23:39:39，明确 `family-b-runtime (19/20 passed, 1 failed)`；第 1446 行，MATLAB action 报 exit code 1；第 1464-1466 行，验证脚本输出 `MATLAB_FULL100_STATUS=failed`、失败数 2、退出 1；第 1648/1649 行分别输出 `MATLAB_STEP_OUTCOME=failure`、`SCORE_STEP_OUTCOME=failure`，第 1650 行 enforce 退出 1。
- R2024b：同样证据分别在第 1465、1473、1491-1493、1664-1666 行；enforce 时间为 23:40:51 UTC。
- R2026a：第 1258 行同报 19/20、family-b-runtime 失败；第 1266 行 MATLAB action 退出 1；第 1285-1287 行验证脚本 failed、失败数 1、退出 1；第 1442/1443 行两个 outcome 均为 failure，第 1444 行 enforce 于 23:46:03 UTC 退出 1。
- CI 对应 [workflow:134](https://github.com/wzn1118/ocean-intelligence/blob/85ab9d20b9fcdecff39e7b2632a1250da6195a6d/.github/workflows/matlab-full100.yml#L134) 和第 142 行均为 `continue-on-error: true`；[第 179 行](https://github.com/wzn1118/ocean-intelligence/blob/85ab9d20b9fcdecff39e7b2632a1250da6195a6d/.github/workflows/matlab-full100.yml#L179) 起的 enforce 使用 `if: always()`，没有 continue-on-error，取 `steps.matlab-runtime.outcome` / `steps.runtime-score.outcome`。实际 shell 为 `bash --noprofile --norc -e -o pipefail`，这次第一个 test 已失败退出，不能声称两个 test 都被执行；两个失败值都已打印。
- [run_github_full100.m:135](https://github.com/wzn1118/ocean-intelligence/blob/85ab9d20b9fcdecff39e7b2632a1250da6195a6d/codex-runtime/matlab/tests/run_github_full100.m#L135) 在完成所有阶段及状态记录后抛 `run_github_full100:StagesFailed`。逐阶段 catch 是为继续取证，不是最终吞错。
- 工作区 workflow 已与 CI head 的文件不同，因此本次以 GitHub contents API 的固定 SHA 文件为准，没有将当前未提交修改用于解释旧 run。该 CI workflow 为 8861 bytes，SHA-256 `6eaac0791adb7628333fcf0212bee37456ccca60390c2bfaf0be10ac4ca509d6`。

完整 job 日志的 bytes / SHA-256：R2021a 为 815046 / `af7c4c3a9722240e9c90813e38f462db380c0e9fec54a4d2cb1342be19f3bd5a`；R2024b 为 816706 / `cdab3cb3a48a962756d384b70217ece601117afcb0795cc20e3786e7f4e1cf40`；R2026a 为 847795 / `166e069f05e06ea9c5495b919fcbbb86f5e4106610e64cb68a475c6f31db6c74`。行号指 jobs logs 接口返回的文本。

## 原始产物与具体失败

目录为 `/tmp/matlab-run-33999054663/matlab-full100-<release>/`。逐条重算 stages 计数，与三份 summary 完全一致：各 total=20、passed=19、failed=1、pending=running=0。失败均为 `family-b-runtime`，错误标识 `MATLAB:hg:shaped_arrays:PositiveOrNanVectorDataPredicate`。

已确认的测试兼容性缺陷：固定 CI 版本 [test_comparison_native_evidence.m:131](https://github.com/wzn1118/ocean-intelligence/blob/85ab9d20b9fcdecff39e7b2632a1250da6195a6d/codex-runtime/matlab/tests/test_comparison_native_evidence.m#L131) 将 `scatter-zero-size` 的 `SizeData` 设为 0；三版实际在第 157 行 setter 处拒绝非正值，尚未到第 159 行的 reader 拒绝断言。日志也记录了该 case 名。不能把 setter 的意外中断算作预期负例成功；本轮未修改该测试。

| 原始文件 | bytes | SHA-256 |
| --- | ---: | --- |
| `R2021a/ci-stage-status.json` | 5030 | `2686138606c9130e1c8640dd6629481a8a7b39caa3c162567d8216f6bbabf1c2` |
| `R2021a/ci-validation-summary.json` | 2819 | `dc85eaf130668faee1986f605ab469d7595ab3376424846af064c370c89b59ac` |
| `R2024b/ci-stage-status.json` | 5527 | `a7766d316165f579f6ac5e0851c58a30282609268903922e0614a0dcb8656d07` |
| `R2024b/ci-validation-summary.json` | 2819 | `06d3921395df468e4738b3f557b6fb73c3d57c3cba582ce859ae202e173c90d9` |
| `R2026a/ci-stage-status.json` | 5527 | `7f85d2eb44025e65f5c8622c7a524d17bc0e6537edad8d9195cdae096d029924` |
| `R2026a/ci-validation-summary.json` | 2691 | `de240e721dfeed701212470acdb1e9d47eed526c50e210fa33af6fabb5a50879` |

六份文件的 bytes/hash 与各自 `artifact-inventory.json` 条目一致；这是包内一致性，不是把清单自报当成独立真实性认证。三版 validation summary 均 failed：R21/R24 失败检查是 `regression-contract` 与 `rendered-artifacts`，R26 是 `regression-contract`。三版报告构建均 `status=passed`，但 rendered audit 依次为 failed/failed/passed；R21/R24 各 8/12 artifact passed、4 failed，R26 为 12/12 passed。R26 的自动产物检查通过同样不能覆盖阶段/CI 失败，更不等于人工视觉通过。

## 监控与报告应取的证据

1. 先绑定 run ID、attempt、head SHA、release/job ID 和对应 artifact；看最终 enforce、job/run conclusion。尚在运行时保留 pending 状态，同时明确已经观测到的子任务失败，不提前宣称全通过。
2. 读取原始 `ci-stage-status.json.stages` 并重算 total/passed/failed/pending/running，核对 summary；不能只看 GitHub step conclusion、某个 evaluator 子集通过、成功上传或报告生成成功。
3. 将日志中的两个实际 outcome 与 action/脚本退出状态并列记录。对 continue-on-error 步骤，API 的 success 只能标注为其最终 conclusion，不能映射为科学阶段 execution pass。
4. validation summary、rendered audit 和报告构建状态分别展示；已知 failed 不降成 unverified，也不被另一个作用域的 passed 覆盖。

还有一个已证实的摘要边界：[matlab-github-full100.sh:79](https://github.com/wzn1118/ocean-intelligence/blob/85ab9d20b9fcdecff39e7b2632a1250da6195a6d/scripts/matlab-github-full100.sh#L79) 仅调用 `require_file stage-status`，只验非空普通文件；因此三份 summary 的 `checks[id=stage-status].status=passed` 不表示 stages 全过。该脚本没有把阶段失败加入自己的 failures，若其他检查均过，源码路径可输出 `runtime_passed_visual_pending`，即使这个文件含失败阶段。这是独立使用该摘要时的聚合缺口，不是本次已发生的最终 CI 绕过：本次 summary 自身失败，且 enforce 另行拒绝 MATLAB outcome。监控必须自行核对阶段内容；未来可单独补摘要聚合验证，本轮不改脚本或评分。
