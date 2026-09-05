# 第 10 项：真实产物视觉基线审查

## 身份与边界

- 审查日期：2026-09-05 UTC。**旧 runID：33981675642**。
- 唯一输入产物根目录：`/tmp/matlab-run-33981675642`。版本名取自其 `matlab-full100-R2021a`、`matlab-full100-R2024b`、`matlab-full100-R2026a` 目录；本次没有启动 MATLAB，也没有重新核验各版本运行环境。
- 范围仅限三版本 `family-b` 的 time-series、comparison、ts-diagram，共 9 张原始 PNG、9 份现有 PDF、9 份现有 SVG。未读绘图源、MAT 数据、运行日志或 evaluator 得分来替代视觉证据；未查看其他 family 或 interaction 产物。
- 主线程正在修复 SVG/geometry，新 CI 尚未完成（用户提供的任务背景，本次未查询 CI）。**本报告仅描述旧 run 的实际文件，不是当前源码或新 CI 的验收结果，也不能证明问题仍存在于主线程新代码。**
- 本次工作区独占新增文件为本报告；不修改绘图源、现有产物、其他评估记录，不提交、不推送。另在独立目录 `/tmp/matlab-visual-baseline` 新增现有 PDF 的查看用 PNG；这些不是 MATLAB 重新渲染产物。

## 检查方法与覆盖

| 对象 | 实际操作 | 证据边界 |
| --- | --- | --- |
| 原始 PNG | 9/9 分别调用 `view_image` 实际查看；`file` 检查均为 1200 x 675 RGB；计算逐文件 SHA256 | 只支持本次可见内容的判断，不证明源数据、运行时或交互正确 |
| 现有 PDF | 9/9 经 Poppler `pdftoppm` 22.02.0 转为查看用 PNG，9/9 分别调用 `view_image`；另检查 `pdfinfo`、`pdffonts`、`pdftotext -layout` | 目视结论限本机 Poppler 的页面呈现；不是 MATLAB Desktop 或所有 PDF 阅读器验证 |
| 现有 SVG | 9/9 计算 SHA256；用 Python 标准库 `xml.etree.ElementTree` 严格解析；对 R2021a 的失败核对原文件第 4-5 行 | **SVG 目视 0/9，未在浏览器或编辑器渲染。** XML 可解析不等于 geometry、字体或视觉通过 |
| CJK | 查看上述 PNG/PDF 中的实际文字，并检查可解析 SVG 的文本元素 | 没有中文、日文或韩文代表性可见测试文本；**无法证明，未验证** |
| Desktop | 未启动桌面、未操作图窗或交互控件 | **未执行、未验证**；静态导出不能替代 Desktop 证据 |

所有 PDF 均为单页、480 x 270 pt。转换使用以下参数，逐版本、逐图执行；输出文件均为 1001 x 563 RGB：

```bash
pdftoppm -f 1 -singlefile -r 150 -png \
  /tmp/matlab-run-33981675642/matlab-full100-R2021a/family-b/family-b-time-series.pdf \
  /tmp/matlab-visual-baseline/33981675642-R2021a-family-b-time-series-pdf
```

下文每图的三条原件链接及 SHA256 锁定此次输入；PDF 预览另给出绝对路径。SHA256 指原始文件，不是转换后的预览。数值坐标为目视近似，不是对原始数组的重算。

## 主要结论

1. **R2026a 三张 PNG 的图例边框不能包住文字**；T-S 的 Cast 文本还进入色条及其刻度区域。comparison 的纵轴标题与刻度局部相碰，不能判 geometry 通过。
2. **R2026a 三份 PDF 顶部标题均有裁切**；time-series、T-S 的纵轴标签还越出页面左边。time-series 日期右端被截，comparison 图例遮挡缺测统计。其 PDF 不能凭 PNG 结果判通过。
3. **R2021a/R2024b comparison 的 PNG 和 PDF 均由图例遮挡缺测/QC、未匹配统计。** PDF 能抽出统计文字不等于页面上能读到完整统计。
4. **三版本 T-S 的图例形状与主数据点外观不一致**：图例右三角/方块，主点外观下三角/圆点，且有浅色辅助符号叠画。不能据图例可靠对应 Cast。
5. **R2021a/R2024b 的六份 PDF 与 PNG 字体外观不同，图例文字越框。** `pdffonts` 均报 Courier、Type 1、未嵌入；这不是宣称标准字体 PDF 无效，而是跨格式字体/边界一致性存在实证问题。
6. **R2021a 三份 SVG 非良构 XML**，均报 `duplicate attribute: line 5, column 1`。其他六份可解析，但未进行 SVG 目视验收。

