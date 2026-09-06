# R21 Simple Canvas 原件独立复核

## 结论
- 本报告检查的是 **R20 run34000171748** 新原件，不是R19复述。旧两版四个context的0pt PDF均重新独立确认：**MediaBox/CropBox=576x360pt、WenQuanYi嵌入、五项预期文本完整且实际可读**。
- 三版12候选的36份geometry均为captured，每份都有7条font记录。所有候选的FontName/FontUnits/FontSize/FontWeight/FontAngle在PDF前、PDF后、PNG尝试后均未变化；但不能声称整个对象或画面不变。
- **副作用仍在：** R21四候选的data axes.PositionConstraint由outerposition变成innerposition；R26四候选背景轴顶部TightInset增加15pt。R24四候选在已采集全部字段范围内前后相同。
- R26两份0pt PDF仍为578x362pt，虽字体嵌入和文本完整，页面不达目标；四PNG均不存在，原生print明确拒绝UI组件，candidate仍failed。不用geometry修复替代导出/尺寸成功。

## 范围与方法
- 基目录为 `/tmp/matlab-run-34000171748/matlab-full100-<release>/`。B=`native-pdf-page-probe`，D=`display-comparison/native-pdf-page-probe`；候选目录为 `<context>/canvas-extent-experiment/panel-canvas-inset-<0|3>pt/`。
- 完整解析12份candidate JSON，逐字段比较三份geometry及7条字体记录；同context另比较0pt/3pt全部geometry。没有过滤PositionConstraint、浮点尾差或unavailable字段来制造相等。
- 对六份0pt原生PDF分别执行 `pdfinfo -box`、`pdffonts`、`pdftotext -layout`、`pdftotext -bbox-layout`；Poppler均为22.02.0，命令均成功。bbox通过XML解析，页尺寸不采用JSON的literal扫描代替。
- 六份PDF均以 `pdftoppm -singlefile -r 150 -png <原PDF> <临时前缀>` 渲染，并逐张实际view_image。预览只写 `/tmp/canvas-native-round21-VT0qFl/<代号>-0.png`，不覆盖原件。
- **没有查看3pt PDF或任何原生PNG图面**，不补签这些视觉项；3pt仅作JSON几何对照及文件hash核验。未重审复杂fixture probe、36suite、比较主图或生产exporter，也未修改旧设计报告。

## 六份0pt PDF
字体A=`EAAAAA+WenQuanYiZenHei / CID TrueType / Identity-H / emb=yes / sub=yes / uni=yes`；字体B=`WenQuanYiZenHei / CID TrueType / Identity-H / emb=yes / sub=no / uni=yes`。每PDF只有对应这一项字体，无Courier。旧两版Producer为Apache FOP 2.4.0-SNAPSHOT，R26为Qt 6.8.1；全部单页、rotation=0、PDF1.4、MediaBox原点0/0。

| 原件 | MediaBox与有效CropBox(pt) | 字体 | bbox文字上/下余量(pt) | 本次实际PDF图面 |
| --- | --- | --- | --- | --- |
| 21B-0 | 576x360 | A | 6.032 / 3.218 | 中文标题、旋转ylabel、英文轴标签和两行图例完整；xlabel贴近页底。 |
| 21D-0 | 576x360 | A | 7.052 / 4.178 | 同样完整；图例框比B更矮，虚线节距不同，未盖住本例曲线。 |
| 24B-0 | 576x360 | A | 6.032 / 3.218 | 已单独查看，标题/标签/刻度/图例无明显裁切；底边偏紧。 |
| 24D-0 | 576x360 | A | 7.052 / 4.178 | 已单独查看，中文与图例完整，曲线和圆/方标记可辨。 |
| 26B-0 | 578x362，非目标 | B | 8.341 / 7.427 | 标题、ylabel、图例可读，图面无本例明显文字裁切；无原生PNG对照。 |
| 26D-0 | 578x362，非目标 | B | 8.341 / 7.427 | 已单独查看，同样文字完整但页面不精确；无原生PNG。 |

- 六份各抽出20个word；`南海海表温度`、`温度 (degC)`、`Time (h)`、`Observed 20.125`、`Model 21.50`均逐字存在，x刻度0至5、y刻度19至23完整。这是PDF文本抽取证据，独立于对象FontName与人工可读性。
- 六图图例均在数据区右上角，本例未见盖线；两端标记仍与x=0/5的轴框相交，没有额外端点留白。未见本例文字被页边截断，但旧版约3.2/4.2pt底部文字余量不是充足出版页边距保证；不外推到长标题/统计或复杂图。

