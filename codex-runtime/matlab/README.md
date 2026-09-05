# MATLAB 图像回归

在本项目选择 MATLAB 模板前，先读本目录的 `SKILL.md` 与本文；使用本目录 `assets`，用 `which` 核对同名函数来源，不混入全局技能附带的旧模板或 Octave helper。仓库文档是可随 checkout 携带的项目入口说明，不代表本目录已被 Codex 自动发现为技能；本机全局技能的条件入口不能替代其他环境中的显式读取。

`tests/run_plot_regression.m` 生成固定尺寸的 PNG/PDF 与 `figures.json`。manifest 同时记录导出尺寸、字节数、SHA-256、PDF 页数，以及文字/轴对象清单。

`oi_export_figure` 的严格尺寸路径在 R2019b-R2024b 仍明确使用 `print`，不是导出失败后的重试。R2025a+ 原生 PNG 使用 `Units="inches"`、`Width=widthPixels/dpi`、`Height=heightPixels/dpi`、`Resolution=dpi`、`PreserveAspectRatio="off"`；PDF/SVG 保持相同物理尺寸的 inches 与 `PreserveAspectRatio="on"`，均使用 `Padding="figure"`。绘图前先设置最终物理画布，不能把屏幕像素当输出像素。逐格式 `runtime.export_size_units` 记录实际路径的 inches；目标策略不能冒充执行证据。

第11轮有限探针中，保持宽高比 on 为 2/6 尺寸准确，off 为 6/6；但 pixels/off 实图出现字体缩小和刻度变多，拒绝作为生产方案。inches/off 保留近似原物理字号且所测 3/3 尺寸准确，但轴位置和留白有变化。新 PNG 策略仍待跨版本全量 CI 验证，不能声称尺寸问题已修复或视觉满分。必须重新核验真实像素/DPI、字体、刻度、裁切与逐格式产物，不做导出后 resize、重采样、裁切或填边，不放宽既有门禁。

交互图件使用 `assets/interactive_timeseries_native_template.m`，详细边界见 `INTERACTIONS.md`。该模板以稳定 `ObservationID` 连接 data tip 与 brush 选择，并区分桌面 `uifigure`/`exportapp` 和无界面传统 figure/`exportgraphics` 路径；默认不启用生命周期不明确的 `linkdata`。

静态时间序列图件使用 `assets/oi_plot_time_series.m`。该资产正式注册于 MATLAB 资产清单和绘图资产清单，并由 `tests/run_plot_regression.m` 直接调用和导出；契约测试覆盖 `table`/`timetable`、带时区 `datetime`、缺测与采样间隙断线、QC、单位一致性和不确定度语义，对抗测试覆盖缺失 QC 策略与不确定度溢出。当前服务器静态时间序列路由仍使用内联生成路径，因此验证器将该资产列为“主回归直连资产”，不会伪装为已完成的路由生成接线。

运行 `scripts/matlab-plot-regression.sh [输出目录] [基线目录]`：

- 有 MATLAB 时执行生成脚本并校验 manifest、文件非空、PNG/PDF 尺寸、PDF 页数、文字/轴对象和 PNG 像素差异。
- 无 MATLAB 时输出 `MATLAB_REGRESSION_SKIPPED=matlab_not_found` 并以跳过状态结束；不会伪造通过或用 Octave 代替 MATLAB。
- 基线 PNG 使用与输出 manifest 相同的相对文件名；像素阈值可通过 `inspectMatlabPlotRegression` 的 `pixelChannelThreshold` 与 `pixelDiffRatioThreshold` 配置。

`taskType="interactive"` 的 MATLAB 路由会实际调用原生交互模板；其生成脚本额外接收 `ObservationID`、`Station` 和 `QCFlag`，并在生成前校验逐点对齐。对应 Node 契约测试与 MATLAB 回归均在上述回归入口中覆盖。