不计算综合分、不输出满分表，也不把“已查看”转换为“通过”。标题或标签的局部可读不抵消其他缺陷；9/9 是覆盖数量，不是合格数量。

## 逐图记录

### 01. R2021a / time-series

| 原件 | SHA256 |
| --- | --- |
| [PNG](/tmp/matlab-run-33981675642/matlab-full100-R2021a/family-b/family-b-time-series.png) | `37a37b03908d8d2803db04ffb651877edb5fd7869c8f957bfe79a2491b76a61d` |
| [PDF](/tmp/matlab-run-33981675642/matlab-full100-R2021a/family-b/family-b-time-series.pdf) | `d83a1555ae27e25caffa413cd9c72b7d79208ce8af32e7c3d4e9ed2804ca9da2` |
| [SVG](/tmp/matlab-run-33981675642/matlab-full100-R2021a/family-b/family-b-time-series.svg) | `bcbb8292eddd82a53765ba1865d77b49a85a7bd08b3d3f2ec2b8091687df22c8` |

- **实际查看**：原始 PNG；[PDF 第 1 页预览](/tmp/matlab-visual-baseline/33981675642-R2021a-family-b-time-series-pdf.png)。SVG 仅静态检查，未目视。
- **标题/标签**：PNG 的 `Family B time series`、`Time (UTC)`、`Sea temperature (degC)` 和 `Sep 01, 2026` 完整可读，未见明显画布裁切。单位写的是 ASCII `degC`，不是度符号测试。
- **图例边框**：PNG 右下部单行 `Sea temperature` 在深色矩形框内，未见遮挡主点；PDF 同一文字右端越出边框，字体呈等宽外观。
- **数据标记**：约 00:00/10 与 01:00/11 为蓝色空心圆并有连线、浅色带；05:00/12 是小空心方块，07:00/14 是空心圆。首末圆与左右轴框相交；单一圆形图例不能解释中间方形点的差别。
- **缺测**：01:00 后至 05:00、05:00 至 07:00 未见跨空段连线，浅色带也只在首段可见。只证明“可见断线”，不能证明原始 NaN、QC、时间对齐或应有的缺测数量。
- **格式事实**：PDF 为 Courier、未嵌入；SVG 严格解析失败，根元素第 4-5 行重复 `width`、`height`、`style`。
- **不确定/需重渲染**：需新 run 核对 PDF 字体及图例包围、方形孤立点语义、端点与边框间距，并在修复后实际渲染 SVG。CJK 无可见样本、无法证明；Desktop 未执行。

### 02. R2021a / comparison

| 原件 | SHA256 |
| --- | --- |
| [PNG](/tmp/matlab-run-33981675642/matlab-full100-R2021a/family-b/family-b-comparison.png) | `b93b3944d782a534f4c84fd21a66631f5c32cb6830143f00cf9260e84aa260eb` |
| [PDF](/tmp/matlab-run-33981675642/matlab-full100-R2021a/family-b/family-b-comparison.pdf) | `f0739dfa099fcaf795f287a1ec05c04a12db5b0a2d0bf5acf4536974e76c2165` |
| [SVG](/tmp/matlab-run-33981675642/matlab-full100-R2021a/family-b/family-b-comparison.svg) | `2c86f9f322b71e15c7eeda57536a4d06fce3a146e9f6276cdc318f98f88b5da2` |

