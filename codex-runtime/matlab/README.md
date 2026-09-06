# MATLAB 图像回归

在本项目选择 MATLAB 模板前，先读本目录的 `SKILL.md` 与本文；使用本目录 `assets`，用 `which` 核对同名函数来源，不混入全局技能附带的旧模板或 Octave helper。仓库文档是可随 checkout 携带的项目入口说明，不代表本目录已被 Codex 自动发现为技能；本机全局技能的条件入口不能替代其他环境中的显式读取。

`tests/run_plot_regression.m` 生成固定尺寸的 PNG/PDF 与 `figures.json`。manifest 同时记录导出尺寸、字节数、SHA-256、PDF 页数，以及文字/轴对象清单。

`oi_export_figure` 的严格尺寸路径在 R2019b-R2024b 仍明确使用 `print`，不是导出失败后的重试。R2025a+ 原生 PNG 使用 `Units="inches"`、`Width=widthPixels/dpi`、`Height=heightPixels/dpi`、`Resolution=dpi`、`PreserveAspectRatio="off"`；PDF/SVG 保持相同物理尺寸的 inches 与 `PreserveAspectRatio="on"`，均使用 `Padding="figure"`。绘图前先设置最终物理画布，不能把屏幕像素当输出像素。逐格式 `runtime.export_size_units` 记录实际路径的 inches；目标策略不能冒充执行证据。

第11轮有限探针中，保持宽高比 on 为 2/6 尺寸准确，off 为 6/6；但 pixels/off 实图出现字体缩小和刻度变多，拒绝作为生产方案。inches/off 保留近似原物理字号且所测 3/3 尺寸准确，但轴位置和留白有变化。第12、13轮各通过 57/60 个 CI 阶段，R2021a/R2024b/R2026a 各为 19/20；三版全量原生回归的尺寸检查已通过，包含 R2026a PNG inches/off 路径，不再仅有早期探针证据。三幅 unit-circle 图的局部像素包围框宽高差不超过 2 个边缘像素，但这不是全图视觉保证。仍须逐图核验字体、刻度、裁切与各格式产物，不做导出后 resize、重采样、裁切或填边，不放宽既有门禁。

第14轮 `oi_annotate_svg` 仅对受支持的 SVG 子集进行受限嵌套 viewport 规范化：原生 `viewBox` 和绘图坐标保留在内部 viewport，外层 viewport 被规范化。这是原生导出后的 XML 后处理，不是未经处理的纯原生 SVG；未知或不支持的 SVG 必须拒绝，不能泛化覆盖或降低尺寸门禁。第15轮命名空间明确的 DOM 检查已在三版通过，包含10个正例和34个拒绝例；主运行阶段60/60通过，但后处理和整体CI仍失败。R2024b额外DISPLAY诊断产生了白名单外的内嵌SVG字体，规范化明确拒绝。两套SVG布局引擎的历史副本对照均零像素差，CairoSVG对四件实际第15轮输出的对照也一致；两引擎共用Cairo，仍不等于浏览器、字体或全图视觉验收。

第20轮 run34000171748（远端 `31e74db52922031dfe1f15b7f385c38e620a9d7f`）三版完成：R2021a 为 19/20，R2024b/R2026a 各 20/20，合计 59/60，`evaluator-runtime` 三版 passed。各自 `evaluator-result.json` 原始评分为 90、状态仍为 `runtime_pending`，整体 CI 仍失败，视觉未通过。唯一主阶段失败是 R2021a `comparison-statistics-layout` 的 `test_comparison_statistics_layout:NativeSubtitle`：创建时 Subtitle 为 10 points，扰动 axes 至 12 后，restyle 将 axes 恢复为 10，但 Subtitle 仍为 12。第21轮 `oi_apply_axes` 候选显式将 Subtitle 设为 `theme.FontSize`，仍待新 licensed CI，原失败字号断言不放宽。

