# 第九批 evaluator 全包视觉复查：33989846546 / R2026a

2026-09-05 UTC。限定 `/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime` 四图各 PNG/PDF/SVG，**12/12 原件逐个实际 view_image**，并绑定 SHA256。外部检查 12/12 passed、Xvfb/DPI96、MATLAB 报告生成及数组/fixture 声明核对通过为用户提供的背景，不代替本次视觉，也不由本次重新认证。
只读原件、manifest、matlab-runtime.json；不查主回归、其他版本或源码，不复算科学数据。仓库仅新增本报告；转换副本另存 `/tmp/matlab-visual-baseline/33989846546`。12 原件及两份 JSON 前后哈希/字节数不变，未改 score/audit、trusted visual 标志、源码或旧报告，未提交推送。

## 结论与残留项
- **此前 R26 同名图的长 Title/Ylabel 裁切未在本批十二个格式中重现**：温度场长标题、盐度完整参考面 Ylabel、两图轴标签及图例均在页内，日期刻度分开。
- **比较图三行 subtitle 均可读且在数据区上方，未再见统计文字覆盖点或 1:1 线**；长标题完整，横排图例不越框。第三行与上轴框/顶部短刻线间距偏紧，仍是排版余量限制。
- **交互图三格式中文标题完整**，没有明显方框代字或截顶；但首末圆点、误差棒与左右轴框重合，边界处误差棒不如内部点清楚。比较图部分近邻散点彼此重叠，不能凭目视逐点计数。
- **不是全满分或 trusted visual 批准**：未做色觉模拟、交互操作或 Desktop 核验；灰度/低对比显示、很小尺寸下的点线辨读仍有局限。外部 passed 与本次观察覆盖数均不等于全量视觉合格。

## 方法、尺寸与字体
四张原 PNG 直接看，均 2400 x 1500；四 PDF 均单页 576 x 360 pt (8 x 5 in)，Poppler 22.02.0 用 `pdftoppm -f 1 -singlefile -r 150 -png` 整页转为 1200 x 750，再分别 view_image，未裁边/补画。
四 SVG 均声明 2400px x 1500px、CSS 8in x 5in、viewBox=`0 0 576 360`；用现有 librsvg 2.52.5/Cairo 1.16 标准 API、DPI96、白底、完整 viewport `(0,0,1200,750)` 实际渲染，四次成功且非空，再分别 view_image。温度场/剖面/比较图有 27/23/20 个 text 元素，交互 SVG 无 text；结构解析不替代视觉，也不证明跨浏览器一致。
四 PDF 的 pdfinfo 均列 R2026a Update 5、Qt 6.8.1；pdffonts 均列 WenQuanYiZenHei、CID TrueType、Identity-H、emb=yes、sub=no、uni=yes。**嵌入是字体证据，不是标题完整、位置正确或色觉通过的证据**。manifest 四图三格式均记录 exportgraphics、display_environment_present=true、desktop_available=false；本次未重跑 API。
按原 PNG/整页预览非白着色 bbox 换算，三格式各自四边余白中的最小值约为：温度场 0.52 in、剖面 0.45 in、比较图 0.50 in、交互图 0.36 in；没有着色内容触页面边缘。这是导出图像观察，不是 MATLAB layout.Text 公共几何测量，也不是对隐形容器 bounds 的认证。