- **实际查看**：原始 PNG；[PDF 第 1 页预览](/tmp/matlab-visual-baseline/33981675642-R2021a-family-b-comparison-pdf.png)。SVG 未目视。
- **标题/标签**：PNG 的 `Family B paired comparison`、`Observed temperature (degC)`、`Model temperature (degC)` 可读。注释中 `N = 2`、Bias/MAE/RMSE 各 `0.1 degC`、`r = 1.000` 可读；这是图上文字，不是重新验证统计量。
- **图例边框/事实问题**：PNG 右侧三行深色边框图例完整包围自身文字，却盖住 `Missing/QC rejected =`、`Unmatched obs/model` 后半部分及数值；PDF 重现遮挡，并且三个图例名称的末尾越出右框。
- **数据标记**：约 (1, 1.1) 蓝色下三角、(3, 3.1) 黄色右三角，与 Region 图例形状相符；主点周围有浅色圆、方、三角、菱形辅助符号。黑色 1:1 参考线在轴框角部带空心圆，图例也显示线加圆；参考线的端点圆不应被当成新增观测。
- **缺测**：PNG/PDF 页面无法完整读取被遮住的计数。`pdftotext -layout` 能抽出 `Missing/QC rejected = 0/1`、`Unmatched obs/model = 1/1`，仅证明 PDF 含该字符串，不证明可见性或计算正确性。
- **格式事实**：PDF 为 Courier、未嵌入；SVG 在第 5 行第 1 列因重复属性解析失败。
- **不确定/需重渲染**：需重新布局图例与统计块，复核浅色辅助符号的说明及 PDF 字体/图例包围，实际查看修后 SVG。CJK 无样本、无法证明；Desktop 未执行。

### 03. R2021a / ts-diagram

| 原件 | SHA256 |
| --- | --- |
| [PNG](/tmp/matlab-run-33981675642/matlab-full100-R2021a/family-b/family-b-ts-diagram.png) | `1a6514f5c8875b8097f6bc80813ad861d38cf08fd86fb653e500fa8c3bf4bd11` |
| [PDF](/tmp/matlab-run-33981675642/matlab-full100-R2021a/family-b/family-b-ts-diagram.pdf) | `1a2c79e579143b3883f0d729e1c7249b8b74d6b34d8349948ed17dde2f35855a` |
| [SVG](/tmp/matlab-run-33981675642/matlab-full100-R2021a/family-b/family-b-ts-diagram.svg) | `88aa461b6eb6e04c4943aed958f36b71b08fdc586000fd4f89c7b1805983c218` |

- **实际查看**：原始 PNG；[PDF 第 1 页预览](/tmp/matlab-visual-baseline/33981675642-R2021a-family-b-ts-diagram-pdf.png)。SVG 未目视。
- **标题/标签**：PNG 的 `Family B T-S diagram`、`Absolute salinity (g/kg)`、`Conservative temperature (degC)` 及色条 `Sample depth (m)` 完整可读。色条有 0 到 60 的可见标值，顶端颜色延伸到 60 之上；未据图猜定精确最大值。
- **图例边框/事实问题**：PNG 右上两行 Cast 图例在框内，与色条分开；PDF 的 `Cast: Cast-1`、`Cast: Cast-2` 右端越过边框。
- **数据标记/事实问题**：约 (34.2, 12) 主点外观为深色下三角，(35, 5) 为橙色圆，周围有浅色辅助符号；图例却用绿色右三角、绿色小方块。颜色可能承担深度编码，不能仅凭颜色判错；**形状仍无法与主点外观可靠对应**。
- **缺测**：只见两组主点，没有缺测计数或独立缺测编码；不能证明剔除/保留规则，也不能把稀疏点数当作缺测处理成功。
- **格式事实**：PDF 为 Courier、未嵌入；SVG 在第 5 行第 1 列因重复属性解析失败。
- **不确定/需重渲染**：需复核 Cast 形状映射及辅助符号叠画、PDF 图例宽度，修复后实际查看 SVG 和色条。CJK 无样本、无法证明；Desktop 未执行。

### 04. R2024b / time-series

| 原件 | SHA256 |
| --- | --- |
| [PNG](/tmp/matlab-run-33981675642/matlab-full100-R2024b/family-b/family-b-time-series.png) | `bbb34d723456eae56bb460e120320922dccb1ee4cf77f59161e077653d4249b4` |
| [PDF](/tmp/matlab-run-33981675642/matlab-full100-R2024b/family-b/family-b-time-series.pdf) | `5afdbae1f3b279c13244eba919acbe9b5958ea0e91e3c91a590fa6a9fa7a51fa` |
| [SVG](/tmp/matlab-run-33981675642/matlab-full100-R2024b/family-b/family-b-time-series.svg) | `43627356d2d4f3a525ac49c6981643ef5d213709ad1b54a689ae018c5ce56b54` |

