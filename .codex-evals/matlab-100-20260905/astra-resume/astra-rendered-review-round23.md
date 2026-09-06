# R23：Astra 合成比较图三格式独立视觉复查

- 审阅日期：2026-09-06；原始 CI：R22 run `34002693563`，整体 `completed/failure`，不是全量通过。
- 范围仅 R2026a `family-b/astra-comparison-trial/` 的一张图、三个格式及其 manifest/evidence。未审其他图族、复杂 canvas、native suite 或其他版本图件。
- 原件目录：`/tmp/matlab-run-34002693563/matlab-full100-R2026a/family-b/astra-comparison-trial/`。R21/R24 因 FontUnavailable 早停无产物仅按任务背景记录，不补位。
- 结论：**3/3 格式已实际查看，仍有排版缺陷，不签 visual 全过**。PNG 最后一行统计与顶轴刻度粘连；PDF/SVG 间隙也不足。未见标题、轴标签或图例被页面边界裁掉。

## 实际方法与证据边界

- `view_image` 查看原 PNG、Poppler 22.02.0 的 PDF 300dpi 渲染、librsvg 2.52.5 的 SVG 3000x2550 渲染；另逐格式查看标题/统计、图例及低/中/高值三组数据局部。不是用 XML 或 stage passed 代替视觉。
- 临时渲染与局部预览仅在 `/tmp/astra-rendered-round23-b8IMg3/`；未覆盖任何原件。复现命令如下，`SRC` 指原件目录，`TMP` 指上述临时目录：
```sh
pdftoppm -r 300 -singlefile -png "$SRC/paired-observation-model.pdf" "$TMP/pdf-300dpi"
/tmp/svg-derived-pdf-round19-tqf6v5/tool/usr/bin/rsvg-convert --format=png --width=3000 --height=2550 --output="$TMP/svg-librsvg-3000.png" "$SRC/paired-observation-model.svg"
pdfinfo -box "$SRC/paired-observation-model.pdf"
pdffonts "$SRC/paired-observation-model.pdf"
pdftotext -layout "$SRC/paired-observation-model.pdf" -
pdftotext -bbox-layout "$SRC/paired-observation-model.pdf" "$TMP/pdf-bbox.html"
```
- evidence 原生证明为 `passed_before_and_after_export`，前后数据证据 schema 3；三格式 API 均声明 `exportgraphics`，尺寸单位均为 inches。图窗前后均 10x8.5in，所记录 axes position/font/display 相同。这不证明导出画面逐像素相同，也不是本机 MATLAB 重跑。
- 外检 JSON 为 automated-only，3 artifacts passed；其三图及 manifest hash 与本次原件吻合。原始 `visual_verified=false`、Desktop 未验证保持不变。

## 逐格式实际所见

| 格式 | 标题、统计、轴文字 | 图例与页面边界 | 数据区 |
| --- | --- | --- | --- |
| PNG | 长标题完整；三行统计均可辨，但末行 `Missing/QC rejected...` 中 Q、rejected 等与向外顶刻度粘连；X/Y 标签完整、刻度 13.5 至 17.5 可读 | 下方双行图例标题及两项均在边框内；首行左右余量较紧，但未越框；与 xlabel 分离 | 11 个蓝圆点和水平 U 均能看到；黑色虚线 1:1 可辨；部分圆点被网格或参考线穿过 |
| PDF 渲染 | 长标题、三行统计、X/Y 标签及刻度完整；末行较 PNG 上移且字较小，但 `Missing/` 附近字形与顶刻度几乎相接，不作无重叠通过 | 双行标题、圆点项、虚线项完整；首行留白比 PNG 大；没有页面裁切 | 水平 U 可见，圆点总数与三组分布可辨；参考虚线划段较 PNG 长，部分段穿过圆点 |
| SVG / librsvg | 与 PDF 布局近似，英文文字完整；同样存在末行统计贴顶刻度问题 | 双行标题及两项完整，边框未越出页面；没有此前长 title/ylabel 锚点裁切外观 | 11 圆点、水平 U、1:1 线均实际渲染；与 PDF 相同的局部参考线/圆点相交 |

- 顶部实际是 **1 行标题 + 3 行统计，共 4 行**，不是四行统计；SVG 有对应四个 text，PDF 提取及三张图面一致，不能报告缺失第四行统计。
- 标题：`Synthetic observation-model comparison with stable identities`。
- 统计三行：`N = 11; Bias = 0.08727 degC; MAE = 0.09273 degC`；`RMSE = 0.1116 degC; r = 1.000`；`Missing/QC rejected = 1/0; Unmatched obs/model = 0/0`。显示精度不代表相关系数数学上恰为 1。
- 轴标签：`Observation temperature (degC)` / `Model temperature (degC)`；图例标题两行是 `Horizontal: observation standard uncertainty (degC)` / `Model uncertainty not provided`，两项为 `Paired samples` / `1:1 reference`。
- 水平 U 是无端帽实线，圆点两侧线段可见；没有垂直 U，符合“模型不确定度未提供”的可见说明。密集的近邻点与线段仍较拥挤；本次未复算配对、统计或证明 RecordID 的科学真实性。
- 标题/图例没有遮住有限数据点；但统计贴顶刻度、参考线穿点均为实际残留。单一蓝色数据系列配圆点、黑色参考线配虚线有非颜色区分，不等于色觉、低视力或缩版阅读全部验证。

