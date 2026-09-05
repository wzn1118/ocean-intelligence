# 第八批 R26 显示环境对照：33989124823

2026-09-05 UTC。只看 R2026a baseline/display 的 publication 各 PNG/PDF/SVG、01-exact-first 各 PDF，共 **8/8 原件逐个实际 view_image**；另只读五份对应 JSON。不看 R21/R24、其他 probe/回归图、源码或 score/audit，不运行 MATLAB。
仓库仅新增本报告，预览另存 `/tmp/matlab-visual-baseline/33989124823`；8 个原件及五份 JSON 前后 SHA256/字节数不变。未改原件、评分、audit、visual 标志或源码，未提交推送。本报告是观察证据，**不是批准 visual 或生产验收**。

## 结论与环境限制
- **目标缺陷在本包 R26 display 两个样本中未再出现**：publication PDF/SVG 的标题不再贴顶/偏右，Ylabel 回到左轴附近；01 PDF 的完整长双语标题和长 Ylabel 均可读且入页。baseline 对应原件仍重现锚点偏位及裁切。
- **不是靠扩大 PDF 页面或更换 figure target 避开问题**：publication 两条件都为 288 x 162 pt，01 都为 576 x 360 pt；01 两条件都是 figure target、相同 exact 选项。与上一批 axes-tight 改 target/页尺寸的试验不同。
- **本包 R26 是 ScreenPixelsPerInch 72→96，不是 100**：baseline probe JSON=72，display probe JSON 和 display-rendering.json 均=96。这里只纠正本包 R26 记录，不推断其他版本。
- DISPLAY、屏幕 DPI 与显示环境初始化同时变化，不能归因为“单独设置 DISPLAY 必然修复”或“只改 DPI 就够”。结果支持把该 R26 组合列为下一轮生产候选条件，不足以批准所有格式/版本/图或取消逐图检查。
- JSON scope 保持 `virtual_display_diagnostics_only`；DISPLAY=`:98`，JVM=true、desktop_available=false、visual_verified=false、desktop_interaction_verified=false，status=`completed_pending_external_review`。**desktop=false 不是 Desktop 已验证**；未执行 Desktop/交互操作，未将这些字段改成 true。

## API、尺寸、字体与抽取分别判断
| 层面 | 本次证据与结论 |
| --- | --- |
| 原生 API | 两份 publication manifest 的 PNG/PDF/SVG 都记录 exportgraphics，无 print fallback；两份 01 JSON 都记录原生 exportgraphics.p 路径、target=matlab.ui.Figure，ContentType=vector、Units=inches、Width=8、Height=5、Padding=figure、PreserveAspectRatio=on。是元数据取证，未重跑调用；**本范围没有 print 对照，不外推 print 路径改善**。 |
| 精确尺寸 | 两张原 PNG 均 1200 x 675；四份 PDF 均单页，publication=288 x 162 pt (4 x 2.25 in)，01=576 x 360 pt (8 x 5 in)。两 SVG 均 1200px x 675px，CSS=4in x 2.25in，viewBox=`0 0 288 162`。尺寸正确与视觉正确分开。 |
| PDF 字体 | 四份 pdffonts 均为 WenQuanYiZenHei / CID TrueType / Identity-H，emb=yes、sub=no、uni=yes；pdfinfo 均为 R2026a Update 5、Qt 6.8.1。**baseline 也已嵌入 WQ，因此本次改善不是“原先未嵌入、现在嵌入”**。不重复主线程 R21/R24 Courier 检查。 |
| PDF 抽取 | 用 pdftotext -bbox-layout 解析实际文字与页面框，见下表。baseline publication 中文能抽出却仍触顶；baseline 01 只抽出标题/Ylabel 残串，display 01 可抽出完整英文及中文。抽取成功不替代图面查看。 |
| SVG 抽取 | 两原件均无 text 元素，文字为图形内容；aria-label/元数据有中文不算字形证明。本次两份都经标准渲染后实际查看，不声称 SVG 可搜索文本已验证。 |

