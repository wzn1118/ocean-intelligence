# 第十二轮原生 PNG 尺寸候选视觉复核：33991563211

- 范围仅 `/tmp/matlab-run-33991563211/matlab-full100-R2026a/export/native-raster-sizing-probe/` 的 12 张候选 PNG 和 1 份 JSON；12/12 PNG 均逐张直接调用 view_image 实看，未缩放后覆盖原件。
- 按最新协调意见，生产候选改为 PNG `inches + PreserveAspectRatio="off"`；明确排除 `pixels+off`。PDF/SVG 继续 inches+on 是本轮建议边界，本次没有查看或批准其产物。
- 环境来自绑定 JSON：R2026a Update 5、DISPLAY=:97、ScreenPixelsPerInch=96、desktop_available=false、synthetic diagnostics。不是 Desktop 验证、生产全量验收或 trusted visual-audit。
- 只新增本报告；未修改生产、原图、JSON、评分或审计状态，未提交推送。

## 结论及生产风险
1. **inches+off 可进入受控生产候选验证，不可直接宣称无视觉回归。** 三个尺寸均精确，字高、标记和线宽大体保留物理尺度；但轴框及文字位置真实改变，400/997 图的轴宽分别减少约 7.1%/5.3%，不是简单去掉一行像素。
2. **底部安全余量减少。** inches on→off 最低可见墨迹留白：400 为 22→16 px，997 为 47→32 px，1200 为 43→34 px；off 的底部留白分别约 0.107/0.107/0.189 in。当前短标签完整，不证明长 xlabel、日期、多行标题或外置图例仍安全。
3. **固定比例/坐标叠加风险必须单测。** 本例 off 的轴框比例更接近记录的源轴比例，但不能外推到 axis equal、地图、图像、tiledlayout、colorbar、长 legend 或 annotation；依赖旧 PNG 像素位置的叠加需重新验证。
4. **pixels+off 不采用。** 997 标题可见墨迹高约 47→16 px，xlabel 39→13 px，X/Y 刻度变为每 0.2，轴框变高，线和标记显著缩小；400/1200 同样出现缩字及增刻度。尺寸正确不等于排版正确。
5. 本探针只有短英文标题、双轴标签和一条三点折线；无中文、图例、长文本或多面板证据。必须以真实生产中文/长标题/图例图重新验证 PNG，并与保持 inches+on 的 PDF/SVG 对照后再决定上线；本报告不给视觉审批。

## 尺寸、元数据与对象状态
- 独立读取 PNG IHDR/pHYs 并核对 JSON 的 bytes/SHA256：off 共 6/6 精确，其中 inches 3/3、pixels 3/3；on 仅 2/6 精确，两个单位模式结果相同。
- 400 组目标 400x300@150 dpi，on/off 均 400x300；997 组目标 997x613@300 dpi，on 为 997x614，off 为 997x613；1200 组目标 1200x675@180 dpi，on 为 1200x676，off 为 1200x675。
- 实际 pHYs 换算 DPI：150.0124、299.9994、180.0098，X/Y 一致，符合每米整数编码精度；对应目标物理页分别约 2.6667x2、3.3233x2.0433、6.6667x3.75 in。
- 12/12 的 `figure_before_export` 与 `figure_after_export` 深比较相同；每个尺寸组内四候选的 before 快照也相同。仅证明已记录的 figure/axes 位置、比例、limits、X/Y 数组未变，不证明完整对象树或导出中间布局未变。
- 快照没有 FontSize、FontUnits、LineWidth、MarkerSize、tick 数组或文字 Extent；不能据此给这些对象属性 before/after 签名。JSON 记录字体 WenQuanYi Zen Hei，PNG 无可抽取的原生点数字号或嵌入字体证据。
- 三组 pixels+on 与 inches+on 解码 RGB 完全相同，虽然文件 SHA256 不同；off 两个单位模式的画面明显不同。原 JSON 的 visual_verified/layout_verified=false 保持不动。

