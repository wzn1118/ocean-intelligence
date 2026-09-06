# Round 21: 主报告 parse5 结构边界复核

审计基线: `2965aec1c1f84f4ea49a6d55e296ced14465c8f0`。本轮只新增此报告，不修改生产、测试、package、point 检查器或评分，不提交。未重跑第 20 轮 77 例 duplicates/entities 审计。

结论: **两个新增 DOM 抽取盲区，以及一个新依赖冷启动边界已复现**。另有三项图注抽取缺口仍存在，但从父提交的实现可见它们不是本次 parse5 接线新引入的回归，单独列出，不混报。

## 1. [P2] Declarative Shadow DOM 被当作普通惰性 template 整体丢弃

位置: [ocean-report-html-parser.mjs:5](/opt/ocean-intelligence/codex-runtime/server/ocean-report-html-parser.mjs:5)、[ocean-report-html-parser.mjs:42](/opt/ocean-intelligence/codex-runtime/server/ocean-report-html-parser.mjs:42)；消费处 [illustrated-report-contract.mjs:136](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:136)、[illustrated-report-contract.mjs:208](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:208)。

最小结构:

```html
<div><template shadowrootmode="open">
  <figure data-figure-id="unmanifested">
    <figcaption>Observed temperature during the stated UTC sample window, with explicit limits.</figcaption>
  </figure>
</template></div>
```

- **合法结构正例**: 把通过基线中的完整 `fig-1` 包进上述 open shadow 模板。浏览器文档导航后创建真实 `ShadowRoot`，其中 `figure.namespaceURI` 是 HTML，图注 `innerText` 完整，可访问性树也有相应 figure；无需报告脚本执行。完整公开入口却返回 `ok=false, figureCount=0, figureLinksOk=false`。
- **恶意负例**: 保留通过的 light-DOM 图，另追加上述未登记图。浏览器包括 shadow tree 在内有两个 HTML figure，可访问性树也显示两个；`inspectIllustratedReportEvidence` 返回 **`ok=true, figureCount=1, figureViolations=[]`**，未登记图完全不进入 correspondence 检查。
- 普通、不带 `shadowrootmode` 的 template 对照仍惰性，只有其中一张图时拒绝是正确的，不能为修复此项而把所有 template 内容计为证据。
- 底层 parse5 7.3.0 将内容保存在 `template.content`，不建立 ShadowRoot；本例没有 `onParseError`。问题不是浏览器 `document.querySelectorAll` 自动穿越 shadow，复现专门遍历了 `shadowRoot` 并读取可访问性树。

现有契约 [illustrated-report-contract.mjs:96](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:96) 要求每个分析 figure 对应 manifest，没有声明只支持 light DOM。最小处置建议: 在剪枝前识别有效 `shadowrootmode`，暂不支持时明确报 unsupported，不能静默忽略后仍给出完整报告通过；要支持时需定义 open/closed shadow 的抽取契约并做浏览器对照。普通惰性模板继续排除。

## 2. [P2] select 内的树修复规则与当前 Chromium 不一致，证据标签被静默吞掉

位置: [ocean-report-html-parser.mjs:17](/opt/ocean-intelligence/codex-runtime/server/ocean-report-html-parser.mjs:17)、[ocean-report-html-parser.mjs:20](/opt/ocean-intelligence/codex-runtime/server/ocean-report-html-parser.mjs:20)、[illustrated-report-contract.mjs:161](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:161)。

```html
<select><option><figure data-figure-id="unmanifested">
  <figcaption>Observed temperature during the stated UTC sample window, with explicit limits.</figcaption>
</figure></option></select>
```

- 浏览器 Chromium `151.0.7922.34` 保留 `option > figure > figcaption`，figure 为 HTML namespace。
- parse5 7.3.0 只留下 `select > option > #text`，figure 和 figcaption 被删除。加上完整 doctype/head/body 再直接收集 `onParseError`，结果仍是空数组；现有 `htmlParsingOk=true` 不能揭示该差异。
- **完整入口负例**: 在通过的报告后追加此未登记图，返回 **`ok=true, figureCount=1, figureViolations=[]`**，浏览器 DOM 实际有两张图。
- **对照**: 将唯一完整基线图包入 select，则 `figureCount=0, ok=false`，浏览器仍存在那张 HTML figure。这里仅证明抽取集合不同，不把传统 select 中的图宣称为合格的可见分析图，也不宣称其他浏览器均采取相同修复规则。

