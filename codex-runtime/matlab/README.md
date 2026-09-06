# MATLAB 图像回归

在本项目选择 MATLAB 模板前，先读本目录的 `SKILL.md` 与本文；使用本目录 `assets`，用 `which` 核对同名函数来源，不混入全局技能附带的旧模板或 Octave helper。仓库文档是可随 checkout 携带的项目入口说明，不代表本目录已被 Codex 自动发现为技能；本机全局技能的条件入口不能替代其他环境中的显式读取。

报告新函数源码放在 `generated/<reportId>-matlab/` 的直接子级，例如 `plot_report.m` 的主函数同名为 `plot_report`；目录从服务端已绑定的 reportId 固定派生，调用方不能重写。仅放 basename 长 1-63 字符且非 MATLAB 关键字、首字母为 ASCII 字母、其后为字母/数字/下划线、小写 `.m` 扩展名的普通源文件；不放子目录、符号/硬链接、README、数据或导出产物。旧根目录 `<reportId>-*.m` 脚本仍兼容，但不要求新函数使用含连字符的非法函数名。manifest 的 source 保留 `<reportId>-matlab/plot_report.m` 完整相对路径。发现源码不等于语法、执行或身份验证；执行前用 `which` 确认本报告来源，不把其他报告目录加入 MATLAB path。

已核对的 Argo 4903822 本地快照仅有 1 平台、3 个非连续 profiles、1785 层，不是全海区报告。保留源 bytes/hash、剖面/层顺序、UTC/位置、`data_keys_mode=A`、原 `degree_Celsius`/`psu`/`decibar` 单位及五份原始 QC；联合接受 mask 不能覆盖原 flags。pressure 是压力，不是 depth；不能造 U/密度、命名海区/九区覆盖、独立现场验证或未知上游获取收据，更新时间不能代替获取时间。无原生 PNG/PDF 的投影保持 `complete=false`，不同输入、release、合成评分与完整报告/视觉验收分别计证，不伪造 native/visual evidence。

该回放的 T-S 图可用 `oi_plot_ts_diagram` 显式设置 `ColorLabel="Pressure"`、`ColorUnit="decibar"` 和 `ColorLimits`，未知温盐类型保持 `unspecified` 并写明原定义。helper 没有 `RawRecords`、`RecordMetadata` 或 comparison v3 身份接口；调用方保留完整记录，将剖面内 `source_row` 显式映射为拼接调用行，按 `CompleteMask` 在各实际 Scatter 的调用方管理 `UserData` 中绑定身份。导出前后实读 XData/YData/CData、归属、可见性、顺序及身份并逐值回对源数据；`SampleLabels` 或输入副本不能替代原生证明，新 T-S 图不得冒充 comparison v3。源码归属支持不等于 MATLAB、完整报告或部署已通过。

`tests/run_plot_regression.m` 生成固定尺寸的 PNG/PDF 与 `figures.json`。manifest 同时记录导出尺寸、字节数、SHA-256、PDF 页数，以及文字/轴对象清单。

`oi_export_figure` 在 R2019b-R2024b 使用 `print` 保持 PNG/SVG 的严格尺寸；R2020a-R2024b 的 PDF 改用原 figure 底层临时白色画布与原生矢量 `exportgraphics`，修复旧 `print` 将字体替换为未嵌入 Courier 的问题。不会移动或复制原绘图对象，也不改写导出文件，清理后保留原 children 顺序和 current axes，记录 `pdf_canvas_strategy="same_figure_background_axes"`。R2021a/R2024b 四 fixture 对照的八份 PDF 尺寸和字体嵌入通过、八组导出前后 PNG 像素相同；不是完整视觉批准，R2020a 尚未实跑。R2019b PDF 保留显式 `print` 路径。

R2025a+ 原生 PNG 使用 `Units="inches"`、`Width=widthPixels/dpi`、`Height=heightPixels/dpi`、`Resolution=dpi`、`PreserveAspectRatio="off"`；PDF/SVG 保持相同物理尺寸的 inches 与 `PreserveAspectRatio="on"`，均使用 `Padding="figure"`。绘图前先设置最终物理画布，不能把屏幕像素当输出像素。逐格式 `runtime.export_size_units` 记录实际路径的 inches；目标策略不能冒充执行证据。导出错误直接失败，不静默重试或修改尺寸门禁。