## inches on/off 实看与测量
坐标为原 PNG 左上角起算的 0-based px；测量使用 Pillow 12.3.0。深色文字/轴采用 max(R,G,B)<160，标题连通域排除刻度；墨迹边界及拟合坐标约有 1 px 量化误差，不是 MATLAB 公共几何测量。字高是可见墨迹而非 FontSize。
| 目标 / DPI | 标题墨迹宽x高 on→off | xlabel 墨迹宽x高 on→off | 轴框宽x高 on→off；宽高比 | 实看结论 |
| --- | --- | --- | --- | --- |
| 400x300 / 150 | 150x24→151x24 | 79x20→80x20 | 268x162→249x162；1.6543→1.5370 | 标题 Raster sizing、Value (1)、Time (s) 完整；X/Y 仍为 1、2、3；轴框变窄，标题和轴下移约 7 px，底部更紧。 |
| 997x613 / 300 | 298x47→300x48 | 158x39→159x40 | 693x334→656x334；2.0749→1.9641 | 大字号保留，X 仍为 1/1.5/2/2.5/3、Y 仍为 1/2/3；轴框收窄，下移约 14 px，xlabel 下移，无当前裁切。 |
| 1200x675 / 180 | 180x28→180x28 | 95x24→96x24 | 837x474→838x474；1.7658→1.7679 | X/Y 仍为每 0.5；整体左移约 20 px、下移约 8 px，文字完整；轴框宽高近似保持。 |

- 同组目标英寸/DPI 相同，故可以比较物理字高；三组 inches on/off 标题墨迹高度约 0.156–0.160 in，xlabel 约 0.130–0.133 in，支持“接近原字号”，不支持精确 FontSize 未变。
- 三组深色轴框核心厚度 on/off 分别都是 2/2、4/4、2/2 px；蓝折线非网格区域的抗锯齿加权法向厚度约 0.90→1.05、2.03→1.96、1.14→1.20 px，折合约 0.43–0.50 pt。粗细量级保留，但抗锯齿、斜率及亚像素落点不同，不签逐像素/精确 LineWidth 等价。
- 蓝线厚度估算取上升段横向 20%–35% 的截面，以白/浅底与蓝色差估计覆盖率并按斜率换算法向厚度；仅是栅格近似测量，不是 API 属性读取。
- 源 axes_pixels 的宽高比约 1.5356、1.9485、1.7655；inches+off 实际约 1.5370、1.9641、1.7679，比 on 的前两组更接近源轴框。不能把 on 当成已证明正确的几何基准，也不能把 off 普遍解释为畸变。
- 六张 inches 图均未见标题/标签触页边或缺字；文字仍分别对齐各自轴框，没有遮盖线段。三个圆点均落在轴框边界/角点并与框线相交，这是 on/off 共同局限；顶端圆点距标题较紧。没有图例，也没有 CJK 样本。

## 折线位置及 pixels 对照
蓝色阈值定位后对两段可见线中心拟合；首/末点在实测左右轴框处取值，顶点取两段交点，约 ±1 px。以下不是从原始科学数组重新计算的结果。
| inches 组 | on：首点；顶点；末点 (x,y) | off：首点；顶点；末点 (x,y) |
| --- | --- | --- |
| 400 | (87.5,210.5)；(221.5,48.5)；(355.5,129.5) | (96.5,217.9)；(220.9,55.5)；(345.5,136.6) |
| 997 | (195.5,431.5)；(542.0,97.5)；(888.5,264.5) | (205.5,445.7)；(533.5,111.4)；(861.5,278.4) |
| 1200 | (219.5,548.5)；(638.0,74.5)；(1056.5,311.5) | (199.5,556.8)；(618.4,82.5)；(1037.5,319.5) |

| pixels 组 | on→off 标题字高 / xlabel 字高 | on→off 可见刻度 | off 轴框与实际视觉 |
| --- | --- | --- | --- |
| 400 | 24→15 / 20→13 px | X/Y 从每 1 变每 0.5 | 272.5x197 px；标题、标签完整但缩小，线顶点移至约 (208.9,41.4)，不等价。 |
| 997 | 47→16 / 39→13 px | X 从每 0.5、Y 每 1 变 X/Y 每 0.2 | 695.5x449.5 px；顶点约 (513.6,71.6)，同页内字号/线/圆点明显变小，不适合作原排版替换。 |
| 1200 | 28→16 / 24→13 px | X/Y 从每 0.5 变每 0.2 | 837.5x495 px；顶点约 (618.4,78.5)，字体缩小、网格变密，不等价。 |

