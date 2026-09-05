# 第四批实图审计：run 33985570222

审查日期：2026-09-05 UTC。只读 `/tmp/matlab-run-33985570222` 的指定原件、stage/manifest 及相关源码。仓库内仅新增本报告；查看副本另存 `/tmp/matlab-visual-baseline`。未改代码、原件、评分或已有报告，未运行 MATLAB，未提交或推送。五字体探针由 laplace 负责，本报告不重复该范围。

## 关键结论

1. **三版本目录齐全不等于三版本成品齐全。** R2026a 的 publication 三格式均不存在，`export-runtime` 因 strictclip (`ClippedContent`) 失败而未 promote；evaluator 仅留下前两图。R2021a evaluator 在第一图阻断，未 promote，无图可看。R2024b evaluator 有四图且该 stage passed，但 PDF 仍有实际版面缺陷。缺失项就此记录，不等待第五批新图，不扩大本轮范围。
2. **确认布局标题的 manifest 漏项，但不能把漏项写成图面标题缺失。** R2024b 中文交互 PNG/PDF 的 `温度时间序列 / Temperature time series` 实际完整可读；同图 `text_objects` 只有两个英文轴标签，`cjk_text_present=false`。`clipped_count=0` 没有覆盖这个布局标题。
3. **R2026a 现存两张 evaluator PDF 的裁切未改善。** 温度场标题上缘/右端、横轴标签下缘仍被截；盐度剖面标题、长 Ylabel、横轴标签仍被截。两张整页渲染与上轮 33984666441 各自逐像素相同。
4. **R2024b stage passed 不是 PDF 视觉通过。** 观测/模型 PDF 的标题右端被截、图例文字越框、参考线穿过统计文字；盐度剖面 PDF 的长 Ylabel 顶端被截。两图 manifest 的 `clipped_count` 和 `text_overlap_count` 都是 0。
5. R2021a/R2024b publication 六个现存格式均已实际查看，中文标题及两轴标签可读；两版 PDF 的 Latin 字形与 PNG/SVG 不一致，`observed` 紧贴图例右框。不能据此签收缺失的 R2026a 出版图。

**实际目视覆盖为 13 个本轮原件，不是 13 个合格项，更不是全量验收。** 13 个图像原件及 6 个 stage/manifest 文件的前后 SHA256、字节数均未变。并行线程修改了两个源码文件，单独记录在末节，不归为本次审计修改。

## Stage 与产物门禁

数据来自各版 `ci-stage-status.json`，不是上一轮的 14-stage 状态；本轮每版总数是 15。

| 版本 | stage 汇总 | export-runtime | evaluator-runtime | 指定成品实际存在情况 |
| --- | --- | --- | --- | --- |
| R2021a | passed 12 / failed 3 | passed | failed | publication PNG/PDF/SVG 齐；evaluator 仅 fixture-inputs，无四图、无 figures.json |
| R2024b | passed 13 / failed 2 | passed | passed | publication 三格式齐；evaluator 四图 PNG/PDF/SVG 及 figures.json 齐 |
| R2026a | passed 10 / failed 5 | failed | failed | 无 export 目录，publication 三格式缺失；evaluator 仅温度场和盐度剖面三格式，无比较图、交互图或 figures.json |

- R2021a evaluator：`oi_export_figure:ClippedContent`，`text=[0.42736 -0.0011111 0.10069 0.033333]`；stack 指向 `run_matlab_gate` 第 32 行，即第一张温度场导出。缺失项未验证，不补造哈希。
- R2026a publication：同一错误，`text=[0.38174 0.88681 0.27431 0.11728]`，上缘约为 1.00409；stack 指向 CI 的 `full100_export_contracts` 第 36 行。日志未给文字内容，不能仅凭 bounds 把该对象武断认作某一标题。
- R2026a evaluator：同一错误，`text=[-0.0071523 0.94706 0.66146 0.052778]`；stack 指向 `run_matlab_gate` 第 65 行，即第三张观测/模型比较图导出。前两图是失败 stage 的部分产物，不是 evaluator 完成证据。
- R2026a 另有 `text-bounds` 失败：`test_text_bounds:ColorbarGeometry`。这是坐标框测量测试失败，不等于已经看到色条标签与刻度相撞。
- 三版的 `plot-regression`、`manifest-evidence-integrity` 均失败；不修改或重算这些状态。stage 文件生成时间分别为 18:58:16Z、18:58:21Z、18:59:02Z。