## 十二个格式逐项所见
ID：T=温度场，S=盐度剖面，C=观测/模型比较，I=中文交互图；后文哈希表绑定每件原件。
| 原件 | 文字/对齐、图例/刻度、数据区与中文 |
| --- | --- |
| T-PNG | 长标题完整且位于绘图区上方，Depth/Time/色条单位可读，Ylabel 与刻度分开；四个 Aug 01 时刻与年份 2026 不重叠，白色缺测格可见；无中文样本。 |
| T-PDF | 同一长标题、两轴、色条标签完整，没有此前右裁/下裁；日期刻度清楚，未见文字遮热图；白格与低温深色可区分。无中文样本。 |
| T-SVG | 标准渲染实际同样完整，文字对齐接近 PDF，色条与日期各有空间；没有独立分类图例，色条是数值映射。无中文样本。 |
| S-PNG | 标题、Salinity、完整 Depth (m, positive down; reference: synthetic sea surface) 均入页；三行无框时间戳图例完整在右侧、不压曲线，0至100刻度清楚。无中文样本。 |
| S-PDF | 完整长 Ylabel 不再从页顶截断，标题与 Xlabel 完整；三个时间戳可读、页右有余白，实/虚/点线可辨，曲线末端贴轴限。无中文样本。 |
| S-SVG | 长 Ylabel、标题、三行时间戳和刻度均实际可读且无明显相撞；三种线型保留，未见文字覆盖数据。无中文样本。 |
| C-PNG | 长标题完整，三行 subtitle 清楚、位于绘图区外；第三行贴近上框但未盖点/线；Observation/Model 轴标签和横排图例在框内，近邻点存在互相遮叠。无中文样本。 |
| C-PDF | 三行统计文字完整且与数据区分离，未见旧统计压线；图例两个条目不越框；数据与1:1参考线靠形状/虚线区分，近邻点仍重叠。无中文样本。 |
| C-SVG | 标题、三行 subtitle、两轴和图例均实际可读；第三行与上轴框间距仍紧，但没有文字遮挡散点；图例线框完整。无中文样本。 |
| I-PNG | 温度时间序列 / Temperature time series 完整、居于绘图区上方，无方框代字；00:00至20:00时刻、日期与轴标签分开；中间断线和误差棒可见，首末点/误差棒与轴框重合；无独立图例。 |
| I-PDF | 同一双语标题和轴标签完整，未见页顶裁切；时刻/日期清楚，数据区没有文字覆盖；首末误差棒贴左右框，未用静态图证明交互功能。 |
| I-SVG | 标准渲染的中文完整可读、布局接近 PDF；日期和轴标签不相撞，断线和误差棒可见，边界重合限制相同。路径化文字不等于可搜索中文已验证。 |

## PDF 抽取与 subtitle
另用 `pdftotext -bbox-layout` XML 解析实际文字，而不是抄 manifest 的 exports.pdf.text。四 PDF 的标题/两轴均能完整抽取；S 的三个时间戳数字完整，I 可抽取完整双语标题与日期。抽取与实际 view_image 是两项独立证据。
| PDF 重点对象 | 实际抽取/页面 bbox 证据，单位 pt、页左上原点 |
| --- | --- |
| T 长标题 | Synthetic mooring temperature field with crossed time and depth；bbox `(103.680,37.977,470.407,54.304)`，未越宽576的页面。 |
| S 长 Ylabel | Depth (m, positive down; reference: synthetic sea surface)；bbox `(56.281,33.975,69.886,309.240)`，全句入高360的页面。 |
| C 三行 subtitle | 分别抽出下列三行；行框 y 范围为 56.519–68.310、68.759–80.550、80.999–92.790，目视三行均清楚且不进入散点区。 |
| I 中文标题 | 温度时间序列 / Temperature time series；bbox `(181.890,25.997,412.774,42.324)`。这是 PDF 文字框，不是原 layout.Text 句柄几何。 |
```text
N = 11; Bias = 0.08727 degC; MAE = 0.09273 degC
RMSE = 0.1116 degC; r = 1.000
Missing/QC rejected = 1/0; Unmatched obs/model = 0/0
```
上述是成品显示/抽取值，未重算统计。图形在各格式的字重、栅格化、线宽观感存在细微差别，本次不声明逐像素或所有下游阅读器一致。

## 色觉、几何与比较边界
- 温度场连续数值主要靠颜色映射，没有等值线、图案或逐格数值的非颜色冗余；白块虽不同于色条低值，但图面没有明确缺测文字键。灰度/色觉异常下的数值区分与缺测理解未独立认证，不称 colorblind-safe。
- 剖面以颜色加实线/虚线/点线区分三组，有非颜色冗余；比较图以圆点对虚线区分数据/参考，交互图以线/圆/误差棒区分图元。细点线、浅网格/误差棒缩小或低对比输出仍可能难辨，未做模拟测试。
- I manifest 的 `unmeasured_text_objects` 明确记录 role=layout.title、class=matlab.graphics.layout.Text、geometry_status=unverified（本任务的 unknown）；text_objects 仅轴标签。**三格式目视完整与公共几何未测可同时成立**，不将它升级为 measured/verified。visual_inspection_verified、glyph_rendering_verified 等原字段不改。
- 与此前 [R26 同名四图记录](/opt/ocean-intelligence/.codex-evals/matlab-100-20260905/astra-resume/visual-review-33987455982.md) 相比，本次未复现长标题/Ylabel 页边裁切、图例越框或统计文字遮数据；不只凭 Xvfb 或外部12/12推导因果，也不复审其他批次原件。报告生成、原生数组/fixture绑定已核对的背景不由本次复算；Desktop/trusted visual-audit 均不批准。