- **实际查看**：原始 PNG；[PDF 第 1 页预览](/tmp/matlab-visual-baseline/33981675642-R2024b-family-b-time-series-pdf.png)。并非用 R2021a 外观代替本版查看；SVG 未目视。
- **标题/标签**：PNG 的 `Family B time series`、`Time (UTC)`、`Sea temperature (degC)`、日期均完整可读；未见明显标题或坐标标签画布裁切。
- **图例边框**：PNG 单行图例位于右下部，文字在深色框内；PDF 呈 Courier 等宽外观，`Sea temperature` 右端越框。
- **数据标记**：首段蓝色线、浅色带及 00:00/10、01:00/11 空心圆清楚；05:00/12 为孤立空心方块，07:00/14 为空心圆。首末圆与轴框相交；单一圆形图例没有说明方形点。
- **缺测**：首段之后未见连线跨越至 05:00 或 07:00；只能证明可见断开，不能证明 NaN 位置、缺测计数或 QC 语义。
- **格式事实**：PDF 为 Courier、未嵌入；SVG XML 可解析，`viewBox="0 0 1200 675"`，没有 `<text>` 元素。路径和标题元数据的存在不能替代字形、坐标或视觉检查。
- **不确定/需重渲染**：需核对孤立方形点、PDF 字体/边框与端点边距，补 SVG 实际呈现。PNG/PDF 无 CJK 样本，SVG 路径内容也未目视，CJK 无法证明；Desktop 未执行。

### 05. R2024b / comparison

| 原件 | SHA256 |
| --- | --- |
| [PNG](/tmp/matlab-run-33981675642/matlab-full100-R2024b/family-b/family-b-comparison.png) | `fae5ae6b0c5612cb46297125e6fded7819154b288fc738cdbecd981ed78100dc` |
| [PDF](/tmp/matlab-run-33981675642/matlab-full100-R2024b/family-b/family-b-comparison.pdf) | `2fb015ac209195ef36d5f2351ad8c5052127541e96e91d04530b2dfe2d1964c5` |
| [SVG](/tmp/matlab-run-33981675642/matlab-full100-R2024b/family-b/family-b-comparison.svg) | `81108755d86bf6aa313648148e343815ee7e333e0fd0f06acdb8144c7e1d45f9` |

- **实际查看**：原始 PNG；[PDF 第 1 页预览](/tmp/matlab-visual-baseline/33981675642-R2024b-family-b-comparison-pdf.png)。SVG 未目视。
- **标题/标签**：PNG 的 `Family B paired comparison`、观测/模型温度轴标签可读；`N = 2`、Bias/MAE/RMSE 各 `0.1 degC`、`r = 1.000` 可读，未重新验算。
- **图例边框/事实问题**：PNG 右侧带框图例包住自身三行文字，但遮盖缺测/QC 及未匹配统计的右半部；PDF 同样遮挡统计，且三个图例名称右端越框。
- **数据标记**：约 (1, 1.1) 蓝色下三角、(3, 3.1) 黄色右三角，与 Region 图例形状相符；浅色辅助符号与黑色 1:1 参考线/端点圆都可见。端点圆属可见参考线样式，不能当新增观测点。
- **缺测**：图上计数被图例遮住；PDF 文本能抽出 `Missing/QC rejected = 0/1`、`Unmatched obs/model = 1/1`，但不能因此判可读或语义正确。
- **格式事实**：PDF 为 Courier、未嵌入；SVG XML 可解析、`viewBox="0 0 1200 675"`，没有 `<text>` 元素；不据此判断文字已正确呈现。
- **不确定/需重渲染**：需图例与统计分离、核对 PDF 字体/图例边框及辅助符号说明，并实际渲染 SVG。CJK 无可见样本、无法证明；Desktop 未执行。

### 06. R2024b / ts-diagram

