# R20 原生 Canvas 候选审阅与诊断修复

## 关键结论
- 原件为 **R19 run33999054663**，不是修复后的新运行。R2021a/R2024b/R2026a，各 baseline/DISPLAY context、0pt/3pt，共12个canvas候选；已逐件实际 `view_image` 查看全部12PDF预览和8PNG。R26四份PNG未生成，不能查看或补签。
- **两旧版的四份0pt原生PDF同时具备576x360pt页面、WenQuanYi嵌入和完整预期文本。** 中文标题、旋转ylabel、英文标签/图例实际可读；不是R18/R19外部派生PDF，也未后处理原PDF。
- **原候选12/12仍为failed，不能改签。** 旧版8候选的PDF/PNG实际存在、hash匹配且原记录为exported；三版每候选三次几何采集共36次均报 `MATLAB:heterogeneousStrucAssignment: Subscripted assignment between dissimilar structures.`。R26还叠加真实PNG API失败，不是所有失败都可归为结构数组问题。
- **R26另有反例：** 两个0pt PDF实际578x362pt，两个3pt为572x356pt；四份PNG报 `MATLAB:print:ExportappForPrintFigureWithUIControl`，文件缺失。几何修复不会解决这些API/页尺寸问题，本次不切换API或重试掩盖。
- 旧版0pt可以继续送下一轮独立原生候选验证，但尚不支持生产替换、全图视觉/字号不变、100分或trusted visual。未重复原3个核心候选的视觉审查，也未动其他字体/对比度探针。

## 原因与窄修复
- `canvas_geometry`先成功记录figure、panel、两个axes、rectangle和堆叠顺序，随后首次写入 `snapshot.fonts(fontIndex,1)` 时失败；所有原JSON的fonts为空。初值是无字段 `struct([])`，被下标赋入含 `class/properties/unavailable_properties` 字段的结构，触发实际原生错误。
- 仅修改 `codex-runtime/matlab/tests/test_native_pdf_page_probe.m` 的字体采集循环：先取得真实 `fontRecord`，首次直接令 `snapshot.fonts=fontRecord`，后续再按下标追加。没有填空、过滤异常或把capture_failed改成captured。
- **三次几何仍全部必需**：before PDF、after PDF、after PNG必须为captured，且两份文件exported，候选才可标 `export_pair_completed`；错误捕获/完整候选归档保持不变。
- 保留主线IO隔离：原root JSON通过 `supplementary_report`指向独立实验JSON，实验后不重写root文件。旧3候选、断言、计数、导出API/选项及评分均未改变。
- `mh_lint --matlab 2021a --brief codex-runtime/matlab/tests/test_native_pdf_page_probe.m`通过；`git diff --check`通过，静态对照确认字体循环之外未改。本机无MATLAB，修复后的字体采集仍待新CI，不冒充已原生重跑。

## 实测页面与文本
- 基目录：`/tmp/matlab-run-33999054663/matlab-full100-<release>/`。B=`native-pdf-page-probe`，D=`display-comparison/native-pdf-page-probe`；各候选在 `<context>/canvas-extent-experiment/panel-canvas-inset-<0|3>pt/`。
- 对12份PDF逐件执行 `pdfinfo -box`、`pdffonts`、`pdftotext -layout`、`pdftotext -bbox-layout`、`pdfimages -list`；预览仅用 `pdftoppm -singlefile -r 150 -png`写入独立 `/tmp/canvas-native-round20-kK8yJp`，不改原件。
- 全部单页、rotation=0、PDF1.4。旧版8PDF Producer为 `Apache FOP Version 2.4.0-SNAPSHOT: PDFDocumentGraphics2D`，唯一字体均为 `EAAAAA+WenQuanYiZenHei / CID TrueType / Identity-H / emb=yes / sub=yes / uni=yes`，没有Courier，`pdfimages -list`为零图像。不能仅凭FOP名称推断Courier。
- R26四PDF Producer为 `Qt 6.8.1`，字体为 `WenQuanYiZenHei / CID TrueType / Identity-H / emb=yes / sub=no / uni=yes`。源JSON未找到字面CropBox，Poppler有效CropBox等于MediaBox；这是工具独立解析，不是将空literal当成功。
- 每份均抽出20个word，五项预期字符串全部存在：`南海海表温度`、`温度 (degC)`、`Time (h)`、`Observed 20.125`、`Model 21.50`，以及x刻度0至5、y刻度19至23。这里证明的是本合成图文字，不是完整海洋报告文本契约。

