# 原生导出视觉核验：33984666441 / R2026a

审查日期：2026-09-05 UTC。范围为 `/tmp/matlab-run-33984666441/matlab-full100-R2026a` 的出版图三格式及 `evaluator-runtime` 四图各自的 PNG/PDF，共 **11 个新原件**。版本名来自目录；本轮未启动 MATLAB。

用户提供的生成背景是三格式使用 `exportgraphics` P-code 与精确尺寸；本次不读取或修改源码来独立验证调用路径，仅核对产物尺寸和真实呈现。**Runtime 本轮仍失败（用户提示 11/14），不是全量验收。** 下文的查看覆盖数不等于 Runtime 测试数或通过数，不出具综合满分。

## 结论先行

1. **出版 PNG 的 legend 越框问题在本次原件中未再出现**：observed/model 均在框内，标题“南海海表温度”、Y 标签“温度 (degC)”完整可读。
2. **出版 PDF/SVG 的 title/Ylabel 问题仍存在**：真实渲染后看不到中文标题，左页边仅有纵轴标签残片；仅横轴“时间 (UTC)”可读。不能用 PNG 或精确尺寸替代这两个格式的视觉结果。
3. **温度场 PNG/PDF 的 Y 标签与 0/20/40/60/80 刻度均可辨，目视未见相撞**。但 PDF 标题上缘及右端被截，横轴 `Time (UTC)` 在下页边被截；不能判整页布局通过。
4. **中文交互图 PNG 的双语标题完整；PDF 的标题上缘被截，虽然字串仍可辨。** 静态图可见不证明任何交互回调或 Desktop 功能。
5. 另外两张 evaluator PNG 及其 PDF 也已实际查看：观测/模型图有统计文字与数据/参考线交叠，PDF 标题不可读；盐度剖面 PDF 有标题、长 Y 标签及 X 标签的页边裁切。四份 evaluator PDF 均存在标题或页边问题。

## 实际覆盖与方法

| 范围 | 实际查看 | 方法与限制 |
| --- | --- | --- |
| 新 publication PNG | 1/1 | 原件直接 `view_image`，1200 x 675 |
| 新 publication PDF | 1/1 | Poppler 整页渲染后 `view_image`，300 dpi，1200 x 675 |
| 新 publication SVG | 1/1 | librsvg/Cairo 实际渲染后 `view_image`，1200 x 675；不是 XML 检查代替视觉 |
| 新 evaluator PNG | 4/4 | 四张原件分别 `view_image`，均为 2400 x 1500 |
| 新 evaluator PDF | 4/4 | 各自第 1 页经 Poppler 渲染后分别 `view_image`，150 dpi，1200 x 750 |
| 旧 run 33983591040 出版对照 | 3/3 | 本轮重新查看旧 PNG、旧 PDF 整页预览、旧 SVG 的 librsvg 预览，并复核旧原件哈希 |
| 新 run 其他版本、family、regression | 未查看 | 不作视觉签收 |
| Runtime / Desktop / 交互操作 | 未执行 | 不解除 Runtime 失败状态，不假签交互成功 |

本轮新产物目视覆盖是 **11/11，绝非 11/11 合格**。新原件在操作前后计算 SHA256 与字节数，11/11 均未变化。工作区仅新增本报告；未修改任何绘图源、原件或此前报告，未提交、未推送。

渲染细节：

- PDF 使用现有 Poppler `22.02.0`（包 `22.02.0-2ubuntu0.13`），参数 `-f 1 -singlefile -r <dpi> -png`；输出至 `/tmp/matlab-visual-baseline`，未人工裁剪页面。
- SVG 使用现有 librsvg `2.52.5+dfsg-3ubuntu0.2`、Cairo `1.16.0-5ubuntu2.1`。通过 Python `ctypes` 调用 `rsvg_handle_new_from_file`、`rsvg_handle_render_document`，CSS 单位 DPI 96，完整 viewport `(0, 0, 1200, 675)`、白底；不替换字形、不修改 viewBox/CSS、不补画标题。
- SVG 渲染及 Cairo 写 PNG 返回成功；非白差异包围盒为 `[0, 0, 1102, 519]`，灰度小于 245 的像素数 39474，仅证明不是空白输出。实际缺陷以下述目视为准。
- 本轮未尝试浏览器渲染，SVG 结论限本机 librsvg/Cairo；PDF 结论限本机 Poppler。

