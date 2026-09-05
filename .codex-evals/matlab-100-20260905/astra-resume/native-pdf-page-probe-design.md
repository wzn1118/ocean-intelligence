# Native PDF 精确页面探针设计

日期：2026-09-05。目标：R2021a/R2024b；R2026a 可运行相同候选作为对照。本机无 MATLAB，尚无本探针的真实导出结果。

## 官方边界

- [R2021a exportgraphics](https://ww2.mathworks.cn/help/releases/R2021a/matlab/ref/exportgraphics.html) 明确按内容紧密裁剪，接受 axes、tiledlayout、Panel 等对象。接受容器不等于保留容器全部空白或输出整页。
- [现行 exportgraphics 的版本历史](https://ww2.mathworks.cn/help/matlab/ref/exportgraphics.html) 将本地 `Width/Height/Padding/Units/PreserveAspectRatio` 支持标为 R2025a 起；R2024a 的提前支持仅限 MATLAB Online。旧版 CI 不传这些参数。
- [Axes 属性](https://ww2.mathworks.cn/help/matlab/ref/matlab.graphics.axis.axes-properties.html) 的 `OuterPosition` 包含标签和边距；`PositionConstraint="outerposition"` 固定布局外框。它们不是 PDF 页面合同，`TightInset` 只读，不使用未公开的 `LooseInset`。
- [R2021a TiledChartLayout 属性](https://ww2.mathworks.cn/help/releases/R2021a/matlab/ref/matlab.graphics.layout.tiledchartlayout-properties.html) 已公开 `Units/OuterPosition/PositionConstraint`。[现行属性文档](https://ww2.mathworks.cn/help/matlab/ref/matlab.graphics.layout.tiledchartlayout-properties.html) 的版本历史说明 R2021a 起 `Padding/TileSpacing` 的 `normal` 更名为 `loose`；旧中文归档注明翻译过时，仍显示旧名称。布局 Padding 不等于 R2025a 的导出 Padding。
- [Panel 属性](https://ww2.mathworks.cn/help/matlab/ref/matlab.ui.container.panel.html) 公开英寸 Position 和 `BorderType="none"`。探针只含一个真实 axes，不添加 UI 控件或相邻子容器。

结论：这些官方设置没有承诺旧版 native PDF 同时满足整页 8×5in 与嵌入字体。目前没有文档支持或实跑证实的完整解法。下面是三个有限的布局/裁剪实验，不是可直接合入生产的修复。

## 三个候选

共同条件：绘图前固定 figure 为 8×5in，同时设置 8×5in PaperSize 和手动 PaperPosition；后者不被当作 exportgraphics 的尺寸控制。WenQuanYi Zen Hei 经现有 helper 精确确认可用才运行，否则明确 skip。使用相同两条合成曲线、Latin 数字/图例、中文标题“南海海表温度”和旋转纵轴“温度 (degC)”，字体常规字重，图例在 axes 内。

| ID / PDF 文件名 | 公开设置与导出对象 | 仅待检验的假设 |
| --- | --- | --- |
| `axes-outerposition.pdf` | axes `Units="inches"`, `OuterPosition=[0 0 8 5]`, `PositionConstraint="outerposition"` | 固定外框的真实标签边距是否被保留 |
| `tiledlayout-loose.pdf` | 1×1 layout，同样的英寸外框，`Padding="loose"`, `TileSpacing="loose"`；导出 layout | 布局分配的真实留白是否影响原生裁剪 |
| `panel-fullpage.pdf` | panel `Position=[0 0 8 5]`, `BorderType="none"`，内部 axes 与第一候选同配置；导出 panel | 无边框容器的物理范围是否被保留 |

每个候选独立新建/清理图窗，只调用一次 `exportgraphics(target, path, "ContentType", "vector", "BackgroundColor", "white")`。不使用 print 回退、隐藏/透明撑边图元、假坐标、额外数据、PDF pagebox 改写、事后重绘或任何 PDF 转换。

## 执行与证据

入口：[test_native_pdf_page_probe.m](/opt/ocean-intelligence/codex-runtime/matlab/tests/test_native_pdf_page_probe.m:1)。由主线程挂 CI，使用新的、不存在的输出目录；不传参数则使用新的临时目录并打印路径。

```matlab
addpath('codex-runtime/matlab/tests');
report = test_native_pdf_page_probe(fullfile(outputRoot, 'native-pdf-page-probe'));
```

`native-pdf-page-probe.json` 逐候选保存 release、p-code 检测/which、字体可用性、真实调用 API/格式与参数、实际图窗/容器/axes 几何属性、文件 bytes/SHA-256、错误或 skip 原因。仅导出调用、非空 PDF 文件头和哈希参与执行断言；尺寸不符不触发尺寸门禁，也不把文件导出成功升级为出版通过。

PDF 只读扫描字面量 `/MediaBox`、`/CropBox`，原样记录 `media_box_literals`、`crop_box_literals`。这不是完整 PDF 解析器：不解析对象流、间接引用、继承、页对象关联、Rotate 或 UserUnit；找不到字面量时留空并要求外检，绝不回填目标值。所有 `exact_page_verified/font_embedding_verified/cjk_visual_verified/text_extraction_verified/layout_verified` 始终为 false，图形 FontName 也不是输出字体身份。

外检须绑定 JSON 的 SHA-256，对三个版本各自的原始 PDF 运行：

```bash
pdfinfo -box "$PDF"
pdffonts "$PDF"
pdftotext -layout "$PDF" -
pdftoppm -png -r 150 -singlefile "$PDF" "$PREVIEW_PREFIX"
sha256sum -- "$PDF"
```

核对单页实际 MediaBox/CropBox 与 576×360pt、字体是否真实嵌入，以及中文/数字提取和真实渲染是否正确、是否裁切。字体清单与视觉/提取分别判断；预览输出不改写 PDF。即使某个候选碰巧为 576×360pt，也只对该产物记录观察，不能推出任意内容的精确页面保证；若全不满足，保留失败证据和旧版生产 print 合同，不扩展候选或放松标准。

## 本地验证

已通过 `mh_lint --matlab 2021a --ignore-config --brief`、MATLAB 源码 ASCII 检查及两份新增文件的空白检查。没有 MATLAB 执行或页面/字体通过结论。生产 exporter、runner/freeze 和评分均未修改，未提交或推送。