## 实际查看方法与边界

| 范围 | 实际查看 | 方法 |
| --- | --- | --- |
| publication 原 PNG | R2021a、R2024b，各 1 张 | 原件分别 `view_image`，1200 x 675 |
| publication PDF | R2021a、R2024b，各 1 份 | Poppler 整页 300 dpi 渲染，再分别 `view_image` |
| publication SVG | R2021a、R2024b，各 1 份 | librsvg/Cairo 实际渲染，再分别 `view_image`，不是 XML 代替视觉 |
| evaluator PDF | R2024b 四份、R2026a 两份 | Poppler 整页 150 dpi 渲染，六张均分别 `view_image` |
| evaluator PNG 补充对照 | R2024b paired-interactive 1 张 | 原件 `view_image`，2400 x 1500 |
| 其他 evaluator PNG/SVG | 未看 | 不作视觉判断；目录存在不等于已查看 |
| R2026a publication、R2021a evaluator、R2026a 后两张 evaluator | 原件缺失 | 门禁阻断/未验证，不判修复成功 |

PDF 均为一页：publication 为 288 x 162 pt，evaluator 为 576 x 360 pt；预览分别为 1200 x 675、1200 x 750。使用现有 Poppler 22.02.0，参数 `pdftoppm -f 1 -singlefile -r <dpi> -png`，未人工裁掉页面。

SVG 使用现有 librsvg 2.52.5、Cairo 1.16，经 Python ctypes 调用标准渲染 API；CSS DPI 96、白底、完整 viewport `(0,0,1200,675)`。两次渲染均成功，非白包围盒均为 `[24,3,1107,552]`，灰度小于 245 的像素均为 56619；这些数字只排除空白输出，视觉结论来自 `view_image`。未替换字体、移动 viewBox 或补画标题，没有安装依赖。没有成功的浏览器渲染证据，SVG 结论限本机 librsvg/Cairo。

本轮不验证 Desktop、鼠标交互、回调、数据正确性、统计计算或完整 CJK 字库覆盖。英文图的 CJK 结论为无样本，不是假 true。PDF 的字体外观差异只记录本批成品，不扩展为五字体探针审计。

## Publication：逐格式事实

下表原件逐一查看过，哈希见后文。两版 manifest 均记录三格式走 `print`；不能把较旧版本的结果冒称为 R2026a 原生 `exportgraphics` 已验收。

| 版本 / 格式 | 中文、标题与裁切 | 字体、图例及其他事实 |
| --- | --- | --- |
| R2021a PNG | `南海海表温度`、`时间 (UTC)`、`温度 (degC)` 完整可读，未见方框代字；标题上边距很小但未见明确截字 | 图例两行在框内；蓝圆/橙方可区分；极值与右端标记触及轴框，不判无边界风险 |
| R2021a PDF | 三处中文均可读，未复现 R2026a 旧 PDF 的标题消失/Ylabel 残片；标题上边距紧 | `observed/model` 和数字的等宽外观与 PNG 不一致；`observed` 末字紧贴右框，没有宽裕留白，未见旧 R2026a PNG 那种大段越框 |
| R2021a SVG | 实际渲染的三处中文均完整，未见标题/Ylabel 裁切 | 外观接近本版 PNG，图例在框内，标记触轴框；仅绑定本次标准渲染器 |
| R2024b PNG | 三处中文完整可读，标题上边距很小但未见明确截字 | 图例在框内；圆/方标记可区分，极值及右端标记触轴框 |
| R2024b PDF | 三处中文完整可读；标题及 Ylabel 不属于不可见状态 | Latin 字形与 PNG 不一致；`observed` 紧贴右框。与 R2021a 的本轮 PDF 预览相同，但两个原件分别查看、分别保留哈希 |
| R2024b SVG | 实际渲染的标题、中文轴标签完整，无明显页边裁切 | 图例在框内，外观接近本版 PNG；两个版本 SVG 原件哈希相同，仍分别渲染查看 |
| R2026a PNG/PDF/SVG | **三份均缺失，未验证** | 无法判断上轮 title/Ylabel、PNG legend 问题是否消失 |