## 八个原件逐项视觉
| 原件 ID | 实际所见 |
| --- | --- |
| B-PNG / baseline publication | 中文标题和两轴完整；横排图例在框内；极值/右端标记触轴框。 |
| B-PDF / baseline publication | 标题可辨但偏右且触页顶；Ylabel 靠页左且向上移，Xlabel/图例文字锚点与 PNG 不同；图例本身在框内，不判文字定位正常。 |
| B-SVG / baseline publication | 标准渲染重现 PDF 的标题触顶/偏右和标签偏移；中文可辨，图例不越框。 |
| D-PNG / display publication | 中文标题/轴标签完整、图例入框；相比 baseline 刻度更密、几何有调整，不是逐像素相同图。 |
| D-PDF / display publication | 中文标题回到绘图区上方并有上边距，Ylabel 在左轴旁、Xlabel/横排图例分开且完整，未再见 baseline 的锚点裁切。标记仍触轴框；字重、虚线间隔观感与 PNG 不完全一致，不签全格式保真。 |
| D-SVG / display publication | 实际渲染的中文标题、轴标签完整，标题不触顶，图例在框内，布局接近 display PDF；标题字重仍与 PNG 有差异。 |
| B-01 / baseline exact-first PDF | 长标题从画面中部向右展开，英文右尾及中文不可见；长 Ylabel 上移，reference 后说明被截；Xlabel 偏右。 |
| D-01 / display exact-first PDF | 完整标题 Ocean temperature profiles: Station A and Station B - 南海温度剖面 横向居中，长 Ylabel 沿左轴居中且可读，Xlabel 完整；未见目标文字裁切。刻度由稀变密，不能声称除裁切外其他布局均未改变。 |

## 实际文字 Bbox
坐标 `(xMin,yMin,xMax,yMax)` 为 Poppler 行框，单位 pt、原点页左上；不是从 MATLAB Extent 推算，也不是实际着墨边缘的精确测量。
| PDF / 文字 | 实际抽取与 bbox |
| --- | --- |
| B-PDF title / Ylabel | 南海海表温度 `(141.500,-1.252,219.500,15.125)`，上越界；温度 (degC) `(3.410,15.966,17.267,72.000)`，靠左且上移。 |
| D-PDF title / Ylabel | 南海海表温度 `(113.040,15.657,190.800,31.984)`；温度 (degC) `(21.646,34.987,35.251,90.000)`，均在页内。 |
| B-01 title / Ylabel | 实际残串 `Ocean temperature profiles: Station A and Stati` `(287.500,2.504,577.784,20.141)`，xMax>576；`Depth (m, positive down; reference` `(38.808,0.766,53.925,184.000)`，只代表页内残串。 |
| D-01 title / Ylabel | 完整 `Ocean temperature profiles: Station A and Station B - 南海温度剖面` `(94.680,19.081,499.882,36.315)`；完整 `Depth (m, positive down; reference: mean sea level)` `(56.880,42.545,71.392,305.280)`，均入页。 |
| 01 Xlabel 前后 | 两份实际均为 Temperature (degC)；baseline `(287.500,336.208,390.772,351.325)` → display `(247.680,328.480,346.851,342.992)`，位置回到绘图区下方中部。 |

## 查看副本与方法
PDF 使用 Poppler 22.02.0，`pdftoppm -f 1 -singlefile -r <dpi> -png`；publication 300 dpi→1200 x 675，01 为150 dpi→1200 x 750。两 PNG 直接 view_image，四 PDF 预览及两 SVG 预览均逐张 view_image；未裁页、补画、修改原始 SVG。
SVG 使用 librsvg 2.52.5/Cairo 1.16，通过 ctypes 标准 API、固定 CSS DPI 96、完整 viewport `(0,0,1200,675)`、白底；这个查看参数不修改 MATLAB 生成环境。两次成功，非白 bbox baseline=`(21,0,1060,619)`、display=`(94,67,1069,617)`，灰度<245 像素分别 54555/53762。无浏览器验证，SVG 结论限该渲染器。
| 已实际查看的转换副本 | SHA256 |
| --- | --- |
| [B-PDF](/tmp/matlab-visual-baseline/33989124823/baseline-publication-pdf.png) | `299486f681874918e042efed64b4f2b1c9df9be2dcbd2bb12e8ade3187431797` |
| [B-SVG](/tmp/matlab-visual-baseline/33989124823/baseline-publication-svg-librsvg.png) | `61f941724a96ddf825bcf2279d45423672f184ceccf01bc68716bcd3fede6a24` |
| [D-PDF](/tmp/matlab-visual-baseline/33989124823/display-publication-pdf.png) | `027d15c2ae6788ce23909ebddca0867e5d51d303b91302ed1a88a2377190868c` |
| [D-SVG](/tmp/matlab-visual-baseline/33989124823/display-publication-svg-librsvg.png) | `1225472ebcc709fd315d0725482053fe53298dab509b3bea06b3b9098aee7dca` |
| [B-01](/tmp/matlab-visual-baseline/33989124823/baseline-01-exact-first-pdf.png) | `5626bc622202ddb750f8679d4e0a79c7d7978e7f1748f8622eb1998d51a67b83` |
| [D-01](/tmp/matlab-visual-baseline/33989124823/display-01-exact-first-pdf.png) | `6f6e864c88797415d0d7ff576eb25d6f60c1b6ec141f1a0d6aba2ddbcc4372d7` |