## 原件 SHA256
下列 13 文件的审前/审后 SHA256 及字节数逐一相同；12 张 PNG 同时匹配原 JSON 声明。链接直接指向原件，未生成或改写原图副本。
| 原件 | 实际尺寸 | 审前 = 审后 SHA256 |
| --- | --- | --- |
| [1200x675-dpi180-inches-aspect-off.png](/tmp/matlab-run-33991563211/matlab-full100-R2026a/export/native-raster-sizing-probe/1200x675-dpi180-inches-aspect-off.png) | 1200x675 | `8a154777794e518e4b00fc1452721c44005f0429129b8c8af689cd0abe05db87` |
| [1200x675-dpi180-inches-aspect-on.png](/tmp/matlab-run-33991563211/matlab-full100-R2026a/export/native-raster-sizing-probe/1200x675-dpi180-inches-aspect-on.png) | 1200x676 | `14b7650b377eb7bf7ca4e8ccd633b3d6211b1132089561ad4b4d72da6f17e05c` |
| [1200x675-dpi180-pixels-aspect-off.png](/tmp/matlab-run-33991563211/matlab-full100-R2026a/export/native-raster-sizing-probe/1200x675-dpi180-pixels-aspect-off.png) | 1200x675 | `421602756a398bb9ab8967d13d2087065c6848360d21da24b2319022f89246eb` |
| [1200x675-dpi180-pixels-aspect-on.png](/tmp/matlab-run-33991563211/matlab-full100-R2026a/export/native-raster-sizing-probe/1200x675-dpi180-pixels-aspect-on.png) | 1200x676 | `2ad4f55ba4ec826a4fcc65d57014882d5558caaa3b8e2eb789ab48d3ee994164` |
| [400x300-dpi150-inches-aspect-off.png](/tmp/matlab-run-33991563211/matlab-full100-R2026a/export/native-raster-sizing-probe/400x300-dpi150-inches-aspect-off.png) | 400x300 | `58267e8b44a288d199ac721e1a2c246f2a104ce65aa6c55ab2e16f92d8b694e5` |
| [400x300-dpi150-inches-aspect-on.png](/tmp/matlab-run-33991563211/matlab-full100-R2026a/export/native-raster-sizing-probe/400x300-dpi150-inches-aspect-on.png) | 400x300 | `fb9475d04a0c5dcb5a9cf8d135ced4f8a0a00da91e0fd7ff15f519926a049223` |
| [400x300-dpi150-pixels-aspect-off.png](/tmp/matlab-run-33991563211/matlab-full100-R2026a/export/native-raster-sizing-probe/400x300-dpi150-pixels-aspect-off.png) | 400x300 | `fa49675ee9da73030af3798a959030edfe90ee16f2fa8f1ae8f57aef51445104` |
| [400x300-dpi150-pixels-aspect-on.png](/tmp/matlab-run-33991563211/matlab-full100-R2026a/export/native-raster-sizing-probe/400x300-dpi150-pixels-aspect-on.png) | 400x300 | `241d1b05e3c91744f047224ea049ef8571a2228adca376a97368c91799e0f723` |
| [997x613-dpi300-inches-aspect-off.png](/tmp/matlab-run-33991563211/matlab-full100-R2026a/export/native-raster-sizing-probe/997x613-dpi300-inches-aspect-off.png) | 997x613 | `9c6d63779ae5fddf2673c5e5ae501520ed64745fa8ac4c1ed493686c7f415e65` |
| [997x613-dpi300-inches-aspect-on.png](/tmp/matlab-run-33991563211/matlab-full100-R2026a/export/native-raster-sizing-probe/997x613-dpi300-inches-aspect-on.png) | 997x614 | `2e47e1839b04c5c6bd4be95cfdd26ab1d236ba905ee312d9e4e0ef1d32beb9ec` |
| [997x613-dpi300-pixels-aspect-off.png](/tmp/matlab-run-33991563211/matlab-full100-R2026a/export/native-raster-sizing-probe/997x613-dpi300-pixels-aspect-off.png) | 997x613 | `e854f0cbc08e09a80a014052a6663f330d6155d6bb9ad7ca7cef504099c2f69f` |
| [997x613-dpi300-pixels-aspect-on.png](/tmp/matlab-run-33991563211/matlab-full100-R2026a/export/native-raster-sizing-probe/997x613-dpi300-pixels-aspect-on.png) | 997x614 | `e517cd4a14fd49b712528aa2d15d0e2e62debd99c3571b1c03de054094d3236e` |
| [native-raster-sizing-probe.json](/tmp/matlab-run-33991563211/matlab-full100-R2026a/export/native-raster-sizing-probe/native-raster-sizing-probe.json) | JSON | `15c3a4af0612a34266b46871cd27cd17964f5ee456cd530ccb66ca0e2a3b24bf` |

## 交付边界
本轮证据为 12/12 PNG 实看、13/13 原件哈希不变、已记录对象快照相同及局部栅格测量；不是科学数据复算、完整字体属性审计、CJK/复杂布局验收或生产视觉批准。inches+off 的精确尺寸与近似物理字体尺度有实证，布局变化与边距风险也有实证，二者必须同时保留。