这是解析器/目标浏览器的树构建边界，不是已审过的重复属性顺序问题。父提交正则抽取会看到这些 figure，新接线使这些标签不再进入后续验证。最小建议: 明确报告是否支持 select 内承载证据；支持则验证对应解析器与目标浏览器一致，不支持则明确拒绝这种结构。不能仅依赖当前 parse5 AST 中已经消失的标签或 `onParseError` 来拒绝，也不建议退回正则抽取。

## 3. [P2] 冷启动必须新增依赖安装；缺包在模块导入时抛错

位置: [ocean-report-html-parser.mjs:3](/opt/ocean-intelligence/codex-runtime/server/ocean-report-html-parser.mjs:3)、[illustrated-report-contract.mjs:16](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:16)。

把未修改的 parser 文件复制到独立临时目录，用 Node 子进程静态 import 其公开 API:

| 场景 | 实测结果 |
| --- | --- |
| 没有邻接 node_modules，`NODE_PATH=''` | exit 1，`MODULE_NOT_FOUND: Cannot find module 'parse5'`，没有返回结构化 `html.parse_failed` |
| 同一份文件，`NODE_PATH=/opt/ocean-intelligence/codex-runtime/server/node_modules` | exit 0，`parseOceanReportHtml('<figure></figure>').ok === true` |

`require('parse5')` 在函数外，不受函数内 try/catch 保护。[index.mjs:11](/opt/ocean-intelligence/codex-runtime/server/index.mjs:11) 静态导入 report contract，因此由模块依赖关系可知缺包影响 sidecar 启动，不只是调用报告检查时失败。本轮没有启动真实 sidecar。

**没有发现当前完整构建路径漏装**: 锁文件固定 parse5 `7.3.0`、entities `6.0.1`；本机实际解析到 `parse5/dist/cjs/index.js`，该版本确实导出 require 入口。[Dockerfile.codex-runtime:34](/opt/ocean-intelligence/deploy/Dockerfile.codex-runtime:34) 安装到挂载目录外并设置 `NODE_PATH`；[matlab-full100.yml:58](/opt/ocean-intelligence/.github/workflows/matlab-full100.yml:58) 在 Node 合约测试前执行 `npm ci`。Docker 行号按当前工作树，HEAD 中同段从第 28 行开始。

风险限于干净本机、只同步源码到旧镜像等没有履行新安装前置条件的路径。[README.md:529](/opt/ocean-intelligence/README.md:529) 的本地启动入口仍直接执行 Node，没有 server 依赖安装步骤。建议由文档/部署所有者补齐 `npm ci --prefix codex-runtime/server --ignore-scripts --no-audit --no-fund` 和升级时重建镜像要求；不要用正则 fallback 隐藏缺包。未实际构建 Docker，不把隔离子进程对照写成容器上线验证。

## 4. 图注残余缺口: 已复现，但不计为新增回归

以下均经完整公开入口复现，`artifactsOk` 和 `manifestFreshnessOk` 保持 true。父提交原有“第一个后代 figcaption + 标签替换为空格”的逻辑也存在相同风险；不是本轮才退化。

### 4.1 后代 figcaption 先于真正所属图注被选中

位置: [ocean-report-html-parser.mjs:51](/opt/ocean-intelligence/codex-runtime/server/ocean-report-html-parser.mjs:51)、[illustrated-report-contract.mjs:168](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:168)。

在保留完整 figure 属性的前提下，用以下内容替换原图注:

```html
<div><figcaption>Observed temperature during the stated UTC sample window, with explicit limits.</figcaption></div>
<figcaption>Short.</figcaption>
```

浏览器直接子图注只有 `Short.`，可访问性树为 `figure "Short."`；提取器却取 div 中的长文本，完整 gate **ok=true**。交换长短后，浏览器有长的直接子图注，gate 却 **ok=false**，唯一 figure violation 是 `figures[0].caption`。只保留 div 中的图注时，DOM 没有直接子 figcaption，gate 仍通过。

这些 div 包裹样例是故意构造的非规范图注结构，不称为合法文档正例。它们证明当前抽取没有采用浏览器的图注归属，而不只是“能修复畸形 HTML”。建议只选归属于该 figure 的 HTML 直接子 figcaption；若要约束多个图注或位置，明确报结构错误，不借用其他后代。合法直接图注和浏览器修复后成为直接子节点的对照均已通过。