## 原件与环境哈希
以下八个图像原件和五份只读辅助 JSON 分别绑定；JSON 不计作额外目视图，scope/visual/desktop 字段全部保留原值。
| 文件 | SHA256 |
| --- | --- |
| [B-PNG](/tmp/matlab-run-33989124823/matlab-full100-R2026a/export/full100-export-artifacts/publication.png) | `827ef9831cf1a232fe8256e886e8e0531f3af691d3c8e0d043a658d53229df29` |
| [B-PDF](/tmp/matlab-run-33989124823/matlab-full100-R2026a/export/full100-export-artifacts/publication.pdf) | `3c85f1ce493e6956ca9761aaff1b68a0e01b781b9f04c263f9f7e69b47807465` |
| [B-SVG](/tmp/matlab-run-33989124823/matlab-full100-R2026a/export/full100-export-artifacts/publication.svg) | `d690c8c08fb1235a37b6118f8106fd92034e95d4cdc8063d59d6c8b4602cf8a0` |
| [D-PNG](/tmp/matlab-run-33989124823/matlab-full100-R2026a/display-comparison/publication/publication.png) | `9c384a1426294d84cc596128a93ac5beff734d0b6edf0fd834ee2f503d424ea0` |
| [D-PDF](/tmp/matlab-run-33989124823/matlab-full100-R2026a/display-comparison/publication/publication.pdf) | `c359250ad5ad82d5aff38c1a0de21daae12e2c722354cc5d060d5c6398fa7e52` |
| [D-SVG](/tmp/matlab-run-33989124823/matlab-full100-R2026a/display-comparison/publication/publication.svg) | `28236ed449066119130ba8151bda13ea8118afc6d246484868a888834185ca99` |
| [B-01](/tmp/matlab-run-33989124823/matlab-full100-R2026a/vector-text-alignment-probe/01-exact-first.pdf) | `5a61ac5b06f66f66b28f305234813427825e69dab69fa970b51ee9d9fc30afae` |
| [D-01](/tmp/matlab-run-33989124823/matlab-full100-R2026a/display-comparison/vector-text-alignment-probe/01-exact-first.pdf) | `0315462684b02775c405c879ecadbb59fb79a820e7cc6356d937be28cf88b18b` |
| [baseline publication manifest](/tmp/matlab-run-33989124823/matlab-full100-R2026a/export/full100-export-artifacts/figures.json) | `b1cd3765b171d0b16a1a2dfe285312b175f05c9b1f1567978b1ef13b6183a4ec` |
| [display publication manifest](/tmp/matlab-run-33989124823/matlab-full100-R2026a/display-comparison/publication/figures.json) | `642187d158cad78d0327b61e222e2c08c893ed9fe6d20ff6b62f6e7f2b4f0b8f` |
| [baseline probe JSON](/tmp/matlab-run-33989124823/matlab-full100-R2026a/vector-text-alignment-probe/vector-text-alignment.json) | `a2ecbb90fdc412317ba0ce8eee539d18307199665fe153e899a8b9e32aca0b75` |
| [display probe JSON](/tmp/matlab-run-33989124823/matlab-full100-R2026a/display-comparison/vector-text-alignment-probe/vector-text-alignment.json) | `d40501362697b5096015b949b37a485d05d9192926b5d3693b4a7e354fa8ceeb` |
| [display-rendering.json](/tmp/matlab-run-33989124823/matlab-full100-R2026a/display-comparison/display-rendering.json) | `63e102611b0f01fb88c6da46341ac9bbafd9ec0eaf64de0b4e4a529dfd28e099` |