第11轮有限探针中，保持宽高比 on 为 2/6 尺寸准确，off 为 6/6；但 pixels/off 实图出现字体缩小和刻度变多，拒绝作为生产方案。inches/off 保留近似原物理字号且所测 3/3 尺寸准确，但轴位置和留白有变化。第12、13轮各通过 57/60 个 CI 阶段，R2021a/R2024b/R2026a 各为 19/20；三版全量原生回归的尺寸检查已通过，包含 R2026a PNG inches/off 路径，不再仅有早期探针证据。三幅 unit-circle 图的局部像素包围框宽高差不超过 2 个边缘像素，但这不是全图视觉保证。仍须逐图核验字体、刻度、裁切与各格式产物，不做导出后 resize、重采样、裁切或填边，不放宽既有门禁。

第14轮 `oi_annotate_svg` 仅对受支持的 SVG 子集进行受限嵌套 viewport 规范化：原生 `viewBox` 和绘图坐标保留在内部 viewport，外层 viewport 被规范化。这是原生导出后的 XML 后处理，不是未经处理的纯原生 SVG；未知或不支持的 SVG 必须拒绝，不能泛化覆盖或降低尺寸门禁。第15轮命名空间明确的 DOM 检查已在三版通过，包含10个正例和34个拒绝例；主运行阶段60/60通过，但后处理和整体CI仍失败。R2024b额外DISPLAY诊断产生了白名单外的内嵌SVG字体，规范化明确拒绝。两套SVG布局引擎的历史副本对照均零像素差，CairoSVG对四件实际第15轮输出的对照也一致；两引擎共用Cairo，仍不等于浏览器、字体或全图视觉验收。

当前第23轮 run34004200751（远端 `9593a0c`）经主线程 GitHub API 确认为 completed/failure：R2021a/R2024b/R2026a 各 20/20，合计 60/60。各自 `evaluator-result.json` 原始评分仍为 90、状态仍为 `runtime_pending`；后处理失败，全量视觉仍未通过。`family-b/astra-comparison-trial` 中 `tests/model-generated-round23/` 修订源码已在三版完成原生调用、同图导出前后完整 v3、PNG/PDF/SVG 原生导出及 manifest 验证。该模型产物独立外检 R2021a 为 2/3、R2024b 为 2/3、R2026a 为 3/3；两旧版 PDF 仍为 `pdf_font_embedding=failed`（含未嵌入 Courier）。Faraday 已查看三份 PNG 和三份 PDF 渲染，三份 SVG 仅做物理/结构检查。旧版 PDF 图例标题越框、虚线样例压字，R2026a 统计贴近顶刻度、参考线仍穿点；不批准全量视觉或 CJK，详见 [native CI 审阅](../../.codex-evals/matlab-100-20260905/astra-resume/native-ci-review-round24.md)。

历史第22轮 run34002693563（`0f677978`）仍为 58/60：两旧版各 19/20，模型原函数第118行因 listfonts 枚举断言报 `astra_comparison_trial:FontUnavailable`，不等于系统字体缺失。首版仅 R2026a 完成原生调用及模型产物独立外检 3/3，不能与 evaluator 的 12/12 混计。Faraday 已实际查看三格式：标题、轴标签与图例完整，PDF 字体嵌入；但 PNG 统计与顶刻度粘连，矢量间距紧、字号较小，参考线穿点，不签全量视觉通过，也不把未测图例标题 geometry 改成已测。修订使用 `oi_font_available`，不覆盖首版原源或旧失败；字体枚举、存在性与实际 glyph 渲染分别计证，不额外要求 listfonts 必须枚举。历史详情见 [evals/README.md](evals/README.md)，不据新结果升级旧包或宣称真实海区报告、部署通过。

第22轮四 fixture `test_native_pdf_fixture_canvas` 在两旧版 primary/DISPLAY 已声明 `completed_diagnostics_only` 并调用 canvas PDF；但独立离线像素检查发现 R2021a primary/DISPLAY、R2024b primary 共 12 张恢复 PNG 全白。R2024b DISPLAY 四对恢复/参考图仅解码 RGB 相同，不是 PDF 或视觉通过。原头部/哈希检查漏掉空白，候选检查器已增加完整 PNG 解码与白底非均匀前景检查；缺 Pillow 时像素保持 `not_verified`。该像素门禁不证明恢复等价，绝不提升生产 canvas 策略。非公开 `legend.Text.Position` 仍不可测，`captured`、属性相等和完成标记不能证明恢复成功；R2026a 为 `not_applicable`，不是 pass。仅允许排除严格空 AnnotationPane（非空拒绝），该轮未实际覆盖非空负例。这些诊断均不计入原三 candidate 的 native PDF probe stage、评分或正式报告产物；历史 JVMRequired/RootObjects 失败见 evals README，不用主阶段 passed 替代产物检查。

