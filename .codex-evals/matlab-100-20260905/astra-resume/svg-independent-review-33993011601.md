# SVG 嵌套 viewport 独立审计：33993011601

## 协调后续
- 以下原始审计绑定第14轮提交，不改写其发现。主线程随后在规范化分支拒绝所有显式CSS-wide值：inherit、initial、unset、revert和revert-layer；新增属性/inline style负例及固定数值透明度正例。
- 后续测试扩大为10正例、34负例；本地MATLAB语法及静态检查通过，原生拒绝路径尚待新CI执行。没有把透明度复制到wrapper，也没有新增渲染等价证据。

## 结论
- **存在一项已确认的代码接受域缺口：显式 opacity 继承不满足等价证明。** 这是静态代码与 CSS 语义结论，不是已渲染反例，也不是已发现第13轮真实图变色。
- **第二 renderer 实证为零：未成功渲染、无 before/after 像素对照、无新增 view_image 视觉结论。** 不复用已有 librsvg 的12次结果冒充独立引擎证据。
- 仅新增本报告；原图、生产代码、测试、评分均未修改，未安装软件包、未提交推送。浏览器尝试已停止，收束时没有本审计遗留浏览器/执行会话。
- 第14轮33994158131由主线进行三版安装，不在本报告已验证范围；本机没有 MATLAB/Java DOM 实跑，未用 Octave 替代，不批准 trusted visual、Desktop 或视觉全过。

## 已确认风险
**[P2] 根 opacity 与直接子节点 opacity:inherit 被同时接受，新增 svg 改变继承来源。**
[oi_annotate_svg.m:137](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_annotate_svg.m:137) 把 opacity 放入根/子公用 presentation 白名单；[值检查:184](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_annotate_svg.m:184) 不拒绝 inherit；[新 viewport:40](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_annotate_svg.m:40) 未设置 opacity。以下合法静态组合会进入比例不匹配分支且通过当前列出的检查：
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="997px" height="613px"
     viewBox="0 0 239 147" opacity="0.5">
  <rect x="10" y="10" width="200" height="100" fill="red" opacity="inherit"/>
