# 第17轮 R2024b SVG嵌入字体独立审查

## 结论与风险
- **本轮建议维持拒绝，不直接扩大白名单。** 纯轮廓字体的坐标等价可以有条件证明，但这批真实产物的字体描述识别尚无有效渲染证据；没有发现“嵌入字体必然导致viewport变换错误”的反例。
- **P1 验证盲区已实证：** librsvg与CairoSVG的12组before/after比较全部零差分，但两者对规范字体探针的字形/字距突变也零差分，实际显示回退的`AA`，而非指定方块。零差分不能证明保留了嵌入字体语义。
- **P1 真实字体描述存在规范兼容缺口：** 所有`font-face`均缺少直接的`font-family/font-weight/font-style`描述属性，只在`style`中写这些值。SVG 1.0/1.1定义的是字体描述属性，不能把普通CSS属性继承等同于描述符注册；需要支持SVG字体的实现核实，不应在规范化时擅自改写。[SVG 1.0 font-face](https://www.w3.org/TR/2001/REC-SVG-20010904/fonts.html#FontFaceElement)、[SVG 1.1 font-face](https://www.w3.org/TR/SVG11/fonts.html#FontFaceElement)
- **P2 已见渲染缺陷：** CairoSVG的真实图标题、轴标签和刻度呈破碎条带，原始文件与before/after均如此；不是本实验观察到的规范化新增缺陷。librsvg可读，但不能据此确认嵌入WQ字形身份。

## 范围与原件绑定
仅研究run `33994671384`、R2024b的`display-comparison/svg-print-sizes-probe`六份原始SVG及其JSON；未审其他版本、出版图或PDF。根目录：`/tmp/matlab-run-33994671384/matlab-full100-R2024b`。
probe记录MATLAB R2024b Update 9、DISPLAY `:98`、ScreenPixelsPerInch `100`，API为`print -dsvg -painters`，explicit组另加`-r150/-r300`；本机未调用MATLAB。
下表SHA256在读取前、渲染后及交付前一致，六份SVG均匹配probe所记哈希：

| 原件basename | SHA256 |
| --- | --- |
| 400x300-150dpi-default.native.svg | `7d8df73bfb3d4cbe203b7035524656791cb3368b403dcb4841413f1a788523a5` |
| 400x300-150dpi-explicit-resolution.native.svg | `7d8df73bfb3d4cbe203b7035524656791cb3368b403dcb4841413f1a788523a5` |
| 997x613-300dpi-default.native.svg | `4f91ed1e8e9fb76298d992e101857662d4ab90c21e7d4b7c6f2e5bdd74893cb5` |
| 997x613-300dpi-explicit-resolution.native.svg | `4f91ed1e8e9fb76298d992e101857662d4ab90c21e7d4b7c6f2e5bdd74893cb5` |
| 1200x675-300dpi-default.native.svg | `da6c4a1985373b3559cea6e771fa1b181bcb0f0373a60ae8893d409cd9e15e73` |
| 1200x675-300dpi-explicit-resolution.native.svg | `da6c4a1985373b3559cea6e771fa1b181bcb0f0373a60ae8893d409cd9e15e73` |
| svg-print-sizes.json | `0a7022910b571cdae8376f7ff72cbeb5c73f72ff02c1196774bfbcb70f8420ad` |

只读实现快照：`oi_annotate_svg.m` SHA256 `1baf9bcb1e438cb6b7676ee1b06c49b5ba257a4eef1f9711ce73ad074a4d6a9b`，审查前后相同。第38行仅在纵横比不同才进入profile；第137行元素表及第153行属性表均不支持本字体子树。

## 结构化XML事实
- 使用ElementTree按SVG命名空间解析，不加载外部DTD。原件带SVG 1.0外部DOCTYPE和Batik生成注释；不要把probe解析器补入的DTD默认属性当作原始字节中的属性。
- 三组原始根尺寸分别`267x200 / 332x204 / 400x225`，均无显式viewBox；default与explicit每组字节完全相同。
- 每份均为`svg > g > defs#defs1 > font`，有2个font、2个font-face、2个missing-glyph；glyph数分别26/28/28。font-face无子节点，glyph/missing-glyph均为无子节点的`d`轮廓。
- font仅含`id,horiz-adv-x`；font-face仅含`ascent,descent,units-per-em,style`；glyph仅含`unicode,horiz-adv-x,d`；missing-glyph仅含`horiz-adv-x,d`。两套face style声明WenQuanYi Zen Hei的bold/normal，units-per-em均100，ascent=100.78125、descent=25.195312。
- 无font-face-src/uri、hkern/vkern、嵌套SVG、脚本、样式表或外部字体引用；本地`url(#clipPath1)`用于普通背景矩形。字形包含负y坐标及空格的空`d`，不能当作非法页面越界或缺字。
- 标题组为显式`font-size:18.0556px`、WQ、bold；ylabel组为`15.2778px`、WQ、rotate(-90)。根`Dialog/12px`不是这些文本的最终样式。所有可见文本均ASCII，无CJK样本、无图例。

## 坐标与继承判断
- 字形轮廓属于字体设计网格，不是defs所在页面的普通path坐标；字号f、units-per-em U、文字定位矩阵A下，纯轮廓可写为`A * scale(f/U,-f/U) * glyph`。其中y反向来自字体网格约定，不能再把viewport变换烘焙进glyph或重缩放advance。[SVG字体坐标](https://www.w3.org/TR/SVG11/fonts.html#SVGFontsOverview)、[glyph处理](https://www.w3.org/TR/SVG11/fonts.html#GlyphElement)
- 对原viewBox `(vx,vy,vw,vh)`，目标W/H的meet矩阵为`M = translate((W-s*vw)/2,(H-s*vh)/2) * scale(s,s) * translate(-vx,-vy)`，`s=min(W/vw,H/vh)`。外层改为目标viewBox并将旧viewBox放入同尺寸子svg后仍是M；只要字体选择、文本样式与轮廓未变，字形也是`M*A*scale(...)`。此为条件证明，不是字体匹配实测。
- font/face/glyph本身不新建页面viewport。纯d字形转换到引用文本坐标后按普通路径绘制；带子元素的glyph另有克隆/级联规则，继承来自引用文字而非字体定义祖先，不能一概当作普通g搬移。[glyph继承](https://www.w3.org/TR/SVG11/fonts.html#GlyphElement)
- 插入svg会改变最近viewport与潜在裁切，必须保留`overflow=visible`及现有百分比、相对单位、样式表、根效果等拒绝条件；实际样本只有绝对字号/轮廓，字体子树无裁切或效果。[新viewport](https://www.w3.org/TR/SVG11/coords.html#EstablishingANewViewport)
- 本实验确认6/6字体子树的标签、属性、文字、子序完全保留，全部text属性/内容不变。这是结构事实，不能替代字体渲染证明。

## 实际渲染与查看
工具：librsvg `2.52.5`、CairoSVG `2.9.0`、共享Cairo `1.16.0`，不是两个独立绘制后端；CairoSVG官方明确不支持SVG fonts。[CairoSVG支持范围](https://cairosvg.org/svg_support/#fonts)
临时证据目录：`/tmp/svg-font-round17-ner78cv5`。原始字节先按原始尺寸渲染12次；另对六文件各生成before/after副本并分别渲染，两引擎共24次。
before补`viewBox=0 0 nativeW nativeH`，设置相同目标px及目标英寸root style；after仅将旧内容移入目标尺寸、旧viewBox、overflow=visible子svg，外根viewBox改目标尺寸。两者均去DOCTYPE，未模拟Java DOM序列化；比较隔离viewport搬移，不声称原始无viewBox文件与尺寸注释完全等价。
librsvg使用`rsvg_handle_render_document`、DPI96、目标大小viewport；CairoSVG使用`svg2png`、dpi=96及相同output_width/height。RGBA逐通道最大差计算改变像素，不用可能遗漏RGB变化的单独alpha bbox。

| 目标组，每组2原件 | meet缩放s / 纵向留白px | librsvg before/after | CairoSVG before/after |
| --- | --- | --- | --- |
| 400x300 | 1.498127340824 / 0.187265917603 | 2/2零差分 | 2/2零差分 |
| 997x613 | 3.003012048193 / 0.192771084337 | 2/2零差分 | 2/2零差分 |
| 1200x675 | 3 / 0 | 2/2零差分 | 2/2零差分 |

1200组原生纵横比已相同，真实helper不进入受限规范化；该组after是强制套viewport的实验控制，不能报告为实际拒绝或生产执行结果。
已用view_image查看三组原始双引擎拼图、三组before/after四联图、字形反例拼图，共7张证据图；explicit组实际渲染且与同组default输出一致，未把重复图冒充独立视觉样本。
所见：librsvg三组标题`Raster sizing`、`Value (1)`、`Time (s)`及刻度完整，线/轴位置在before/after一致；CairoSVG三组原始及变换前后均文字破碎，图线/轴仍可辨。没有视觉证据支持CJK、嵌入字体正确性或全量视觉通过。

## 可复现的验证反例
以下为规范描述属性的合成探针，不是生产改图；原始`canary-square.svg`在证据目录，SHA256 `b278c704f655fe13e2a25a844ed510baad0f942edbb32952cf72093710ca4006`。
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120"><defs><font id="canary" horiz-adv-x="100"><font-face font-family="Round17Canary" font-style="normal" font-weight="normal" units-per-em="100" ascent="100" descent="0"/><missing-glyph d="M0 0L100 0L100 100L0 100Z"/><glyph unicode="A" horiz-adv-x="100" d="M0 0L100 0L100 100L0 100Z"/></font></defs><text x="20" y="100" font-size="80" font-family="Round17Canary" fill="black">AA</text></svg>
```
复现参数同上，画布200x120。变体仅将glyph的d改为`M0 0L100 0L50 100Z`、advance改50；第三份仅删除合成探针defs，作为回退控制。字体生效时方块版应为从(20,20)至(180,100)的黑矩形；实见两引擎均为普通AA。
两引擎的方块vs三角、方块vs回退均0改变像素；与显式绘制预期黑矩形比较分别有11080/11062改变像素、最大通道差255。它反证“像素相同即可验证字体”的检验方法，不是viewport不等价反例。
真实400组另将所有glyph/missing-glyph的d改为100x100方块、advance改200，仅在内存实验副本中操作；两引擎对before仍0改变像素。原始字体始终保留且原件哈希未变。
结果账本`results.json` SHA256 `fcf21d1e9d59ae066994337de0e3ca12252a066e27ed7020f82d0909712ae1d3`；`canary.contact.png` SHA256 `ff095182abed52b128193509a716dab368c493afff68fdd9dadc44dfca460896`。账本含12组差分、8项负/正控制及before/after渲染PNG哈希。

## 主线决策边界
- 有依据的候选仅是defs内自包含、有限数值度量、正units-per-em、单face、无子元素的glyph/missing-glyph纯轮廓子集；不能只加font/font-face/glyph三个名字，遗漏missing-glyph或全局放开新属性。
- 如继续研究，应按元素验证字体度量/字符映射，保持轮廓、advance、unicode、顺序与引用不变；unicode是数据，不应直接套用长度或CSS值检查。glyph子树、kerning、外部源、CSS选择器等未在本轮获证，不扩大白名单。
- 本批style-only face描述须先有明确的兼容性依据及真正消费嵌入字体的渲染器正控制，再谈放行；本机两引擎不能补这一证据缺口。没有安装新依赖，也没有尝试用Octave替代MATLAB。
- 本报告仅为静态/外部渲染研究，**不等于MATLAB Java DOM实跑、三版本CI、trusted visual、Desktop或完整字体验收**。旧PDF Courier问题未复核、更未解决；禁止通过删除SVG字体偷换结论。仓库仅新增本报告，未改生产、原件、评分或审计状态，未提交推送。
