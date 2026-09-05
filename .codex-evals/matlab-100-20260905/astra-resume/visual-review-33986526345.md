# 第五批限定实图审计：run 33986526345

审查日期：2026-09-05 UTC。范围严格限定为 R2026a `regression/run` 的 profile、comparison、hovmoller、interactive-timeseries 各 PNG/PDF，共 8 个原件；以及 R2024b `evaluator-runtime` 四份 PDF，共 4 个原件。**12/12 均已实际 `view_image`，不是 12/12 合格，更不是全量验收。**

仓库内仅新增本报告；PDF 整页预览另存 `/tmp/matlab-visual-baseline/33986526345`。12 个原件的查看前后 SHA256 和字节数均未改变。未修改原件、源码、score、audit 或旧报告，未运行 MATLAB、未提交、未推送。不查看 publication、其他回归图、R21/R26 evaluator 图、R24 PNG/SVG 或字体探针；不等待第六批。

## 结论先行

1. **早设 inches + WenQuanYi 的本批结果没有全面解决裁切或重叠。** R26 四份选样 PDF 的英文标题都可读，但 profile PDF 长 Ylabel 仍超出页顶；comparison 的统计文字仍与参考线重叠；hovmoller 的完整日期刻度在 PNG/PDF 中都相互重叠。
2. **R24 evaluator PDF 仍存在实物缺陷。** 温度场长标题右端被截；盐度剖面长 Ylabel 顶端被截；观测/模型图标题右尾被截，两行图例文字越过右框，统计区被数据点和参考线穿过。stage passed、用户给出的原分 90 都不能代替这些视觉结果。
3. **字体结论必须分版本、分格式。** R26 四份 PDF 均列出已嵌入 `WenQuanYiZenHei`，所见英文字符可读；但文字位置、行距或刻度与同版 PNG 不完全一致。R24 四份 PDF 的字体表仍只列未嵌入的 Courier，图面 Latin 也呈等宽外观，不能称 WQ 字体一致性已经解决。
4. **唯一中文样本 R24 paired-interactive PDF 的双语标题完整可读，无明显方框字或上缘裁切。** 它在第四批也已完整，属于保持，不是新修复证据。R26 这四张回归图都是英文标题，没有本批 R26 中文字形样本。
5. 三版 publication 均因 strictclip 检出负坐标图例而未 promote，直接记 **blocked / 未验证**，不追查或补图。R26 回归 profile 的 `Station A/B` 短图例正常，不代表被阻断的 evaluator 长时间戳图例已修好。

## 状态背景与证据边界

只读 stage 中指定状态，不重算或改动评分：

| 版本 | plot-regression | evaluator-runtime | publication / export-runtime |
| --- | --- | --- | --- |
| R2021a | passed | `run_matlab_gate:PageMargins`，最小页边距 0.095337 in < 0.1 in；本次不看该版图 | `ClippedContent`，legend bounds 的 y=-0.17951；blocked、未 promote |
| R2024b | passed | passed；本次仅看四份 PDF | 同上，y=-0.17951；blocked、未 promote |
| R2026a | passed | `ClippedContent`，legend x=0.77806、width=0.25694，右缘约 1.035；本次不看该 evaluator 图 | `ClippedContent`，legend y=-0.16668；blocked、未 promote |

用户说明 R21 卡在第三图、R26 卡在 profile 长图例，本报告不扩大范围重新渲染它们。用户提供的 R24 原分 90 仅作背景，未核算或修改。主线程正在修 tiled legend、generator 实跑桥接及第六批，不将尚未查看的新工作纳入结论。

“早设 inches”是本次用户提供的生成背景，本轮未读取或执行源码来证明初始化顺序或单因素因果。两份 manifest 的选中字形均为 `WenQuanYi Zen Hei`；R26 选样三格式记录 `exportgraphics`，R24 evaluator 记录 `print`。这些记录不能取代最终格式的实际呈现。

## 查看方法

