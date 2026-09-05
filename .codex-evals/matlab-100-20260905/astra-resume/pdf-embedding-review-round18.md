# 第18轮：旧版PDF字体后处理候选研究

## 决策与限制
- **可进入下一轮CI的隔离候选探针，但拒绝直接作为生产替换或“无损补嵌字体”。** 八份真实PDF的副本均得到实际嵌入的字体程序；同时确认文字栅格、颜色数值、透明度数值及部分轮廓坐标改变。原件字体失败不因副本而消失，不改门禁或100评分。
- 嵌入的是Ghostscript提供的**Nimbus Mono PS Regular替代字体**，输出PDF仍命名为`XXXXXX+Courier`，不是补回MATLAB请求的WenQuanYi，也不是原生MATLAB字节。仅实际覆盖标准14中的Courier regular，不能外推其余13种或缺失CID/CJK字体。
- 旧PDF的标题裁切、长ylabel越页及图例拥挤仍在。候选只解决这八份副本的“字体程序存在”，不能解决字体身份、排版或完整可访问性。

## 范围与SHA256
原包run `33995525791`；只取`/tmp/matlab-run-33995525791/matlab-full100-{R2021a,R2024b}/evaluator-runtime`的四PDF及只读manifest。已参考`legacy-font-analysis-33989846546.md`，不再把实际绘制正文的Courier当空资源豁免。
H=`crossed-time-depth-temperature.pdf`；P=`repeat-cast-salinity-profiles.pdf`；C=`paired-observation-model.pdf`；I=`paired-interactive.pdf`。
独立实验目录`/tmp/pdf-embedding-round18-JS9ljN`；每个`<release>-<basename无扩展名>/`内有逐字节`input.pdf`、`embedded-candidate.pdf`及检测/渲染证据。八原件初始哈希均匹配原manifest，复制后和实验末尾复核未变。

| 原件 | 原件SHA256 | 候选副本SHA256 |
| --- | --- | --- |
| R21 H | `ea0a8f741e36c6b6dcb9120e6d494dbb3644dfc3b04dad4b90f0688b6ec90a24` | `493d505ff4691262d446eb2f5c2cdb32b1f529f40bc0e62d4f72056c26487f3b` |
| R21 P | `b43fecc42e6fadadc1d35458b273d0007b1a15a8c18398220fe134b7eeede28f` | `cc0597111da5ecb8115a218d990e994fac7b703b4644aad8b5deb879c563af16` |
| R21 C | `c88b02c01246915055c0ddb4710bb61cbef9520d835aedd8fda6a6fd47c8239a` | `1a15afb76f727b85a9c6ebbf4ee378e9d6ed2f0e9236f05061b91fc520605305` |
| R21 I | `90ceed1da83b3de723c8b733ed7dc4b273566d11bdfc117df27f0bdb0483af96` | `bd9e77651ebfd171ece80f25438b35fffd4075f8075c457b2f1f5ce8112df6cf` |
| R24 H | `cebba261e60a72fd5c4c33cee2c57018e531fd604b8b92c48399f3acebc9f3b0` | `59157b9831e22490418fb247f5e5b812b0f498f3643d9fb4ba2537a40a9fd382` |
| R24 P | `e44eb643991a3935ad94472c71d1d83aa0dd2fdadfead7bb7f8d01255f269a13` | `261926af5787c12226abde2da20acd39c88f3e770297549203e3a550dd9be0e7` |
| R24 C | `c3e5d19dccf7a05da3de258da74a99c16f1364f67b232e47bacdb5e96655c979` | `8e993c594f6825b6217fc5c45310fb287338d11fa8576e21c23e26915d355117` |
| R24 I | `ebcceaf21c6885684e6881a474028a52788bf7ef32b64ef38028529e614a9a83` | `a950fc9769de2663955029addba38a2350af555e4315d7a15b1a74b6089136fa` |

两份`figures.json`前后SHA256：R21=`771e4c094b78133c6afb72ba0ed88fa8941b419b218a491d3850620a0446fbd6`；R24=`b80170a441a09565792cd24edcff7854e0dd0f9833ff4d5f7f0a8d2182857929`。

