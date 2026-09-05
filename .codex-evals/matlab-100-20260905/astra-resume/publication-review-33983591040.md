# 第二轮中文出版产物核验：33983591040

审查日期：2026-09-05 UTC。仅审查 `/tmp/matlab-run-33983591040` 三版本的 `export/full100-export-artifacts/publication.png`、`publication.pdf`、`publication.svg`，共 9 个原件。版本名来自目录，不代表本次重新验证运行环境。

**Runtime 尚失败（用户提供的状态，本次不读取其他日志复核）。本报告不是全量验收，不代表 Runtime、Desktop、其他图族或所有 CJK 字形通过，不给综合满分。** 本次只新增本报告和独立临时 PDF 预览，不改源码、原件或上一轮长基线，不提交。

## 具体结果

| 版本/格式 | 中文可读性 | 裁切、边界与布局 | 字体一致性 |
| --- | --- | --- | --- |
| R2021a PNG | 已实际看到“南海海表温度”“时间 (UTC)”“温度 (degC)”，均可读 | 未见明显文字裁切；标题距上页边很近；图例文字在框内 | 中文/英文呈无衬线外观；仅凭 PNG 不能锁定字体名称 |
| R2021a PDF | 三处中文均实际可读，不能因文本抽取无中文而判缺字 | 未见明显文字裁切；`observed` 末尾贴近/触及图例右框，留白不足 | 英文图例/刻度呈等宽外观，与 PNG 不一致；`pdffonts` 报 Courier、未嵌入；中文字体身份未独立证明 |
| R2021a SVG | **视觉未验证**；中文存在于 title/desc/aria-label，不能代替图面字形 | XML 解析成功；未渲染，裁切/图例几何未验证 | 无 `<text>`；style 声明 Noto Sans CJK SC 及根级 Dialog；路径字形是否匹配 PNG/PDF 未验证 |
| R2024b PNG | 三处中文均实际可读 | 未见明显文字裁切；标题上方留白很小；图例包住文字 | 与 R2021a PNG 的字体外观相近，不能据栅格证明精确字体身份 |
| R2024b PDF | 三处中文均实际可读 | 未见明显文字裁切；`observed` 末尾贴近/触及图例右框 | 英文图例/刻度呈 Courier 等宽外观，与本版 PNG 不一致；中文字体身份未独立证明 |
| R2024b SVG | **视觉未验证**；中文元数据存在 | XML 解析成功；未渲染，裁切/边界未验证 | 无 `<text>`，style 声明与 R2021a 相同；不能凭声明签字体一致 |
| R2026a PNG | 三处中文均实际可读 | 未见明显中文画布裁切；**observed/model 明显越出图例右框**，图例上框紧邻横轴标签 | 中文/英文呈无衬线外观；整体字体身份不能仅靠 PNG 证明 |
| R2026a PDF | **仅横轴“时间 (UTC)”可读**；中文标题不可见，纵轴标签只余左页边残片 | **页面呈现失败：标题/纵轴越界或裁切**；绘图区明显变矮，横轴只剩 0/10/20 主刻度；图例自身文字在框内 | 嵌入 NotoSansCJKsc-Bold/Regular；剩余文字外观与 PNG 较接近，但因标题/纵轴无法比较，不能判整体一致 |
| R2026a SVG | **视觉未验证**；中文元数据存在 | XML 解析成功；未渲染，不能用 PDF/PNG 结果代签 | 无 `<text>`，仅检出 Sans Serif 属性声明；路径字形的实际字体与可读性未验证 |

三张 PNG 都是真正含中文的可见样本，证据仅限上述实际字串。R2021a/R2024b PDF 也有实际中文可读证据；R2026a PDF 只有部分中文可读，不能给整图 CJK 通过。

## 逐格式 SHA256

哈希均针对原始产物，而非转换图；下列九个原件在审查后按此表复核。

### R2021a

| 原件 | SHA256 |
| --- | --- |
| [PNG](/tmp/matlab-run-33983591040/matlab-full100-R2021a/export/full100-export-artifacts/publication.png) | `69df8dc39167df4c95578ee65013ee7f0e8aff75a0e113642f47394dd943ec5e` |
| [PDF](/tmp/matlab-run-33983591040/matlab-full100-R2021a/export/full100-export-artifacts/publication.pdf) | `a07b19aa0f728bd9e722e63ef9a0dd8ba34f0821753296e4d9619476a3b63590` |
| [SVG](/tmp/matlab-run-33983591040/matlab-full100-R2021a/export/full100-export-artifacts/publication.svg) | `7286932eeaa39ee41ea9fd281bb3281f268d189c9a6465f2f3763872e3ea6a24` |

原始 PNG 和 [PDF 整页预览](/tmp/matlab-visual-baseline/33983591040-R2021a-publication-pdf.png) 均分别调用 `view_image` 实际查看。PDF 中中文标题及两个轴标签可见，但 `pdftotext -layout` 只抽出刻度和 observed/model，未抽出中文及轴单位。**视觉可读与文本可检索是两项不同结果**；本次不据此确定中文是否转成轮廓，也不把 Courier 字体清单套用于所有可见中文。

### R2024b