两版 publication PDF 的 `pdftotext -layout` 仅抽出刻度和图例，未抽出已目视可读的中文及轴标签；这是文本可提取性与视觉呈现不同，不能写成 CJK 缺字，也不能签为可搜索中文已验证。

## Evaluator：六份 PDF 与中文 PNG

### R2024b

- **温度场 PDF**：[整页预览](/tmp/matlab-visual-baseline/33985570222-R2024b-crossed-time-depth-temperature-pdf.png)。长英文标题完整但接近右页边；`Depth (m, positive down)` 与 -10 至 80 刻度分开，`Time (UTC)` 和日期刻度完整，色条及 `Temperature (degC)` 可读。中部可见白色格块，未验证其与输入缺测掩膜逐点对应。没有中文样本。
- **观测/模型 PDF**：[整页预览](/tmp/matlab-visual-baseline/33985570222-R2024b-paired-observation-model-pdf.png)。长标题右尾 `identities` 被页边截断；`Paired samples` 越出底部图例右边框，第二行也很紧；1:1 虚线穿过 `Missing/QC rejected` / `Unmatched obs/model` 统计区。轴标签与多数数值可读，不能判无碰撞。`pdftotext` 能抽出完整标题，不推翻图面裁切。没有中文样本。
- **盐度剖面 PDF**：[整页预览](/tmp/matlab-visual-baseline/33985570222-R2024b-repeat-cast-salinity-profiles-pdf.png)。标题、横轴、0 至 100 深度刻度及三行无框时间戳图例可读；**长 Ylabel 顶端超出页面，reference 后的完整海面说明不可读**。三条线型可区分，橙线在约 60 m 结束；不据此认定输入处理正确。没有中文样本。
- **中文交互 PDF**：[整页预览](/tmp/matlab-visual-baseline/33985570222-R2024b-paired-interactive-pdf.png)。`温度时间序列 / Temperature time series` 在页顶有留白且完整可读，**本原件未见上缘裁切**。两个英文轴标签、时刻和日期可读；Ylabel 与刻度分开。可见圆点、误差棒、中间断线，首末标记靠轴框；没有独立图例。Latin 刻度/轴标签呈等宽外观，与 PNG 不一致。PDF 文本抽取未包含这条实际可见的双语标题。
- **中文交互 PNG**：[原件](/tmp/matlab-run-33985570222/matlab-full100-R2024b/evaluator-runtime/paired-interactive.png)。双语标题完整，未见方框字或页顶裁切；轴标签、日期、断线和误差棒可见。这里仅验证静态导出，不签交互操作成功。

### R2026a

- **温度场 PDF**：[整页预览](/tmp/matlab-visual-baseline/33985570222-R2026a-crossed-time-depth-temperature-pdf.png)。**标题上缘与右端被截，`Time (UTC)` 下部被页底截去**。`Depth (m, positive down)` 与 0/20/40/60/80 刻度均可辨且分开，未见相撞；色条标签和主刻度可读。中间白色格块仍在。本图无中文，不能提供 CJK 成功证据。
- **盐度剖面 PDF**：[整页预览](/tmp/matlab-visual-baseline/33985570222-R2026a-repeat-cast-salinity-profiles-pdf.png)。**标题上缘、左/上页边的长 Ylabel、页底 `Salinity (g kg-1)` 均被截**。0/50/100 深度刻度和右侧时间戳图例目视可读；文本抽取丢失时间戳数字，不等于画面数字缺失。无中文样本。
- 观测/模型图及中文交互图未生成，不能给这两图作任何本轮视觉结论。没有 evaluator manifest，因此也不补造本轮 R2026a 中文标题的 text_objects 证据。

## TiledChartLayout.Title 与 manifest 漏项

证据为 R2024b evaluator 的 `figures.json` 中 `id=paired-interactive`，不是 publication 的普通 axes title：