## 尺寸、字体与几何分别核实

- PNG 原始 3000x2550px，pHYs 299.9994dpi，约 10x8.5in；PDF 单页 MediaBox/CropBox 均 `[0 0 720 612]pt`，精确 10x8.5in。PDF Creator 为 MATLAB R2026a Update 5，Producer Qt 6.8.1。
- SVG XML：`width=3000px height=2550px`，根内联样式 `width:10in;height:8.5in`，`viewBox="0 0 720 612"`。显式栅格化为 3000x2550；不能把 SVG 的 px 属性当成独立的 300dpi 字体保证。
- PDF 独立 `pdffonts` 仅列 `WenQuanYiZenHei / CID TrueType / Identity-H`，`emb=yes, sub=no, uni=yes`，无 Courier。`pdftotext` 抽取标题、三行统计、双轴、刻度、双行图例标题及两项；bbox 所有单词均在页面内。抽取完整不否定图面的刻度粘连。
- manifest 声明 WQ：title 13pt、axes labels 11pt、统计/刻度/legend title 10pt。PNG 位图本身不能证明字体家族；图面字形与矢量版基本一致，但大小并不完全一致。
- SVG 28 个 text 显式 WQ，局部字号 18/15/13 经父矩阵 0.72 缩放，对应本页 12.96/10.8/9.36pt。XML 无 font/font-face/glyph、脚本或 href；没有嵌入字体。librsvg 本机 `fc-match` 命中 `wqy-zenhei.ttc`，别的机器仍有字体替换风险。
- 同为 3000x2550 的首行统计墨迹框，Pillow 灰度阈值 <128：PNG `965x37px`、PDF `902x34px`、SVG `903x34px`；矢量渲染字宽约小 6.5%，不能声称 inches 尺寸一致就字号/布局完全一致。标题墨迹高三者均 48px，宽分别 1464/1458/1458px。
- 页面可见前景留白，阈值 <240、顺序左/上/右/下：PNG `619/139/678/320px`，PDF `612/122/673/319px`，SVG `612/123/672/319px`。这是渲染墨迹而非 MATLAB 对象边界测量；没有顶边、左 ylabel 或底图例页外截断。
- manifest 的 `legend.title` 仍属 unmeasured、`bounds_audit_complete=false`。本次看到图例完整只补充局部视觉事实，不能把公共几何 metadata 的 unknown 改成 measured。
- 图内没有中文文本。WQ 字体存在/嵌入不是 CJK 字形实证；CJK、其他图族、交互/Desktop、真实海区报告、100 分与 trusted visual 均未批准。

## 原件 SHA256 与只读核验

下列五个原件及外检 JSON 均在查看前后计算 SHA256，六者前后完全一致；三格式值也匹配 manifest/evidence。源码仅引用 evidence 内的 basename/hash 声明，未打开或改动源码。

| 文件 | SHA256（前 = 后） |
| --- | --- |
| paired-observation-model.png | `12301f81728a6321b0c4ad868979f34b5233bbea5c3b749ae7d0c37aa7d966c7` |
| paired-observation-model.pdf | `edead8fef2e3a155e052a1933e02cae49e0831bb1ba471e6a2f4bc693383233e` |
| paired-observation-model.svg | `050d0318ce009cfcda5eedd636424c6a4d5358cb6815f36c6a9648aba64aa2b4` |
| figures.json | `f8405986f886482eb598e0665c2e8b39203184d61e8dde52b207a93998ad096b` |
| astra-generated-comparison-evidence.json | `9b5d6c07fb2e5eb6c7a74aed1a2abd03bf55f627d2e792cb896fc73a7cf4bb7d` |
| astra-round22-R2026a-rendered-audit.json | `dadcf326ad0cadb4ceb76aad0a2c49ed2123b61b9957b1157fc78c09687f98d8` |

- 已查看的 PDF 渲染 `pdf-300dpi.png` SHA256：`772fb2b2445ef4014ab00f68a2beefa0582c308bfc034fca9bcc33973f45ab6f`。
- 已查看的 SVG 渲染 `svg-librsvg-3000.png` SHA256：`bf95164f506da274267d2d31d1618b6c6716a0ea9ea7da0cf4be516205726eee`。
- 下一轮局部修复重点应是统计与顶刻度的真实间距、参考线/圆点层次、跨格式字号差异；本轮未修改原图、声明、源码、评分或审计状态，未提交/推送。
