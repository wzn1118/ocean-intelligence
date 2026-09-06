# R21 Fixture Canvas 只读设计审核

- 日期：2026-09-06。仅审源码及 MathWorks 官方 R2021a/R2024b 文档；本机 `command -v matlab` 无结果，未执行 MATLAB、DOM、reparent、恢复或新图渲染，不替用 Octave。
- 结论：**整棵 TiledChartLayout 迁入 Panel 有公开 API 依据，可作为两旧版的隔离出图探针；当前检查不足以证明原图完整恢复，不能接生产或签视觉通过。** 未发现当前代码中确定非法的 setter，也未发现 R19 异构结构数组初始化错误的同型复现。
- 审核对象包括主线程新 `test_native_pdf_fixture_canvas.m`（下称 T）和 Huygens 新 `build_native_pdf_fixture_case.m`（下称 B）。仅新增本报告；不修改二者、生产 exporter、门禁、评分、原件。不重做 simple 12 PDF；R2026a 保持生产 exact 路径。

## 优先风险

1. **恢复完成不等于几何恢复，当前未比较。** [T:132](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_fixture_canvas.m:132) 在 root 回迁、删 panel、drawnow 后即记 `restoration_completed=true`；[T:147](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_fixture_canvas.m:147) 只检查六个 snapshot 的 `captured`，不检查位置、字体、刻度或父身份相等。reference/restored PNG 均留 hash，但没有解码像素比较。因此存在 geometry 漂移而 `completed_diagnostic` 的路径；该状态只能解释为诊断流程完成。
2. **恢复只覆盖 root，而且基准在两次 reference print 之后。** [T:101](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_fixture_canvas.m:101) 保存 root 的 Parent/Units/Position/OuterPosition/PositionConstraint；[T:196](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_fixture_canvas.m:196) 不恢复后代 axes 状态。R20 已记录 R21 普通 axes 在 export 后 PositionConstraint 改变，但这不是本轮 tiled axes 已变化的证据。应分别比较 constructed→before_wrap（reference 副作用）与 before_wrap→after_restore（包装副作用），不可混为一种变化。还需单列 after_restore→after_restored_png。
3. **中文 layout.Title 不在当前枚举闭包内。** [T:86](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_fixture_canvas.m:86) 仅用 `findall(figure)`；官方说明 layout.Title 不在 Children 中，findall 的隐藏句柄能力不能补回非 Children 对象。当前无法凭这六份快照证明交互图中文标题文字、字号或位置不变。应直接读取 `layout.Title`，并显式检查 `Legend.Title`、axes.Subtitle、各轴标签和 Colorbar.Label；无公开 Extent/Position 就记 unavailable，不能填零。现有 [oi_export_figure:630](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_export_figure.m:630) 已有单独读取 layout/legend 文本的先例。
4. **data/paint 相等范围不足，缺测含义可能漏检。** [T:208](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_fixture_canvas.m:208) 保留原句柄并比较完整 X/Y/CData、errorbar deltas、UserData 及若干线/标记属性，这是有效的局部证据；但未比较 AlphaData/AlphaDataMapping/CDataMapping、CLim/Colormap、YDir、限值/刻度/模式、DataAspectRatio/PlotBoxAspectRatio、Clipping、FaceAlpha、DisplayName、ErrorBar.CapSize、appdata 或 DataTipTemplate。Hov 用 AlphaData 表示缺测，comparison 用 axis equal，遗漏直接关联图意。geometry 中部分字体/文字/Visible 虽已采集，却也没有相等判定。
5. **root 门禁只覆盖可枚举的 Children，不是全部顶层对象。** [T:97](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_fixture_canvas.m:97) 可拒绝可见的独立 Legend/Colorbar/UI root，属于保守限制；但 HandleVisibility=off 的 annotation/container 仍可在 figure 中而未迁入 panel。应只读采集 `allchild(figure)`，按真实 Parent 身份区分受支持根与明确排除对象；未知根需诊断失败，不要开 ShowHiddenHandles、改变 HandleVisibility 或照单全迁。当前四个 builder 预期为单 layout root，尚无原生证据证明存在该隐藏根问题。
6. **恢复异常诊断与安全边界仍有限。** root 恢复循环任一 setter 抛错就停止，后续 root 不再尝试；catch 会记录 restoration_error，但失败后没有独立恢复快照，[T:228](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_fixture_canvas.m:228) 的 same_data 还会丢弃 getter/已删除对象的具体异常，仅回 false。当前最终 delete(figure) 只适用于本探针自建、独占、可销毁 figure，不能搬进接收调用方 figure 的 exporter。一般复用前必须验证所有原 root/对象父链已恢复且 panel 无原件后代，再删 panel；恢复失败需保留逐对象错误，不能用删除容器掩盖。

