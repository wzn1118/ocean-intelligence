# MATLAB 满分评测框架审计报告

日期：2026-09-05 UTC
范围：`framework`
状态：`runtime_pending`

## 已完成

- 建立三套确定性合成 fixture，均明确声明不是观测数据，并记录生成公式、单位、UTC、缺测、QC 与不确定度。
- `crossed-time-depth-temperature` 为 6 时次 × 4 深度完整交叉设计；`repeat-cast-salinity-profiles` 为 3 时次 × 6 深度完整交叉设计；`paired-observation-model` 为 4 时次 × 3 深度完整交叉记录。三者都拒绝时间与深度的一一映射混杂。
- 定义 100 分机器 rubric：fixture 科学性 20、科学契约 15、反作弊 15、哈希冻结 10、框架测试 10、真实 MATLAB 20、产物视觉审计 10。
- 定义严格结果 schema、可信视觉审计 schema、反作弊规则、CI 输入、失败条件和最终冻结顺序。
- 实现 Python 评分器：仅 evaluator 自有顶层 gate 计分；忽略提交中的 `score/status/passed/gates`；剥离 MATLAB 注释和字符串后才接受静态 API 证据。
- 实现真实 MATLAB harness：新鲜输出目录、随机 nonce、`matlab -batch` 退出码、版本/release、PNG/PDF/SVG、`figures.json`、外部字节与 SHA-256 复核、文件签名、DataTip、Brush 稳定 ID、生命周期和 headless fallback。
- 视觉满分门禁不能自我声明，必须由独立可信输入绑定 manifest 与每个产物 SHA-256，逐项确认 PNG/PDF/SVG、CJK、字体、裁剪、色觉可访问性和交互行为。

## Fixture 科学契约

- 时间均为显式 ISO-8601 `Z`，验证为 UTC 且严格递增；配对记录允许同一时刻多个深度，但完整覆盖时间×深度组合。
- 深度均为非负、严格递增、`positive_down`、单位 `m`，并给出合成参考面。
- 主变量与标准不确定度维度和缺测掩码严格对齐；不确定度非负；有效零不作为缺测。
- QC 仅允许 `good`、`suspect`、`missing`，策略为 preserve；配对记录 ID 必须非空且唯一。
- 所有变换均显式；框架不插值、不平滑、不填补、不重排、不反转、不归一化。

## 反作弊与冻结

- 注释、字符串、报告文字、嵌套字段、伪造扩展名、陈旧产物、symlink、候选自报退出码与 Octave 结果均不能通过对应门禁。
- MATLAB 产物必须由 evaluator 创建的新目录产生，且 `matlab-runtime.json` 必须回显同次运行随机 nonce。
- 外部评分器重新验证 manifest 相对路径、文件签名、PNG 尺寸、字节数和 SHA-256；视觉审计必须再次绑定相同哈希。
- `SOURCE_SHA256SUMS.txt` 在 `REPORT.md`、`RESULT.json`、`DONE` 和全部最终范围文件写完后生成；清单排除自身、缓存和临时 runtime-output，随后只读复核。

## 验证结果

- `python3 -m unittest discover -s codex-runtime/matlab/evals/tests -p 'test_*.py' -v`：10/10 通过。
- `python3 -m py_compile codex-runtime/matlab/evals/evaluate.py codex-runtime/matlab/evals/tests/test_evaluate.py`：通过。
- `python3 /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py /root/.codex/skills/matlab-scientific-plotting`：通过。
- `python3 /root/.codex/skills/matlab-scientific-plotting/scripts/validate-matlab-skill.py`：通过。
- `bash /root/.codex/skills/matlab-scientific-plotting/scripts/static-smoke-test.sh`：通过；明确报告 MATLAB unavailable、rendering unverified。
- `node --test codex-runtime/server/*.test.mjs`：297/297 通过，日志为 `node-server-tests.log`。
- `node --test codex-runtime/server/matlab-runtime-wiring.test.mjs`：12/12 通过，日志为 `node-runtime-wiring.log`。
- `git diff --check -- .codex-evals/matlab-100-20260905/framework codex-runtime/matlab/evals`：通过。
- 冻结写入与篡改检测均由单元测试和实际 `--write-freeze` / `--verify-freeze` 命令验证。

## 范围外观察

`python3 codex-runtime/matlab/tests/validate_assets.py` 当前失败，日志为 `matlab-assets-static.log`。失败来自其他并行线程写入范围：新增 `oi_plot_time_series.m` 尚未被该验证器登记，以及 `full100_export_contracts.m` 违反现有 ASCII 静态约束。本线程没有修改这些范围外文件，也没有用本框架结果掩盖该失败。

## 真实 MATLAB 待验证

当前主机 PATH 中没有 MathWorks `matlab`。诊断命令：

```bash
bash /root/.codex/skills/matlab-scientific-plotting/scripts/run-matlab-batch.sh --check-only
```

结果为 `MATLAB_RUNTIME=unavailable`、`MATLAB_SMOKE_SKIPPED=matlab_not_found`，退出码 127。因此未声称渲染、字体、SVG、交互或满分通过，也未使用 Octave 替代。

可复现真实门禁命令：

```bash
python3 codex-runtime/matlab/evals/evaluate.py \
  --runtime require \
  --output-dir .codex-evals/matlab-100-20260905/framework/runtime-output \
  --visual-audit /trusted-input/visual-audit.json \
  --result .codex-evals/matlab-100-20260905/framework/runtime-evaluation.json
```

CI 需要 Linux、MathWorks MATLAB R2019b+、MATLAB base product、`python3`、CJK 可用字体和可信视觉审核输入。期望归档 MATLAB console、版本/release、产品列表、退出码、runtime record、PNG/PDF/SVG、manifest、全部哈希和视觉审核。任一 runtime、nonce、DataTip、Brush、headless、签名、尺寸、字节、哈希、字体、裁剪或视觉项失败，均不得获得 100 分。

## 分数声明

本线程静态可执行门禁全部完成后为 70/100；真实 MATLAB 20 分和可信视觉审计 10 分保持 pending。最终诚实状态为 `runtime_pending`，不声明 100 分。
