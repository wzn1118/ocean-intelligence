# MATLAB 图像回归

`tests/run_plot_regression.m` 生成固定尺寸的 PNG/PDF 与 `figures.json`。manifest 同时记录导出尺寸、字节数、SHA-256、PDF 页数，以及文字/轴对象清单。

交互图件使用 `assets/interactive_timeseries_native_template.m`，详细边界见 `INTERACTIONS.md`。该模板以稳定 `ObservationID` 连接 data tip 与 brush 选择，并区分桌面 `uifigure`/`exportapp` 和无界面传统 figure/`exportgraphics` 路径；默认不启用生命周期不明确的 `linkdata`。

静态时间序列图件使用 `assets/oi_plot_time_series.m`。该资产正式注册于 MATLAB 资产清单和绘图资产清单，并由 `tests/run_plot_regression.m` 直接调用和导出；契约测试覆盖 `table`/`timetable`、带时区 `datetime`、缺测与采样间隙断线、QC、单位一致性和不确定度语义，对抗测试覆盖缺失 QC 策略与不确定度溢出。当前服务器静态时间序列路由仍使用内联生成路径，因此验证器将该资产列为“主回归直连资产”，不会伪装为已完成的路由生成接线。

运行 `scripts/matlab-plot-regression.sh [输出目录] [基线目录]`：

- 有 MATLAB 时执行生成脚本并校验 manifest、文件非空、PNG/PDF 尺寸、PDF 页数、文字/轴对象和 PNG 像素差异。
- 无 MATLAB 时输出 `MATLAB_REGRESSION_SKIPPED=matlab_not_found` 并以跳过状态结束；不会伪造通过或用 Octave 代替 MATLAB。
- 基线 PNG 使用与输出 manifest 相同的相对文件名；像素阈值可通过 `inspectMatlabPlotRegression` 的 `pixelChannelThreshold` 与 `pixelDiffRatioThreshold` 配置。

`taskType="interactive"` 的 MATLAB 路由会实际调用原生交互模板；其生成脚本额外接收 `ObservationID`、`Station` 和 `QCFlag`，并在生成前校验逐点对齐。对应 Node 契约测试与 MATLAB 回归均在上述回归入口中覆盖。