- 四张 R26 原 PNG 分别直接 `view_image`，均为 2400 x 1500。
- 八份 PDF 均为一页，页面为 576 x 360 pt，即 8 x 5 in。现有 Poppler 22.02.0 使用 `pdftoppm -f 1 -singlefile -r 150 -png` 整页渲染成 1200 x 750，再八张分别 `view_image`。未改 CropBox、未裁掉边缘、未移动或补画文字。
- 仅对这八份 PDF 运行 `pdfinfo`、`pdffonts`，对两份交互 PDF 补查 `pdftotext`。这是指定成品取证，不是五字体探针。
- 标题、标签、图例、刻度和可见数据图形逐项记录。没有验证输入数据、缺测算法、统计计算或交互回调；静态图可读不证明 Desktop 或交互功能成功。

## R2026a Regression：八个原件

### Profile

- **PNG**：[原件](/tmp/matlab-run-33986526345/matlab-full100-R2026a/regression/run/profile.png)。`Ocean profile`、`Temperature (degC)` 和完整 `Depth (m, positive down; reference: mean sea level)` 可读，未见页边裁切；Ylabel 与 0/20/40 刻度分开。右侧无框 `Station A/B` 图例完整、没有超出画布，蓝实线/橙虚线可区分。
- **PDF**：[整页预览](/tmp/matlab-visual-baseline/33986526345/R2026a-regression-run-profile-pdf.png)。标题和 Xlabel 可读，短图例也在页内；**Ylabel 明显向上移，`reference: mean sea level` 的末段落到页顶之外，无法读全**。不能因为 PNG 完整或 PDF 嵌入 WQ 就签长轴标签通过。与 PNG 相比，标题、纵轴标签的文字位置仍不同。
- 两格式都能看到蓝线约 20 至 40 m、橙虚线约 0 至 20 m；这里只记录线段外观，不验证剖面缺测处理。无中文样本。

### Comparison

- **PNG**：[原件](/tmp/matlab-run-33986526345/matlab-full100-R2026a/regression/run/comparison.png)。标题和 Observation/Model 轴标签完整；底部两行图例在框内。**蓝点与 `Unmatched obs/model` 文字交叠，1:1 虚线也穿过下方统计文字区**，不是无重叠布局。
- **PDF**：[整页预览](/tmp/matlab-visual-baseline/33986526345/R2026a-regression-run-comparison-pdf.png)。标题完整但接近页顶且相对绘图区偏右；轴标签可读；图例文字未见越框，不过首行靠近上框，图例与 Xlabel 间距紧。**参考线穿过 Missing/QC rejected、Unmatched obs/model 两行文字**。统计行距明显大于 PNG，字串位置不一致。
- `N=4` 等统计是图上显示值，本轮未重新计算；不能将这张短标题、四个样本的回归图当成上轮 evaluator 长标题比较图的修复证明。无中文样本。

### Hovmoller

- **PNG**：[原件](/tmp/matlab-run-33986526345/matlab-full100-R2026a/regression/run/hovmoller.png)。`Time-depth evolution`、`Depth (m, positive down)`、`Time (UTC)`、色条 `Temperature (degC)` 可读，未见这些标签页边裁切；**横轴五个完整日期时间字串过长，相邻刻度文字重叠**，不是仅留白较紧。
- **PDF**：[整页预览](/tmp/matlab-visual-baseline/33986526345/R2026a-regression-run-hovmoller-pdf.png)。标题、两轴及色条标签均完整；**相邻日期时间刻度仍重叠**。相比 PNG，文字锚点位置有偏移，色条主刻度由逐整数变为 8/10/12/14，不能判两格式布局完全一致。
- 两格式中央白色格块可辨，区别于低温深色；未用输入矩阵校验缺测语义。没有独立图例，没有中文样本。

### Interactive-timeseries

- **PNG**：[原件](/tmp/matlab-run-33986526345/matlab-full100-R2026a/regression/run/interactive-timeseries.png)。`Interactive time series`、两个轴标签、00:00 至 05:00 刻度及 `Jan 01, 2024` 完整，未见文字裁切或互相重叠。首末点与误差棒靠轴框，无独立图例。
- **PDF**：[整页预览](/tmp/matlab-visual-baseline/33986526345/R2026a-regression-run-interactive-timeseries-pdf.png)。同一英文标题、标签与日期完整可读，无明显页边裁切；标题相对绘图区偏右，Ylabel 位置比 PNG 靠上。Y 主刻度是 10/12/14，而 PNG 是 10/15；因此仅可说文本可读，不能说图面严格一致。
- 两格式可见左端孤立点与后段上升线、空心圆和误差棒。未进行交互操作，没有中文样本。静态标题实际存在，即使 manifest 的 text_objects 未收录它。