## 完整字体与几何
- 36份快照每份7条font记录：Panel、Legend、data axes、background axes、title、xlabel、ylabel；字体均WenQuanYi Zen Hei，FontUnits均points，FontWeight/FontAngle均normal。每候选7条记录的String、Position、可用Extent等字段也前后一致。
- 实际FontSize分别为：Panel=10、Legend=10、data axes=11、background axes=10、中文title=14、xlabel/ylabel=`12.100000000000001`（12.1pt），三版及B/D相同。面板和无刻度背景轴有字体属性，不代表另外画出了文字；PDF实际使用的字体以上述pdffonts为准。
- Panel/axes缺String/Extent/Interpreter、Legend缺Extent等均原样列在unavailable_properties；三个普通Text的公开几何已记录。captured表示现有采集成功，不是任意文本或所有对象的公共几何均可测。

| 候选组（每组含0pt与3pt） | before PDF → after PDF 的全部已记录差异 | after PDF → after PNG尝试 |
| --- | --- | --- |
| 21B、21D，共4 | 仅data_axes.PositionConstraint：outerposition→innerposition | 无新增差异；旧值未恢复。 |
| 24B、24D，共4 | 无差异 | 无差异。 |
| 26B、26D，共4 | background_axes.TightInset顶部：0→0.2083333333333337in（15pt）；OuterPosition左端-1.04→-1.0399999999999998、宽9.8→9.799999999999999 | 无新增差异，但PNG调用失败，不能叫“成功PNG后的不变”。 |

- 三版data axes.Position始终为`[1.04 0.55 6.2 4.075]`in，OuterPosition=`[0 0 8 5]`in；panel.Position/InnerPosition和background_axes.Position均为`[0 0 8 5]`in，层叠始终为Legend、data axes、background axes。各候选已记录限值、刻度、方向、尺度、aspect ratio及颜色在三时点不变，例外只有上表。
- 六context内0pt与3pt在各时点的geometry差异**仅**rectangle.Position及对应rectangle_panel_points：`[0 0 576 360]`→`[3 3 570 354]`；字体、axes/panel几何与层叠均一致。未据此推导3pt实际PDF页尺寸，本次未对其运行pdfinfo。
- **跨context不是同一布局：** 两旧版ScreenPixelsPerInch为B=72、D=100。字体字号不变，但Legend归一化高度B约0.090278、D约0.081（物理高度约32.5/29.16pt），title/ylabel位置及TightInset也有差别；PDF图面确有框高/线型节距差异。R26两context均96。不能把FontSize相同写成画面不变，也不作DISPLAY单因素归因。
- 原记录状态核对：旧两版8候选均export_pair_completed，PDF/PNG均exported；R26四候选均failed，PDF为exported，PNG均报`MATLAB:print:ExportappForPrintFigureWithUIControl`，消息为不支持UI组件并建议exportapp。本审计没有改API重试。
- 此simple快照没有逐条原Line的数据/句柄/全部绘制属性比较；不能把已采集几何相同外推成所有科学数据、所有对象状态或像素完全不变。也未测试包裹已有tiledlayout及恢复调用方figure。

## 原件与源码hash
- 审计前后核对44份包内文件：12 PDF、8 PNG、12 candidate JSON、6实验JSON、6root JSON，全部SHA-256不变；所有20份现存PDF/PNG的实际hash均匹配对应candidate声明。R26四PNG确实缺失，无虚构hash。
- 下表各候选文件为`candidate.json`、`native.pdf`、`native-reference.png`。0pt PDF有独立页面/字体/抽取/视觉检查；3pt PDF及全部PNG仅hash核验，不能由表格误读为视觉通过。

