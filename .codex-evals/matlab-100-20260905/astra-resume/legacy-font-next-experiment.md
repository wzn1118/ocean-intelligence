# 第十二轮：旧版 print 字体映射的下一项实验

## 结论

目前没有查到可从 MATLAB 公开 API 直接配置 `print -dpdf` 的 FOP FontInfo/font map 的可靠入口，不能给出已获依据的原生 PDF 修复调用。不是断言内部入口绝不存在，而是本机没有 MATLAB 安装树，已有 CI 也未保存对应打印实现或配置消费证据；不猜测隐藏函数、配置路径、环境变量或 Java 注入方法。
仅建议一项小规模原生实验：R2024b 对已有 WenQuanYi 字体诊断图额外导出一次 `print -depsc -painters`，检查 EPS 与现有 PDF 的实际字体使用差异。此项用于定位驱动边界，不是 PDF 修复，不转换 EPS，不替换原件或放宽门禁。

## 本地证据

- [生产分支](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_export_figure.m:576) 设置页面属性后直接调用 `print(..., "-dpdf", "-painters")`，没有额外字体映射参数；[现有探针](/opt/ocean-intelligence/codex-runtime/matlab/tests/diagnose_font_exports.m:134) 已覆盖五字体、默认 print/painters、exportgraphics，但没有 EPS 对照。
- 只读复核 `/tmp/matlab-run-33991563211/matlab-full100-<release>/font-export-probe/` 的 R21/R24 共 22 份 PDF：bytes/SHA256 均与 JSON 一致。两版各六份 print PDF 仍只有未嵌入 Courier；WenQuanYi exportgraphics 则为嵌入 CID TrueType。未重新执行这些已排除的方案。
- 两份 `font-export-probe.json` 原件 SHA256：R2021a=`5bd18b3c232f55297825c943bd2a2cc739f9f41eba8cee9d04699073ad1730c7`；R2024b=`8780666c0fab07aa7c51f9b6d988ca7c06853c6df1a39e8600b6b65773b6bcb6`。
- 第九轮已逐内容流证明 `/F9` 的 Courier 绘制非空刻度、图例及统计，混合中文标题为路径轮廓；不再测试普通换字体、默认/renderer、Xvfb，也不把无使用证明当作成功。[已存分析](/opt/ocean-intelligence/.codex-evals/matlab-100-20260905/astra-resume/legacy-font-analysis-33989846546.md:8)

## 根因线索与 API 边界