| 原件 | SHA256 |
| --- | --- |
| [PNG](/tmp/matlab-run-33981675642/matlab-full100-R2024b/family-b/family-b-ts-diagram.png) | `5c9968b40dd08a7b1d1f10213f5ec8d6692500b3f105c802ed1b488a477bb903` |
| [PDF](/tmp/matlab-run-33981675642/matlab-full100-R2024b/family-b/family-b-ts-diagram.pdf) | `f1bf77cbb976bd42da8efa6bf2abc6ae9f4216ef17cbf9a69dfa9a209d3ceaca` |
| [SVG](/tmp/matlab-run-33981675642/matlab-full100-R2024b/family-b/family-b-ts-diagram.svg) | `dfbc81bbafaf2a83c09f4333bd5aeaba3aa7e2d165986f11d517820b28b35af4` |

- **实际查看**：原始 PNG；[PDF 第 1 页预览](/tmp/matlab-visual-baseline/33981675642-R2024b-family-b-ts-diagram-pdf.png)。SVG 未目视。
- **标题/标签**：PNG 的 `Family B T-S diagram`、盐度/保守温度标签及 `Sample depth (m)` 可读，色条 0 到 60 标值可见，无明显画布裁切。
- **图例边框/事实问题**：PNG 右上较窄的两行 Cast 图例仍包住自身文字，未进入色条；PDF 的两行 Cast 文字右端越框。
- **数据标记/事实问题**：约 (34.2, 12) 深色下三角、(35, 5) 橙色圆及浅色辅助符号可见，图例为绿色右三角/方块。主点与图例的形状对应不明确；不将深度颜色与图例颜色不同单独判错。
- **缺测**：没有可见缺测计数或缺测编码；两组稀疏点不能证明缺测筛选规则。
- **格式事实**：PDF 为 Courier、未嵌入；SVG XML 可解析、没有 `<text>`、含 1 个 `<image>` 元素。未检查该栅格元素承载的具体内容，不能声称 SVG 全部由可编辑矢量构成。
- **不确定/需重渲染**：需复核 Cast 形状映射及叠画、PDF 字体/图例宽度，补 SVG 字形、色条、栅格元素的视觉检查。CJK 无样本、无法证明；Desktop 未执行。

### 07. R2026a / time-series

| 原件 | SHA256 |
| --- | --- |
| [PNG](/tmp/matlab-run-33981675642/matlab-full100-R2026a/family-b/family-b-time-series.png) | `88b1338baf37b8ea4440c4445c77238824c68fc4013aa58715d195aa9c43a21a` |
| [PDF](/tmp/matlab-run-33981675642/matlab-full100-R2026a/family-b/family-b-time-series.pdf) | `f6d0feb74b32358a05b2c8e933d98f9ca3e9b44f538fcb69f30b1374ba8f6bc8` |
| [SVG](/tmp/matlab-run-33981675642/matlab-full100-R2026a/family-b/family-b-time-series.svg) | `8640884f7d112cfa16685fe19f174412c48993cf3d7baeabcc5860a9a83c9aaf` |

- **实际查看**：原始 PNG；[PDF 第 1 页预览](/tmp/matlab-visual-baseline/33981675642-R2026a-family-b-time-series-pdf.png)。SVG 未目视。
- **标题/标签**：PNG 的 `Family B time series`、`Time (UTC)`、`Sea temperature (degC)`、日期可读；纵轴标签与刻度的横向间距很窄，需 geometry 实测，不能据此签发无碰撞结论。
- **图例边框/事实问题**：PNG 图例移到左上，边框只覆盖样线和文字起始部分，`Sea temperature` 大段伸出右边框。PDF 图例却在右下并包住文字，说明 PNG/PDF 的布局并不一致。
- **数据标记**：首段两空心圆与蓝线/浅色带、05:00/12 方块、07:00/14 圆均可见；首末圆仍与轴框相交。方形孤立点与圆形图例的关系没有说明。
- **缺测**：PNG 与 PDF 预览都未见首段之后跨越孤立点的连线；不证明输入 NaN、QC 或缺测计数正确。
- **PDF 事实问题**：顶部标题被页上缘截去一部分；纵轴标签大部分越出左页边；右下日期右端被截。PDF 主刻度明显少于 PNG（例如横轴可见 00:00、02:00、04:00、06:00）。`pdftotext` 的日期只余 `Sep   ,` 一类残缺文本，**这是文本抽取异常，不能等同于图中所有数字均不可见**。
- **格式事实**：PDF 报 Qt 6.8.1、嵌入 `NotoSansCJKsc-Regular`；SVG XML 可解析，有 11 个 `<text>`，声明 `Noto Sans CJK SC`/`Sans Serif`，文本元素没有 CJK 字符。字体名称/嵌入状态不是 CJK 字形成功证据。
- **不确定/需重渲染**：需统一各格式的最终布局、修复 PNG 图例宽度与 PDF 页边裁切、复核文本抽取及标记一致性，实际查看修后 SVG。CJK 无样本、无法证明；Desktop 未执行。

