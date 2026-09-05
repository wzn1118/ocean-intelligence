# 第九轮旧版 PDF 字体定点分析

日期：2026-09-05。只读原件，不修改生产、工作流、评分、原 PDF 或其证据；本轮唯一写入为本文。
原件根目录：`/tmp/matlab-run-33989846546/matlab-full100-<release>/`。下文 H/P/C/I 分别为 evaluator-runtime 内温度场、盐度剖面、配对比较、交互图。
方法：Poppler 22.02.0 的 `pdfinfo -box`、`pdffonts`、`pdftotext -layout`、`pdftohtml -xml -hidden -i -stdout`；Ghostscript 9.55.0 `-dPDFDEBUG -sDEVICE=nullpage` 解释真实页面及内容流。仅解析工具输出，不用 PDF 字面量搜索冒充完整解析。
已逐文件核对 12 份 evaluator PDF、33 份字体探针 PDF、9 份页面探针 PDF、3 份 display publication PDF 的 bytes/SHA256 与各自原始 JSON 一致。工具输出及四张 PDF 预览仅在内存中处理，未另写文件。

## 结论：Courier 确实承担正文，不是空资源

R2021a/R2024b 的八份 evaluator PDF 均为单页 576×360 pt，Producer 均为 `Apache FOP Version 2.4.0-SNAPSHOT: PDFDocumentGraphics2D`，manifest 记录真实 `print -dpdf -painters`。
每一页唯一字体资源为 `/F9`，指向 `/Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding`，无嵌入字体程序；`pdffonts` 的 emb/sub/uni 全为 no。所有页都有非空文本绘制，不能删除该资源或豁免嵌入失败。

| 图 | Courier 对象号 R21 / R24 | `Tf` 次数 R21 / R24 | 非空 `TJ` 次数 R21 / R24 | 实际承担内容 |
|---|---|---|---|---|
| H：crossed-time-depth-temperature | 23 0 / 28 0 | 7 / 7 | 22 / 27 | 英文标题、UTC 日期/年份、深度刻度/单位、色条刻度/温度单位 |
| P：repeat-cast-salinity-profiles | 20 0 / 20 0 | 6 / 6 | 18 / 18 | 英文标题、盐度/深度刻度及长轴标签、三个原始 UTC 剖面图例 |
| C：paired-observation-model | 16 0 / 16 0 | 6 / 6 | 16 / 16 | 英文标题、三行配对统计、双轴刻度/单位、两项图例 |
| I：paired-interactive | 23 0 / 23 0 | 4 / 4 | 18 / 18 | 00:00–20:00 刻度、日期、温度刻度、两轴单位；不含混合标题 |

这里统计的是执行内容流中的 `BT ... [(非空字符串)] TJ ... ET`，不是只数 `/Font` 声明；没有空字符串/仅位移数组、`Tj`、引号显示操作或 `Tr` 隐形文本设置。XML 文本的字体映射也全部为 Courier。未发现 Form XObject；H 的两个 `Do` 为图像，其余三图无 `Do`，不存在未追踪的 Form 字体分支。
例如 R24 配对图：Page 13 → Resources 14 → `/F9 16 0 R`；Contents 12 → stream 10；`/F9 10.0 Tf` 后实有 `[(N = 11; Bias = 0.08727 degC; MAE = 0.09273 degC)] TJ`、RMSE/r 及缺测/QC 配对统计。字体失败直接影响科学说明文字，并非只涉及默认标签。

## 中文与轮廓证据

两旧版 I 的整页 PDF 均实际查看：标题“温度时间序列 / Temperature time series”可见，但整段中英标题都不在任何 `TJ` 内。页面无图像、无 Form；顶部路径组 `8 0 0 8 2379.6 351.999969 cm` 下有 64 个 `m`、311 个 `l`、396 个 `c`，最后 `f` 填充，位置与标题吻合。
因此该混合标题以路径轮廓绘制，不是 Courier 的中文文本回退，也不是标题缺失。仅凭路径不能识别实际中文字体文件或证明所有字形正确；本次可读观察仅限上述标题，不签整页布局通过。
两旧版 WenQuanYi print-painters 探针也已逐张查看：“南海海表温度”可读，但中文不在文本流；标题路径组有 30 个 `m`、208 个 `l`、170 个 `c`、一次 `f`。Courier 的 15 次非空 `TJ` 则用于 Latin、数字、两轴标签及 `Observed 20.125` / `Model 21.50`。print-default 的操作与轮廓计数相同。
这比“pdftotext 无中文”更强，但仍不证明轮廓字体身份；前三张纯英文 evaluator 图也失败，已排除“只有中文触发 Courier”或“空字串默认字体”作为本包解释。

## 已有探针对照与边界

- 两旧版五种字体的 print-painters 均只有未嵌入 Courier；新增 WenQuanYi `print -dpdf` 默认分支也相同。单纯换 FontName、去掉 `-painters` 已无修复证据，不值得重复这两项实验。
- 同批 WenQuanYi `exportgraphics(..., 'ContentType', 'vector')` 确有嵌入 CID TrueType，中文标题和 Latin 数字可提取。Noto 原生仍为未嵌入 Times-Roman，不能把“原生导出”泛化为所有字体成功。
- 两旧版页面探针三个容器均嵌入 WenQuanYi，五段预期中英文本逐项提取一致；但 axes/panel 为 486×347 pt、tiledlayout 为 486×340 pt，均不是目标 576×360 pt。字体有证据，精确页尺寸没有闭环。
- 两旧版 `display-comparison/publication` 在 `DISPLAY=:98`、实测 DPI100 下仍只有未嵌入 Courier；R21 JVM=false、R24 JVM=true。不能仅归因于没有 DISPLAY/JVM，也不能外推到尚未检查的旧版 DPI96 运行。
- R26 evaluator 四 PDF 为 Qt 6.8.1 输出，均为嵌入 WenQuanYi，独立外检逐 PDF passed；其 manifest 和外检已只读核对。版本与后端同时不同，不能据此声称旧版或字体布局全部通过。