### 4.2 人为空格可将同一短图注从 22 字符膨胀到 41 字符

位置: [ocean-report-html-parser.mjs:57](/opt/ocean-intelligence/codex-runtime/server/ocean-report-html-parser.mjs:57)。

```js
const text = 'Temperature increased.';
const markup = '<figcaption>'
  + [...text].map(letter => `<span>${letter}</span>`).join('')
  + '</figcaption>';
```

普通文本和逐字符 span 的浏览器 `textContent`、`innerText` 都是 22 字符，内容完全相同；普通文本 gate 拒绝，逐字符 span gate 通过，因为提取器生成 `T e m p e r a t u r e i n c r e a s e d .`，长度 41。建议不在每个 inline text node 边界凭空插空格；保留真实空白，另明确处理 br/block 边界。不能只改门槛掩盖抽取差异。

### 4.3 iframe rawtext 与 SVG title 元数据仍可垫长图注

位置: [ocean-report-html-parser.mjs:5](/opt/ocean-intelligence/codex-runtime/server/ocean-report-html-parser.mjs:5)、[ocean-report-html-parser.mjs:54](/opt/ocean-intelligence/codex-runtime/server/ocean-report-html-parser.mjs:54)。

```html
<figcaption>Short.<iframe>Observed temperature during the stated UTC sample window, with explicit limits.</iframe></figcaption>
<figcaption>Short.<svg><title>Observed temperature during the stated UTC sample window, with explicit limits.</title></svg></figcaption>
```

分别替换基线图注，两例 gate 均通过；浏览器图注 `innerText` 均只有 `Short.`。这是读取 rawtext fallback / SVG 元数据而不是实际显示的图注文本。SVG title 可以贡献可访问名称，本轮不把它描述为“完全无语义”，也不否认辅助技术可读；但它不能证明版面上已呈现要求的完整图注。

对照中把长文本放入真实 SVG `<text x="0" y="20">`，浏览器 `innerText` 与提取均保留文本且 gate 通过。因此不能为了排除 title 就全部跳过 SVG。建议明确图注的可见文本与辅助描述边界，并按 namespace/元素语义处理。**现实现没有 CSS 可见性检查**；此次没有为 `hidden`、`display:none` 等做旧漏洞扩展审计，也不宣称修正这些结构例子就完成了视觉验收。

## 5. 未发现回归与有界支持范围

| 对照 | 结果与边界 |
| --- | --- |
| 普通完整 HTML figure | 浏览器节点、直接图注与抽取一致，完整入口通过 |
| `<svg><foreignObject>` 中的完整 HTML figure | HTML namespace 保留，完整入口通过；不能一律丢弃 foreign subtree |
| `<svg><figure>` 中的同名 SVG 元素 | 浏览器 namespace 为 SVG，提取器拒绝作为 HTML figure，正确 |
| 普通 template 中唯一 figure | 浏览器 light DOM 和抽取均无 figure，正确拒绝 |
| table 内不合法 figure 的 foster parenting | 浏览器和 parse5 都把完整 figure 移至 table 前，完整入口通过 |
| figure 内 table 中的 figcaption | 浏览器和 parse5 都将图注修复为 figure 直接子节点，完整入口通过 |
| 省略末尾 figcaption/figure/body/html 关闭标签 | 浏览器和 parse5 修复一致，完整入口通过 |
| JavaScript enabled 的 HTML noscript | 浏览器不产生有效图证据，抽取排除，正确；disabled 浏览器会产生 figure，当前 `scriptingEnabled:true` 不适用于该另一运行模式 |

另有 namespace 剪枝边界: `<svg><template><foreignObject>...HTML figure...</foreignObject></template></svg>` 中的 SVG template 不是 HTMLTemplateElement，浏览器确有 HTML 后代，公开 parser 却因仅按 tagName 剪枝而忽略它。该样例包含未知 SVG 元素，未证明它构成合法、实际呈现的报告图，因此**不升级为合法报告误拒的独立缺陷**；后续若调整剪枝，应按 namespace 加元素名判断，避免把同名 foreign 元素当作 HTML 惰性模板。

对于嵌套 figure，当前寻找图注时跳过子 figure，不能据此宣称所有图注语义已验证；相反，也不应把直接 figcaption 内合法组合内容一律删掉。对本轮已实证的直接子归属问题作最小修正即可。

