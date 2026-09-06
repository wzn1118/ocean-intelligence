# R22 comparison 布局最小候选

2026-09-06。只读基线为本地 `587c382a7155c265abb82137b6e5ce47717b8de0`；远端 SHA 按主线程提供，不据此声称新 CI 已通过。原件来自 R20 run `34000171748`。下文 E 为 evaluator 的 `paired-observation-model`，H 为独立 U 测试的 `synthetic-observation-uncertainty`；MATLAB R2021a 与项目第21轮不是同一编号。

## 已证实与待定位

- **不是单一字体问题。** [R21 视觉审查](/opt/ocean-intelligence/.codex-evals/matlab-100-20260905/astra-resume/comparison-visual-review-round21.md:5) 已发现 R2021a E 的 PNG/PDF/SVG 均有 xlabel 被图例遮挡、首行 Legend.Title 超出框线。此次复看 E 原 PNG、既有 PDF 预览及 H 原 PNG，与该结论一致。R2024b 的同类 PNG/SVG 未见对应缺陷，不能把 R2021a 现象泛化为所有版本。
- **遮挡对象须分清。** 此次对 E 原 PDF 执行 `pdftotext -bbox`：xlabel 的纵向区间为 `253.081..261.727 pt`，首行图例标题为 `262.150..270.010 pt`；两段字形框本身没有相交。结合 R21 审查的图例框顶线约 `257.4 pt`，直接问题是图例容器/底色压住 xlabel，而非已证明的两段文字字形相交。
- **旧 PDF 另有真实字体度量失配。** 此次 `pdffonts` 仍只列未嵌入 Courier，Producer 为 Apache FOP；E 主标题残留文字框到 `580.700 pt`，超过 `576 pt` 页宽。R21 审查还记录 H 的旧版 PDF 首行图例标题和条目越框。单独修复外围布局不能据此宣告 PDF 字体、条目或主标题已修好。
- **生产路径差异明确，内部原因尚未做单变量验证。** [helper:141](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_comparison.m:141) 已先应用 theme，再显式设置 legend 字体和双行原生 Title；[gate:323](/opt/ocean-intelligence/codex-runtime/matlab/evals/run_matlab_gate.m:323) 随后把四向 outside legend 转为外围 `Layout.Tile`。H 则保留按 axes 定位的 `southoutside`，不执行该转换。H 的数据、标题、Padding 和页边距也不同，所以这里只能把外围 tile 分配列为优先假设，不能宣布已定位 MATLAB 内部缓存或排版算法 bug。
- **已有门禁存在明确覆盖缺口。** [exporter:171](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_export_figure.m:171) 的重叠统计只比较 `textEvidence`，legend 容器仅进入裁切/页边距检查；[statistics test:187](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_comparison_statistics_layout.m:187) 比较 statistics 与其它区域，却没有 xlabel 与 legend 容器的直接配对检查。因此零 text overlap 不排除本次遮挡，修复不能只沿用旧零计数验收。

## 官方 API 约束

本轮成功读取以下 R2021a 官方归档 HTML；当前版网址曾返回403，搜索工具返回502/503，不依赖其失败结果。