## 官方语义与命令
使用现成`/usr/bin/gs` **9.55.0**、Poppler **22.02.0**、Python/Pillow；未安装工具、修改系统字体映射或触碰运行服务。没有使用PDF/A、转曲、整页栅格化或`NoOutputFonts`冒充嵌入。
- 版本对应官方手册说明标准14的NeverEmbed默认策略及用`setdistillerparams`覆盖的方法；数组须经`-c`或PostScript设置。未使用`PDFSETTINGS=/prepress`作为质量保证，手册明确预设会连带改变输入。[Ghostscript 9.55 VectorDevices](https://github.com/ArtifexSoftware/ghostpdl/blob/ghostpdl-9.55.0/doc/VectorDevices.htm)
- 官方字体查找规则包含Fontmap别名与替代字体，并另行处理CID字体。本机`Fontmap.GS:116`为`/Courier /NimbusMonoPS-Regular`；实际八次日志均加载NimbusMonoPS-Regular，`/Courier findfont`的FullName亦为Nimbus Mono PS Regular。Poppler原件`pdffonts -subst`也指向系统NimbusMonoPS-Regular.otf；这不是恢复缺失的原始字体程序。[Ghostscript字体查找](https://github.com/ArtifexSoftware/ghostpdl/blob/ghostpdl-9.55.0/doc/Use.htm)、[官方Fontmap](https://github.com/ArtifexSoftware/ghostpdl/blob/ghostpdl-9.55.0/Resource/Init/Fontmap.GS)
- pdfwrite解释输入并重建PDF，不是只给旧对象附加字体；设置1.7避免低于1.4时无法保留PDF透明度的限制，但不保证对象或数值原样保留。[高层设备与透明度限制](https://github.com/ArtifexSoftware/ghostpdl/blob/ghostpdl-9.55.0/doc/VectorDevices.htm)

八份候选实际命令均为下式，`INPUT_COPY`和`OUTPUT_PDF`分别指向上述独立副本，完整argv逐项存于`results-all.json`：
```bash
gs -dSAFER -dBATCH -dNOPAUSE -sDEVICE=pdfwrite \
  -dCompatibilityLevel=1.7 -dAutoRotatePages=/None \
  -dEmbedAllFonts=true -dSubsetFonts=true -dCompressFonts=true \
  -sColorConversionStrategy=LeaveColorUnchanged \
  -dDownsampleColorImages=false -dDownsampleGrayImages=false -dDownsampleMonoImages=false \
  -dAutoFilterColorImages=false -dAutoFilterGrayImages=false \
  -dColorImageFilter=/FlateEncode -dGrayImageFilter=/FlateEncode \
  -sOutputFile="$OUTPUT_PDF" \
  -c '<< /NeverEmbed [] /AlwaysEmbed [/Courier /Courier-Bold /Courier-Oblique /Courier-BoldOblique /Helvetica /Helvetica-Bold /Helvetica-Oblique /Helvetica-BoldOblique /Times-Roman /Times-Bold /Times-Italic /Times-BoldItalic /Symbol /ZapfDingbats] >> setdistillerparams' \
  -f "$INPUT_COPY"
```
**不能夸大单参数因果：** R24 C另做去掉`-c`两数组的控制、以及再指定`PDFSETTINGS=/default`的控制，两份仍嵌入Courier Type1C；`currentdistillerparams`却确实列出默认14项NeverEmbed。控制输出SHA分别为`fb74cace73f3c087bfbaa6fb8b58b584b7ef46fe64b6a1bb6c8b4504fb104d1e`、`65ffa06b7835df2193a700047fda7fbdff8470568c2fc7c6cfd2aa4b6665b5ef`。这是本机PDF输入路径的实测现象，内部原因未定位；不能声称本例成功唯一依赖清空NeverEmbed，也不能仅凭参数签成功。

## 页面、字体和文字实测
- **8/8页面框一致：** 单页、旋转0，MediaBox/CropBox/BleedBox/TrimBox/ArtBox均`[0 0 576 360]`pt；576x360pt的页面尺寸未变。原件FOP 2.4.0-SNAPSHOT/PDF1.4变为GPL Ghostscript 9.55.0/PDF1.7，字节与Producer明确不同。
- **8/8字体程序实际嵌入：** 原件唯一Courier Type1/WinAnsi，emb/sub/uni=`no/no/no`；候选唯一带子集前缀的Courier Type1C/WinAnsi，=`yes/yes/no`。GS解释后的FontDescriptor有`FontFile3`，并非只改名称。仍无ToUnicode，不能将emb=yes等同于完整文字语义或CJK字体成功。
- `pdftotext -bbox-layout`的词内容及顺序8/8一致，H/P/C/I词数R21为43/29/48/21、R24为48/29/48/21；统计数值与日期没有发现文本替换。`pdftotext -layout`仅7/8逐字节一致：R21 C若干行前导空格减少1个，非空白内容不变，不能报告文本输出完全相同。
- XML词框坐标有变化，最大分量差`0.467996pt`；这是提取器基于字体度量形成的bbox差，不等于已证明所有文字锚点位移该数值。原件和候选的混合中文标题都不能经pdftotext提取；其路径轮廓不因Courier嵌入而获得可搜索中文。

## 像素、颜色、透明度与几何
统一Poppler `pdftoppm -singlefile -r 150/300 -png`渲染原件副本和候选；分辨率分别1200x750、2400x1500。改变像素为任一RGB通道不同，未设豁免阈值；最大差为0..255通道值，不是百分比。全页300dpi**无一零差分**。

| 文件 | 150dpi改变像素 | 300dpi改变像素 | 300dpi最大通道差 | 300dpi文字词框外改变像素 |
| --- | ---: | ---: | ---: | ---: |
| R21 H | 188 | 17373 | 238 | 0 |
| R21 P | 663 | 10414 | 237 | 46 |
| R21 C | 7 | 14327 | 182 | 16 |
| R21 I | 551 | 10881 | 241 | 107 |
| R24 H | 188 | 18623 | 238 | 0 |
| R24 P | 667 | 17908 | 255 | 143 |
| R24 C | 6 | 17426 | 182 | 14 |
| R24 I | 551 | 10881 | 241 | 107 |

词框外统计仅排除两边bbox并各扩3px的区域，不能证明余下差异全是科学数据，也不能把全部差异归于字体hinting。300dpi改变比例约0.2893%..0.5173%；低分辨率差异少不代表高分辨率稳定。
- **颜色确有数值改写：** GS解释后的蓝线/点RGB由`(0,0.4471,0.698)`变`(0,0.447021,0.697266)`；网格由`(0.7451,0.8196,0.851)`变`(0.744141,0.820313,0.851563)`。即便设置LeaveColorUnchanged，也不能宣称颜色数值无损。两H的RGB图像、灰度soft mask及色条解码数组/尺寸分别一致，未发现降采样或像素阵列损失；这只覆盖图像数组，不覆盖全部矢量色值。
- **透明度确有数值改写：** 原绘制资源的`/CA 0.349019617`变为`/CA 0.34902`，H仍保有SMask。`pdftocairo -transp -r 150`的alpha通道8/8无像素差，但所有页本来就有不透明白底，alpha范围都是255..255，不能用此证明内部透明度严格不变或泛化到透明页面。
- **轮廓几何非严格不变：** 两I混合标题首个moveto按各自CTM折算由`(193.965625,319.765628875)`变`(193.966,319.766)`pt。未穷举所有路径；这一个实测反例已足以否定只补字体、不动轮廓的说法。
- **CJK局部也有像素差：** 两I在300dpi的中文ROI`[745,115,1090,190]`各14个改变像素、最大差21；混合标题ROI`[740,115,1950,190]`各74个、最大差109。不能把仍可读说成字形逐像素不变；标题轮廓来源字体身份仍未证明。

## 实际看图记录
已逐一view_image查看8对150dpi原件/候选拼图，另看R24 I的300dpi标题放大及R24 P差分图；300dpi其余全页仅做机器差分，不冒充逐图人工核验。两版对应图的观察如下：
- H：温度色块、缺测白块、色条和轴可辨；长标题右端在原件和候选都被页面截断，嵌入未修复。
- P：三条曲线和日期图例可辨；长ylabel向上越页、末端缺失，两边都存在。
- C：三行统计可读，点/参考线可辨；长标题右裁切，图例文字拥挤且越框；R21的xlabel区域仍与图例挤在一起。无依据签布局通过。
- I：中文“温度时间序列”及英文标题均完整可读，缺测断线、误差棒和左右端点可见；字体像素及轮廓微差如上，不能签字形无损或Desktop/trusted visual。

## 下一轮与证据复现
下一轮仅建议新增独立`derived-pdf-font-embedding`探针：保留原始native文件/原失败状态，单独输出候选及父SHA、GS版本、字体映射、参数、页面/字体/文本/像素差证据。原生与后处理产物不得共享“native export passed”身份；不引入容差绕过既有门禁。
若交付合同要求颜色/透明度/轮廓/文字框或像素严格不变，本候选已经不满足；若只研究替代字体嵌入，则有8/8窄证据，可继续隔离验证。其他标准14字体、CID字体、跨GS版本及跨查看器仍未验证，且旧排版缺陷必须保留为缺陷。
实验脚本由apply_patch新建于上述/tmp目录。将`probe.py`放入另一个全新实验目录后运行`python3 <新目录>/probe.py`可重跑同八原件，所有输出落该新目录；脚本拒绝复用已存在的逐图目录。本次每条argv、原/副本SHA、完整工具输出、XML词框与解码图像摘要保存在`results-all.json`和逐图`record.json`。
证据SHA256：`probe.py`=`8deb1a3c3cc5f5d2ec8486a2c0c6095889551ca8decee019dce3f37f08818976`；`results-all.json`=`eefd89140af04e17dd756e16410defb382e4b5424bd37c2ddf3eda2e2912cf55`；`evidence-sha256.json`=`401862102e8f127f7c723f2d63cf1c98b2b0ad23c812b51176643ec79ac6ee37`，最后一份索引绑定全部本地实验文件与图像。
仓库仅新增本报告；未修改原CI包、生产helper、门禁、score或audit。未调用MATLAB、未提交推送；零差分或字体嵌入成功均不构成人工视觉批准。