## 最小下一步

1. 已有反例足以保留旧版 `pdf_font_embedding=failed`。不移除实际使用的 Courier、不把路径标题算作嵌入、不用转曲/重写 PDF 或查看器代用字体掩盖失败。
2. 若下一轮补一个有新增信息的 MATLAB 探针：两旧版各取最终 `drawnow` 后的同一个真实 I 图窗，保留原 print，再向独立新文件追加一次下述原生导出；保持字体、数据、几何、字号和所有 String 不变，不重复 PNG 尺寸任务。

```matlab
assert(~isfile(probePdf));
exportgraphics(figureHandle, probePdf, 'ContentType', 'vector', 'BackgroundColor', 'white');
```

3. 记录当前 WenQuanYi 请求、release/启动参数、DISPLAY/JVM/DPI、bytes/hash；外检实际字体对象与非空文本操作，逐字核对混合标题、日期、数字/单位并整页查看。MediaBox/CropBox 只记录实值，不回填 8×5 英寸，也不改原报告或评分。
4. 这是把已有字体探针的正例验证到真实 evaluator 内容，不是已执行的修复。若仍要求旧版原生精确页合同，当前没有证据支持直接用紧裁剪 exportgraphics 替换生产 print；字体方向可用，精确页面仍是独立阻塞，需主线程另定交付范围。

## 原件身份

以下路径相对各 release 根目录；PDF 行列出 bytes/SHA256，JSON 行列出 SHA256。探针 PDF 的逐项绑定已校验，可由所列原始 JSON 追溯，未回写其 verified 标志。

| 原件 | R2021a | R2024b |
|---|---|---|
| evaluator-runtime/crossed-time-depth-temperature.pdf | 54116 / `d3d71bf890821ec7e0016543e90fb564c3e735e5dc317049aae9aad53cbbbb5c` | 54765 / `69651579bc04c58b503c29878602217050266820931c714271d26914f53db354` |
| evaluator-runtime/repeat-cast-salinity-profiles.pdf | 3481 / `01a70d2b95b99a670201fcf48d96f9e05f0f525cb463c48777cc90ffa66517c3` | 3445 / `2aef8fa88539766554c313922b01cd0ca5adeb1c091f5d7f8a3cafe9a836cf6e` |
| evaluator-runtime/paired-observation-model.pdf | 3639 / `b1ec0a1b9d3dad41046aaa07c46cd5e7f771b96f6c6656dc678cb2edf55be42f` | 3615 / `ecd7bd0ca9ab52b498ba75a8804c007e1977c417d74895dfbc745d43135b91cb` |
| evaluator-runtime/paired-interactive.pdf | 14253 / `a5b11a63897d46bee4c8b699ea5e2fc1e4b4e59312a245fd993db647e4f21d38` | 14253 / `04399e0e4e88d4fec900ee5412c93b9caefac53941011601dea21f2b4c41d99b` |
| evaluator-runtime/figures.json | `dfca3f3d54d22b4ef849d1a494df7d5d4e7392ffc9afd2e30d562ca5b8bcc19a` | `11a045b47d1bd13d42cd0be13dc132c0730da318b340d2f32f7ebcb6b044162b` |
| font-export-probe/font-export-probe.json | `568e209b13102e69828bbcd04cf0d72df900b50a1f34c8e34431b6ceb6acdecb` | `51cd3a200ca76ce8db8c371354e45854d5e34ee8c82fa6a48158bfa25806b135` |
| display-comparison/native-pdf-page-probe/native-pdf-page-probe.json | `4e564a819f65dcb3139f857fc18dbc93625b503ec346b06af5204116f9e745e5` | `f08d13038c51fa268d5359002ad32e2ea93501905ce73b63d05c05111bd5c34c` |
| display-comparison/display-rendering.json | `f87f9131d74975ad50a82d5f945b7f5c3c08d16151109b90ce67fd1c7b7b0108` | `b6dcc6276fc201dddff6bd3195a027d6e6e8f8acc80ce90cadf03e615b54d608` |
| display-comparison/publication/figures.json | `ab78e94c82fc73913a5db213be8e39420ed5ea67d8d91f754d215c658da575fc` | `3854d57f92eb508bdbcaaaec109791a3dc8d5ddda6b421e1b519e99e74fe6d4c` |

R26 对照：`evaluator-runtime/figures.json` SHA256=`2804adffdc0ed7ea5f1de495a268bae81cb41097a85387916e4f5c723af25ea7`；`rendered-artifact-evidence.json` SHA256=`38709e96064eca50efa7de6dfb89209825892d10f7849eef4b233dccd7172edc`。
复核命令：`gs -q -dSAFER -dBATCH -dNOPAUSE -dPDFDEBUG -sDEVICE=nullpage "$PDF"`；`pdffonts "$PDF"`；`pdftohtml -xml -hidden -i -stdout "$PDF"`；`pdftotext -layout "$PDF" -`；`pdfinfo -box "$PDF"`。
未验证：本机无 MATLAB，未新跑探针、未验证内部 FOP 字体映射根因、未签独立桌面/全图字形/布局通过。实际查看仅两旧版 I 与两份 WenQuanYi print-painters 探针；不扩展至真实海况、评分或第十轮 PNG 修复。