## R2024b Evaluator：四份 PDF

### Crossed-time-depth-temperature

[整页预览](/tmp/matlab-visual-baseline/33986526345/R2024b-evaluator-runtime-crossed-time-depth-temperature-pdf.png)。

- **长标题右端的 `depth` 已贴到并被页面右缘截断**；标题上缘有留白，不属于上缘截字。
- `Depth (m, positive down)`、深度刻度、`Time (UTC)` 及两个日期主刻度可读且分开；色条标签完整，未见 Ylabel/ticks 相撞。中部白色格块仍可见。
- Latin 呈 Courier 等宽外观，无中文样本。第四批同版此标题曾完整但接近右边，本次出现右端裁切，不能宣称所有标题页边距改善。

### Repeat-cast-salinity-profiles

[整页预览](/tmp/matlab-visual-baseline/33986526345/R2024b-evaluator-runtime-repeat-cast-salinity-profiles-pdf.png)。

- 标题和 `Salinity (g kg-1)` 完整，0 至 100 刻度可读；**长 Ylabel 顶端仍超出页顶，`reference: synthetic sea surface` 不能读全**。
- 三行无框时间戳图例位于右侧，均完整留在页内，未见图例覆盖曲线；蓝实线、橙虚线、绿点线可区分。
- 无中文样本。与第四批同版相同的长 Ylabel 裁切仍在，不能把本次较宽的上下页边距当成此项已解决。

### Paired-observation-model

[整页预览](/tmp/matlab-visual-baseline/33986526345/R2024b-evaluator-runtime-paired-observation-model-pdf.png)。

- **标题右端 `identities` 被截；底部 `Paired samples` 与 `1:1 reference` 两行均越过图例右框**。这不是仅“接近边框”。
- **数据点和 1:1 参考线穿过 Missing/QC rejected、Unmatched obs/model 统计文字区**。Observation/Model 标签和其余统计大部分可读，不代表版面合格。
- 与第四批同版相比，标题右裁、图例越框、统计重叠均未解决。无中文样本；`N=11` 等数值未重算。

### Paired-interactive

[整页预览](/tmp/matlab-visual-baseline/33986526345/R2024b-evaluator-runtime-paired-interactive-pdf.png)。

- **`温度时间序列 / Temperature time series` 完整可读，未见方框代字、页顶截字或与轴框相撞**。这仅证明这条中文标题在本机 PDF 渲染可读，不覆盖其他中文样本。
- 两轴标签、时刻和 `Aug 01, 2026` 日期完整，Ylabel 与刻度分开；圆点、误差棒和中间断线可见，首末标记靠轴框，没有独立图例。
- Latin 轴标签/刻度仍为等宽外观。`pdftotext` 没有抽出这条实际可见的双语标题；不能据此声称图面中文缺失，也不能签中文可搜索或 WQ 嵌入通过。本轮未看 R24 PNG，未作该版本轮 PNG/PDF 字形一一比较。

## 字体与标题证据限制

| 指定 PDF | `pdffonts` 实际结果 | 可证明 / 不可证明 |
| --- | --- | --- |
| R26 四份 regression PDF | `WenQuanYiZenHei`，CID TrueType，Identity-H，emb=yes，uni=yes | 证明这些 PDF 列有已嵌入 WQ 字体；所见英文可读。不证明位置正确，也不提供本批 R26 中文视觉样本 |
| R24 四份 evaluator PDF | 仅 `Courier`，Type 1，WinAnsi，emb=no，uni=no | 与 manifest 选择 WQ 不是一回事；可见 Latin 等宽外观仍在。中文标题可见，但没有 WQ 嵌入证据，不推断所有图元都由 Courier 绘制 |

八个选中 manifest 条目的 `clipped_count` 都为 0，但最终 PDF 中已经看到上述裁切。R26 interactive-timeseries、R24 paired-interactive 的 `text_objects` 都只有 X/Ylabel，没有布局标题；R24 的 `cjk_text_present=false`，`glyph_rendering_verified=false`，而双语标题实际可读。这个先前已记录的证据漏项仍可见，本轮不修改 manifest/audit，也不展开源码根因修复。

