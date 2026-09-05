# MATLAB 绘图与报告能力 100 分冲刺

日期：2026-09-05 UTC

## 目标

在不伪造运行证据的前提下，将项目内 Codex MATLAB 绘图与科研报告能力提升到严格满分门禁。没有 MathWorks MATLAB 时，必须完成全部静态、契约、测试、CI 和报告工作，但最终状态只能是 `runtime_pending`；只有真实 MATLAB 运行、PNG/PDF/SVG、字体、交互和 manifest 全部验证后才能写 `score=100`。

## 通用规则

1. 每条线程只修改分配的写入范围，不撤销其他线程修改。
2. 工作树已有多线程成果，不得执行 `git reset`、`git checkout --`、清理未跟踪文件或覆盖他人代码。
3. MATLAB 是权威运行时；Octave 只能作为单独标注的兼容证据。
4. 所有科学变换必须显式，不得静默插值、平滑、填补、重排、反转或归一化。
5. 真实运行证据缺失时不得声称渲染、字体、交互、导出或满分通过。
6. 每条线程在自己的 `.codex-evals/matlab-100-20260905/<scope>/` 目录写 `REPORT.md`、`RESULT.json` 和 `DONE`。
7. `RESULT.json` 必须包含：`scope`、`status`、`tests`、`files_changed`、`remaining_runtime_gates`、`score_claim`。
8. `score_claim` 只有在该线程负责范围的全部可执行门禁通过时才可为 100；涉及真实 MATLAB 的项目必须保留运行时待验证项。

## 总门禁

- 全量 Node 测试通过。
- MATLAB 资产验证通过。
- MATLAB skill 静态 smoke 通过。
- 科学契约覆盖 UTC、维度、单位、缺测、QC、不确定度、坐标方向和混杂因素。
- 出版契约覆盖物理尺寸、字体/CJK、颜色、裁剪、PNG/PDF/SVG 和 manifest。
- 交互契约覆盖 DataTip、Brush、稳定 ID、生命周期和 headless 降级。
- 路由与评测不能被注释、字符串、伪造报告或嵌套字段欺骗。
- 所有清单必须在最终文件冻结后生成，路径、字节和 SHA-256 一致。
- 真实 MATLAB CI 必须归档版本、toolbox/license、退出码、图形、manifest 和视觉审计结果。