```text
title = "温度时间序列 / Temperature time series"
text_objects[*].string = ["Time (UTC)", "Temperature (degC)"]
rendering_evidence.bounds_audited = true
rendering_evidence.clipped_count = 0
rendering_evidence.text_overlap_count = 0
accessibility.cjk_text_present = false
accessibility.cjk_font_verified = true
rendering_evidence.cjk_font_evidence.text_present = false
rendering_evidence.cjk_font_evidence.glyph_rendering_verified = false
rendering_evidence.visual_inspection_verified = false
exports.pdf.text = "Time (UTC) | Temperature (degC)"
```

**确定事实**：标题元数据及 PNG/PDF 图面均有中文，但几何文本清单没有布局标题，CJK 检出结果也错误地成了 false。完整 `title` 或 alt text 不是标题的 bounds 证据；0 个已收录对象越界也不能证明未收录标题不越界。当前 R2024b 图面标题完整与这个清单漏项可以同时成立。

只读源码定位如下，行号以首次读取快照为准；并行变更后的行号可能移动：

- [interactive_timeseries_native_template.m:258](/opt/ocean-intelligence/codex-runtime/matlab/assets/interactive_timeseries_native_template.m:258) 建立 `tiledlayout`，第 306 行调用 `title(layout, title_text, ...)`，第 370 行导出时另传 `Title=title_text`。因此元数据标题可以存在，而布局标题几何证据仍缺失。
- 首读 [oi_export_figure.m:560](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_export_figure.m:560) 的 `collect_text` 仅由 `findall(figureHandle,"Type","text")` 枚举，随后按 Visible/String 过滤；没有显式补收 `TiledChartLayout.Title`。`collect_axes` 只补 X/Ylabel，`collect_layout_containers` 只选 Legend/ColorBar。[oi_text_bounds.m:13](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_text_bounds.m:13) 又要求 `isgraphics(handle,"text")`。这是与实物漏项一致的覆盖缺口；未启动 MATLAB 查询该布局标题的具体 Type、可见性或父链，不能把具体运行时机制写成已复现。
- 首读 `oi_export_figure` 第 733 行的 CJK 检测只拼接 textEvidence 与 axesEvidence 的文字；第 736 行为 `~cjkPresent || all(is_cjk_font(fontNames))`。遗漏唯一中文标题会让 `cjkPresent=false`，于是 `cjk_font_verified=true` 可以在没有中文被检出的情况下成立。**这个 true 不证明实际 CJK 渲染。**
- 首读 `oi_export_figure` 第 278 行的 `exports.pdf.text` 是从 textEvidence 拼接，不是从最终 PDF 抽取；第 151 行起的门禁在第 295 行文件 promotion 前执行。[oi_write_manifest.m:50](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_write_manifest.m:50) 校验已有 evidence，不重新遍历原始图形对象。严门禁仍可能漏掉未收录对象，也不等于独立审过最终 PDF 页面。
- [run_matlab_gate.m:87](/opt/ocean-intelligence/codex-runtime/matlab/evals/run_matlab_gate.m:87) 调用交互模板，第 90 行传中文标题；第 123 行在四图完成后才写 manifest，解释了 R2026a 部分文件存在而总 manifest 缺失。
- publication 源测试使用 `title(axesHandle,titleText)`，不是 `title(layout,...)`。本轮 R2021a/R2024b publication 的 `text_objects` 均确实含中文标题、Xlabel、Ylabel，**不能将交互布局标题漏项泛化成所有 title 都漏收**。

另外，R2024b 观测/模型标题、盐度长 Ylabel 已经在 text_objects 中且 clipped=false，最终 PDF 仍实际截字；这属于最终格式视觉与导出时几何证据不一致，和布局标题根本未收录是两类问题，不能混为一个根因。

## 与上轮的比较

上轮报告为 [native-review-33984666441.md](/opt/ocean-intelligence/.codex-evals/matlab-100-20260905/astra-resume/native-review-33984666441.md)。本轮没有改写它。