| 原件 | SHA256 |
| --- | --- |
| [PNG](/tmp/matlab-run-33983591040/matlab-full100-R2024b/export/full100-export-artifacts/publication.png) | `6b88332c166351b097bb9effd19a132a697403cdd21bc210b777bbe049b30699` |
| [PDF](/tmp/matlab-run-33983591040/matlab-full100-R2024b/export/full100-export-artifacts/publication.pdf) | `8e6f0a6a8fcc1fdafe63f93327fbbaf22c405e6110ed9a484a56e33d2ea3e49f` |
| [SVG](/tmp/matlab-run-33983591040/matlab-full100-R2024b/export/full100-export-artifacts/publication.svg) | `7286932eeaa39ee41ea9fd281bb3281f268d189c9a6465f2f3763872e3ea6a24` |

原始 PNG 和 [PDF 整页预览](/tmp/matlab-visual-baseline/33983591040-R2024b-publication-pdf.png) 均独立调用 `view_image` 查看，未用前一版本代替。PDF 中文确实可读，英文图例/刻度的字体与 PNG 不同；PDF 中文和轴单位同样未被 `pdftotext` 抽出。

### R2026a

| 原件 | SHA256 |
| --- | --- |
| [PNG](/tmp/matlab-run-33983591040/matlab-full100-R2026a/export/full100-export-artifacts/publication.png) | `d7d9379600e2e893fe8f20a900e07de201e319e85632f3a1f9f01317e3a13d48` |
| [PDF](/tmp/matlab-run-33983591040/matlab-full100-R2026a/export/full100-export-artifacts/publication.pdf) | `d792675e261b48e0f3e825a1bb262134eddfcda373f8d1aedcc63a06b384a16d` |
| [SVG](/tmp/matlab-run-33983591040/matlab-full100-R2026a/export/full100-export-artifacts/publication.svg) | `58dc60f15db4fa32ee5d5ce193ff537d15019d944aceae5257d9e896894ee150` |

原始 PNG 和 [PDF 整页预览](/tmp/matlab-visual-baseline/33983591040-R2026a-publication-pdf.png) 均分别调用 `view_image` 查看。PNG 的 observed/model 越框是明确可见问题；PDF 没有可读中文标题或纵轴标签，不能因字体已嵌入就判成功。PDF 文本抽取能得到“时间 (UTC)”，没有抽出标题或纵轴中文；本次不读源码定位具体越界/导出根因。

## 方法与结构证据

- PNG：三张均为 1200 x 675 RGB。实际查看数量为 3/3，不等于三张均合格。
- PDF：三份均为 1 页、288 x 162 pt，所有页面盒均为 `[0, 0, 288, 162]`，旋转 0。使用 Poppler `pdftoppm` 22.02.0、180 dpi 转出 720 x 405 RGB，逐张查看 3/3。转换整页，不做人工裁剪、不修改 PDF。
- PDF 字体：R2021a/R2024b 的 `pdffonts` 均只列 Courier、Type 1、WinAnsi、未嵌入；Producer 为 Apache FOP。R2026a 列 NotoSansCJKsc-Bold/Regular、CID TrueType、已嵌入、带 Unicode 映射；Producer 为 Qt 6.8.1。这些是文件检查事实，不是字体覆盖率或跨阅读器成功保证。
- SVG：分别用标准库 `xml.etree.ElementTree` 严格解析 3/3 成功；三份均为 `viewBox="0 0 288 162"`、`width="1200px"`、`height="675px"`，CSS 物理尺寸 4 in x 2.25 in，长宽比一致。本批未报重复属性错误。
- SVG：三份均无 `<text>`、无 `<image>` 元素，各有 1 个 title 和 1 个 desc，并含中文 aria-label；R2021a/R2024b 各有 61 个 path、1 个 clipPath，R2026a 有 57 个 path、0 个 clipPath。数量及中文元数据不能证明路径字形正确、未越界或字体一致。
- R2021a 与 R2024b 的 SVG SHA256 相同，即本批两个文件字节相同；已对两者分别解析，但不据此推断运行路径或其他产物相同。
- 本次 SVG 只做结构核验，视觉查看为 0/3；结构检查成功不是中文视觉成功，未给 SVG 裁切/字体一致性假通过。

PDF 转换参数示例，另外两版本同样逐文件执行：

```bash
pdftoppm -f 1 -singlefile -r 180 -png \
  /tmp/matlab-run-33983591040/matlab-full100-R2021a/export/full100-export-artifacts/publication.pdf \
  /tmp/matlab-visual-baseline/33983591040-R2021a-publication-pdf
```

## 尚未通过的项目

1. R2026a PNG 图例需重新核对边框包围；PDF 需修复标题/纵轴不可见及版面不一致后重新导出并查看。
2. R2021a/R2024b PDF 需核对与 PNG 的字体一致性、中文可检索性以及图例右侧留白；可读中文不抵消这些问题。
3. 三份 SVG 仍需独立实际渲染才能确认中文路径、裁切和字体外观。本次只完成用户指定的结构解析，不扩大产物范围。
4. Runtime 失败仍未解除，Desktop 未执行；仅这 9 个出版产物不能替代全量验收。