| 候选 | MediaBox/CropBox终点pt，原点均0/0 | PNG像素 | PDF文字bbox顶部/底部余量pt | 实际PNG/PDF所见 |
| --- | --- | --- | --- | --- |
| 21B-0 | 576x360 | 2400x1500 | 6.032 / 3.218 | 中文和ylabel完整，两条曲线/圆与方标记可辨，图例不越框；xlabel近页底。 |
| 21B-3 | 571x355 | 2400x1500 | 3.032 / 1.218 | 字形/曲线保留，PDF更贴上下页边；PNG仍为全画布。 |
| 21D-0 | 576x360 | 2400x1500 | 7.052 / 4.178 | 中文/标签/两行图例完整；图例及虚线节距与B有细微差别。 |
| 21D-3 | 571x355 | 2400x1500 | 4.052 / 2.178 | 无本例文字截断，但页尺寸不达目标、底部更紧。 |
| 24B-0 | 576x360 | 2400x1500 | 6.032 / 3.218 | 实际单独看过，标题、轴标签、刻度、图例和两组曲线完整。 |
| 24B-3 | 571x355 | 2400x1500 | 3.032 / 1.218 | 实际单独看过，PDF底部余量小；原PNG保留布局。 |
| 24D-0 | 576x360 | 2400x1500 | 7.052 / 4.178 | PDF文字/图形完整；PNG线条与圆标记可见锯齿，不签像素质量一致。 |
| 24D-3 | 571x355 | 2400x1500 | 4.052 / 2.178 | 文字仍可读，PDF更紧；PNG与同context的0pt同样有锯齿。 |
| 26B-0 | 578x362 | 未生成 | 8.341 / 7.427 | PDF中文/标签/图例完整，曲线与标记可辨；页面非576x360，无PNG对照。 |
| 26B-3 | 572x356 | 未生成 | 5.353 / 4.415 | PDF文字和曲线完整、页边更紧，但仍非目标尺寸；无PNG。 |
| 26D-0 | 578x362 | 未生成 | 8.341 / 7.427 | 实际单独查看，中文与图例完整；同样页尺寸不符、PNG缺失。 |
| 26D-3 | 572x356 | 未生成 | 5.353 / 4.415 | 实际单独查看，未见本例文字裁切或图例压线；无PNG，不签跨格式一致。 |

- 旧版0pt与3pt的每个word边界在同context内整体左上移3pt，宽高不变，数值误差小于3e-14pt；这不是字号缩放。**旧版3pt实际少5pt，R26少6pt**，不得凭这些样本外推通用crop补偿公式。
- 同release/context的0pt与3pt原PNG解码RGB逐像素相同，虽然文件SHA不同；这只证明这四对PNG相同，不代表PNG/PDF跨渲染器相同。
- `pdftohtml -xml -stdout -zoom 1`在旧版B报告字号11/12/14/10，D为11/12/13/10；其fontspec为整数化结果，**不能据此说标题缩小1pt**。标题bbox高实际17.612/17.611598pt，仅差0.000402pt；顶部位置差约1.0203pt。旧版B/D的ScreenPixelsPerInch为72/100，R26两context均96；不把差异归结为DISPLAY单因素，也不代替缺失的原生FontUnits快照。

## 几何与剩余风险
- 失败前留下的实际panel/背景axes Position均为 `[0 0 8 5]` inches；白色rectangle的panel点坐标分别 `[0 0 576 360]` / `[3 3 570 354]`。FaceColor白色、Visible on、无边线；堆叠顺序为legend、data axes、background axes。不是隐藏文本或伪造数据范围。
- R21四候选在PDF导出后data axes的 `PositionConstraint`从outerposition变成innerposition，并保持到PNG后；其已记录Position/OuterPosition/TightInset等数值不变。R24所记录几何属性前后相同。R26背景axes的TightInset从`[0 0 0 0]`变为`[0 0 0 0.2083333333333337]`in，顶部15pt；其OuterPosition另有浮点尾差。**所有候选字体快照缺失，整体几何status仍失败**，不能写成完整对象不变。
- 四份0pt文字全部在页面内，但底部只有约3.2/4.2pt，不是充足出版页边距保证；3pt更只有约1.2/2.2pt，且页面不精确。未测长title、长ylabel、多行统计、多panel/colorbar、NaN/QC/不确定度或其他字体/字号，不能外推到整套evaluator。
- 图例在数据区右上角但未盖住本例折线；x端点标记与边界相交，未被页面裁掉，却没有专门端点留白。原PNG/PDF有可见线型节距/栅格边缘差异，未声称零像素差或颜色可访问性通过。
- R26的print错误为 `UI components are not supported. To include UI components, use the 'exportapp' function.`，原文件确实缺失，不是只有声明失败。本次未采用exportapp或其他fallback。此实验未传生产R26精准Units/Width/Height/Padding选项，其非精确页面不能偷换成生产精确路径的回归结论。
- 原12份candidate.status、36次capture_failed及各context失败summary全部保留；root核心3项exportchecks不因独立视觉结论改变。没有修改生产exporter、门禁、score/audit、工作流或原PDF；无提交推送。