### 08. R2026a / comparison

| 原件 | SHA256 |
| --- | --- |
| [PNG](/tmp/matlab-run-33981675642/matlab-full100-R2026a/family-b/family-b-comparison.png) | `b4ec564d0abe895af4af7b851b57528db8d2f3e2104459599487337b1d087675` |
| [PDF](/tmp/matlab-run-33981675642/matlab-full100-R2026a/family-b/family-b-comparison.pdf) | `ef7f3eaf898fbd59e57b733dcf1b8c905492d438f3b5ab231a71512e9ddd06bc` |
| [SVG](/tmp/matlab-run-33981675642/matlab-full100-R2026a/family-b/family-b-comparison.svg) | `872083b3f2915a6ab1ed051c935d547b81cb8cdb158eb0286163d4544577cd1d` |

- **实际查看**：原始 PNG；[PDF 第 1 页预览](/tmp/matlab-visual-baseline/33981675642-R2026a-family-b-comparison-pdf.png)。SVG 未目视。
- **标题/标签**：PNG 标题和温度轴标签的词句可辨，但纵轴 `Model temperature (degC)` 与 `2.5`、`1.5` 刻度局部挤碰，不能判标签间距合格。
- **图例边框/事实问题**：PNG 图例在右下，三行文本均越出矩形框，部分还越过绘图区右边；PDF 图例改在统计块下半部，虽然自身文字在框内，却遮挡统计。
- **数据标记**：约 (1, 1.1) 蓝色下三角与 (3, 3.1) 黄色右三角、浅色辅助符号、带端点圆的黑色 1:1 线可见；Region 图例形状与主点相符。参考线穿过 PNG 下两行统计文字，造成线字相交。
- **缺测**：PNG 能辨认 `Missing/QC rejected = 0/1`、`Unmatched obs/model = 1/1`，但与参考线相交；PDF 则被图例盖住。N/Bias/MAE/RMSE/r 的 PNG 显示值与前两版相同，不代表重算验证。
- **PDF 事实问题**：标题被上页边裁切，缺测统计被图例挡住；横轴主要只标 1、2、3，与 PNG/PDF 旧版刻度密度不同。`pdftotext` 在 N、误差、相关系数、比例计数和 `1:1` 等字符串中丢失数字，而预览仍能看见若干数字；需区分视觉问题与文本抽取问题。
- **格式事实**：PDF 嵌入 `NotoSansCJKsc-Regular`；SVG XML 可解析，有 19 个 `<text>`，可抽到完整统计字符串但没有 CJK 字符；没有 SVG 渲染证据。
- **不确定/需重渲染**：需复核图例几何、纵轴标签/刻度、参考线/统计避让、PDF 页面裁切及数字抽取，补 SVG 实际呈现。CJK 无样本、无法证明；Desktop 未执行。

### 09. R2026a / ts-diagram

| 原件 | SHA256 |
| --- | --- |
| [PNG](/tmp/matlab-run-33981675642/matlab-full100-R2026a/family-b/family-b-ts-diagram.png) | `1c54f9e881d38db7dd701e17dd14d18b8ad885ead3fdcd9ef22bdd2e2d9b9824` |
| [PDF](/tmp/matlab-run-33981675642/matlab-full100-R2026a/family-b/family-b-ts-diagram.pdf) | `8fe93b901aad5f0720703f9cfc6423f60efb018efc7c771044e035e2712a45b6` |
| [SVG](/tmp/matlab-run-33981675642/matlab-full100-R2026a/family-b/family-b-ts-diagram.svg) | `0e300f766ba52de9d118774c4903e8e17340030002241e18434902d95a5af375` |