## 出版三格式：旧问题是否消失

| 检查项 | 旧 run 33983591040 / R2026a | 新 run 33984666441 / R2026a | 本次判断 |
| --- | --- | --- | --- |
| PNG 中文标题与 Ylabel | 可读 | 仍完整可读 | 保持；这两项本来不是旧 PNG 的缺陷 |
| PNG legend 边框 | observed/model 大段越出右框 | 两行文字均在更宽的框内，与横轴标签分开 | **本原件中越框问题已消失** |
| PDF 中文标题 | 不可见 | 仍不可见 | **问题仍在** |
| PDF Ylabel | 左页边残片，不可完整读取 | 仍是左页边残片 | **问题仍在** |
| SVG 中文标题 | 不可见 | 仍不可见 | **问题仍在** |
| SVG Ylabel | 左页边残片，不可完整读取 | 仍是左页边残片 | **问题仍在** |
| PDF/SVG legend | 自身文字在框内 | 仍在框内；上边紧邻横轴标签 | 不能据此推断标题/Ylabel 正常 |
| 整体几何与线型 | PNG 与 PDF/SVG 不一致 | 新 PNG 绘图区也变矮，但 PNG 标题/Ylabel 可见而 PDF/SVG 不可见；PNG 的 model 样线有虚线间隔，PDF/SVG 预览中呈连续样线 | 仍不能判三格式整体一致 |

### Publication PNG

原件直接查看：[publication.png](/tmp/matlab-run-33984666441/matlab-full100-R2026a/export/full100-export-artifacts/publication.png)。

- “南海海表温度”“时间 (UTC)”“温度 (degC)”均完整可读，未见中文方框代字。`degC` 是 ASCII，不是度符号覆盖测试。
- 图例 observed/model 被矩形框完整包围；蓝圆、橙方与两条曲线符号相符。这是本轮明确改善项。
- 绘图区上下留白紧，极值和最右端标记与轴框相交；绘图区明显较旧 PNG 矮，横轴主刻度从旧图 0/5/10/15/20 变为 0/10/20。这里只记录差异，不在未读源数据/设计要求时判定轴限正确性。

### Publication PDF

实际查看：[PDF 整页预览](/tmp/matlab-visual-baseline/33984666441-R2026a-publication-pdf.png)。

- **中文标题在整页内不可见，Y 标签只有左上页边的零碎残片**；“时间 (UTC)”可读，图例文字在框内。旧缺陷不能签为已修复。
- 与 PNG 相比，不仅字形是否存在不同，横轴标签位置及绘图区周围留白也不同。标题/纵轴不可读，无法判整体字体一致。
- `pdffonts` 列出已嵌入的 NotoSansCJKsc-Bold/Regular，仍不能证明不可见文字已通过；`pdftotext` 仅抽出刻度、横轴和图例，未抽出标题/Ylabel。

### Publication SVG

实际查看：[SVG 的 librsvg 渲染图](/tmp/matlab-visual-baseline/33984666441-R2026a-publication-svg-librsvg.png)。

- **标题不可见、纵轴只余左页边残片，与本轮 PDF 症状一致**；横轴“时间 (UTC)”可读，图例自身文字在框内。整图 CJK 只能判部分可读，不能全通过。
- XML 解析成功，存在中文 title/aria-label，但没有 `<text>` 元素；这不能推翻已经看到的图面不完整。
- 本次没有裁掉原 SVG 的一部分来截图，也没有通过移动画布“找回”标题。未检查源码，不能从共同症状断言具体根因。

### 尺寸与证据边界

