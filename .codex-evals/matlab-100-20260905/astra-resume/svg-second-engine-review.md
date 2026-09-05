# SVG 第二布局引擎复核

日期：2026-09-05。这是归档SVG副本的离线渲染实验，不是第15轮MATLAB执行或视觉验收。

- 在 `/tmp/matlab-svg-audit-venv` 安装 CairoSVG 2.9.0、cairocffi 1.7.1、cssselect2 0.10.1、tinycss2 1.5.1、defusedxml 0.7.1；没有修改全局或仓库依赖。使用既有 Pillow 12.3.0 和 Cairo 1.16.0。
- CairoSVG和先前librsvg是不同的SVG布局/样式引擎，但共用Cairo后端；不是两套完全独立的字体或图形栈，也不等同于Chromium或其他浏览器验证。
- 输入为原研究的四份已标注MATLAB原件及其规范化副本：R26来自33992397354，R21/R24及DISPLAY来自33990723561。四件只有三种不同输入，旧版两文件同哈希。完整来源和哈希见 `svg-viewport-review-33993011601.md`，不能按本文件日期称作新MATLAB产物。
- 每件在目标像素/96 DPI、目标像素/300 DPI、双倍像素/300 DPI下各渲染一次before/after。12次真实产物对照的RGBA及白底RGB变化像素均为0，最大通道差0；所有基线非空，最少43825个非白像素。源原件哈希复核未变。
- `:root > rect`选择器反例在997x613下改变360115像素；透明度继承反例改变349030像素、最大通道差64。后者把先前CSS语义风险补成实际渲染反例，但输入是合成控制，不是已发现真实MATLAB图变色。
- 透明度反例展示未经拒绝的DOM改写为何不等价；生产候选已拒绝CSS-wide值。这里未执行MATLAB拒绝函数，也没有将反例文件当作允许输出。
- 实际查看R26 997x613渲染副本，坐标轴、文字、折线均非空；只证明这个英文样本的可见内容，不证明CJK字形、PDF嵌入、全部图族、桌面交互或trusted visual通过。

结果：`/tmp/svg-cairosvg-audit-93lnl6qu/results.json`，SHA256 `f9332a059f617bdcbad5bf8fd6c27d57c36cef98e7dec9899d7bab30bfc20b22`。
首轮执行脚本：`/tmp/svg_second_engine_audit.py`，执行时SHA256 `88438cd437b5f036d29f61147bda64959d34ffd9d8a40d5d612d839336c2497d`；随后增加可选的实际运行目录输入，原渲染参数不变。
before/after SVG、PNG及逐次统计保留在同一临时输出目录；未改变原研究、原生产物、评分或生产依赖。

## 第十五轮实际输出

- 再以33994671384真实MATLAB输出作为after输入：R21/R24/R26的997x613及R21 DISPLAY的400x300，before仍为前述历史基准。四件12次对照全部零RGBA及白底RGB差，所有原件读取前后hash不变，没有缺失样本。
- R24额外DISPLAY含白名单外内嵌SVG字体，被生产拒绝，没有进入这四件比较，也不因此获得支持或视觉通过。
- 输出 `/tmp/svg-cairosvg-audit-toa2jnsa/results.json`，SHA256 `8f07eab9d30825fbc251d81edb6a1dc1f27ad72d5ff8fb924a135595f14d03c4`，含完整来源路径与哈希。
- 扩展脚本当前SHA256 `60698194aaab21165a8aac057c7ee52b81aebcdbd1acf0e2f1b39911d02c52d2`。这是离线复核MATLAB产物，审计本身未执行MATLAB，不能把局部零像素差扩展为全量视觉验收。
