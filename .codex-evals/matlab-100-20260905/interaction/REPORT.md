# Interaction Scope Report

日期：2026-09-05 UTC
范围：MATLAB 原生交互图件、点位温度交互质量门禁与实机验收证据。

## 已完成

- 加固 `interactive_timeseries_native_template.m`：保留过滤/排序前传入的唯一正整数 `SourceRow`，将其与 `ObservationID`、值、时间、站位、QC 一并写入图元 `UserData` 和 `DataTipTemplate`。
- Brush 选择同时返回稳定 `ObservationID` 与 `SourceRow`，通过 `GetSelectedObservationIdentity()` 提供可复核表格；拒绝长度、重复、缺失和非法源键。
- DataTip 回调从同一份元数据读取时间、单位、数值、稳定 ID 和源行；失效句柄、越界事件和异常元数据返回固定无害提示，不抛二次错误。
- 保持 desktop/headless 双路径：headless 自动关闭 DataTip/Brush 并走传统 figure 的静态导出；`exportapp` 界面快照不伪造出版 manifest。
- 加强 Node 点位交互质量检查：不再接受 HTML 注释、惰性字符串、全局标签或未绑定处理器作为交互证据；新增逐点 `data-point-index`/`data-observation-id` 对齐、唯一性、覆盖率和 mismatch 检查；按实际系列数判断图例要求；拒绝 `blob:`/`javascript:` 等非离线资源。
- 扩展点温度交互规范和相邻测试，覆盖稳定身份、排序过滤、回调生命周期、异常清理和 headless 降级。
- 新增真实 MATLAB Desktop/headless 验收脚本、SHA-256/字节校验器及证据格式说明。

## 验证

- 定向 Node：`node --test codex-runtime/server/point-interaction-quality.test.mjs codex-runtime/server/point-temperature-interaction-spec.test.mjs codex-runtime/server/matlab-interaction-contract.test.mjs`；`26/26` 通过。
- MATLAB skill 静态 smoke：`STATIC_SMOKE_OK`；静态链接、函数、占位符、导出 fixture、mock regression 通过。
- MATLAB runtime check：`MATLAB_RUNTIME=unavailable`、`MATLAB_SMOKE_SKIPPED=matlab_not_found`；本机没有 MathWorks MATLAB，因此没有声称 MATLAB 渲染、字体、DataTip、Brush、Desktop 回调或 PNG/PDF 产物已验证。
- 全量 Node：`286/288` 通过；失败为其他并行范围的既有 illustrated-report/router 测试（`creates an adaptive illustrated report contract`、`runtime composition returns stable contracts for malformed JSON shapes`），未修改其范围文件。
- `git diff --check`：通过。

## 实机门禁

使用 `.codex-evals/matlab-100-20260905/interaction/EVIDENCE_FORMAT.md` 中的命令分别运行 Desktop 和 headless。每次必须使用新输出目录，并通过 `validate_interaction_evidence.mjs` 校验 JSON、PNG/PDF 非空、字节数和 SHA-256。Desktop 还须人工操作 DataTip/Brush 并填写视觉审核；headless 需确认 `HeadlessFallbackUsed=true`、交互关闭且 `PublicationExport=true`。

当前状态：`runtime_pending`。原因是本机无 `matlab` 可执行文件，且尚无真实 MATLAB 运行/视觉审核证据。