## 十二个原件 SHA256
| 原件 | SHA256 |
| --- | --- |
| [T-PNG](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/crossed-time-depth-temperature.png) | `9461f1b6a9de215beb22596c8836fa236df5253931b531ed17d09a6cb71965f0` |
| [T-PDF](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/crossed-time-depth-temperature.pdf) | `c5394b99f55bdad2fac225374909739847d36011a57e3ad8e50ee8a710b4fbf4` |
| [T-SVG](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/crossed-time-depth-temperature.svg) | `146152aefe253caa3cea747aae1a7cc35e6a252130bb15c5eeb92380763b2023` |
| [S-PNG](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/repeat-cast-salinity-profiles.png) | `3c653d1647a88cde951204ee9612792cadbea9670493e57e5486d612666f6068` |
| [S-PDF](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/repeat-cast-salinity-profiles.pdf) | `a769b9af6cb3cd5b06144ce51f17f0e5ea9803032088ef8752aacbf88aa6be99` |
| [S-SVG](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/repeat-cast-salinity-profiles.svg) | `a7adf0140534e9cb04e51f9ff36d7d202e38e5c304a3105b64743ce9b4b63b4a` |
| [C-PNG](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.png) | `cb648fee6c5a7814bc90bfbc013a95a0ac6b4d5a8f9413096b39ba431d4f6ab4` |
| [C-PDF](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.pdf) | `886cb08fad56ed86d1258028bf0ef14ee5f3c36c59ce93ff2f53208e0bd123f8` |
| [C-SVG](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.svg) | `62e1a7e3bf052ff9519b54a01a1bad3772feb7c5a5a64667fa767b09f024a00a` |
| [I-PNG](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/paired-interactive.png) | `27e9672f29b2f25eb343cb25c3530a31ed43c6af8df213345fef30c48e3f1984` |
| [I-PDF](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/paired-interactive.pdf) | `42e6adedf593cd06294af6f43d8dac2ed3a56aef26576dea89bbaae2da50e0ed` |
| [I-SVG](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/paired-interactive.svg) | `559c9a0e285c27fdc4e7642ad601cf5682fbddbadb0fee96b784c200b15718e7` |

## 查看副本与元数据 SHA256
八份转换副本均实际 view_image；两份 JSON 仅辅助取证，不计额外目视图。
| 文件 | SHA256 |
| --- | --- |
| [T PDF预览](/tmp/matlab-visual-baseline/33989846546/crossed-time-depth-temperature-pdf.png) | `6cd792b0ac04c73e0cd170400eba58568b7e964929fb57c9ab4b80421e97c2b6` |
| [T SVG预览](/tmp/matlab-visual-baseline/33989846546/crossed-time-depth-temperature-svg-librsvg.png) | `a68154e1005f015667afda3928f896ea25ca71141c11733ca3c6592aa948075d` |
| [S PDF预览](/tmp/matlab-visual-baseline/33989846546/repeat-cast-salinity-profiles-pdf.png) | `26f209217a156384c73b565e5db166b96b32c274346f3259966a9c7988d7cc28` |
| [S SVG预览](/tmp/matlab-visual-baseline/33989846546/repeat-cast-salinity-profiles-svg-librsvg.png) | `8492c425c6a0b589d71358b149c158e4f7c862b4f2cf56e22635345bdb9fc281` |
| [C PDF预览](/tmp/matlab-visual-baseline/33989846546/paired-observation-model-pdf.png) | `29a0e6082c8da1aa6a4a8b42e008f35a68e3742eaf3966a69bd3f7186cd705fd` |
| [C SVG预览](/tmp/matlab-visual-baseline/33989846546/paired-observation-model-svg-librsvg.png) | `09ef59aba236251dfcbc272cff65cb8d7483e934928b618ee6f14b9b47397c07` |
| [I PDF预览](/tmp/matlab-visual-baseline/33989846546/paired-interactive-pdf.png) | `f7239d5cab82c81e69d3db9720367a0e6aa9eccc2eb689dd500bcbf6171aeb52` |
| [I SVG预览](/tmp/matlab-visual-baseline/33989846546/paired-interactive-svg-librsvg.png) | `96bd31588ba56a6b666a91b297eafb17daa3388b1255dc6160f3d7c18bf96482` |
| [figures.json](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/figures.json) | `2804adffdc0ed7ea5f1de495a268bae81cb41097a85387916e4f5c723af25ea7` |
| [matlab-runtime.json](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/matlab-runtime.json) | `ca38766dfec8183d81dbab447154f2d804f81ca65450dcbc67845be561bbb99e` |