## 6. 复现方法与证据范围

- 实际执行: Node `v22.14.0`，parse5 `7.3.0`，Playwright Chromium headless `151.0.7922.34`。
- 只读复用 `/tmp/report-machine-fields-round20-5aFo0m/browser-cache` 和 `/opt/ocean-intelligence/frontend/node_modules/playwright/index.mjs`；没有修改 Aristotle 的脚本、结果或环境文件。
- 20 个临时完整报告样例分别调用 `parseOceanReportHtml`、`inspectIllustratedReportEvidence` 和真实浏览器 DOM/可访问性查询；另执行了 2 个隔离模块加载正负对照。检查的是**当前行为**，包括本应拒绝却通过的负例，不是宣称这 20 个结果均正确。
- 完整入口借用现有测试的 `createReportEvidenceFixture()`，只在系统临时目录生成合成 fixture；修改主 HTML 后刷新 manifest 时间，保留原 artifact hash 对照并逐项 assert `artifactsOk=true`、`manifestFreshnessOk=true`。所有临时 fixture 已删除，未形成 MATLAB 产物或评测证据。
- 没有运行 MATLAB、没有真实报告数据正确性结论、没有桌面或完整视觉验收、没有修改现有 `4of4`/CI 状态；point 检查器仅由公开报告入口按原路径调用，未审计或修改其并行补丁。

以下为最小公开入口复现骨架，使用现有 fixture 工厂而非重造统计/运行证据。默认重现第 1 项“追加 shadow 图仍通过”；把插入片段替换为各节最小样例即可重现相应边界:

```bash
cd /opt/ocean-intelligence
PLAYWRIGHT_BROWSERS_PATH=/tmp/report-machine-fields-round20-5aFo0m/browser-cache node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { chromium } from '/opt/ocean-intelligence/frontend/node_modules/playwright/index.mjs';
import { inspectIllustratedReportEvidence as inspect, REQUIRED_MATLAB_REPORT_RELEASES,
  REQUIRED_REPORT_ZONE_NAMES } from '/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs';
const source = readFileSync('/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.test.mjs', 'utf8');
const factory = vm.runInNewContext(source.slice(source.indexOf('function createReportEvidenceFixture() {'))
  + '\ncreateReportEvidenceFixture;', { createHash, mkdtempSync, readFileSync, statSync,
    writeFileSync, path, os, REQUIRED_MATLAB_REPORT_RELEASES, REQUIRED_REPORT_ZONE_NAMES });
const fixture = factory();
let browser;
try {
  assert.equal(inspect(fixture).ok, true);
  const extra = '<div><template shadowrootmode="open"><figure data-figure-id="unmanifested">'
    + '<figcaption>Observed temperature during the stated UTC sample window, with explicit limits.</figcaption>'
    + '</figure></template></div>';
  const html = readFileSync(fixture.htmlPath, 'utf8').replace('</body>', extra + '</body>');
  writeFileSync(fixture.htmlPath, html);
  fixture.manifest.generator = 'SYNTHETIC Node/DOM reproduction; not MATLAB or visual evidence';
  fixture.manifest.generated_at = new Date().toISOString();
  writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
  const result = inspect(fixture);
  assert.equal(result.artifactsOk, true);
  assert.equal(result.manifestFreshnessOk, true);
  console.log({ ok: result.ok, figureCount: result.figureCount, violations: result.figureViolations });
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  console.log(await page.evaluate(() => ({
    lightFigures: document.querySelectorAll('figure').length,
    shadowFigures: [...document.querySelectorAll('*')]
      .reduce((total, node) => total + (node.shadowRoot?.querySelectorAll('figure').length || 0), 0),
  })));
  console.log(await page.locator('body').ariaSnapshot());
} finally {
  if (browser) await browser.close();
  rmSync(fixture.root, { recursive: true, force: true });
}
NODE
```

上述完整审计运行前后确认两份生产源码 SHA-256 未变:

```text
2d542a08266aa42c9b0670207b8281231766ba9f8b03a44c7feba04df987991a  /opt/ocean-intelligence/codex-runtime/server/ocean-report-html-parser.mjs
c2d337ebb7fbe6cea9998be2698d39c6044ae40935176eacaa26ed061e5a23a1  /opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs
```