</svg>
```
opacity 的初值为1且默认不继承，显式 inherit 才取父计算值。因此原 rect 为0.5，再乘根0.5，得到有效alpha 0.25；插入默认opacity=1的svg后，rect变为1，根仍0.5，得到0.5。即使CTM完全一致，合成结果也不一致。这直接违反研究证明的“computed styles unchanged”前提。[W3C CSS Color 3](https://www.w3.org/TR/css-color-3/#transparency)
建议发布前拒绝这类非继承属性的显式 inherit，或收紧属性值正向白名单，并增加拒绝且原文件hash不变的负例。不要简单把根opacity复制到wrapper，以免增加一次合成。四份下列真实SVG未发现任何inherit值，因此不将该反例描述成归档产物已经失败。

## 与证明一致处
- [构造:37](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_annotate_svg.m:37) 仅在native/target比例不匹配时建立一个namespaced子svg；子层保留四数native viewBox及原aspect，外层改为0 0 W H / xMidYMid meet，没有拉伸路径或添加补偿平移。
- 对native box=(a,b,vw,vh)，s=min(W/vw,H/vh)，tx=(W-s*vw)/2-s*a，ty=(H-s*vh)/2-s*b；目标viewport下新外层为恒等映射，子层为T(tx,ty)S(s)。比例缩放k时两者均为S(k)T(tx,ty)S(s)，非零原点项也保留。
- 子viewport overflow=visible避免引入默认子viewport裁切；defs、子clipPath与图形一并移动而保留内部坐标/顺序。根transform/clip/filter/mask和已有nested SVG被拒绝，符合受限裁切前提。
- 根字体及presentation声明没有复制到wrapper，正常继承的绝对字体不会多应用一次。现有根style保留，末尾追加物理width/height覆盖旧尺寸是原标注步骤，不是字体重设。
- 最新[viewBox解析:25](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_annotate_svg.m:25) 已检查四个完整数字token、有限值和正尺寸；相对单位正则已使用(?:$|[^a-z])，不再使用MATLAB含义有风险的\\b。

## 仍须保留的边界
- 证明只覆盖相同target比例的独立文档viewport。外部宿主CSS、非等比例强制viewport、与像素比例不一致的物理widthPoints/heightPoints，不由该CTM推导保证。
- stylesheets、脚本、外部href、处理指令和未许可节点在规范化分支被拒绝；**比例已匹配时不会执行这套profile验证**，新增测试也明确保留matching-stylesheet。这不是通用SVG净化器。
- 值校验主要是排除表，不是完整CSS值语法或计算样式等价检查；“拒绝根效果”不能笼统包含仍获准的opacity。未渲染输入不能由白名单直接取得视觉通过。
- 无viewBox时由native_length推导的旧fallback是额外假设；研究使用已有viewBox的已标注原件，不能据此证明任意无viewBox原生SVG第一次标注前后等价。
- 函数末尾只回读断言根width/height；更完整的外/内viewBox、native子树和元数据保持由新增DOM测试覆盖。无MATLAB执行记录时仍未验证Java DOM行为、XML重序列化和真实字体渲染。

## 测试核对
已读新增 [test_svg_viewport_normalization.m](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_svg_viewport_normalization.m:7)：9正例包含不匹配/匹配比例、非零原点、缺viewBox、字体family字符、重复标注；28负例覆盖外部引用、根效果、CSS、百分比/部分相对单位、aspect及非法viewBox。它断言子树、局部clip、元数据和拒绝后原件hash，且明确输出rendered=false。
这纠正了审计早期仅看到旧test_svg_metadata时的覆盖判断；不再报告“新增分支无测试”。当前列表仍无opacity:inherit负例。243项Python通过及三版CI由主线提供，本审计未重新执行，也不等同于9正28负已在MATLAB通过。

## 第二引擎结果
本机已有Chromium 152.0.7977.64 snap及项目Playwright，但未成功创建可用渲染页面：
- 直接运行snap内chrome：主机glibc缺GLIBC_2.38。
- snap入口及独立profile尝试：Failed to create socket directory / ProcessSingleton。
- 仅使用已有core24 loader/运行库与临时资源引用的最后尝试：依次遇到ICU/V8资源、最后缺chrome_crashpad_handler而退出；没有安装或下载依赖。已按协调要求停止，不继续扩实验。
所以没有可报告的第二引擎像素差、非空截图或成功view_image。既有研究的librsvg12次等价是单引擎既有证据，本次没有重跑。临时启动资源位于/tmp/svg-independent-33993011601-7Fh8ok，不是SVG视觉证据。

## 原件与版本绑定
四份第13轮SVG仅结构读取、hash和有理数CTM核对，审前/审后字节数及SHA256不变；R21/R24为相同字节，四件只有三个不同输入。未改原件、未伪称实际渲染。
| 原件 | SHA256 | 目标viewport下(s,tx,ty) |
| --- | --- | --- |
| [R26 997](/tmp/matlab-run-33993011601/matlab-full100-R2026a/export/full100-export-artifacts/raster-997-613/raster-sizing.svg) | `989642b9d16a6c2971c663d1964c9a55c98ca23f302708cd428154848d8782d2` | (613/148,109/74,0) |
| [R21 997](/tmp/matlab-run-33993011601/matlab-full100-R2021a/export/full100-export-artifacts/raster-997-613/raster-sizing.svg) | `8115fef8744815650579ece9ee803801c604abdaef6210b0cf3d19f9edfb20c2` | (613/147,26/147,0) |
| [R24 997](/tmp/matlab-run-33993011601/matlab-full100-R2024b/export/full100-export-artifacts/raster-997-613/raster-sizing.svg) | `8115fef8744815650579ece9ee803801c604abdaef6210b0cf3d19f9edfb20c2` | (613/147,26/147,0) |
| [R21 DISPLAY 400](/tmp/matlab-run-33993011601/matlab-full100-R2021a/display-comparison/publication/raster-400-300/raster-sizing.svg) | `30e58f46ef95037bb9d9c9a3172bd4833cd015192e81b05ce883fc82d321369a` | (400/267,0,50/267) |

最终风险结论绑定helper SHA256 `85621006b934cbd4b6c030c12af5bd68e95ed1f3d70c720e3ec8ea18c20ac03a`；新增DOM测试SHA256 `f2a0a180c6baa3eca253660fea107713576f3d0187e414d64c2ec18c18e3ed71`。审阅中主线增加严格数字解析，故不声称代码全程hash未变；我没有编辑它。
研究输入：[findings.md](/tmp/svg-viewport-equivalence-TSB5lT/findings.md)，SHA256 `cdf1a4930bd30a8e4eca5427f9960367109473fbb4dd420f20ef5f26bca0f886`；[probe.py](/tmp/svg-viewport-equivalence-TSB5lT/probe.py)，SHA256 `2ed3ac09518fc945ecc6839480285aa98791cc8a0c3df4f41e234d6cb81cbdbf`。仅阅读，不重复执行。