- **实际查看**：原始 PNG；[PDF 第 1 页预览](/tmp/matlab-visual-baseline/33981675642-R2026a-family-b-ts-diagram-pdf.png)。SVG 未目视。
- **标题/标签**：PNG 的 `Family B T-S diagram`、盐度/保守温度标签及 `Sample depth (m)` 可读。刻度范围/密度与前两版不同：横轴约 34.0 到 35.2，纵轴主刻度 4、6、8、10、12；约 (34.2, 12) 的主点及辅助符号贴近上轴框，留白不足。
- **图例边框/事实问题**：PNG 右上矩形框只包住图例符号及少量文字；两行 Cast 文本越过绘图区，进入色条，第一行还与 `60` 附近刻度相碰。这不是仅凭文字长度推测，而是原 PNG 可见的碰撞。
- **数据标记/事实问题**：主点外观仍是深色下三角与橙色圆，周边浅色符号叠画；图例仍是绿色右三角/方块，形状对应无法可靠建立。
- **缺测**：无可见缺测计数或独立缺测编码，不能证明缺测处理规则。
- **PDF 事实问题**：顶部标题被裁，保守温度纵轴标签大部分越出左页边；图例在 PDF 内反而包住文字且未碰色条，故不能从 PDF 推断 PNG 图例正常。主点/辅助符号贴近上框以及右下框，PDF 与 PNG 的轴限/主刻度呈现也不同。`pdftotext` 的 Cast 编号只抽成 `Cast-`，但预览可读 `Cast-1`/`Cast-2`，属于另外的文本抽取问题。
- **格式事实**：PDF 嵌入 `NotoSansCJKsc-Regular`；SVG XML 可解析，有 13 个 `<text>`、1 个 `<image>`，文本元素无 CJK 字符；不能声称纯矢量或 SVG 视觉通过。
- **不确定/需重渲染**：需修复图例/色条碰撞、主点留白、Cast 形状映射及 PDF 页边裁切，核对轴限是否符合预期并补 SVG 呈现/文本抽取检查。CJK 无样本、无法证明；Desktop 未执行。

## 跨格式限制与后续验收条件

- R2021a 三份 SVG 的重复属性属于已观察到的旧产物结构问题。未修补原件、未生成“清理版 SVG”，未推测浏览器宽容解析后的外观。
- R2024b 三份 SVG 无 `<text>` 元素，不能因此说文字缺失，也不能说文字已通过；需要实际渲染路径内容。R2026a 的三个 SVG 文本列表为英文/数字，字体声明不构成 CJK 证据。
- R2026a 三份 PDF 的 `MediaBox`、`CropBox`、`BleedBox`、`TrimBox`、`ArtBox` 均报 `[0, 0, 480, 270]`，页面旋转为 0。本次转换整张第 1 页，没有人为裁剪；原 PDF 的页内呈现仍有上述裁切。未检查其他阅读器，未定位源码根因。
- 九张原 PNG 和九张 PDF 预览均未提供代表性 CJK 字形。`degC` 的 ASCII 可读性、Courier/Noto 字体名、PDF 字体嵌入、XML/aria-label 字符串都**不能**证明 CJK。需要未来新 run 导出含实际中文等目标字形的标题、轴标签、图例及色条并逐格式查看；本次不生成该样例。
- 任何 Desktop/交互通过结论都需要独立桌面会话证据；本次静态导出审查不作代签。
- 缺测只能记录“看见断线”“看见/看不全统计文字”“无可见编码”。缺测数组、QC 拒绝、匹配计数、误差/相关系数正确性需要独立数据证据，不能从截图反推。
- 主线程新 CI 完成后应使用**新 runID、新目录、新 SHA256**逐图复核标题/标签裁切、图例包围/遮挡、T-S 形状映射、轴限/端点间距、PDF 字体和数字抽取、SVG 实际呈现；不得把本报告勾选成新版本已通过。

## 本次交付状态

- 已实际查看：9 张原 PNG，以及 9 份现有 PDF 各自的整页转换图。
- 已锁定：27 个原始 PNG/PDF/SVG 的逐文件 SHA256，见逐图表格。
- SVG 视觉、CJK、Desktop 均未验证；存在上述明确缺陷，**不出具全通过或满分结论**。
- 本次未修改绘图源或旧产物，未触发 MATLAB 重跑，未提交或推送。后续所列重渲染/运行时验收项尚未执行。
