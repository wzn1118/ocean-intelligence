# R19 SVG 派生 PDF 独立候选研究

## 结论先行
- **不能作为字体嵌入/可搜索 PDF 的修复方案。** 8/8 原 SVG 已把可见文字转成路径，无 `text/tspan/textPath`；派生 PDF 的 `pdffonts` 均零行、`pdftotext -layout/-bbox-layout` 均零词。空字体表不等于全部字体已嵌入，不能据此通过原门禁。
- **图面有价值，但非全图修复。** 8/8 派生页面精确 576x360pt；所看标题、长 ylabel 和中文比旧 Courier PDF 更接近 native PNG，但 R21 对比图仍无可见 xlabel，图例末字与右框接触。不能称全通过或直接替换生产 PDF。
- 这是 **MATLAB SVG + 外部 librsvg/Cairo 转换的派生产物**，不是 MATLAB native PDF，不是 GS 候选重跑。只适合作为隔离的轮廓版布局对照；若目标仍要求字体 family/嵌入/文字抽取，当前输入已足以否定该候选，不建议为其宣告修复成功。

## 范围与方法
- 原包：`/tmp/matlab-run-33995525791/matlab-full100-{R2021a,R2024b}/evaluator-runtime`。仅四图各 PNG/SVG/PDF 和两份 `figures.json`；24 原产物及两 manifest 的 SHA 前后全部一致，产物 SHA 与 manifest 一致。
- 简称：H=`crossed-time-depth-temperature`，P=`repeat-cast-salinity-profiles`，C=`paired-observation-model`，I=`paired-interactive`；21/24 分别指 R2021a/R2024b。
- 隔离证据目录：`/tmp/svg-derived-pdf-round19-tqf6v5`。每图目录为 `<release>-<完整图名>`，含 byte-identical `input.svg`、`native.png`、`derived.pdf`、两种 raster、`comparison.png`、命令与 Poppler 日志。
- 开始时无可执行 `rsvg-convert`；仅在上述临时目录 `apt-get download librsvg2-bin=2.52.5+dfsg-3ubuntu0.2` 后 `dpkg-deb -x ... tool`，未安装系统包/生产工具或影响服务。使用 `tool/usr/bin/rsvg-convert` 2.52.5、Cairo 1.16.0、Poppler 22.02.0。
- ElementTree 解析真实 XML，tinycss2 1.5.1 解析根 style。8/8 均无 `font/font-face/glyph/missing-glyph/hkern/vkern` 等内嵌字体节点，无嵌套 SVG；未删除字体、未扩大规范化白名单。实验脚本遇内嵌字体即拒绝；本次不证明这些节点可安全放行。
- **实际 view_image** 看了 8 张三列对照：native PNG、librsvg SVG raster、Poppler 派生 PDF raster，共24个图面；另放大查看 R21 C 原PNG/派生PDF、R24 C/H 派生PDF、R21 I 派生PDF。原 PDF 本轮查字体及 hash，不重复 R18 的原PDF视觉审阅。

