# 第十二轮 evaluator 局部视觉复核：33992397354 / R2026a

- **9/9 指定原件实际 view_image**：evaluator 四 PNG、paired-interactive 的 PDF/SVG、三张 raster-aspect 圆 PNG。其余 evaluator PDF/SVG、圆 PDF、publication 和其他版本不在本次视觉结论内。
- 主协调从CI读取的 57/60、各版 19/20 和圆门禁 passed 是运行背景，不代替视觉；**旧版字体仍 failed**，不以本次 R26 单份 PDF 嵌入结果改写该结论。
- 仓库只新增本报告；转换副本位于 `/tmp/matlab-visual-baseline/33992397354`，未覆盖原件，不改代码/score/audit，不签 trusted visual 或 Desktop，未提交推送。

## 字体、排版与逐图结论
比较基线明确为第11轮 `33991563211`、第9轮 `33989846546` 同名 R26 PNG；本次另实看第11轮四 PNG，第9轮沿用已有实看报告并重新解码比较，未重审旧 PDF/SVG。
**T/S/C 的本轮 PNG 与两轮基线逐像素 RGB 完全相同**，不是只凭尺寸或对象快照推断；文件 SHA256 不同，不等于画面变了。I 的双语标题区域也逐像素相同，但数据区、日期刻度和整体右侧墨迹边界改变。
manifest 确认本轮三格式均 exportgraphics/inches，第11轮 PNG 为 pixels；本轮 inches/off 策略来自协调背景，manifest 未记录 PreserveAspectRatio 实参，本审计未重跑 API。标题/轴标签记录仍为 13/11 pt、比较 subtitle 10 pt；这是属性证据，实际字号稳定另由图像比较支持，不由圆形保证。
| 图件 | 实际视觉与残留问题 |
| --- | --- |
| T 温度场 PNG | 长 title、Depth (m, positive down)、Time (UTC)、色条文字完整；四个日期刻度和2026不重叠，无新遮挡。缺测浅白块可见；色值主要靠颜色、缺测无单独文字键的局限保留。 |
| S 剖面 PNG | 长 Ylabel 全句含 reference: synthetic sea surface 完整，标题和0至100刻度可读；右侧三行时间戳图例完整、不压数据，实/虚/点线保留。曲线端点贴轴限是旧有现象。 |
| C 比较 PNG | 长标题及三行统计完整，仍在散点区上方；第三行与上轴框/短刻线距离偏紧，但未出现新的文字覆盖数据。底部两项图例完整入框；近邻散点相互重叠仍在。 |
| I 交互 PNG | 中文“温度时间序列”及英文标题完整、字形未缩小；首末圆点与完整误差棒已离开左右框。日期从每2小时短标签改为 Aug 01 的00/06/12/18及右下2026，当前不相撞；20:00不再单列刻度。 |
| I 交互 PDF | 整页渲染后中文/两轴/日期均完整，端点圆和误差棒上下帽完整，与框线分离；断线保留，无文字盖数据。静态图不证明交互操作。 |
| I 交互 SVG | librsvg 标准渲染实际与 PDF 位置接近，中文完整，端点留白及误差棒帽均可见；路径化文字不证明可搜索文本，也不代表所有浏览器一致。 |

## 四边 margin 与端点留白
Pillow 12.3.0 对原始 RGB 非白墨迹 bbox 测量；四 PNG 均2400x1500@约300dpi（8x5in），顺序为左/上/右/下，单位in。这是可见图像边界，不是 MATLAB layout.Text 公共 bounds。
| PNG | 11/9轮四边 margin | 本轮四边 margin |
| --- | --- | --- |
| T | 0.850 / 0.610 / 0.523 / 0.527 | 相同 |
| S | 0.823 / 0.447 / 0.557 / 0.537 | 相同 |
| C | 1.687 / 0.633 / 1.433 / 0.503 | 相同 |
| I | 0.700 / 0.397 / 0.780 / 0.363 | 0.700 / 0.397 / 0.957 / 0.363 |
I 右 margin 增大部分来自旧20:00刻度消失，不能全部归因于端点 padding；其标题区域 RGB 不变，底部 margin 没有下降。I PDF/SVG整页预览四边约0.687/0.380(0.373)/0.953/0.393in，没有页边裁切。
| I 格式/查看尺寸 | 首末误差棒中心距左右轴框 px | 误差帽距框最窄水平净隙 px | 留白占首末中心间距 |
| --- | --- | --- | --- |
| PNG 2400x1500 | 64.5 / 64.5 | 54.5 / 53.5 | 4.00% / 4.00% |
| PDF预览 1200x750 | 32.5 / 32.0 | 27.0 / 25.5 | 4.03% / 3.97% |
| SVG预览 1200x750 | 32.5 / 32.0 | 27.0 / 25.5 | 4.03% / 3.97% |
测量用深色长边定位轴框、低色差灰线定位误差棒，原点为图像左上，约±1px。4%相对于原数据横向跨度，约为扩展后轴宽的3.70%；三格式均是可见净隙，不是仅抄配置。旧首末误差棒与左右框重合问题在本次三格式未复现。