第19轮 Astra 两次真实 diagnostic turn 已完成，均为 low effort、只读诊断；不是 MATLAB 执行、桌面交互覆盖或既有会话普遍刷新证据。

布局覆盖须显式记录可见、非空但没有公开 `Extent`/`Position` 的图例标题：加入 `unmeasured_text_objects`，保留 `role="legend.title"`、`class="matlab.graphics.illustration.legend.Text"`，并令 `bounds_audit_complete=false`。第17轮三版的 visible、hidden-title、hidden-legend、empty 四个原生用例及 `text-bounds` 阶段均通过；可见标题仍明确未测量，其他三例不列为未测标题。这不是视觉或裁切修复，不能用零矩形补齐。

交互图件使用 `assets/interactive_timeseries_native_template.m`，详细边界见 `INTERACTIONS.md`。该模板以稳定 `ObservationID` 连接 data tip 与 brush 选择，并区分桌面 `uifigure`/`exportapp` 和无界面传统 figure/`exportgraphics` 路径；默认不启用生命周期不明确的 `linkdata`。

静态时间序列图件使用 `assets/oi_plot_time_series.m`。该资产正式注册于 MATLAB 资产清单和绘图资产清单，并由 `tests/run_plot_regression.m` 直接调用和导出；契约测试覆盖 `table`/`timetable`、带时区 `datetime`、缺测与采样间隙断线、QC、单位一致性和不确定度语义，对抗测试覆盖缺失 QC 策略与不确定度溢出。当前服务器静态时间序列路由仍使用内联生成路径，因此验证器将该资产列为“主回归直连资产”，不会伪装为已完成的路由生成接线。

运行 `scripts/matlab-plot-regression.sh [输出目录] [基线目录]`：

- 有 MATLAB 时执行生成脚本并校验 manifest、文件非空、PNG/PDF 尺寸、PDF 页数、文字/轴对象和 PNG 像素差异。
- 无 MATLAB 时输出 `MATLAB_REGRESSION_SKIPPED=matlab_not_found` 并以跳过状态结束；不会伪造通过或用 Octave 代替 MATLAB。
- 基线 PNG 使用与输出 manifest 相同的相对文件名；像素阈值可通过 `inspectMatlabPlotRegression` 的 `pixelChannelThreshold` 与 `pixelDiffRatioThreshold` 配置。

`taskType="interactive"` 的 MATLAB 路由会实际调用原生交互模板；其生成脚本额外接收 `ObservationID`、`Station` 和 `QCFlag`，并在生成前校验逐点对齐。对应 Node 契约测试与 MATLAB 回归均在上述回归入口中覆盖。

CI 的 `inspectMatlabPlotRegression` 显式选择 `validationMode="runtime-artifacts"`，只验自动运行和产物合同，并对回归十图的三十件产物单独执行严格外检。未配置图像基线、未进行视觉审阅、明确列出的原生未测标题保持 pending；显式基线缺失、文件损坏、字体嵌入失败、实际布局或科学合同错误仍失败。默认 `full-regression` 模式不变，自动模式不把 `regressionOk`、`imageRegressionOk` 或 `visualInspectionVerified` 改成 true，也不授予 100 分。

`oi_plot_comparison` 的显式 `UncertaintySides="observation"` 支持只有观测侧的 `standard-uncertainty`。模型不确定度必须省略，不能补零或复制；缺观测不确定度不删除有限且 QC 接受的散点或改变统计，只是不画该点的水平区间。`result.Uncertainty` 保留对齐原值、提供状态及实际 `GraphicsMask`，原生图例标题说明模型侧未提供。默认双侧契约保持不变。仅在 helper 实际创建的不确定度 Line 上设置既有 appdata `OI_ColorAccessibilityRole="uncertainty"`；第18轮独立 `test_comparison_uncertainty` 已三版完成 PNG/PDF/SVG 导出及 manifest。不改 audit 算法、数据、尺寸或视觉门禁，不能把角色或隐藏 handle 当作任意数据线的免审依据。