1. Apache 官方 FOP 2.4 的 `FontSetup` 明确把 `F9` 注册为 Courier，并关联 `monospace` / `Monospaced` / Courier；默认 `any` 却关联 Times。因此“没装字体就一律回退 Courier”不是有根据的解释。原件 F9 与该注册表吻合，但不能据此断言 MATLAB 在哪一步选了该 family。[FontSetup 源码](https://github.com/apache/xmlgraphics-fop/blob/fop-2_4/fop-core/src/main/java/org/apache/fop/fonts/FontSetup.java#L85)；[官方字体说明](https://xmlgraphics.apache.org/fop/2.4/fonts.html)
2. FOP 的 `PDFGraphics2D.drawString` 通常通过 AWT Font 的 name/family/style/weight 查找 FontInfo，也存在覆盖字体状态分支；这给出了应检查的调用边界，不证明本批实际走了哪一分支。原件 Producer 为 `2.4.0-SNAPSHOT`，不能把上游 2.4 标签源码冒充 MATLAB 随附二进制。[drawString](https://github.com/apache/xmlgraphics-fop/blob/fop-2_4/fop-core/src/main/java/org/apache/fop/svg/PDFGraphics2D.java#L1246)；[AWT 字体查找](https://github.com/apache/xmlgraphics-fop/blob/fop-2_4/fop-core/src/main/java/org/apache/fop/fonts/FontInfo.java#L336)
3. 上游确有 `PDFDocumentGraphics2D.setFontInfo` 和 `PDFDocumentGraphics2DConfigurator.configure`，但必须拿到正在输出该 PDF 的 graphics 实例，并显式配置它。没有证据显示 MATLAB `print` 暴露这个实例或读取任意用户 `fop.xconf`；另建一个 FOP 实例不是修改 MATLAB 原生 print。[FontInfo setter](https://github.com/apache/xmlgraphics-fop/blob/fop-2_4/fop-core/src/main/java/org/apache/fop/svg/PDFDocumentGraphics2D.java#L189)；[Configurator](https://github.com/apache/xmlgraphics-fop/blob/fop-2_4/fop-core/src/main/java/org/apache/fop/svg/PDFDocumentGraphics2DConfigurator.java#L55)
4. Apache 的 `<auto-detect>`、`embed-url` 和 substitutions 是 FOP 配置功能，不自动构成 MATLAB 参数。未经“该 print 进程实际读取该配置”的证据，不建议写全局配置、改 jar/classpath 或依赖字体缓存改动。[FOP 配置边界](https://xmlgraphics.apache.org/fop/2.4/fonts.html)
5. `printopt` 的官方用途是默认打印命令、打印机设备/目标，不是 PDF 字体映射；R2025a 已删除。`psfontmap` 的尝试文档地址返回 404，本地也无可检查实现，这不证明函数在旧版一定不存在，更不能编造其调用签名。[printopt 官方说明](https://ww2.mathworks.cn/help/matlab/ref/printopt.html)

## 唯一建议：EPS 驱动分界诊断

官方 R2021a/R2024b `print` 文档均明确列出 `-depsc` 为彩色 EPS Level 3，区别于整页 PDF 的 `-dpdf`；这是实际 API 依据，不是假设的 font-map 开关。仅测试旧版，先 R24 一份；内部是否真的经过不同字体适配器，仍须由产物判定。[R2021a print](https://ww2.mathworks.cn/help/releases/R2021a/matlab/ref/print.html)；[R2024b print](https://ww2.mathworks.cn/help/releases/R2024b/matlab/ref/print.html)

在现有 WenQuanYi probe 的同一 finalized 图窗关闭前加一份诊断产物即可，沿用原图中文字、Latin 数字、字体、解释器、字号、几何与已完成的 drawnow；不另建庞大 probe，不新增 PDF 基线矩阵：

```matlab
assert(~isfile(probeEps));
print(figureHandle, char(probeEps), '-depsc', '-painters');
```

- 记录 release、`which('print')`、真实调用、文件 bytes/hash；EPS 路径必须是独立新文件，现有 PDF 及 JSON 不覆盖。此调用只变输出设备，不进行 renderer 对照。
- 原样检查 EPS 的非空文本显示操作及其字体选择/定义链；`%%DocumentNeededResources`、FontName 或字体清单本身不算使用/嵌入证明。区分 `findfont` 等字体调用、字体程序定义和填充字形轮廓，不转换成 PDF 验收。
- 若 EPS 真实文本仍由 Courier 绘制：支持替换发生在两个输出路径的共同环节，或两驱动各有相同替换；尚不能唯一归因，不扩矩阵。若 EPS 保留请求字体而 PDF 是 Courier：优先向 MathWorks 提交 PDF 驱动字体配置/适配器差异证据，仍不能用 EPS 成功代签 PDF。
- 若 EPS 全部文字变路径、没有可追踪文本，结论是映射分界未查明，不是字体通过；导出报错也原样保留。即使 EPS 嵌入成功，也不证明同一配置可到达 `-dpdf`。
- 如主线程只接受能直接产出合规 PDF 的候选，而不需要进一步诊断，建议本轮不增加实验：目前没有这样的已证实候选。旧版完整 PDF 字体/页面合同继续失败，不用已知紧裁剪 exportgraphics 正例冒充闭环。

## 本轮验证范围

只新增本文，未改生产、工作流、评分或任何原产物；未执行 MATLAB、未创建新 EPS/PDF、未做 PDF 后处理或提交。浏览工具连续 502、MathWorks 英文主站 403；已通过官方中文站直连读到两版归档 print 文档及 printopt，并读取 Apache 官方文档/仓库源码。所有外部推论均保留与 MATLAB 实际实现之间的边界。