旧的两个 simple canvas 诊断（0pt/3pt inset）已在 R2021a/R2024b 的 primary 和 DISPLAY 中取得 `geometry_before_pdf`、`geometry_after_pdf`、`geometry_after_png` 的 `captured` 快照；采集成功不等于几何不变或视觉通过。新的四 fixture `test_native_pdf_fixture_canvas` 诊断尚未 MATLAB 执行；它和附加 simple canvas 均不计入原三 candidate 的 native PDF probe stage、评分或正式报告产物。

第19轮 Astra 两次真实 diagnostic turn 已完成，均为 low effort、只读诊断；不是 MATLAB 执行、桌面交互覆盖或既有会话普遍刷新证据。

布局覆盖须显式记录可见、非空但没有公开 `Extent`/`Position` 的图例标题：加入 `unmeasured_text_objects`，保留 `role="legend.title"`、`class="matlab.graphics.illustration.legend.Text"`，并令 `bounds_audit_complete=false`。第17轮三版的 visible、hidden-title、hidden-legend、empty 四个原生用例及 `text-bounds` 阶段均通过；可见标题仍明确未测量，其他三例不列为未测标题。这不是视觉或裁切修复，不能用零矩形补齐。

交互图件使用 `assets/interactive_timeseries_native_template.m`，详细边界见 `INTERACTIONS.md`。该模板以稳定 `ObservationID` 连接 data tip 与 brush 选择，并区分桌面 `uifigure`/`exportapp` 和无界面传统 figure/`exportgraphics` 路径；默认不启用生命周期不明确的 `linkdata`。

静态时间序列图件使用 `assets/oi_plot_time_series.m`。该资产正式注册于 MATLAB 资产清单和绘图资产清单，并由 `tests/run_plot_regression.m` 直接调用和导出；契约测试覆盖 `table`/`timetable`、带时区 `datetime`、缺测与采样间隙断线、QC、单位一致性和不确定度语义，对抗测试覆盖缺失 QC 策略与不确定度溢出。当前服务器静态时间序列路由仍使用内联生成路径，因此验证器将该资产列为“主回归直连资产”，不会伪装为已完成的路由生成接线。

运行 `scripts/matlab-plot-regression.sh [输出目录] [基线目录]`：

- 有 MATLAB 时执行生成脚本并校验 manifest、文件非空、PNG/PDF 尺寸、PDF 页数、文字/轴对象和 PNG 像素差异。
- 无 MATLAB 时输出 `MATLAB_REGRESSION_SKIPPED=matlab_not_found` 并以跳过状态结束；不会伪造通过或用 Octave 代替 MATLAB。
- 基线 PNG 使用与输出 manifest 相同的相对文件名；像素阈值可通过 `inspectMatlabPlotRegression` 的 `pixelChannelThreshold` 与 `pixelDiffRatioThreshold` 配置。

`taskType="interactive"` 的 MATLAB 路由会实际调用原生交互模板；其生成脚本额外接收 `ObservationID`、`Station` 和 `QCFlag`，并在生成前校验逐点对齐。对应 Node 契约测试与 MATLAB 回归均在上述回归入口中覆盖。

`oi_plot_comparison` 的显式 `UncertaintySides="observation"` 支持只有观测侧的 `standard-uncertainty`。模型不确定度必须省略，不能补零或复制；缺观测不确定度不删除有限且 QC 接受的散点或改变统计，只是不画该点的水平区间。`result.Uncertainty` 保留对齐原值、提供状态及实际 `GraphicsMask`，原生图例标题说明模型侧未提供。默认双侧契约保持不变。仅在 helper 实际创建的不确定度 Line 上设置既有 appdata `OI_ColorAccessibilityRole="uncertainty"`；第18轮独立 `test_comparison_uncertainty` 已三版完成 PNG/PDF/SVG 导出及 manifest。不改 audit 算法、数据、尺寸或视觉门禁，不能把角色或隐藏 handle 当作任意数据线的免审依据。