| 已核对 API | 对候选的约束 |
| --- | --- |
| [Legend 属性](https://www.mathworks.com/help/releases/R2021a/matlab/ref/matlab.graphics.illustration.legend-properties.html) | `Location` 是相对 axes 的位置；`layout` 位置由 `Layout.Tile` 控制，四个外围 tile 是公开用法。`Position` 在 tiledlayout parent 下设置无效，在可手动定位情形又会把 Location 改为 `none`。不建议同时写 Tile/Position，也不把 Location 和 Tile 当成两套同时生效的定位器。 |
| [TiledChartLayout 属性](https://www.mathworks.com/help/releases/R2021a/matlab/ref/matlab.graphics.layout.tiledchartlayout-properties.html) | `TileSpacing` 控制 tile 间距，`Padding` 控制外围留白；两者不是任意像素位移 API。R2021a 的 `compact` 仍是有效值，不能仅凭版本改名就归因为非法设置。原 E 已使用 loose Padding 和0.4in页边距，不先全局增白边。 |
| [Legend.Text 属性](https://www.mathworks.com/help/releases/R2021a/matlab/ref/matlab.graphics.illustration.legend.text-properties.html) | String 支持按行 string/cell 数组，FontSize 单位为 points；公开属性列表没有 Extent/Position。原生句柄属性与最终导出字形尺寸仍须分开记录。 |

## 首选候选 A：保留按轴外置，不再升级外围 tile

1. 在获准的小实验中完整复现 E：同一冻结 fixture、QC/U/RecordMetadata、theme、8x5in、0.4in page margin、`Padding='loose'`、`TileSpacing='compact'`。基线保留 gate 当前操作；A 只省去这张 comparison 图的后置 `Legend.Layout.Tile` 赋值。每个分支新建 figure，不尝试用未确认的空 Tile 值“恢复”旧句柄。
2. 保留 native `legend(axes,...,'Location',requestedLocation)`、两个标题行的全部文字和字号、条目及次序、1:1 reference；仍然是外置图例，不搬进数据区，不添加代理 axes、伪条目、annotation 或第二份说明文字。
3. 实验先限于有单侧说明的 comparison。`northwest`/`best` 等现有显式覆盖、四向 outside 以及合法对角 outside/`bestoutside` 值不能统一改成 south；默认 both 和无 U 调用保持原语义，不新增“模型不确定度未提供”声明。不要为其它图删除通用 tile 行为。
4. helper 单独改动不能阻止 caller 之后重新赋 Tile。若 A 获得原生证据，后续需由主线程在 comparison 调用边界作窄调整；本轮不改 gate、helper、builder 或探针，也不借复杂 canvas 实验替换该单变量对照。
5. resize 交给原生 axes/legend/tiledlayout，不缓存一次性像素坐标，不装 SizeChangedFcn/timer，不扩大坐标限值腾位置。A 的预期只是假设按轴分配能留足 xlabel 与标题空间；原生重排是否可靠必须实跑，不能由 API 支持推断。

**保留风险：** 8x5in 加页边距后的空间小于 H，A 可能仍越框、压缩数据区或未保留最小页边距；旧 PDF Courier 条目宽度也可能继续出错。A 如果只修 xlabel，不得标整体视觉通过。

## 条件候选 B：仅在 A 后仍有长标题越框时

可独立试验把首行按语义拆开：`Horizontal: observation` / `<实际 uncertaintyLabel> (<实际 unit>)` / `Model uncertainty not provided`，不删词、不缩字号；置信水平仍由原语义生成，不硬编码 degC。这只减少最长行宽，却增加一行高度，可能让纵向问题更坏，也不能修复 Courier 或 reference 条目碰撞。仅在新原件证明需要后测试 B 与 A+B，不把多项改动混成一个“成功原因”。

B **不是无协议影响的补丁**：[measure_comparison_plot_data:153](/opt/ocean-intelligence/codex-runtime/matlab/evals/measure_comparison_plot_data.m:153)、[U test:163](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_comparison_uncertainty.m:163)、[RecordMetadata test:266](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_comparison_record_metadata.m:266)、[native evidence test:73](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_comparison_native_evidence.m:73) 都绑定当前双行文字。若选择 B，需要另行授权同步明确的新分行契约；不能用宽松字符串规范化掩盖缺词或坏证据。首轮 A 不触及这些断言。

## 最小验证与拒绝条件

| 检查 | 必须保留的实证 |
| --- | --- |
| R2021a 单变量首轮 | E 基线与 A 各自新建 figure，完全相同输入和设置；记录实际 release、字体、Parent/Location/Tile、每阶段 geometry 与源码/fixture hash。先比较两分支，不改 R20 原件。 |
| 正常窗口 resize | 同一存活 figure 在8x5、10x6、6x4in之间往返，逐次 drawnow；有 DISPLAY 时检查实际可见窗口，不以 invisible figure 属性赋值充当桌面验证。无 DISPLAY 只报程序化 resize 已测。记录屏幕 DPI 和实际像素，不固定依赖某个 Xvfb DPI。6x4 若容不下就明确失败/边界，不能默默删字或缩字号。 |
| Native 三格式 | 回到最终8x5in后，用现有 R2021a 原生 print PNG/PDF/SVG 路径输出；各格式前后读取状态，确认2400x1500 PNG、300DPI、576x360pt PDF/等效 SVG。不后处理 PDF，不改尺寸门禁，不以屏幕图代替导出图。SVG 的既有注释/viewport处理如发生须区分原生源和最终交付件。 |
| 布局新增配对 | 同 figure 坐标系内比较公开 xlabel/ylabel/title/subtitle 的可测边界与 legend 容器边界；尤其显式拒绝 xlabel-legend 相交，保留旧 statistics 各对门禁。对四向 outside 分别检查对应侧与标签间距，不能只检 south。 |
| 最终字形与图例框 | 每格式查看完整主标题、轴标签、七项统计、全部 Title 行及条目，检查图例框/底色不遮字、条目不压 reference 样线、不越页。PDF 外部 bbox 与实际字体、PNG/SVG 渲染证据分开；外部 bbox 不冒充 native Title.Extent。Title 无公开几何继续 unverified。 |
| 科学与句柄不变量 | resize/导出各阶段以 isequaln 对比 Scatter/所有真实 U Line 的 X/Y、RecordID/SourceRow/UserData、QC/U数组和掩码、全量RecordData、Metrics/StratifiedMetrics、X/YLim及equal比例约束；保留missingU散点、suspect策略、端点、层序和aux角色，不以result单独替代native句柄检查。 |
| 兼容回归 | 单侧、默认双侧、无U；默认theme10和既有非默认12pt；未传及显式 LegendLocation（至少四向outside、northwest、best，并覆盖已支持的其它位置解析）。分组和缺测保留；both仍画真实双侧，不能凭空出现单侧说明。允许布局按窗口重排，不要求不同尺寸的Position数值相等。 |
| 跨版与证据边界 | R2021a 候选成立后再跑 R2024b/R2026a 对照；确认 theme FontName/FontSize、Title独立字号和原文始终不变。只有新产物可支持局部改善结论；字体嵌入、Title测量缺口和全图视觉结论分别报告，R21复杂canvas待CI不提前计入。 |

## 本轮实际检查与原件保留

本轮仅代码/契约阅读、上述局部原图复看、官方归档读取、原 PDF 的 `pdffonts`/`pdftotext -bbox` 和 SHA256复核。`command -v matlab` 无结果；未执行 MATLAB、候选A/B、resize或新导出，不声称布局已修复。未改评分、freeze、生产、探针或旧产物，未提交。

E 路径根为 `/tmp/matlab-run-34000171748/matlab-full100-R2021a/evaluator-runtime/`；以下四件复读 hash 与本轮首次读取及 R21审查账本一致。更多版本/格式的原件账本沿用上述 R21审查，不重复宣称本轮全量重审。

| E 原件 | SHA256 |
| --- | --- |
| paired-observation-model.png | `ce4638c749c1f55aa72701faca5a63a6b222b3259eea7ccfb5cff9375ca0dfae` |
| paired-observation-model.pdf | `11ef545c1d445ffcad44b4bd614d44694cd21bb710bf0dcc412c4578124f4f17` |
| paired-observation-model.svg | `7180bb89ccde9e5a48ebc4c31b1df3a729bfbb52fb8a02766926eccb9ca76bc1` |
| figures.json | `0cb074c3f0e9aed25232817df2aa95cc2936d54187f25997f9606dd76df2fb40` |

**交付建议：先授权 E 的 A/B 单变量小实验；在 xlabel-legend 与三格式原件验收完成前，不合入布局修复。**