出版 PNG 为 1200 x 675；PDF 为单页 288 x 162 pt，即 4 x 2.25 in；SVG 声明 width/height 为 1200px/675px，CSS 为 4in/2.25in，viewBox 为 `0 0 288 162`。这些尺寸关系与 300 dpi 出版目标一致，**但尺寸一致并没有消除本次实际看到的 PDF/SVG 裁切或越界**。仅凭产物无法独立验证 P-code 调用路径。

## Evaluator-runtime 四图逐格式记录

### 1. Crossed-time-depth-temperature

实际查看：[原 PNG](/tmp/matlab-run-33984666441/matlab-full100-R2026a/evaluator-runtime/crossed-time-depth-temperature.png)、[PDF 整页预览](/tmp/matlab-visual-baseline/33984666441-R2026a-crossed-time-depth-temperature-pdf.png)。

- **PNG Ylabel/ticks**：`Depth (m, positive down)` 与 0、20、40、60、80 刻度分开，均可辨；目视没有相撞或 Ylabel 裁切。刻度值向下增大。
- **PNG 其他文字**：长标题 `Synthetic mooring temperature field with crossed time and depth`、`Time (UTC)`、色条 `Temperature (degC)` 可读；横轴标签下边距较紧。
- **PDF Ylabel/ticks**：同一深度标签和刻度可读且分开，未见碰撞；色条标签可读。但**标题顶部与右端被截，Time (UTC) 的下部被下页边截去**，不判整页布局通过。
- **场与缺测**：两个格式均可见中部白色格块，与温度色条低值的深色不同；只能证明存在可见空白块，未用输入数组验证缺测掩膜或时间/深度排序。PDF 色条主刻度较 PNG 稀疏，不能称逐像素一致。
- **CJK**：图中文字为英文，无本图中文样本，CJK 不适用作成功证据。

### 2. Paired-interactive（中文交互图）

实际查看：[原 PNG](/tmp/matlab-run-33984666441/matlab-full100-R2026a/evaluator-runtime/paired-interactive.png)、[PDF 整页预览](/tmp/matlab-visual-baseline/33984666441-R2026a-paired-interactive-pdf.png)。

- **PNG 中文**：`温度时间序列 / Temperature time series` 完整可读，无方框代字；温度、时间轴及 `Aug 01, 2026` 日期可读，没有明显标签相撞。
- **PDF 中文**：同一标题字串仍可辨，但**字形上部被页顶截去**，不能签完整保真。轴标签和日期可读；部分主刻度分布与 PNG 不同。
- **线与误差棒**：两格式可见前段上升、后段下降后持平及中间断开、空心圆和灰色误差棒；首末点/误差棒紧贴左右轴框。只记录可见断线，不验证原始缺测规则或不确定度计算。
- **文本抽取**：PDF 标题中文能抽取，日期抽取中数字缺失；预览仍可见完整日期。这是文本抽取问题，不能混同为日期图面缺字。
- **交互边界**：只看静态导出，没有执行鼠标操作、data tip、brush、回调或 Desktop 会话；不能因文件名含 interactive 就判交互通过。

### 3. Paired-observation-model

实际查看：[原 PNG](/tmp/matlab-run-33984666441/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.png)、[PDF 整页预览](/tmp/matlab-visual-baseline/33984666441-R2026a-paired-observation-model-pdf.png)。

- **PNG**：长标题、Observation/Model 轴标签可读，底部图例在框内；**中部数据点/1:1 虚线与缺测或未匹配统计文字交叠**，不是无碰撞版面。
- **PDF**：标题几乎全部落在页上方，仅余页顶残迹，不能完整读取；轴标签和图例可读，**1:1 虚线穿过统计文字**。
- 可见统计文本包括 `N = 11`、Bias `0.08727`、MAE `0.09273`、RMSE `0.1116 degC`、`r = 1.000`、`Missing/QC rejected = 1/0`、`Unmatched obs/model = 0/0`。这是图上显示值，不是重新计算的结果；交叠处仍不算版面通过。
- `pdftotext` 会丢失统计中的数字，即使预览能看见；独立记录为 PDF 文本抽取缺陷，不把它夸大为所有数字视觉缺失。
- 本图无中文样本，不提供额外 CJK 证据。

