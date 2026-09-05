# 第六批限定实图审计：33987455982

日期：2026-09-05 UTC。Runtime = **partial**：按用户提供状态，三版本各 15/16、合计 45/48，generated-router-runtime 仍失败；relativeJVMcwd/structinit 的后续修复未在本次验证。Visual = **指定 10/10 原件已实际查看，但有明确缺陷**，不是全通过或全量验收。
已先用 `rg` 查到 publication 均位于 `export/full100-export-artifacts`。本轮只看 R26 publication PNG/PDF/SVG、R26 evaluator 四 PDF、R24 publication PDF 与 evaluator profile/comparison PDF；未看其他图、score/audit 或当前修复源码，未运行 MATLAB。
仓库仅新增本报告，预览另存 `/tmp/matlab-visual-baseline/33987455982`；10 个原件前后 SHA256/字节数不变，未改原件、score/audit 或旧报告，未提交推送。

## 结论
- **图例区部分改善**：R26 publication 三格式及 R24 publication PDF 的横排图例均留在画布/框内；R26 evaluator profile 三行长时间戳图例也完整入页。第五批未 promote 的这些样本本次确有成品，不能因此签整图无缺陷。
- **裁切与重叠仍在**：R26 温度场/比较图长标题右裁，R26/R24 profile 长 Ylabel 顶端被截；两版比较图统计仍压点/压线，R24 比较图图例两行仍越右框。
- **中文 layout.title**：R26 paired-interactive 的“温度时间序列 / Temperature time series”完整可读，无明显上缘裁切，但整体偏右；静态可读不证明交互成功。
- **出版图不是三格式一致**：R26 PNG 的中文标题/轴标签完整；PDF/SVG 中文可辨、Ylabel 已可读，但标题触页顶，不能签完整无裁切，字重、文字锚点及 model 虚线外观与 PNG 不一致。

## 实际方法与尺寸字体
原 PNG 直接 `view_image`；八份 PDF 经 Poppler 22.02.0 整页渲染后逐张 `view_image`；SVG 经现有 librsvg 2.52.5/Cairo 1.16 实际渲染后 `view_image`，没有用 XML 代替视觉、没有裁掉页边或补画文字。
PDF 命令为 `pdftoppm -f 1 -singlefile -r <dpi> -png`。八份均单页；下表来自这些指定原件的 `pdfinfo`/`pdffonts`，不是字体探针。
| PDF 范围 | 页面 / 查看副本 | 字体与限制 |
| --- | --- | --- |
| R26 publication | 288 x 162 pt (4 x 2.25 in)；300 dpi，1200 x 675 | WenQuanYiZenHei，CID TrueType，Identity-H，emb=yes、uni=yes |
| R26 evaluator 四份 | 576 x 360 pt (8 x 5 in)；150 dpi，1200 x 750 | 四份均同上；嵌入不证明边界正确 |
| R24 publication | 288 x 162 pt；300 dpi，1200 x 675 | 仅列 Courier，Type 1，WinAnsi，emb=no、uni=no；中文目视可读不等于 WQ 嵌入已证实 |
| R24 profile/comparison | 576 x 360 pt；150 dpi，1200 x 750 | 两份均仅列未嵌入 Courier，Latin 仍呈等宽外观 |
SVG 原件 width/height=1200px/675px，CSS=4in/2.25in，viewBox=`0 0 288 162`，无 `<text>` 元素。通过 ctypes 调用 `rsvg_handle_render_document`，DPI 96、完整 viewport `(0,0,1200,675)`、白底；成功输出，非白 bbox=`(21,0,1060,619)`，灰度<245 像素 54555。没有浏览器验证，结论限本机 librsvg/Cairo。

