# SVG 尺寸证据根因：33990723561

2026-09-05；只读 R2021a/R2024b 原件，用 Python 标准库 ElementTree 解析命名空间 XML、json 读取清单并计算 SHA-256；未生成或改写 SVG。
仓库没有 `assets/oi_svg_metadata.m`；实际元数据实现是 [oi_annotate_svg.m](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_annotate_svg.m:1)，测试名为 `test_svg_metadata.m`。本报告不重复主线程的 PDF physical 修复或 R2026a PNG 调查。

## 精确失败项
两版均触发 [oi_write_manifest.m:676](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_write_manifest.m:676) 的 `approximately_equal(pixelAspect, viewBoxAspect, 1e-7)`，不是 XML 解析错误。
DISPLAY 原件：`400/300 = 1.3333333333333333`，`267/200 = 1.335`；差 `0.0016666666666667052`，允许值 `1.335e-7`，超出约 12484 倍；相对比例偏差为 0.125%。
四份 raster SVG 都有 `width="400px" height="300px"`、物理/CSS `2.6666666666666665in × 2in`、`preserveAspectRatio="xMidYMid meet"`；均有且仅有一个正确的 title/desc，`role="img"`、aria-label 与描述一致。不是小数序列化、单位缺失或标题问题。
两份 DISPLAY raster 的 `figures.json` 未落盘；按 exporter 构造式重建待写记录后，14 项数值/文本检查仅上述比例项为 false。重建不是读取失败时的内存 entry；该比例断言本身完全由原 SVG 决定，不依赖重建记录。noDISPLAY 则直接使用已落盘清单回放，全部一致。

## 原件绑定
路径基准 `B=/tmp/matlab-run-33990723561/matlab-full100-<release>/`；D=`display-comparison/publication/`，N=`export/full100-export-artifacts/`。
下表 raster 指 `raster-400-300/raster-sizing.svg`，publication 指同目录 `publication.svg`；所有文件均由结构化 XML 成功解析。
| release / 文件 | viewBox | bytes | SHA-256 |
| --- | --- | ---: | --- |
| R2021a D/raster | `0 0 267 200` | 23648 | `30e58f46ef95037bb9d9c9a3172bd4833cd015192e81b05ce883fc82d321369a` |
| R2024b D/raster | `0 0 267 200` | 22912 | `57424106b3daa81216b1f98cd31f409918179146cd0ea60efb2b5c2febfbfd19` |
| R2021a、R2024b N/raster，各一份 | `0 0 192 144` | 23327 | `4496fe4dff7cc7343b81f178c9c51f4d5703fa4936c92b1a3d30a3776dd5ebed` |
| R2021a D/publication | `0 0 400 225` | 57975 | `73616a689c66a6e476be0f03868d3dd448412a5027b55b6be29ef2356bab96d2` |
| R2024b D/publication | `0 0 400 225` | 57974 | `2778f0bff0bcbd7cafa06a593132e57eb1f559f2335c4365ed602b002790105a` |
N/raster 的清单均为 `artifact_validation.status="passed"`、`runtime_status="ready"`，且 SVG bytes/hash 与原件一致；清单 SHA-256：R21=`e91f963e2a4a7e0b195538b89b6fd97f382ff26ef3c1cd375e8cff86b95d2345`，R24=`920bbd15652afd6218ce0396ce96ab8c8c17d1814727c897cd8deaa5e385d133`。
D/publication 自身已有有效清单，SVG 记录 hash 与表中一致；失败的是随后子 case D/raster，不应把整个 publication 主图误判为 InvalidSvg。

## 环境证据
| release / JSON（相对 B） | DISPLAY / ScreenPixelsPerInch | SHA-256 |
| --- | --- | --- |
| R21 `display-comparison/display-rendering.json` | `:98` / 100 | `d8010caf2aa7599520e3e422e56cd50cf6b1e2c4cee5cba377564911686f9403` |
| R24 同路径 | `:98` / 100 | `2d257587340cfce8ec344d7dedecc126fe38c84da5b9e2c5681ae080a3c6e64a` |
| R21 `matlab-runtime-probe.json` | 无 DISPLAY / 72 | `5faa6b9699192c48a7140b917ad90515af950dd1c6f24eb1f500970a189da173` |
| R24 同路径 | 无 DISPLAY / 72 | `102929360140dd8cd2288dec981c2ae3cf417f9bd0a6ef922d7d0e2c2ca2f217` |
两份 display JSON 均明确报 `oi_write_manifest:InvalidSvg`，错误路径为 D/raster。R21 JVM=false、R24 JVM=true，却出现同一几何不一致；无证据将此归因于 JVM、字体或 exportgraphics 的 p-code 检测。