## 真实层级与 API 边界

| 对象路径 | 本地实现与迁移约束 |
| --- | --- |
| 前三图 | [run_matlab_gate:303](/opt/ocean-intelligence/codex-runtime/matlab/evals/run_matlab_gate.m:303)：8x5in Figure → 单格 TiledChartLayout → Axes。layout 归一化 OuterPosition=`[0.05 0.08 0.9 0.84]`，预留0.4in。B:124沿用此构造，不是重画 simple probe。 |
| Hov | Axes 持有 Image；Colorbar 与关联 Axes 同 parent，gate 将 Colorbar.Layout.Tile 设 east。R21 Image.XData 是相对于原 DatetimeRuler 的 ruler2num 值，R24 接受 datetime imagesc；应保留原 axes/ruler/image，不能重建数值轴。 |
| Profile | Axes 持有多条不同线型曲线，长 ylabel 归 axes；Legend 位于 east 外围 tile，日期字符串是图例内容。只迁 layout，不另迁/recreate legend。 |
| Comparison | Axes 持有 Scatter、1:1 Line、HandleVisibility=off 的真实不确定度 Line；有三行 Subtitle 和双行 Legend.Title，Legend 位于 south tile。保留 axis equal、所有身份/角色 metadata，不把隐藏句柄误当无效数据。 |
| Interactive | [template:261](/opt/ocean-intelligence/codex-runtime/matlab/assets/interactive_timeseries_native_template.m:261)：Figure → layout → Axes → Line/ErrorBar，中文标题为 layout.Title，不是 Axes.Title；8x5in 时 layout 外边预留0.25in，时间端点各4%。B:162指定 Export=false/Interactive=false，只构造传统无交互图；不能据此验证 Desktop/DataTip/Brush 生命周期。 |