| 同版比较项 | 33984666441 R2026a | 33985570222 R2026a | 可作出的结论 |
| --- | --- | --- | --- |
| publication PNG/PDF/SVG | 三份曾实际查看；PNG legend 改善，PDF/SVG title/Ylabel 仍有问题 | 三份被门禁阻断，均缺失 | 无新原件，修复未验证；不能用 R2024b 代签 |
| 温度场 PDF | 标题及 Xlabel 裁切，Ylabel/ticks 分开 | 同样症状 | 同参数整页渲染逐像素相同，未改善 |
| 盐度剖面 PDF | 标题、长 Ylabel、Xlabel 裁切 | 同样症状 | 同参数整页渲染逐像素相同，未改善 |
| 中文交互 PDF | 中文标题可辨但上缘被截 | 未生成 | 本轮未验证；R2024b 标题完整不构成同版修复证明 |

两组旧/新 PDF 预览均为 1200 x 750；Pillow `ImageChops.difference(...).getbbox()` 均为 `None`，预览 SHA256 也分别完全相同。原 PDF 哈希不同，不把元数据变化误当版面改善。这里只重新比对这两份上轮预览及原件哈希，没有冒称本轮重新查看了上轮全部 11 产物。

旧温度场 PDF SHA256：`6fa90130a75958b51cf5ca713b4c9be949c4251e9b2837980bdf8586040726bc`；旧盐度剖面 PDF：`16852ae1722b912e90851a79d37233bd4151a64847bf9c3d898188ecf7234372`。原件位于 `/tmp/matlab-run-33984666441/matlab-full100-R2026a/evaluator-runtime`，旧预览同名且前缀为 `33984666441-R2026a-`，其哈希与下表本轮对应预览相同。

## 原件 SHA256 绑定

以下 13 个本轮原件均已实际查看；前后哈希与字节数不变。

| 原件 | SHA256 |
| --- | --- |
| [R2021a publication PNG](/tmp/matlab-run-33985570222/matlab-full100-R2021a/export/full100-export-artifacts/publication.png) | `b9cf641744f8a3336344be6e0a5043e75ec72e7d77fc03236c76c1e0a909de3b` |
| [R2021a publication PDF](/tmp/matlab-run-33985570222/matlab-full100-R2021a/export/full100-export-artifacts/publication.pdf) | `e92fb9c6933ca748377cd89b0aa3f72ddaf8ef7ebe77a8159a1bcc8ecedbf6d4` |
| [R2021a publication SVG](/tmp/matlab-run-33985570222/matlab-full100-R2021a/export/full100-export-artifacts/publication.svg) | `7286932eeaa39ee41ea9fd281bb3281f268d189c9a6465f2f3763872e3ea6a24` |
| [R2024b publication PNG](/tmp/matlab-run-33985570222/matlab-full100-R2024b/export/full100-export-artifacts/publication.png) | `7cb11d71b3c767aa21bf8c29572b2f743fa88c55ab556a1240a1a9690f35cae6` |
| [R2024b publication PDF](/tmp/matlab-run-33985570222/matlab-full100-R2024b/export/full100-export-artifacts/publication.pdf) | `c7b81f35dde3d4cb04cf2eda29652db04811b695d332f6c9d809fba0babe2dff` |
| [R2024b publication SVG](/tmp/matlab-run-33985570222/matlab-full100-R2024b/export/full100-export-artifacts/publication.svg) | `7286932eeaa39ee41ea9fd281bb3281f268d189c9a6465f2f3763872e3ea6a24` |
| [R2024b 温度场 PDF](/tmp/matlab-run-33985570222/matlab-full100-R2024b/evaluator-runtime/crossed-time-depth-temperature.pdf) | `361f48758bafabc0c92a2efe47f43fe6564c3f5d226e650171e44bf466917caa` |
| [R2024b 盐度剖面 PDF](/tmp/matlab-run-33985570222/matlab-full100-R2024b/evaluator-runtime/repeat-cast-salinity-profiles.pdf) | `e475bbbd8b6ea9a2c55588d14f13aea4e7508558708c85160f92ac4d2b914711` |
| [R2024b 观测/模型 PDF](/tmp/matlab-run-33985570222/matlab-full100-R2024b/evaluator-runtime/paired-observation-model.pdf) | `7be7679b42eec2a6167b11008a5ad8c56304fe2c324e929e0d88022e3b3b046d` |
| [R2024b 中文交互 PDF](/tmp/matlab-run-33985570222/matlab-full100-R2024b/evaluator-runtime/paired-interactive.pdf) | `8056b1b4c59964ec376803206c04e0eddd6c7967871598e06ff79ded1bd45b70` |
| [R2024b 中文交互 PNG](/tmp/matlab-run-33985570222/matlab-full100-R2024b/evaluator-runtime/paired-interactive.png) | `b92a05e72c79674731786f20163e5c21f8a0adc362e7076bc4ae731fc7ef295e` |
| [R2026a 温度场 PDF](/tmp/matlab-run-33985570222/matlab-full100-R2026a/evaluator-runtime/crossed-time-depth-temperature.pdf) | `9c39b5413cd1993731bc7999a2893de40e7f022fccd539a8a9875039c7eabb0f` |
| [R2026a 盐度剖面 PDF](/tmp/matlab-run-33985570222/matlab-full100-R2026a/evaluator-runtime/repeat-cast-salinity-profiles.pdf) | `8bacdd6c3ee38dc3a1029c9d2cee9a5183ef7d2330592d997328cff9c60f656e` |