## 十个原件逐项目视
| ID / 原件 | 事实问题、正常部分与限制 |
| --- | --- |
| P26-PNG / publication.png | 标题“南海海表温度”、Xlabel“时间 (UTC)”、Ylabel“温度 (degC)”完整；横排 observed/model 在图例框内且与 Xlabel 分开；极值和右端标记触轴框。 |
| P26-PDF / publication.pdf | 图例框与文字均在页内；中文标题可辨、Ylabel 完整，但标题上缘触页顶，整体偏右，不能签完整无裁切；标签/图例文字锚点与 PNG 不同。 |
| P26-SVG / publication.svg | 标准渲染实际呈现与 PDF 相近：图例在框内、中文可辨、Ylabel 完整；标题触顶，字重与 PNG 不同，model 样线近实线，不能签三格式保真。 |
| T26 / crossed-time-depth-temperature.pdf | 长标题右端被截，上缘已有留白；Time (UTC)、Depth (m, positive down)、刻度和色条标签完整，Ylabel/ticks 分开；白色缺测格可见，未校验输入掩膜。无中文样本。 |
| S26 / repeat-cast-salinity-profiles.pdf | 标题和 Salinity Xlabel 完整，右侧三行时间戳图例全部在页内；长 Ylabel 向上移，reference 后文字在页顶截断。无中文样本。 |
| C26 / paired-observation-model.pdf | 长标题右端被截；点靠/压 RMSE 行末，参考线穿过 Missing/QC rejected 与 Unmatched obs/model；底部图例在框内，但首行贴上框、Xlabel 间距紧。无中文样本。 |
| I26 / paired-interactive.pdf | 双语 layout.title 完整，无方框代字或明显截顶；标题偏右、Ylabel 偏上，但轴标签与日期可读；圆点、误差棒、断线可见，端点靠轴框，无独立图例。不验证交互。 |
| P24 / publication.pdf | 中文标题、两轴完整；横排图例不越框，但 observed 末端与下一橙色样线几乎相接，model 靠右框；Latin 等宽外观仍在。本轮未看 R24 PNG/SVG。 |
| S24 / repeat-cast-salinity-profiles.pdf | 标题、Xlabel、三行无框时间戳图例完整在页内；长 Ylabel 顶端仍被截，不能读全 reference: synthetic sea surface。无中文样本。 |
| C24 / paired-observation-model.pdf | 长标题右尾被截；点/参考线穿过下两行统计；Paired samples 和 1:1 reference 均越出图例右框。轴标签可读，无中文样本。 |
P26 标题边界补证：PDF `pdftotext -bbox` 给“南海海表温度”框 yMin=-1.251953 pt；PDF/SVG 预览第 0 行分别仍有 5/2 个深色字形像素。可确定文字框越上边界、图面触顶；具体损失多少笔画未定量，不把“字串可辨”写成“完整无裁切”。

## 与旧报告比较
参照 [第五批报告](/opt/ocean-intelligence/.codex-evals/matlab-100-20260905/astra-resume/visual-review-33986526345.md) 与 [第四批报告](/opt/ocean-intelligence/.codex-evals/matlab-100-20260905/astra-resume/visual-review-33985570222.md) 已记录的目视，不扩大范围重看旧图：publication 从 blocked 变为有成品且所查横排图例入框；R26 evaluator 长图例本次入页。R24 profile 裁切、comparison 标题/统计/图例三类问题仍在。
对照更早 [R26 原生导出报告](/opt/ocean-intelligence/.codex-evals/matlab-100-20260905/astra-resume/native-review-33984666441.md)，本次 publication PDF/SVG 的中文标题与 Ylabel 已可辨，evaluator 温度场/剖面 Xlabel 与标题上缘、中文交互标题有所改善；但长标题右裁、长 Ylabel 裁切及统计重叠未清除。第五批 R26 regression 是不同样本，不能作为本轮 evaluator 同图的直接前后证据。
本次没有复核 manifest 是否补齐 layout.title、没有核验算法/统计或 Desktop，不推断主线程下一批统计/日期/探针修复已通过；partial runtime 与这些局部视觉改善分别记录。