### 4. Repeat-cast-salinity-profiles

实际查看：[原 PNG](/tmp/matlab-run-33984666441/matlab-full100-R2026a/evaluator-runtime/repeat-cast-salinity-profiles.png)、[PDF 整页预览](/tmp/matlab-visual-baseline/33984666441-R2026a-repeat-cast-salinity-profiles-pdf.png)。

- **PNG**：`Synthetic repeat-cast salinity profiles`、长 Ylabel `Depth (m, positive down; reference: synthetic sea surface)`、`Salinity (g kg-1)` 可读，Ylabel 与 0/50/100 刻度分开；下方横轴文字接近画布下缘。
- 右侧无框图例三行时间戳可读，蓝实线、橙虚线、绿点线可区分，没有图例文字覆盖绘图区的明显问题。
- **PDF**：标题上缘被截；长 Ylabel 在页左/页顶截断，不能读全参考面说明；**Salinity 横轴标签被下页边裁切**。时间戳图例实际可读，不能因为 `pdftotext` 丢数字而宣称图例数字不可见。
- 两格式均可见三条曲线和向下增大的深度刻度；未读数据验证剖面长度、缺测或参考面定义。本图无中文样本。

## 原件 SHA256 绑定

以下 11 个新原件均已实际查看，且渲染前后哈希与字节数一致。文件存在、哈希稳定与目视查看不等于合格。

| 原件 | SHA256 |
| --- | --- |
| [出版 PNG](/tmp/matlab-run-33984666441/matlab-full100-R2026a/export/full100-export-artifacts/publication.png) | `f8095288d66f46fade41c44d0c30d21356c7e8666ba8f0244775f1744bd14131` |
| [出版 PDF](/tmp/matlab-run-33984666441/matlab-full100-R2026a/export/full100-export-artifacts/publication.pdf) | `ad9c02699fb9939d6a0cbe84dc73324188bb00aebaf05eae20cf12da71cfe2eb` |
| [出版 SVG](/tmp/matlab-run-33984666441/matlab-full100-R2026a/export/full100-export-artifacts/publication.svg) | `18f49b3de858ee3e1d7e6db42838a7585953e6f7d1dcd51b070f223d2aaddd46` |
| [温度场 PNG](/tmp/matlab-run-33984666441/matlab-full100-R2026a/evaluator-runtime/crossed-time-depth-temperature.png) | `aa430424d50509ff42ca6bdd9245f1baead722a13050c0a4400666bde460da45` |
| [温度场 PDF](/tmp/matlab-run-33984666441/matlab-full100-R2026a/evaluator-runtime/crossed-time-depth-temperature.pdf) | `6fa90130a75958b51cf5ca713b4c9be949c4251e9b2837980bdf8586040726bc` |
| [中文交互 PNG](/tmp/matlab-run-33984666441/matlab-full100-R2026a/evaluator-runtime/paired-interactive.png) | `b1bf3bbc4e2051f327db7dbba119dfab731913e733310909cb97f96bc8e4af41` |
| [中文交互 PDF](/tmp/matlab-run-33984666441/matlab-full100-R2026a/evaluator-runtime/paired-interactive.pdf) | `9f483a56f9f30956ecad30efea3b2ebe802939f5fdf81293751aa405e9d2da42` |
| [观测模型 PNG](/tmp/matlab-run-33984666441/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.png) | `b33e390bc4526333109385b0c07b11e68986d9312557bcaa2226b1b469b783d7` |
| [观测模型 PDF](/tmp/matlab-run-33984666441/matlab-full100-R2026a/evaluator-runtime/paired-observation-model.pdf) | `13d28a67af9a2e68195b351ea409497b7e321e93003805b4e5d0ae8a9a1ab846` |
| [盐度剖面 PNG](/tmp/matlab-run-33984666441/matlab-full100-R2026a/evaluator-runtime/repeat-cast-salinity-profiles.png) | `b7487c1f7ee92afcc8d1d22d1000f983e3e2df1fe09e8299bb0c12e9794787fa` |
| [盐度剖面 PDF](/tmp/matlab-run-33984666441/matlab-full100-R2026a/evaluator-runtime/repeat-cast-salinity-profiles.pdf) | `16852ae1722b912e90851a79d37233bd4151a64847bf9c3d898188ecf7234372` |