六份状态/manifest 证据同样前后不变，但它们不是额外目视产物：

| 文件 | SHA256 |
| --- | --- |
| [R2021a stage](/tmp/matlab-run-33985570222/matlab-full100-R2021a/ci-stage-status.json) | `69e9ddb642002eaf0dc14724e60211bc0d3b07f5142e4e2df999da424637e0bd` |
| [R2024b stage](/tmp/matlab-run-33985570222/matlab-full100-R2024b/ci-stage-status.json) | `875d9f0fd2cb44a7c851a444c0720489860f72993bb35cb4fdae43fab235823c` |
| [R2026a stage](/tmp/matlab-run-33985570222/matlab-full100-R2026a/ci-stage-status.json) | `bfcf1abc5d96ab49c13e105f77cdb42584e89864e01166708c65e2bc9b39d22b` |
| [R2021a publication manifest](/tmp/matlab-run-33985570222/matlab-full100-R2021a/export/full100-export-artifacts/figures.json) | `9bbdd6646663b57009ac36a51939ab231fc2a1631adf192e2daee9b98c3dbda5` |
| [R2024b publication manifest](/tmp/matlab-run-33985570222/matlab-full100-R2024b/export/full100-export-artifacts/figures.json) | `0763305de9017f55db0cf55f0bd655952e2afab69d90299d6549e686562a56b8` |
| [R2024b evaluator manifest](/tmp/matlab-run-33985570222/matlab-full100-R2024b/evaluator-runtime/figures.json) | `8dacac199bba7b74a283bb7083fac23f78e16a9f84fda172fbc009cdc686fc10` |

## 实际渲染副本 SHA256

以下十份均已 `view_image`；PNG 原件直接看，不重复创建副本。副本不是 MATLAB 重新出图。