## 原件SHA-256
下表文件名分别为各候选目录的 `native.pdf` / `native-reference.png`，前后hash一致。

| 候选 | PDF SHA-256 | PNG SHA-256 |
| --- | --- | --- |
| 21B-0 | `829a0d71513bfef000b2f777c0970c4ea97a5d796ab33f703bfd66eac5c31614` | `3d2054c7c26bf03364b499462c1ade2639065e713aa7038efed15c9a216d70c5` |
| 21B-3 | `a566bca57860a4868b7046f524d8b3180e64902bd740debabecf3e0510dd2e3f` | `6ddf939d9cafb64651d2b8f82280ffc66d87c7c6e31c39dadf9849ca42a9e2c8` |
| 21D-0 | `27f3325af8bd9e1a31ebc56db29b3112d7334e86b33d6d970366d5eb23227da7` | `12d8fed698fd40e39d8b94560e4d564d2d0cb46df09c6bc87688a1c437573b6e` |
| 21D-3 | `0c619678507037f103eb8e0e00d60b0f069a164f98ee768d2e894e79983d0680` | `52d7b03142a16ed3099d5fa3919d86a6bba18fd741aca9b832fa86e0dd246194` |
| 24B-0 | `e5830de39167e335f7ba1b5086f4f6a0ae3536f19a5411d5d606b56dcc9036fb` | `529413b5ac865a0b978e21758f501e8a3b7f4429e88aae059950a9bbc6cbc42b` |
| 24B-3 | `571894f099ed0663a970e59c78e70ba89b6fc68fb843b7ac5ed60d72e974050a` | `b008a39ac7f44529b3a1af5bef0e9d267428002e8b973681687e8d3273743b36` |
| 24D-0 | `5c41d72246f5d0b3e7f83c48846a2d817b6c780af67ff5b9cb4a8bb275fd2034` | `3f88b679ea60380bf3355cae38b5c8f5c6079788e7013d69927245b12ee835c7` |
| 24D-3 | `b4d77312fb43b2a19cd0889436a2e612ec24d6d707d58e54e20ac79f46891cf0` | `2923b1c4392e7175936cbc9152187ae1dbc028e7f7e9a7749e3a5378e444d67d` |
| 26B-0 | `b86ee7b39c039857f78b3c009e8282af35972d7d2c94829adf48ad83b76136bf` | 未生成，无hash |
| 26B-3 | `1e7ab41c630388d1ad74524b9bdec94a50336e521de6a660ea73fdaa10535d09` | 未生成，无hash |
| 26D-0 | `f2d08c1c2a45c22421662e5f486dd3c2b3c8c6f65c750081413d92f9e3eddac1` | 未生成，无hash |
| 26D-3 | `13cc60c456e18d3a527d09149c0f59ab66c75592e8d6eef9817a3823f23f6849` | 未生成，无hash |

- 20份图件、12份candidate JSON、6份实验JSON和6份root JSON共44原件全部前后hash一致，现有PDF/PNG也匹配原候选声明；R26四份PNG仍缺失，JSON失败记录未修改。
- 独立证据：`/tmp/canvas-native-round20-kK8yJp/results.json` SHA=`0a0dec5e660752695ab0c46ed7acfcbfa14532074949559e0a233a86b59c59f2`，包含32原件hash、完整Poppler输出、bbox、局部几何差异和预览hash。
- 实验脚本 `inspect.py` SHA=`301eb7d554558f36c68b6eaada7f9bf7f253af0cc68f3b6e6712c519aff27e90`；修复后测试文件SHA=`f12a987a65e9c0165921cfeabfb84e4b8a548ad7db96a2e1ebb2c09d652f585f`。
- R26补充证据同目录 `r26-results.json` SHA=`dd44646e2a8e4bab29cf2e39d956bbdb1eca7d84790f3139cfb36bfa20bf2e6c`，含新增12原件hash、四PNG缺失路径、全部错误/Poppler输出及预览hash；`inspect_r26.py` SHA=`8ec5c02935c389e441dcdfd3519479d96f96e1fe43580e9de6b7a31148d69299`。
- 交付边界：**仅两旧版0pt**的精确页面/嵌字/本例文本有同时成立的证据；R26嵌字与可读性有证据，但页面及PNG失败。诊断修复仅静态验证，完整几何、复杂图面、Desktop及trusted visual均未批准。