严格可选的 `RecordMetadata` 仅支持 numeric row-aligned 输入，不支持 table/timetable 配对。该 scalar struct 必须且只能含 `ID`、`Time`、`Depth`、`DepthUnit`、`DepthDirection`：每行唯一非空 string ID、非 NaT 的 UTC datetime、有限非负深度，单位 `m`、方向 `positive_down`；显式 `SampleLabels` 必须与 ID 一致，匹配的 string 或 `cellstr` 向量均合法，不能同时用 `SampleLabelVariable`。`RecordMetadata.ID` 自身仍须为 string 向量。完整 `result.RecordData` 与 `result.QC` 保留原始行、值、身份和实际 QC 提供状态，原生 Scatter/水平 Line 的 `UserData` 绑定选中记录 ID 与调用入口行号。省略 metadata 时保留原 numeric/tabular 调用兼容性，不造身份，也不生成 `RecordData`。

第13轮 `paired-interactive` v2 原生完整值、QC、不确定度和 errorbar 数组核对已在三版通过；此前归档报告仍为 3/4 图，比较散点 `not_verified`，不能用新一轮结果升级旧包。第18轮至第22轮的归档中，三版 `report-evidence.json` 的 `runtime_evidence.figures` 四图均有 `plot_data_evidence.status="runtime_declaration_verified"`，各轮均为 4/4，与模型生成 trial 分开计证；比较 v3（`schema_version=3`）于第18轮首次完成同图原生数据绑定。`run_matlab_gate.m` 在导出后读取原生 Scatter 和水平 Line 的坐标、端点、归属与身份，报告/evaluator 消费者核对完整 12 条合成记录、11 个散点、未绘值、QC/不确定度掩膜、统计及 release/input hash。模型 QC 和不确定度保持 `not_provided`。旧包缺 v3 仍兼容，错误声明必须拒绝；仅凭 4/4 合成输入声明绑定不能证明完整对抗套件通过、海况观测、独立重跑、桌面交互或全图视觉。

第20轮 `test_comparison_native_evidence` 在 R2021a/R2024b/R2026a 每版完成 4 个正例及 36/36 个 reader 负例；实际 `native-reader-test-results.json` 与日志终标记 `COMPARISON_NATIVE_READER_TEST_NEGATIVES=36`、`COMPARISON_NATIVE_READER_TEST=passed_synthetic_native_mutations_only` 一致。`scatter-nan-size` 已到达 reader 并抛出 `run_matlab_gate:ComparisonProofHandles`，不是把 setter 失败当拒绝。最终恢复/哈希断言已到达，`original_artifacts_unchanged=true` 与六件导出和输入快照哈希一致；仍为 `visual_verified=false`、`desktop_interaction_verified=false`。消费者 mutation tests 与这个合成原生 reader 套件分别计证，不升级第19轮仅 5/36 的旧证据，也不代表整体 CI 或真实海域报告通过。

报告构建通过 `evals/build_ocean_report.py --runtime-output <运行产物目录> --rendered-audit <外部检查JSON>` 显式接收外部检查文件，核对审计文件 bytes/SHA-256、manifest/产物绑定、检查条件与状态一致性，不自动寻找审计文件。shell 工作流先执行图件检查，再将该文件传入报告；报告只验证外部自动检查声明，不重跑或认证检查工具，不是 trusted 视觉审计。缺证据保持 `not_verified`，旧版 `pdf_font_embedding=failed` 必须明确显示，不能被未验证的文本或视觉项掩盖。历史第22轮 R2026a 外部产物检查 12/12 通过，R2021a/R2024b 各 4 件 PDF 字体嵌入失败（含未嵌入 Courier）仍保留。历史独立 DISPLAY 诊断中 R2024b 以 `oi_annotate_svg:UnsupportedNormalization` 拒绝白名单外的 SVG `font` 元素，不与 evaluator 产物混同；报告构建成功不是视觉或整体 CI 通过。报告聚合器候选在缺少有效报告绑定 policy 时不读 `generatedRoot`；有 policy 后，入口、manifest、所有产物引用和 MATLAB 源路径完整预检通过才做物理检查，不能因科学字段失败跳过物理检查或把失败变成通过。status/policy/AST 及像素门禁新代码仍未生产部署，合成测试不证明真实海区报告通过。

R20 源码候选通过 `parseOceanEvidenceTime` 共享严格 UTC coverage 端点解析，并要求主报告 `data-uncertainty-status`、`data-uncertainty-method` 与 manifest 科学上下文精确一致；非空 `data-uncertainty` 自然说明仍需人审，不能用子串命中认证语义。这些源码合同不代表真实海区报告已验证，也不扩展为每条原始 point 时间认证。