## 三圆探针
三 PNG 均直接实看，圆/标题/两轴和刻度完整，未见明显椭圆或页边裁切。测量选择蓝色墨迹 B-R>80 且 G-R>35，bbox右/下为开区间；另以B-R阈值60、100核验抗锯齿影响。
| PNG / DPI | 蓝色 bbox (L,T,R,B) | 墨迹宽x高；宽高比 |
| --- | --- | --- |
| 400x300 / 150 | (143,71,277,203) | 134x132；1.01515；阈值100时132x132，1.00000 |
| 997x613 / 300 | (377,143,651,417) | 274x274；1.00000；阈值60时274x276，0.99275 |
| 1200x675 / 180 | (426,129,812,514) | 386x385；1.00260，三阈值相同 |
结果支持这三幅单轴圆的**局部近似等比**；约1–2px墨迹差受抗锯齿/阈值影响，不能签数学上精确圆。门禁通过不保证字号、物理字高、长文本、tiledlayout、图例或跨格式整体布局；此前 pixels/off 缩字风险也不能被三圆结果推翻。

## PDF/SVG 与审计边界
I PDF经 Poppler整页150dpi渲染并view_image；pdfinfo为单页576x360pt、MATLAB R2026a Update5/Qt6.8.1。pdffonts为WenQuanYiZenHei、CID TrueType、Identity-H、embedded=yes、Unicode=yes；pdftotext实际抽出完整双语标题、两轴及日期。这些证据分开于视觉结论，不覆盖旧版字体 failed。
I SVG声明2400x1500、viewBox=0 0 576 360、8x5in；用现有librsvg/Cairo、DPI96、白底1200x750完整viewport渲染，成功且实际查看；0个text元素，中文由路径呈现。
I的layout.title仍是matlab.graphics.layout.Text、geometry_status=unverified；manifest的visual/glyph标志不改，目视完整不升级公共几何。未做Desktop、色觉模拟、科学数组复算或全包验收；本次没有发现新字体缩小/长标签裁切，仍保留统计间距紧、散点重叠及通用策略外推风险。

## 本轮原件 SHA256
以下14文件（9图件+5JSON）审前/审后哈希及字节数一致；指定图件的hash同时核对对应manifest。所有链接均指原件。
| 原件 | 审前 = 审后 SHA256 |
| --- | --- |
| [evaluator-runtime/crossed-time-depth-temperature.png](/tmp/matlab-run-33992397354/matlab-full100-R2026a/evaluator-runtime/crossed-time-depth-temperature.png) | `4da35bde3a5106ef7ac84724751ec082a0d33f7d5d8cb05c20ae7615948d22d5` |
| [evaluator-runtime/repeat-cast-salinity-profiles.png](/tmp/matlab-run-33992397354/matlab-full100-R2026a/evaluator-runtime/repeat-cast-salinity-profiles.png) | `0bc694e97aca6824ba69d9a8b8bcc942a9f828b4226e5ed1bb5b43105e14e5ba` |
| [evaluator-runtime/paired-observation-model.png](/tmp/matlab-run-33992397354/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.png) | `374cb9e1c8d0bbb15223e617aa50413a1ce877d898b43bdc3f173093e49fcab6` |
| [evaluator-runtime/paired-interactive.png](/tmp/matlab-run-33992397354/matlab-full100-R2026a/evaluator-runtime/paired-interactive.png) | `90bad9edc0dcb5f1577dda1b9eabd5b29a99c0b51be6a3c86b82073a1b22b357` |
| [evaluator-runtime/paired-interactive.pdf](/tmp/matlab-run-33992397354/matlab-full100-R2026a/evaluator-runtime/paired-interactive.pdf) | `8f0a674f370243406c6c8abcaf6ab10f71c1da87679b48d1963189cc71aef4da` |
| [evaluator-runtime/paired-interactive.svg](/tmp/matlab-run-33992397354/matlab-full100-R2026a/evaluator-runtime/paired-interactive.svg) | `29254f318748da9c86468a64884304dea2b679326872a175ba91fea6d4dc0d60` |
| [evaluator-runtime/figures.json](/tmp/matlab-run-33992397354/matlab-full100-R2026a/evaluator-runtime/figures.json) | `55bac0ae548ad02933b2d79ac3ff9505a90c87ea1cdd9ed002858077073c9b7d` |
| [evaluator-runtime/matlab-runtime.json](/tmp/matlab-run-33992397354/matlab-full100-R2026a/evaluator-runtime/matlab-runtime.json) | `eab79705c56279b4a92dea639f6e0ad95bef4361524e704080a023e5128609d4` |
| [export/full100-export-artifacts/raster-aspect-400-300/equal-data-scale.png](/tmp/matlab-run-33992397354/matlab-full100-R2026a/export/full100-export-artifacts/raster-aspect-400-300/equal-data-scale.png) | `e0b517d958c6c936cd6d918d76c494ef70fa366076d5963d8facc1172c033f12` |
| [export/full100-export-artifacts/raster-aspect-400-300/figures.json](/tmp/matlab-run-33992397354/matlab-full100-R2026a/export/full100-export-artifacts/raster-aspect-400-300/figures.json) | `42f0d9da86467748d50483223d6a65c0d1f4f0b9ad5560f0f5bcc84900d429a8` |
| [export/full100-export-artifacts/raster-aspect-997-613/equal-data-scale.png](/tmp/matlab-run-33992397354/matlab-full100-R2026a/export/full100-export-artifacts/raster-aspect-997-613/equal-data-scale.png) | `4720f12fa1f0b30af8b7f788fd7a6cd64cd17dc675821963f626b42478258ce7` |
| [export/full100-export-artifacts/raster-aspect-997-613/figures.json](/tmp/matlab-run-33992397354/matlab-full100-R2026a/export/full100-export-artifacts/raster-aspect-997-613/figures.json) | `18fff1bb19fcf8833cf1d11aedac36118aeefc2571158120b064975e597cf608` |
| [export/full100-export-artifacts/raster-aspect-1200-675/equal-data-scale.png](/tmp/matlab-run-33992397354/matlab-full100-R2026a/export/full100-export-artifacts/raster-aspect-1200-675/equal-data-scale.png) | `70ff6a59186c54d0d23363847640efc0eed375b1185205acdff1f7e99a28c235` |
| [export/full100-export-artifacts/raster-aspect-1200-675/figures.json](/tmp/matlab-run-33992397354/matlab-full100-R2026a/export/full100-export-artifacts/raster-aspect-1200-675/figures.json) | `94c5062f374de8abb45e1802b2347914f4765fe29a258a56ff048ce8b690bf0a` |