## 原件 SHA256
| ID / 原件 | SHA256 |
| --- | --- |
| [P26-PNG](/tmp/matlab-run-33987455982/matlab-full100-R2026a/export/full100-export-artifacts/publication.png) | `e3b1b4e84170fb4d50be80ccf233e58b73be11cb587ea657aa0f9f0aa4277eb7` |
| [P26-PDF](/tmp/matlab-run-33987455982/matlab-full100-R2026a/export/full100-export-artifacts/publication.pdf) | `8db8fc682a29574916af90c55d51a6d765dc26775618c583c162640822326cde` |
| [P26-SVG](/tmp/matlab-run-33987455982/matlab-full100-R2026a/export/full100-export-artifacts/publication.svg) | `d690c8c08fb1235a37b6118f8106fd92034e95d4cdc8063d59d6c8b4602cf8a0` |
| [T26](/tmp/matlab-run-33987455982/matlab-full100-R2026a/evaluator-runtime/crossed-time-depth-temperature.pdf) | `62a4251b57cb7e59516fc05d8fa47177c6350f49a76c8432e38d78d4ac316de2` |
| [S26](/tmp/matlab-run-33987455982/matlab-full100-R2026a/evaluator-runtime/repeat-cast-salinity-profiles.pdf) | `4968f75d5c83f168ac7b315c463b938bf6597acf47f7dfd9e8c0098b83527ab7` |
| [C26](/tmp/matlab-run-33987455982/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.pdf) | `d6c62b903fbbe17bd67d3072742400edd39c3a9074803a3636caf880023ca7f4` |
| [I26](/tmp/matlab-run-33987455982/matlab-full100-R2026a/evaluator-runtime/paired-interactive.pdf) | `215314482326f9605f74cbab46c741e2fdf0e6a6a9b44cca5cde39a9a970ce98` |
| [P24](/tmp/matlab-run-33987455982/matlab-full100-R2024b/export/full100-export-artifacts/publication.pdf) | `df3b2901bd08a708796693c9b817c8cfe3e8fc098a7a7b83ee51dfad520f826f` |
| [S24](/tmp/matlab-run-33987455982/matlab-full100-R2024b/evaluator-runtime/repeat-cast-salinity-profiles.pdf) | `72f0a043f43d334725d4f5ce64ae9b2418affed4d8ce97e597103fd5712cbf53` |
| [C24](/tmp/matlab-run-33987455982/matlab-full100-R2024b/evaluator-runtime/paired-observation-model.pdf) | `93a0d0e1a76b4e43d90c3fb23056cdd7633624ef40f54b2c806ac26251f1358c` |

## 实际渲染副本 SHA256
以下九份都已分别 `view_image`；原 PNG 直接看，没有额外 MATLAB 样本。
| 副本 | SHA256 |
| --- | --- |
| [P26-PDF 预览](/tmp/matlab-visual-baseline/33987455982/R2026a-publication-pdf.png) | `299486f681874918e042efed64b4f2b1c9df9be2dcbd2bb12e8ade3187431797` |
| [P26-SVG 原生文件的 librsvg 预览](/tmp/matlab-visual-baseline/33987455982/R2026a-publication-svg-librsvg.png) | `61f941724a96ddf825bcf2279d45423672f184ceccf01bc68716bcd3fede6a24` |
| [T26 预览](/tmp/matlab-visual-baseline/33987455982/R2026a-crossed-time-depth-temperature-pdf.png) | `aa12cd6e54e28321a3b3641ee6bcb4ef6f1db94782b949cfcb29c71ddbe20d81` |
| [S26 预览](/tmp/matlab-visual-baseline/33987455982/R2026a-repeat-cast-salinity-profiles-pdf.png) | `498285034a8bfdf8806b843581924de3da92da1c1c4c1c37fe0f962f3e40870c` |
| [C26 预览](/tmp/matlab-visual-baseline/33987455982/R2026a-paired-observation-model-pdf.png) | `7cf9ff23464c240fe2330de4453d9f347b59f4a2a2be2ca3cf9cef03b55d85a8` |
| [I26 预览](/tmp/matlab-visual-baseline/33987455982/R2026a-paired-interactive-pdf.png) | `d8c23ea941f15f7c8fdbe8ec08b84a2de4d5b007a9e54a338298833f6decd3df` |
| [P24 预览](/tmp/matlab-visual-baseline/33987455982/R2024b-publication-pdf.png) | `162beaf53c063033a5c60070d269abeadd712f6e87496d3192949f3f6a37f212` |
| [S24 预览](/tmp/matlab-visual-baseline/33987455982/R2024b-repeat-cast-salinity-profiles-pdf.png) | `e3466f1cae200ee17417581afaa15a6724b8cdf5eba50861d1caef89cc225c09` |
| [C24 预览](/tmp/matlab-visual-baseline/33987455982/R2024b-paired-observation-model-pdf.png) | `0dc19719142a9fddca12f989c7f8978db96ebb307fe8c91814a0b70ae91b563e` |