严格可选的 `RecordMetadata` 仅支持 numeric row-aligned 输入，不支持 table/timetable 配对。该 scalar struct 必须且只能含 `ID`、`Time`、`Depth`、`DepthUnit`、`DepthDirection`：每行唯一非空 string ID、非 NaT 的 UTC datetime、有限非负深度，单位 `m`、方向 `positive_down`；显式 `SampleLabels` 必须与 ID 一致，匹配的 string 或 `cellstr` 向量均合法，不能同时用 `SampleLabelVariable`。`RecordMetadata.ID` 自身仍须为 string 向量。完整 `result.RecordData` 与 `result.QC` 保留原始行、值、身份和实际 QC 提供状态，原生 Scatter/水平 Line 的 `UserData` 绑定选中记录 ID 与调用入口行号。省略 metadata 时保留原 numeric/tabular 调用兼容性，不造身份，也不生成 `RecordData`。

第13轮 `paired-interactive` v2 原生完整值、QC、不确定度和 errorbar 数组核对已在三版通过；此前归档报告仍为 3/4 图，比较散点 `not_verified`，不能用新一轮结果升级旧包。第18/19/20轮三版 `report-evidence.json` 的 `runtime_evidence.figures` 四图均有 `plot_data_evidence.status="runtime_declaration_verified"`，各轮均为 4/4；比较 v3（`schema_version=3`）于第18轮首次完成同图原生数据绑定。`run_matlab_gate.m` 在导出后读取原生 Scatter 和水平 Line 的坐标、端点、归属与身份，报告/evaluator 消费者核对完整 12 条合成记录、11 个散点、未绘值、QC/不确定度掩膜、统计及 release/input hash。模型 QC 和不确定度保持 `not_provided`。旧包缺 v3 仍兼容，错误声明必须拒绝；仅凭 4/4 合成输入声明绑定不能证明完整对抗套件通过、海况观测、独立重跑、桌面交互或全图视觉。

第20轮 `test_comparison_native_evidence` 在 R2021a/R2024b/R2026a 每版完成 4 个正例及 36/36 个 reader 负例；实际 `native-reader-test-results.json` 与日志终标记 `COMPARISON_NATIVE_READER_TEST_NEGATIVES=36`、`COMPARISON_NATIVE_READER_TEST=passed_synthetic_native_mutations_only` 一致。`scatter-nan-size` 已到达 reader 并抛出 `run_matlab_gate:ComparisonProofHandles`，不是把 setter 失败当拒绝。最终恢复/哈希断言已到达，`original_artifacts_unchanged=true` 与六件导出和输入快照哈希一致；仍为 `visual_verified=false`、`desktop_interaction_verified=false`。消费者 mutation tests 与这个合成原生 reader 套件分别计证，不升级第19轮仅 5/36 的旧证据，也不代表整体 CI 或真实海域报告通过。

报告构建通过 `evals/build_ocean_report.py --runtime-output <运行产物目录> --rendered-audit <外部检查JSON>` 显式接收外部检查文件，核对审计文件 bytes/SHA-256、manifest/产物绑定、检查条件与状态一致性，不自动寻找审计文件。shell 工作流先执行图件检查，再将该文件传入报告；报告只验证外部自动检查声明，不重跑或认证检查工具，不是 trusted 视觉审计。缺证据保持 `not_verified`，旧版 `pdf_font_embedding=failed` 必须明确显示，不能被未验证的文本或视觉项掩盖。第20轮 R2026a 外部产物检查 12/12 通过，R2021a/R2024b 各 4 件 PDF 字体嵌入失败（含未嵌入 Courier）仍保留。独立 DISPLAY 诊断中 R2024b 仍以 `oi_annotate_svg:UnsupportedNormalization` 拒绝白名单外的 SVG `font` 元素，不与 evaluator 产物混同；报告构建成功不是视觉或整体 CI 通过。

R20 源码候选通过 `parseOceanEvidenceTime` 共享严格 UTC coverage 端点解析，并要求主报告 `data-uncertainty-status`、`data-uncertainty-method` 与 manifest 科学上下文精确一致；非空 `data-uncertainty` 自然说明仍需人审，不能用子串命中认证语义。这些源码合同不代表真实海区报告已验证，也不扩展为每条原始 point 时间认证。