| 候选 | candidate JSON SHA-256 | 原PDF SHA-256 | 原PNG SHA-256 |
| --- | --- | --- | --- |
| 21B-0 | `d38b23eb4f01648d44fee5cde54c2973eac175e5057b91c626ce7e04d7dd2909` | `2b1a255cdb8abcb447167afd5b3d4515cb3f3a10f6da30ed4410648f831a0a56` | `4f79fc6075e21a191f4f0e2f6bdc5ee73914e04774c6ab05ccce5f4adc4afda3` |
| 21D-0 | `09451502480589f6ca91dcf6d9c461eebb9dc9d2d1afc9e0e6740701a1ec5caa` | `3cc7d17e6308c59dd55e0ce9d4dd125ab15d57c538e17d82883b3254ad9b2f64` | `e619a15ae2cc1fd3be490ab31b90dc5d6c3cdca8dad3ce3562dc74219ecb63bd` |
| 24B-0 | `6a702424a76676d11f8d2de5f8b6342e06cb63dd02ad0d7e317dd203aa6a1022` | `d69841836e0dacc4eaa687a59015e9f1bb9ca8d2df04a8a1a16f7fac1bd0fb7f` | `5509981dc6997e6d276af0b69668d6f530d392e59d41e8fc96a79528574c82d1` |
| 24D-0 | `9c1ab3d179de3ecff267eb74bca4135826fbc1abe68f14c15930c29c55e6fe21` | `2b85ed39898383c9c981cc24e9f89e9468ba9f3b7bbfc13d05d6e732892c384d` | `c1cd522ab5b17d4129d9535006654f2695ca5881414793bab376b59a6f454966` |
| 26B-0 | `fd516fcbae2223cdc6556ddd0039f540ccf512ec0fed7f3077a6316872226567` | `297dd554fc177f97b8efc247bee4ecadd63143cbde0fa9ec6120fb3bc6819d5b` | 缺失 |
| 26D-0 | `3dfaa8227552f0b30431b2e93bac03f75bfba6baf54120d4530041a9bc7e8374` | `d7b3a0df30f7b348cb8f7b8b31988e743c6211c950e599ffae24687168f6846e` | 缺失 |
| 21B-3 | `5adc49903c325cda6dd4ca3ea81478e99cb94b03df4045a6ac72caa5b41e194b` | `7d425d07750c044cea3144e5379b231afb90d131750f5e434791f9437a3c1b7e` | `4e18af1b55b6b38c3a17a200e20289eec68e1c4e0be78c91705ad7c77a32979c` |
| 21D-3 | `d654c68a5451f18070b31e5dce5ce0a36815b7066fadba15dd1500f068bf2208` | `f5e8778c9c875b68179d11f148a0a6ccc01a98df00184a624dfd901e07523d0a` | `4c5b5b8895e5543b7fb210438de9f8c7f4807b0f348cd7aac6c1938ed2eaaff2` |
| 24B-3 | `4e68a13677a138f933a9af939518c65a4debef385ea6b7b1fb326fa145a2b7f6` | `7a85e79903b4a982ae69c4c5758bce02d2858f613d812242553805f18fe18d8a` | `e5a43a93acce46d9b70976d84c41afe1a6951954650b159a558181fd20ff4bb2` |
| 24D-3 | `f258d7a0df33dc3b72210e61ff4fbe085e67b31a6f6b832e788f28c1e6a84e11` | `e01270ecc9b55f74b0e56e9b7eef26a591909a9b9382b85a8fe64268170dbc17` | `9ca4d30f3a900b4f3097a429a2f33d9155868a99f491ed0c23f6013c06f130a7` |
| 26B-3 | `1983d0d1e9a8f1680f60c70c2c4ad218b8260414136563e690c5bf7e4648920c` | `ea5be4b61bdc9f4fc384a1b6f037273edc34f1d937fc92f3157cf9ef5885be36` | 缺失 |
| 26D-3 | `cd11d4142a5fffa687169f97197250812d5fe130913717c0dccefc07f08dc007` | `445b5904dbafcfe130a2ea7d24114c3c55733cbd5c5a6140536fdec56709940d` | 缺失 |

- 工作区仅只读的 `test_native_pdf_page_probe.m` SHA=`8d0c0c380b95edc2b3dda27760529aaae8c0ebd7ea4d79e5e9e54f69dd72b97c`，读前后不变；这不是宣称工作区文件与CI源字节相同。
- 旧 `fixture-canvas-design-review-round21.md` SHA=`60f831c90787074dd5c5b5b2ae1ba6107b01058fea439a499d3d8de8cfb468ed`，保持不变；主线程已更新复杂探针的消息不回写该历史快照结论。
- **交付边界：** 仅新增本报告。此次证据增强了旧两版simple 0pt的精确页面、原生嵌字、点制字体属性及本例可读性结论，同时确认R21几何副作用尚在、R26页面/PNG仍失败。不签trusted visual、Desktop、全量验收或生产策略通过；不改源码、原件、score/audit，无提交推送。