| 查看副本 | SHA256 |
| --- | --- |
| [R2021a publication PDF](/tmp/matlab-visual-baseline/33985570222-R2021a-publication-pdf.png) | `19a43f4fca14331d093c658638ee1e8781e194081ad9bf5d2ff7a4e6c5fbd436` |
| [R2021a publication SVG](/tmp/matlab-visual-baseline/33985570222-R2021a-publication-svg-librsvg.png) | `5ab34a7dd357888239b8aca6dfd6f6dace42794971e0020d67c06a3deed4645f` |
| [R2024b publication PDF](/tmp/matlab-visual-baseline/33985570222-R2024b-publication-pdf.png) | `19a43f4fca14331d093c658638ee1e8781e194081ad9bf5d2ff7a4e6c5fbd436` |
| [R2024b publication SVG](/tmp/matlab-visual-baseline/33985570222-R2024b-publication-svg-librsvg.png) | `5ab34a7dd357888239b8aca6dfd6f6dace42794971e0020d67c06a3deed4645f` |
| [R2024b 温度场 PDF](/tmp/matlab-visual-baseline/33985570222-R2024b-crossed-time-depth-temperature-pdf.png) | `3bf26cd6da366a6a67e9be3c64e64ed5d0b0bffdadf0633eef594394006a4fcf` |
| [R2024b 盐度剖面 PDF](/tmp/matlab-visual-baseline/33985570222-R2024b-repeat-cast-salinity-profiles-pdf.png) | `14e056e40122c3140d7c982b24e1cc66ac0579ef04e2346f17c5c21e68a0ab82` |
| [R2024b 观测/模型 PDF](/tmp/matlab-visual-baseline/33985570222-R2024b-paired-observation-model-pdf.png) | `9c550b1c93041aa8aeef74af3bebf2b54f5044e7b4d780cfdae5587072d2d5ca` |
| [R2024b 中文交互 PDF](/tmp/matlab-visual-baseline/33985570222-R2024b-paired-interactive-pdf.png) | `9109ac646fd74783dcfb37f46748198c6d02e463802bfd71c2093d5e8252287c` |
| [R2026a 温度场 PDF](/tmp/matlab-visual-baseline/33985570222-R2026a-crossed-time-depth-temperature-pdf.png) | `f4ba62b466332ffdcc8c5b380ab0fd1f116d58146f4046d3e01c212e8f833b64` |
| [R2026a 盐度剖面 PDF](/tmp/matlab-visual-baseline/33985570222-R2026a-repeat-cast-salinity-profiles-pdf.png) | `a4b5a238ce06d772e3d3fa12a14ac0049b60fde9a9c2b9a9868d1e9e3a4d9dd4` |

## 源码快照与并行修改

首次读取的 workspace HEAD 为 `7c6c4361ce80140fb5391889054d0947d17c0990`。首次读取的 `oi_export_figure.m` 哈希也与该 commit 的文件一致；但本轮未独立验证 CI checkout provenance，不能把本地所有源码等同于 CI 快照。尤其测试文件已存在并行修改，CI stack 行号不应强套当前文件。

| 只读源码 | 首次读取 SHA256 | 复核情况 |
| --- | --- | --- |
| [oi_export_figure.m](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_export_figure.m) | `e9580cceb12756f27a62fc75c448a12561666772f793b4c4be5600b424d1c79a` | 并行修改后为 `ca714da4d2ec49e03eac139236b5f9577e5ffa6e8fc1db8cb1dd6031da98ac3d` |
| [oi_write_manifest.m](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_write_manifest.m) | `5e1313988e4f7d182205ff5969e7e6706219cd059457e01b88a0c958d4c4c0e3` | 复核未变 |
| [interactive_timeseries_native_template.m](/opt/ocean-intelligence/codex-runtime/matlab/assets/interactive_timeseries_native_template.m) | `2f63b9ce4de0d8d908703aa4ebba68646f2c11f08b912d3fc4025503a54578aa` | 复核未变 |
| [run_matlab_gate.m](/opt/ocean-intelligence/codex-runtime/matlab/evals/run_matlab_gate.m) | `8959989cfd01347e3d77149456932ccb106e9e04856ef23c9cf3cd6fa1cead79` | 复核未变 |
| [full100_export_contracts.m](/opt/ocean-intelligence/codex-runtime/matlab/tests/full100_export_contracts.m) | `e785027b015b75c6f967b4d076486e0ff11940b384e1515310649c4c15e4f180` | 并行修改后为 `de841bba5df59a78a2844cbe4f0ddcd240a8f598840fae618c69ce7033c74ef5` |
| [oi_text_bounds.m](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_text_bounds.m) | `5de5e8a57d5c4742f5a88dcd1db10ce51899c630a531feab12cf8860e57bacab` | 复核未变 |

并行 diff 增加了已有 text 对象的角色识别、错误文字以及 publication 尺寸/角色断言。本次未改动或回退这些修改，也没有把修改后的代码当成本 run 已验证的产物。复核时 `collect_text` 仍从 Type=text 枚举；新增角色标签本身不证明此前漏掉的布局标题已收录。

后续需要以新 run 验证：布局标题是否有独立 text/bounds/CJK evidence；R2026a publication 及后两张 evaluator 能否过门禁并真实出图；每份 PDF 的实际页边、图例和统计避让是否改善。现有 run 的失败、缺件、字体外观差异与上述具体裁切均保留，不给综合满分或全量签收。