## 与第四批的可比性

参照 [visual-review-33985570222.md](/opt/ocean-intelligence/.codex-evals/matlab-100-20260905/astra-resume/visual-review-33985570222.md) 中已实际查看的结果；本轮没有为扩大范围再看旧图。

- R24 四份 evaluator 是同版本、同名样本，可以直接比较：盐度长轴标签裁切和比较图三类缺陷仍在；中文标题完整是保持；温度场标题本轮右端出现裁切。
- 第四批 R26 看的是 evaluator 温度场/盐度剖面，本轮 R26 看的是不同的 regression 样本。这里只确认四份选样 PDF 标题可见、部分标签可见，同时仍有 profile 长 Ylabel 裁切；**不把不同文字长度、不同图例的样本当成旧图同版修复验证**。
- R26 regression 短图例可读不能代签 evaluator 长图例；publication blocked 也不能由其他 8 x 5 in 图替代。最终结论是“部分文本呈现正常，仍有明确失败项”，不是 inches/WQ 组合全面解决。

## 12 个原件 SHA256

每个原件均已实际查看，前后哈希及字节数相同。

| 原件 | SHA256 |
| --- | --- |
| [R26 profile PNG](/tmp/matlab-run-33986526345/matlab-full100-R2026a/regression/run/profile.png) | `be84621715cd8554074e1cabaec83f0ef7cb6c57ca744713f0fecbb8366f088c` |
| [R26 profile PDF](/tmp/matlab-run-33986526345/matlab-full100-R2026a/regression/run/profile.pdf) | `a287f9c70a49225ac9fc1a15e4416cf149d6009707722c8f9318ff12efb89dc4` |
| [R26 comparison PNG](/tmp/matlab-run-33986526345/matlab-full100-R2026a/regression/run/comparison.png) | `3e7e240c5f83df9c4f0562f6489605e626d10f42fbc38155fa313fcbbd8c8d91` |
| [R26 comparison PDF](/tmp/matlab-run-33986526345/matlab-full100-R2026a/regression/run/comparison.pdf) | `dff1f318e4c4fcc971f0e70bb0346abdf1ab45dd9971277f65482ecad922062a` |
| [R26 hovmoller PNG](/tmp/matlab-run-33986526345/matlab-full100-R2026a/regression/run/hovmoller.png) | `24c5f61973a38e73222dfc55b02905aaae4b2a4c9262983e64bcafab7e718faf` |
| [R26 hovmoller PDF](/tmp/matlab-run-33986526345/matlab-full100-R2026a/regression/run/hovmoller.pdf) | `8c892e58309121e368b26660db4df003908a99003df98766336cfefd1c36495a` |
| [R26 interactive PNG](/tmp/matlab-run-33986526345/matlab-full100-R2026a/regression/run/interactive-timeseries.png) | `c8af9590afa69743a3c3a22389d5f42f69cf4d535caffc1f6241d51d38821712` |
| [R26 interactive PDF](/tmp/matlab-run-33986526345/matlab-full100-R2026a/regression/run/interactive-timeseries.pdf) | `d97833a795a2246b70cf178626fe2381d440a4b120e80a91502a363188ae70c9` |
| [R24 温度场 PDF](/tmp/matlab-run-33986526345/matlab-full100-R2024b/evaluator-runtime/crossed-time-depth-temperature.pdf) | `ae877b35ca4e81c3967a0943887dc3e7c2caccfec9bfb7b1581cced0427c25bf` |
| [R24 盐度剖面 PDF](/tmp/matlab-run-33986526345/matlab-full100-R2024b/evaluator-runtime/repeat-cast-salinity-profiles.pdf) | `b0ea061e82a7142184a7330d9b0fabb05b90c40ee2d153fc0128c183898ffd46` |
| [R24 观测/模型 PDF](/tmp/matlab-run-33986526345/matlab-full100-R2024b/evaluator-runtime/paired-observation-model.pdf) | `01e244471e7613c15feda7bd741b182442cc33579d1dee26e94a02529d124b34` |
| [R24 中文交互 PDF](/tmp/matlab-run-33986526345/matlab-full100-R2024b/evaluator-runtime/paired-interactive.pdf) | `78d094f83bbf9f9b785d297ca2357b09afb5bdb91e14bb6a6882df5068182b07` |