## 比较基线与查看副本绑定
八份基线 PNG 审前/审后不变；第11轮manifest及两份转换预览绑定如下，未以预览替换原件。
| 文件 | SHA256 |
| --- | --- |
| [09-T PNG](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/crossed-time-depth-temperature.png) | `9461f1b6a9de215beb22596c8836fa236df5253931b531ed17d09a6cb71965f0` |
| [09-S PNG](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/repeat-cast-salinity-profiles.png) | `3c653d1647a88cde951204ee9612792cadbea9670493e57e5486d612666f6068` |
| [09-C PNG](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.png) | `cb648fee6c5a7814bc90bfbc013a95a0ac6b4d5a8f9413096b39ba431d4f6ab4` |
| [09-I PNG](/tmp/matlab-run-33989846546/matlab-full100-R2026a/evaluator-runtime/paired-interactive.png) | `27e9672f29b2f25eb343cb25c3530a31ed43c6af8df213345fef30c48e3f1984` |
| [11-T PNG](/tmp/matlab-run-33991563211/matlab-full100-R2026a/evaluator-runtime/crossed-time-depth-temperature.png) | `c7680a177838255673506a68704fee2c2e23bdac46cc8aa7cde84969b6493f9b` |
| [11-S PNG](/tmp/matlab-run-33991563211/matlab-full100-R2026a/evaluator-runtime/repeat-cast-salinity-profiles.png) | `5eee20b2433745d3bc79e05e3bbf2f17028c8c5fe620c851d54bc5242ea9f2e7` |
| [11-C PNG](/tmp/matlab-run-33991563211/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.png) | `bfd6f3c2bb046929e9d3db8b9215e17f23a8aefd69af8c3b1124cb3551fa27e5` |
| [11-I PNG](/tmp/matlab-run-33991563211/matlab-full100-R2026a/evaluator-runtime/paired-interactive.png) | `65b0613da0910dc5a05af3848db4fd9d1476e49140422f6029d577485b803cac` |
| [11 manifest](/tmp/matlab-run-33991563211/matlab-full100-R2026a/evaluator-runtime/figures.json) | `89c438136e9728566de5a8fb7323dc3580d6594c3a7f989b4b892d760dd6459e` |
| [I PDF预览](/tmp/matlab-visual-baseline/33992397354/paired-interactive-pdf.png) | `2170a9460ce0b0f6755e5a23970c7f82178c3c54859c04f66f738292f94f8301` |
| [I SVG预览](/tmp/matlab-visual-baseline/33992397354/paired-interactive-svg-librsvg.png) | `79f3ee728ef58f73158fb94dd428e36a8a7483f21507499883e260c5c054f815` |
