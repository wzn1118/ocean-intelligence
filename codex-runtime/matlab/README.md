# MATLAB 图像回归

在本项目选择 MATLAB 模板前，先读本目录的 `SKILL.md` 与本文；使用本目录 `assets`，用 `which` 核对同名函数来源，不混入全局技能附带的旧模板或 Octave helper。仓库文档是可随 checkout 携带的项目入口说明，不代表本目录已被 Codex 自动发现为技能；本机全局技能的条件入口不能替代其他环境中的显式读取。

`tests/run_plot_regression.m` 生成固定尺寸的 PNG/PDF 与 `figures.json`。manifest 同时记录导出尺寸、字节数、SHA-256、PDF 页数，以及文字/轴对象清单。

`oi_export_figure` 的严格尺寸路径在 R2019b-R2024b 仍明确使用 `print`，不是导出失败后的重试。R2025a+ 原生 PNG 使用 `Units="inches"`、`Width=widthPixels/dpi`、`Height=heightPixels/dpi`、`Resolution=dpi`、`PreserveAspectRatio="off"`；PDF/SVG 保持相同物理尺寸的 inches 与 `PreserveAspectRatio="on"`，均使用 `Padding="figure"`。绘图前先设置最终物理画布，不能把屏幕像素当输出像素。逐格式 `runtime.export_size_units` 记录实际路径的 inches；目标策略不能冒充执行证据。

第11轮有限探针中，保持宽高比 on 为 2/6 尺寸准确，off 为 6/6；但 pixels/off 实图出现字体缩小和刻度变多，拒绝作为生产方案。inches/off 保留近似原物理字号且所测 3/3 尺寸准确，但轴位置和留白有变化。第12、13轮各通过 57/60 个 CI 阶段，R2021a/R2024b/R2026a 各为 19/20；三版全量原生回归的尺寸检查已通过，包含 R2026a PNG inches/off 路径，不再仅有早期探针证据。三幅 unit-circle 图的局部像素包围框宽高差不超过 2 个边缘像素，但这不是全图视觉保证。仍须逐图核验字体、刻度、裁切与各格式产物，不做导出后 resize、重采样、裁切或填边，不放宽既有门禁。

第14轮 `oi_annotate_svg` 仅对受支持的 SVG 子集进行受限嵌套 viewport 规范化：原生 `viewBox` 和绘图坐标保留在内部 viewport，外层 viewport 被规范化。这是原生导出后的 XML 后处理，不是未经处理的纯原生 SVG；未知或不支持的 SVG 必须拒绝，不能泛化覆盖或降低尺寸门禁。第15轮命名空间明确的 DOM 检查已在三版通过，包含10个正例和34个拒绝例；主运行阶段60/60通过，但后处理和整体CI仍失败。R2024b额外DISPLAY诊断产生了白名单外的内嵌SVG字体，规范化明确拒绝。两套SVG布局引擎的历史副本对照均零像素差，CairoSVG对四件实际第15轮输出的对照也一致；两引擎共用Cairo，仍不等于浏览器、字体或全图视觉验收。

交互图件使用 `assets/interactive_timeseries_native_template.m`，详细边界见 `INTERACTIONS.md`。该模板以稳定 `ObservationID` 连接 data tip 与 brush 选择，并区分桌面 `uifigure`/`exportapp` 和无界面传统 figure/`exportgraphics` 路径；默认不启用生命周期不明确的 `linkdata`。

静态时间序列图件使用 `assets/oi_plot_time_series.m`。该资产正式注册于 MATLAB 资产清单和绘图资产清单，并由 `tests/run_plot_regression.m` 直接调用和导出；契约测试覆盖 `table`/`timetable`、带时区 `datetime`、缺测与采样间隙断线、QC、单位一致性和不确定度语义，对抗测试覆盖缺失 QC 策略与不确定度溢出。当前服务器静态时间序列路由仍使用内联生成路径，因此验证器将该资产列为“主回归直连资产”，不会伪装为已完成的路由生成接线。

运行 `scripts/matlab-plot-regression.sh [输出目录] [基线目录]`：

- 有 MATLAB 时执行生成脚本并校验 manifest、文件非空、PNG/PDF 尺寸、PDF 页数、文字/轴对象和 PNG 像素差异。
- 无 MATLAB 时输出 `MATLAB_REGRESSION_SKIPPED=matlab_not_found` 并以跳过状态结束；不会伪造通过或用 Octave 代替 MATLAB。
- 基线 PNG 使用与输出 manifest 相同的相对文件名；像素阈值可通过 `inspectMatlabPlotRegression` 的 `pixelChannelThreshold` 与 `pixelDiffRatioThreshold` 配置。

`taskType="interactive"` 的 MATLAB 路由会实际调用原生交互模板；其生成脚本额外接收 `ObservationID`、`Station` 和 `QCFlag`，并在生成前校验逐点对齐。对应 Node 契约测试与 MATLAB 回归均在上述回归入口中覆盖。

`oi_plot_comparison` 新增显式 `UncertaintySides="observation"`，支持只有观测侧的 `standard-uncertainty`。模型不确定度必须省略，不能补零或复制；缺观测不确定度不删除有限且QC接受的散点或改变统计，只是不画该点的水平区间。`result.Uncertainty` 保留对齐原值、提供状态及实际 `GraphicsMask`，原生图例标题说明模型侧未提供。默认双侧契约保持不变。该直接helper能力及新增三格式测试尚待首次MATLAB CI，评测比较图尚未调用此模式或获得v3证明。

第13轮 `paired-interactive` v2 原生完整值、QC、不确定度和 errorbar 数组核对已在三版通过；报告 native proof 覆盖为 3/4 图，`paired-observation-model` 比较散点仍为 `not_verified`。这是输入字节绑定的运行声明核对，不是独立重跑、桌面交互或全图视觉证明，也不代表服务已热更新。

报告构建通过 `evals/build_ocean_report.py --runtime-output <运行产物目录> --rendered-audit <外部检查JSON>` 显式接收外部检查文件，核对审计文件 bytes/SHA-256、manifest/产物绑定、检查条件与状态一致性，不自动寻找审计文件。shell 工作流先执行图件检查，再将该文件传入报告；报告只验证外部自动检查声明，不重跑或认证检查工具，不是 trusted 视觉审计。缺证据保持 `not_verified`，旧版 `pdf_font_embedding=failed` 必须明确显示，不能被未验证的文本或视觉项掩盖。本轮三版报告集成都已构建，源 CI 产物未改；报告构建成功不代表其中的图件失败已消除。