## 根因链
1. [旧版 SVG 分支](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_export_figure.m:118) 实际调用 `print(...,"-dsvg","-painters")`，不是 exportgraphics。此 case 请求 400×300 @150 DPI，即 8/3×2in。
2. [元数据 helper](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_annotate_svg.m:23) 保留已有 viewBox，或从 native width/height 建立它；随后把根像素尺寸和物理尺寸写成目标值，但不检查它们与 native viewBox 的比例。
3. [exporter 的 SVG entry](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_export_figure.m:297) 同时记录目标像素/英寸与 helper 返回的 native viewBox，所以每项尺寸可分别对应 XML，却无法满足三种比例必须一致的组合合同。
4. 100 PPI 下请求画布对应 `266.666…×200` 屏幕单位，实际 SVG 为整数 `267×200`；72 PPI 下恰好 `192×144`。D/publication 的 4×2.25in 在 100 PPI 下恰好 `400×225`，因此同一 helper 能通过。证据支持屏幕网格整数化导致的比例失配，不能仅凭这些样本断言内部采用 round 还是 ceil。
5. 不是仅根属性写错：D/raster 的两块背景 rect 和 clipPath 都实际为 `267×200`；N/raster 对应 `192×144`，内容坐标/translate 也不同。因此不能把 viewBox 数字冒写为 `192×144`。没有保存注释前 native SVG，尚不能区分 native 自带 viewBox 与 helper 从 width/height 补建两条路径。
6. [现有测试](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_svg_metadata.m:51) 的分数英寸样例是 `192×144 → 400×300`，比例仍完全一致，未覆盖 `267×200 → 400×300`。
所读工作树源码 SHA-256：helper=`2d3744bab428432c9120073efc179c7c1cf2eb8558612a26f7e0175461f904dd`；validator=`caef045e7d1349dc94a22f80be2bcd6ee9d03f48abedbba83f18111bbbca2493`；exporter=`4eff3a80b90b9a122fd12f5b8e40785ca43ca7e2ad2f75901daa5eb7949f9ee2`（主线程工作树快照，不冒称 CI 源码快照）。

## 最小保真建议
若允许在现有 SVG 元数据阶段做明确记录的视口归一化，候选是“只扩大 viewBox 以显式表达已有居中留白”，不改任何路径、字形、clipPath、子节点 transform 或目标物理尺寸；不放松门禁。
对 `xMidYMid meet`，令目标比 `r=W/H`，原 viewBox 为 `[x,y,w,h]`：`w2=max(w,h*r)`，`h2=max(h,w/r)`，新起点为 `[x-(w2-w)/2,y-(h2-h)/2]`。当前样本候选为 `0 -0.125 267 200.25`，不是缩窄到 `266.666…×200`。
[W3C SVG 视口变换算法](https://www.w3.org/TR/SVG2/coords.html#ComputingAViewportsTransform) 支持对此做等价性检查：在 400×300 viewport 下，原/候选均得到缩放 `400/267=1.4981273408239701`、平移 `(0,0.18726591760299)`；本地纯数学回放最大差 `1.07e-14`。实际 CSS 英寸 viewport 有相同比例，结论同样适用；这不是渲染验证。
限界：本批 raster 无百分比属性、无嵌套 SVG；对百分比长度、嵌套 viewport、非居中 meet/slice/none 必须另证，不能泛化。保留 native 原始 viewBox 和原文件 hash；归一化产物、实际新 viewBox 与新 hash 应如实记录，不宣称 native 原样输出已精确。
禁止把 `preserveAspectRatio` 改成 `none` 来拉伸、直接缩小/重置 viewBox 来裁内容、只把 physical width 改成 2.67in、修改 SVG 字节后沿用旧 hash，或把比例容差放宽到能吞掉当前误差。若合同要求 native viewBox 原样保留，则这个候选不可采用，本轮没有已验证的严格 native 修复。

## 待探针与交付
下一轮只对旧版各做 400×300@150 与整数比例正例，记录真实 DISPLAY/PPI、print API，并分别保存注释前 native SVG、注释后 SVG 和完整 entry；先确认 267×200 的来源，避免再由最终元数据推测后端。
如批准归一化候选，仅在独立新产物中验证：结构化比较全部图形子树/clipPath/字形不变，比较同一 SVG 渲染器的画面及实际物理尺寸，确认留白而非裁切/拉伸，再交原有严格 manifest 校验。仍须负例验证 tampered viewBox、物理尺寸或 title/hash 被拒绝；不改变评分。
本轮仅写本报告；原 SVG、manifest、日志、生产文件和门禁均未改。完成的是 XML/JSON 证据回放和变换数学检查，无本地 MATLAB 实跑或修复后视觉通过结论。