## 八份查看副本 SHA256

这些是指定 PDF 的整页渲染，不是额外 MATLAB 样本；均已逐张 `view_image`。

| 查看副本 | SHA256 |
| --- | --- |
| [R26 profile PDF 预览](/tmp/matlab-visual-baseline/33986526345/R2026a-regression-run-profile-pdf.png) | `4b6c9370824c57311e04c9e6db6dcddb3b29e2ba22f7fecae5303d2af88d7917` |
| [R26 comparison PDF 预览](/tmp/matlab-visual-baseline/33986526345/R2026a-regression-run-comparison-pdf.png) | `aa104d48399432ec71adff344dca129ab5bdd49f031749abbaa2b7a4cfca6902` |
| [R26 hovmoller PDF 预览](/tmp/matlab-visual-baseline/33986526345/R2026a-regression-run-hovmoller-pdf.png) | `76481ad15565525b503bf5656ad7142bf9dcd725998401388fdc931e03bbd766` |
| [R26 interactive PDF 预览](/tmp/matlab-visual-baseline/33986526345/R2026a-regression-run-interactive-timeseries-pdf.png) | `23ff87d0d43ffb44aa8af0576175173b7dd991a6853d5dc84a19f4ea5cb7ac8d` |
| [R24 温度场 PDF 预览](/tmp/matlab-visual-baseline/33986526345/R2024b-evaluator-runtime-crossed-time-depth-temperature-pdf.png) | `7d0ecd09729d58102ccf3f00062b94c74bbacdaecd200d9db150d3dcb14d7f81` |
| [R24 盐度剖面 PDF 预览](/tmp/matlab-visual-baseline/33986526345/R2024b-evaluator-runtime-repeat-cast-salinity-profiles-pdf.png) | `a2127ddf8de993e26846003f994d619b9e9f21c17797d9493b2f949ea47e5d7b` |
| [R24 观测/模型 PDF 预览](/tmp/matlab-visual-baseline/33986526345/R2024b-evaluator-runtime-paired-observation-model-pdf.png) | `ffa11335be5ef6728c035eec52601a5034947587a9acbba39f259efe91890339` |
| [R24 中文交互 PDF 预览](/tmp/matlab-visual-baseline/33986526345/R2024b-evaluator-runtime-paired-interactive-pdf.png) | `59a73b9ed5c76a78017522219a2bd96f2093ac9739580b13bf4a253c94772c67` |

## 只读状态与 Manifest 绑定

这些文件只支撑状态、字体选择和证据字段，不计入 12 个目视原件，也不等于视觉通过。

| 证据文件 | SHA256 |
| --- | --- |
| [R21 stage](/tmp/matlab-run-33986526345/matlab-full100-R2021a/ci-stage-status.json) | `4037ba86bf8f25b0f006540335864598fe5ba44ce9e0886968e26642c85cf5d1` |
| [R24 stage](/tmp/matlab-run-33986526345/matlab-full100-R2024b/ci-stage-status.json) | `88fe623a0e9ab6c92d420250dfbaf4c55e94c98e3b532e6d3f742c4a0784e23b` |
| [R26 stage](/tmp/matlab-run-33986526345/matlab-full100-R2026a/ci-stage-status.json) | `aa90df52c9560e99a6ec367913d914bce2093c639c40c21e9865b75fdcc1d8ed` |
| [R26 regression manifest](/tmp/matlab-run-33986526345/matlab-full100-R2026a/regression/run/figures.json) | `10e33791bfbc8e2133ae8c886b05228677f0288db740a3045476d2fd8a717a7b` |
| [R24 evaluator manifest](/tmp/matlab-run-33986526345/matlab-full100-R2024b/evaluator-runtime/figures.json) | `ad0fcb56844c9e75ce088cc1c0a25535e747f1f0a39f9c0e7f5b0165d91e141b` |

收尾：本报告仅对上述 12 个原件给出事实与限制，不打综合满分，不解除任何 CI blocked/failed 状态，不替第六批签收。