旧出版对照原件哈希与此前记录一致，本次未修改：

| 原件 | SHA256 |
| --- | --- |
| [旧 PNG](/tmp/matlab-run-33983591040/matlab-full100-R2026a/export/full100-export-artifacts/publication.png) | `d7d9379600e2e893fe8f20a900e07de201e319e85632f3a1f9f01317e3a13d48` |
| [旧 PDF](/tmp/matlab-run-33983591040/matlab-full100-R2026a/export/full100-export-artifacts/publication.pdf) | `d792675e261b48e0f3e825a1bb262134eddfcda373f8d1aedcc63a06b384a16d` |
| [旧 SVG](/tmp/matlab-run-33983591040/matlab-full100-R2026a/export/full100-export-artifacts/publication.svg) | `58dc60f15db4fa32ee5d5ce193ff537d15019d944aceae5257d9e896894ee150` |

## 本轮转换图 SHA256

以下均为新原件的整页/整画布查看副本，不是 MATLAB 新生成图，也未覆盖旧预览：

| 查看副本 | SHA256 |
| --- | --- |
| [出版 PDF 预览](/tmp/matlab-visual-baseline/33984666441-R2026a-publication-pdf.png) | `b48648c54fd3f20b539e1a9dd609c599363183f2b9cd804a75e00163e4303344` |
| [出版 SVG 预览](/tmp/matlab-visual-baseline/33984666441-R2026a-publication-svg-librsvg.png) | `71cd87a2339e38d0d1addfcb890d6838e136d6961e9a59c89f6ca07e6a3f43be` |
| [温度场 PDF 预览](/tmp/matlab-visual-baseline/33984666441-R2026a-crossed-time-depth-temperature-pdf.png) | `f4ba62b466332ffdcc8c5b380ab0fd1f116d58146f4046d3e01c212e8f833b64` |
| [中文交互 PDF 预览](/tmp/matlab-visual-baseline/33984666441-R2026a-paired-interactive-pdf.png) | `23d179d19cb76758dbb17b5b6a7b58d66121b08732ea6eafa1266c3ca52090cc` |
| [观测模型 PDF 预览](/tmp/matlab-visual-baseline/33984666441-R2026a-paired-observation-model-pdf.png) | `f5433cd922a731e8f5f436c5e0199e4c85e54ed86d21907f2d8c894f7eba731c` |
| [盐度剖面 PDF 预览](/tmp/matlab-visual-baseline/33984666441-R2026a-repeat-cast-salinity-profiles-pdf.png) | `a4b5a238ce06d772e3d3fa12a14ac0049b60fde9a9c2b9a9868d1e9e3a4d9dd4` |

## 剩余限制

- 所有新 PDF 均为一页。出版图所有页面盒为 `[0, 0, 288, 162]`；四份 evaluator PDF 为 `[0, 0, 576, 360]`，旋转均为 0。本次没有自行缩小 CropBox 或截掉边缘。
- 所有新 PDF 都列出已嵌入 NotoSansCJKsc-Regular，出版 PDF 另有 Bold；字体嵌入、标题文本能抽取、精确尺寸均不能消除实际裁切，也不能单独证明字体保真。
- PNG/SVG/PDF 的缺陷判断只绑定上述哈希；不能推断主线程更新后的源码或下一次 run 是否已修复。
- 需要后续重新导出并逐格式确认出版 PDF/SVG 标题/Ylabel、evaluator PDF 页边以及观测/模型统计避让。本次未进行修复或重新运行 MATLAB。
- Runtime 仍失败（11/14 状态来自用户，本轮未另查日志），Desktop/交互操作未验证；不将本次目视覆盖冒充全量验收。