- R2021a 与 R2024b 的 TiledChartLayout.Parent 均允许 Panel。整体 root 迁移保留内部 axes/legend/colorbar 的原 Parent 身份，不需要逐个拆迁 axes；拆迁反而会失去 tile 分配和共享标题关系。[R21 layout 属性](https://www.mathworks.com/help/releases/R2021a/matlab/ref/matlab.graphics.layout.tiledchartlayout-properties.html)、[R24 layout 属性](https://www.mathworks.com/help/releases/R2024b/matlab/ref/matlab.graphics.layout.tiledchartlayout-properties.html)
- 两版官方明确 Legend/Colorbar 必须与关联 axes 同 parent，axes 改 parent 时二者自动跟随。不能把二者当作任意独立 UI 对象改 parent；当前候选未做这种拆迁。[R21 Legend](https://www.mathworks.com/help/releases/R2021a/matlab/ref/matlab.graphics.illustration.legend-properties.html)、[R24 Legend](https://www.mathworks.com/help/releases/R2024b/matlab/ref/matlab.graphics.illustration.legend-properties.html)、[R21 Colorbar](https://www.mathworks.com/help/releases/R2021a/matlab/ref/matlab.graphics.illustration.colorbar-properties.html)、[R24 Colorbar](https://www.mathworks.com/help/releases/R2024b/matlab/ref/matlab.graphics.illustration.colorbar-properties.html)
- 当前 `restore_geometry` 只向 axes/layout 写公开 Units、Position、OuterPosition、PositionConstraint；其 root_state 用 cell，geometry 统一外层字段且首次直接赋 record，没有向 Text.FontUnits 或 Panel.InnerPosition 写值。**Panel.InnerPosition 是只读属性**，后续扩充通用恢复函数时不可把 getter 清单全部当 setter 清单；Legend.Position 会把 Location 改 none，Colorbar.Position 会改 manual，在 tiled parent 下位置设置还可能无效。[Panel 属性](https://www.mathworks.com/help/releases/R2021a/matlab/ref/matlab.ui.container.panel-properties.html)、[Axes 属性](https://www.mathworks.com/help/releases/R2021a/matlab/ref/matlab.graphics.axis.axes-properties.html)
- `uistack(backgroundAxes,'bottom')` 的单 Axes 参数属于 R2021a 文档支持类型；没有证据认定此 setter 非法。最终混合 layout/axes 的导出堆叠仍需实图验证，不外推 `uistack(layout,...)` 可用。Figure.Children 只能重排现存 children；[T:205](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_fixture_canvas.m:205) 应在全部原 child 仍存在且属于 figure 时才重排，并校验原 child 相对次序。[uistack](https://www.mathworks.com/help/releases/R2021a/matlab/ref/uistack.html)、[Figure 属性](https://www.mathworks.com/help/releases/R2021a/matlab/ref/matlab.ui.figure-properties.html)
- Panel 是 exportgraphics 的公开目标，vector PDF 包含可嵌入字体，但旧 API 仍按内容 tight crop；真实白色 rectangle 只能作为画布候选，不能由8x5in对象尺寸推导 MediaBox 必然576x360。文档另说明相邻/子容器不都被捕获，不能只凭 Parent setter 合法就认定 layout 内全部文字/色条已导出，也不能把此限制机械解释为 tiledlayout 必然被遗漏。[R21 exportgraphics](https://www.mathworks.com/help/releases/R2021a/matlab/ref/exportgraphics.html)

## 可采集与不得触动

| 类别 | 应保留/对比的具体证据；仅列公开存在的属性 |
| --- | --- |
| 身份及父链 | 为原 handle 建稳定 object_id，记录 parent_id、原 child 次序、HandleVisibility、Layout.Tile/TileSpan；六个阶段沿用同一 ID。当前 parent_class 无法区分两个同类父对象。layout/legend 特殊文本用 owner_id+role 单独记录。 |
| 画布 | Figure.Units/Position、PaperUnits/PaperPosition/PaperSize/PaperPositionMode、Color、Renderer/RendererMode、WindowStyle；groot.ScreenPixelsPerInch。Panel.Position/InnerPosition/BorderType/BorderWidth/Title/Units。两者实际可绘制宽高须匹配，不能只看声明的8x5。归一化 layout 位置相对 parent，parent 实际内区变了就会重排。[尺寸语义](https://www.mathworks.com/help/releases/R2021a/matlab/ref/matlab.ui.container.panel-properties.html) |
| 布局 | root/axes Units、Position、OuterPosition、InnerPosition、PositionConstraint、TightInset；layout Padding/TileSpacing/GridSize；axes X/YLim及Mode、X/YTick与Label及Mode、方向/尺度、ruler class/日期格式、两种 aspect ratio及Mode。尺寸/浮点坐标应输出差值及明确单位，不把 auto 重排静默归一成相等。 |
| 文字/外围tile | 显式 Title/Subtitle/XLabel/YLabel/Legend.Title/Colorbar.Label 的 String、FontName/FontSize/FontUnits、Interpreter、Visible、Rotation及可读几何；Legend.Layout/Location/Orientation/NumColumns/AutoUpdate/String/Box；Colorbar.Layout/Location/Limits/Ticks/TickLabels/Direction。缺公共边界保持 unknown，而非裁切通过。 |
| 数据及绘制 | 补齐优先风险4的属性；保留完整数组类型、NaN、datetime/时区、UserData、相关 appdata；不得修改 OI_ColorAccessibilityRole、QC/uncertainty/ID绑定来让测试相等。ErrorBar/Scatter/隐藏 Line 必须保留原 handle 和原科学 axes 父关系。 |
| 背景 | 独立 background Axes 的 Parent/Units/Position/XLim/YLim、rectangle 的 Position/FaceColor/EdgeColor/Clipping/Visible及全 panel child 次序；白色面是实际绘制元素，不是假文本。不要在科学 axes 中加面、改 Color/CLim/colormap、cla 或重建 legend；Hov 原 missingColor 必须保留。 |
| 交互/环境 | 原 Figure.CurrentAxes、groot.CurrentFigure、CloseRequestFcn、DeleteFcn、SizeChangedFcn/ResizeFcn（存在时），OceanInteractionState、DataTipTemplate、BrushData。创建背景 axes 会影响 current axes；目前未快照/恢复。保持 Interactive=false，不调用 close(originalFigure)、切换 brush/datacursor、重建 linked axes 或启用 Desktop 来辅助导出。 |

- 当前六次 geometry 和两次 wrapper geometry 均要求 captured，失败不会当成成功；首条异常字段保留。建议在同样六节点上增加明确的比较状态/差异列表，而非删减采集或放宽为可选。附属 getter 失败应指出 object_id、property、MATLAB identifier；不要只留 `same_data=false`。
- 删除临时 panel 前的最低恢复检查：全部原句柄有效；原 root.Parent 身份恢复；所有原科学数据对象仍在原 axes；Legend/Colorbar 的 axes/tile 关系未变；原 root 相对次序恢复；panel 内无任何原对象。CurrentAxes 等环境状态也应回原值。当前 fresh fixture 最终销毁不是调用方图可恢复的证明。
- 不宜用对所有 axes 强设 Position/PositionConstraint 来“修平”差异：tiled axes 的布局由 parent 管理，官方说明这些设置可能无效。先记录哪一层变化，再决定隔离 probe 是否失败；不得把原0.4in/0.25in margin改成全页 layout 来追页尺寸。
- 新产物需分别核验原生 API、raw PDF SHA/MediaBox、pdffonts 嵌入、英文/中文/统计/日期抽取、真实 PNG/PDF 图面；reference/restored PNG 应解码比较，文件hash相同/不同不是统一的视觉结论。旧 reference print PDF 的 Courier 失败保留，不能因 canvas PDF 新候选出图而改签。

## 已确认与未验证

- 已确认隔离：T只在R2021a/R2024b跑候选，R26为not_applicable；目录要求fresh，四候选独立，reference PNG+print PDF先于wrap，panel仅用于exportgraphics vector PDF，restore后才print PNG；不做外部PDF后处理。exact_page/font_embedding/layout_verified均仍false，counts_toward_stage=false。B沿用四真实helper，并绑定输入fixture hash，不是另造科学数据。
- 原生 setter 成功、tiledlayout/外围tile在panel export中的完整性、实际字体/页面、像素恢复、回调恢复均 **未验证**。本报告不把官方属性许可、静态源码或R20普通axes的0pt证据写成本轮复杂图通过；不批准 trusted visual、Desktop、100分或生产策略替换。
- 官方文档通过 MathWorks release 归档HTML实际读取；web工具返回503后使用 urllib 获取同一官方URL，并用BeautifulSoup按属性标题解析，未依赖第三方转述。findall只覆盖层级后代：[官方说明](https://www.mathworks.com/help/releases/R2021a/matlab/ref/findall.html)。

## 审核源码 SHA-256

以下为本次实际读取的源码快照，不是将来CI源码或产物hash；新增候选可能随后由各所有者修改。

| 文件 | SHA-256 |
| --- | --- |
| [test_native_pdf_fixture_canvas.m](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_fixture_canvas.m) | `4a4ba941aa28fb7ca4e81107178740f7e98b18156b3221dd56502327a27c39c2` |
| [build_native_pdf_fixture_case.m](/opt/ocean-intelligence/codex-runtime/matlab/tests/build_native_pdf_fixture_case.m) | `152e8e687bb41bdc71650b91e86255d58b0da953fa03c9cc9062c8d7c0402362` |
| [run_matlab_gate.m](/opt/ocean-intelligence/codex-runtime/matlab/evals/run_matlab_gate.m) | `b15d5e6849f1f0b1f6fa2a3fbf2cdcd5ba3734bf0b766c8079fa18c897c0c3f8` |
| [interactive_timeseries_native_template.m](/opt/ocean-intelligence/codex-runtime/matlab/assets/interactive_timeseries_native_template.m) | `792fcabcce3881ecc922ff574cd4e1353a3ff6e1e6ec4e6a7b82198554338744` |
| [oi_plot_hovmoller.m](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_hovmoller.m) | `95df6d7afa9f991f3b625e3af5384eb0357aabcd7c7e22291394ea3ca6521a33` |
| [oi_plot_profile.m](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_profile.m) | `a7f481cc007a8967ce7aacec74eb6be99bc519e01703d51d386a64902d48379b` |
| [oi_plot_comparison.m](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_comparison.m) | `e8df5b2a70f6d62c80ad551492e6323f6830fd4e3bbfbe7ee2ba36d6d030e217` |