## 物理尺寸与复现
- 八个根元素均为 `width="2400px" height="1500px" viewBox="0 0 576 360"`，style 另有 `width:8in;height:5in`，并有 `data-physical-*-in` 元数据。元数据不是渲染命令；`viewBox` 四数是用户坐标，不自带 pt 单位。
- [SVG2 viewBox 规范](https://www.w3.org/TR/SVG2/coords.html#ViewBoxAttribute)定义用户坐标到 viewport 的映射；[SVG2 width/height](https://www.w3.org/TR/SVG2/geometry.html#Sizing)规定相应几何属性。但不能把规范支持等同于此版本工具实测行为。
- [librsvg 2.52.5 官方手册](https://github.com/GNOME/librsvg/blob/2.52.5/rsvg-convert.1)说明 px/in/pt、默认96dpi、图像尺寸与独立 page 尺寸；pt 为 1/72in。显式设置图像和页面，不能只设置纸张或省略单位。

| I21 副本控制 | 实测输出 |
| --- | --- |
| 不给尺寸，默认 PNG | 2400x1500px |
| 不给尺寸，默认 PDF | 1800x1125pt，即像素按96dpi换算 |
| 仅移除临时副本根 CSS width/height，其余保留 | PDF 仍1800x1125pt |
| `--width=576 --height=360`，未带单位 | PDF 432x270pt |
| 图像与 page 均显式 `576pt/360pt` | PDF 576x360pt |

上述控制表明，本例 librsvg 未以根 CSS 的8x5in作为默认固有尺寸；不能只依赖该声明。最终等比1.6映射把576x360用户坐标映为576x360pt，没有修改源SVG/viewBox，也没有对结果PDF再缩放补边。

```sh
RSVG=/tmp/svg-derived-pdf-round19-tqf6v5/tool/usr/bin/rsvg-convert
SOURCE_DATE_EPOCH=1788566400 "$RSVG" --format=pdf --dpi-x=96 --dpi-y=96 --width=576pt --height=360pt --page-width=576pt --page-height=360pt --keep-aspect-ratio --keep-image-data --output=derived.pdf input.svg
"$RSVG" --format=png --dpi-x=300 --dpi-y=300 --width=2400px --height=1500px --keep-aspect-ratio --output=svg-raster.png input.svg
pdftoppm -singlefile -r 300 -png derived.pdf derived-raster
pdfinfo -box derived.pdf
pdffonts derived.pdf
pdftotext -layout derived.pdf -
pdftotext -bbox-layout derived.pdf -
pdfimages -list derived.pdf
```

重放完整实验：`/tmp/matlab-svg-audit-venv/bin/python /tmp/svg-derived-pdf-round19-tqf6v5/probe.py --rsvg "$RSVG" --output <新建隔离目录>`；不要使用原包作为输出目录。

## 逐图实见
三列对照均已看；“保留”只指可见图形，不代表科学数组重算、字体嵌入或像素相等。

| 图 | native PNG / SVG raster / 派生PDF实际比较 |
| --- | --- |
| 21H | 长英文标题、Depth ylabel、12至19温度colorbar、UTC日期/2026完整；白色缺测单元保留，未被填为最低温颜色；深度刻度0/20/40/60/80一致。未见旧Courier式右端标题裁切。 |
| 24H | 同版三者标题/轴标签/colorbar完整，白色缺测位置一致；本版深度刻度-10至80、间隔10，区别于21原图，非转换新增。 |
| 21P | 长 ylabel `Depth (m, positive down; reference: synthetic sea surface)` 完整；标题、Salinity单位、三条不同颜色和实/虚/点线及08-10/12/14T06:00:00Z图例可辨，未见右侧图例越框或旧PDF式ylabel顶端裁切。 |
| 24P | 三者保留本版轴位置、长ylabel、三个日期图例和线型；图例位于数据区外，未见新增遮盖或页面裁切。 |
| 21C | 长title及三行统计完整，位于数据区上方；11个散点/虚线1:1参照可辨。**三者均看不到 `Observation (degC)` xlabel；图例末尾 `reference` 贴/触右框，条目间距紧。** 保留原PNG缺陷，不能声称图例已全部修好。 |
| 24C | 同版三者有完整 `Observation (degC)` / `Model (degC)`，图例末字留有右边距；长title及三行统计未压入散点区。统计均可读：N=11、Bias=0.08727、MAE=0.09273、RMSE=0.1116、r=1.000、Missing/QC=1/0、Unmatched=0/0。 |
| 21I | `温度时间序列 / Temperature time series` 完整可读；五个空心圆、竖直误差棒/端帽、两段折线和中间缺测断线可见，左右端点有留白；UTC日期、2026和温度单位完整；无额外图例。 |
| 24I | 独立看过三列；与21I的SVG及派生PDF字节相同，中文、端点/误差棒、缺测断线和日期呈现一致。原PNG文件SHA不同，但本次差分统计相同。 |

- 两个H的 SVG 本已内嵌762x454 RGBA温度场和24x454 RGB色条；派生PDF `pdfimages -list` 仍有这些尺寸及762x454 soft mask，有效约144ppi、`interp=yes`。不是全矢量温度场，300dpi预览不会补回空间信息；格边插值、色彩管理和透明度跨查看器一致性未获零差分证明。
- 图面没有观察到NaN断线被补连、白色缺测变成有效低值、深度方向反转或误差棒消失。QC/不确定度的科学定义不能由外观重建；C是R16旧散点/1:1图，不是主线新v3单侧U证明。未复算数据、统计、掩膜或误差棒数值。
- H主要靠颜色表达量值，未作色觉/灰阶仿真；P有线型冗余。保留这些可见编码不等于通过科学可访问性门禁。

## 字体、文本与像素分开判定
- 8/8：PDF 1.5、Producer=`cairo 1.16.0`、单页、rotation=0；MediaBox/CropBox/BleedBox/TrimBox/ArtBox均为`[0 0 576 360]`。
- 8/8：字体family **无可报告对象**，嵌入 **不满足所需字体证据**，可抽取词数 **0**。中文/英文/统计/日期虽在相应图中肉眼可读，却都不能从派生PDF抽取；SVG `title/desc/aria-label` 不是页面文字。manifest的WenQuanYi声明和根 `font-family:'Dialog'` 均不能证明轮廓所用family或PDF嵌入。
- 本轮复查8个 native PDF仍为 `Courier / Type1 / WinAnsi / emb=no / uni=no`，失败状态保留。避免Courier替换的原因是使用原SVG已经定形的轮廓，并非修复旧PDF字体，也不是找到了带字体语义的SVG输入。
- 差分：统一2400x1500，任一RGB通道非零即计一个变化像素，**不设置容差**；三种渲染路径均非零。不能将所有差异未经证明归为抗锯齿，也不能以低均值签视觉通过。

| 图 | PNG→SVG变化像素 | SVG→PDF变化像素 | PNG→PDF变化像素 | SVG→PDF最大通道差 / 平均RGB绝对差 |
| --- | ---: | ---: | ---: | ---: |
| 21H | 104970 | 131300 | 133786 | 219 / 0.441904 |
| 21P | 65133 | 83874 | 87270 | 184 / 0.326866 |
| 21C | 61989 | 65411 | 71706 | 178 / 0.319892 |
| 21I | 55380 | 71980 | 74009 | 183 / 0.300203 |
| 24H | 123920 | 170469 | 174760 | 219 / 0.486524 |
| 24P | 64515 | 83886 | 86698 | 187 / 0.324759 |
| 24C | 62018 | 71208 | 74281 | 187 / 0.316646 |
| 24I | 55380 | 71980 | 74009 | 183 / 0.300203 |

## SHA-256绑定
原SVG副本SHA与下表源SHA相同；派生PDF在`<release>-<完整图名>/derived.pdf`。

| 图 | 原SVG SHA-256 | 派生PDF SHA-256 |
| --- | --- | --- |
| 21H | `36be8dd5c6a78262504b7b7d46c903cfd227446b86e5b07d52a8f331cb855c21` | `a067153ce6699d9b5a0ebe57f7c9a1867cf5d33307b5616bce72f189a1a1d568` |
| 21P | `788234f7fb8fd287c3d51d7ab807b320af6332e9c4d34c14f67e9811be5beac1` | `26ae1ccb175f059e3536ba46b39c22aee03af3d21aaf2818aea0cee534581648` |
| 21C | `5185b5bbefbbb73dcfa78e7d066734e0403ccb287be17d4d1568aedd08cfe8c4` | `20740b4c2cdd978eed900b05e7e365086761a13f713561d0acf0242d00e27331` |
| 21I | `8d25f6440219e34ffd48aa1b03f5b2efa6bfcd2c49142085329c1a09c532263b` | `494c5427c5e7af7ab3478079fa13d6cab0fb90ff2a17023e8314540ef0997dc1` |
| 24H | `5d6a6d1a8115305e7c6078a4e667018f786b66d8bde524b72d93a41e09af5f11` | `fcc97844a3aa3e24dd8a9f546038d0e122767aa5c7c42d27542d5f19aef0e83f` |
| 24P | `711a35e4670d896044d72a33a8e167f4d38c66c8dff7ce15679eda63bb77ce05` | `2561629af080ce21b5e1f4ccf79ed6a71144c824a080924755f54b035e4c0a3c` |
| 24C | `42cc93f0588f3db12a97a2cc66d40cb0b2e0512893f321fccdd7ccc7b95463dd` | `25e6bab380955ce36514d79570563d560a7d9b89da26a742f39475204d338728` |
| 24I | `8d25f6440219e34ffd48aa1b03f5b2efa6bfcd2c49142085329c1a09c532263b` | `494c5427c5e7af7ab3478079fa13d6cab0fb90ff2a17023e8314540ef0997dc1` |

| 图 | native PNG SHA-256 | 仍失败的native PDF SHA-256 |
| --- | --- | --- |
| 21H | `581d1820c11deeaf22f07f28b47ba54b2a1078a2ac1d1f4ad4a12ab9f119113f` | `ea0a8f741e36c6b6dcb9120e6d494dbb3644dfc3b04dad4b90f0688b6ec90a24` |
| 21P | `dc964400e06c432ecf6ea523a81b4476788614ececac460f017380ad87eb110c` | `b43fecc42e6fadadc1d35458b273d0007b1a15a8c18398220fe134b7eeede28f` |
| 21C | `7a7d7b9dcaa7a889896ea038353bce6b22fa3f0a868271499eaa6fd7a1cd4d33` | `c88b02c01246915055c0ddb4710bb61cbef9520d835aedd8fda6a6fd47c8239a` |
| 21I | `cf414ed195401c0327c90737124b2f7f181b1163f9938408831c21fcf1910729` | `90ceed1da83b3de723c8b733ed7dc4b273566d11bdfc117df27f0bdb0483af96` |
| 24H | `67da538f03e5ff415970b154089d19aac298ee0a6c9ab0d31b326fb043687944` | `cebba261e60a72fd5c4c33cee2c57018e531fd604b8b92c48399f3acebc9f3b0` |
| 24P | `aabd13c0bc4923663ff0b84767af8869f8b2516757da1a3cd66745210deea8a3` | `e44eb643991a3935ad94472c71d1d83aa0dd2fdadfead7bb7f8d01255f269a13` |
| 24C | `94c7d28ca4e370ba0ee2699bff1a137a2b7adbe95e6c607e06156606afa61f81` | `c3e5d19dccf7a05da3de258da74a99c16f1364f67b232e47bacdb5e96655c979` |
| 24I | `a7f17f7ce61548e28ad68042b311e2cb576f3b0c661b1e0c299db49d804eed0b` | `ebcceaf21c6885684e6881a474028a52788bf7ef32b64ef38028529e614a9a83` |

- 证据目录 `results.json` SHA=`05a7f4b117b57460bd2ff0681c023048b6654d258a158debddf91184b2c3a4e6`，含全部原件前后SHA、manifest文字声明、两类raster SHA、完整命令/尺寸控制/字体/文本/像素差；`probe.py` SHA=`c44f9c4ca0649f176768e47f9e6150f206caa539ce63a31a9e783bb94f55e902`。
- 临时Ubuntu包SHA=`ddce7b6107bbbad1f70d138abeecce3a9309836662af929f7683e89236506445`；临时rsvg二进制SHA=`32f801b5ff967829674508cc7a4606eaa9948bd6070bcead4c9f9e8058b9b214`。
- `pdf-embedding-review-round18.md` SHA仍为`8a18f9978e0318caab99202a4b2ea80a01761de4ae3f0eee8af1eaccfe98e85e`，未修改。只新增本R19报告及隔离临时实验，不改原件、生产、评分、audit或门禁，不commit/push。
- **最终边界：** 没有验证 MATLAB Java DOM、新版CI、Desktop、颜色打印全流程或 trusted visual；不签100。需要文字语义的新候选必须另有受支持、真正含文本的上游证据，不能用轮廓PDF、隐藏文字/OCR或放行unsupported SVG字体来冒充本次目标成功。
