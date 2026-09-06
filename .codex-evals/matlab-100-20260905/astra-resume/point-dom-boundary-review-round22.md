# R22: point/tooltip/script 消费边界只读审计

基线: `587c382a7155c265abb82137b6e5ce47717b8de0`，2026-09-06。只新增本报告，不修改生产、测试、package、已有报告或原始产物，不提交。

## 结论与范围

已通过公开 `inspectPointInteractionQuality` 入口和隔离 Chromium 页面复现五组问题，按修复优先级列于下文。共 17 个定向样例，包含正常与拒绝对照，不是 17 项通过验收。所有样例均启用 `requireScientificEvidence: true`、`requireMatlabEvidence: true`，`evidenceMarkupOk` 均为 true；这里的 MATLAB 声明来自现有 synthetic fixture，绝非真实 MATLAB 证据。

R21 的顶层 parse5 guard 没有被绕过或撤销。剩余分叉在 [point-interaction-quality.mjs:98](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:98): 只有顶层声明消费 DOM，point/data/tooltip/script 仍重新扫描 HTML 原文。因此本轮不重审 Shadow DOM、select、主报告 caption、时间和变量目录，也不建议禁止普通 template 来掩盖 point 抽取错误。

实测环境: Node `v22.14.0`、parse5 `7.3.0`、Playwright Chromium headless `151.0.7922.34`。浏览器取证限于实际 DOM、JSON `textContent`、事件注册对象与一次程序派发的事件回调，不包含真实鼠标命中、Tab 导航、CSS 可见性或完整提示字段验收。现有 fixture 的 `<g>` 是空节点、`showTooltip` 是空函数；文中“实际点”均指确实存在的点标记 DOM 节点，不声称已画出真实观测或视觉合格。

## 1. [P1] 原文中的惰性点、tooltip、数据与脚本可整体冒充实际证据

位置: [point-interaction-quality.mjs:228](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:228)、[point-interaction-quality.mjs:247](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:247)、[point-interaction-quality.mjs:379](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:379)、[point-interaction-quality.mjs:547](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:547)。

在现有通过 fixture 中保留真实 body 的科学/运行声明，把 body 内容原样包在一个**普通** `<template>` 中，不使用 shadowrootmode。预期 point-count、tooltip、实际绑定不能通过；当前 `pointInteractionQualityOk=true`、`renderedPointCount=2`、`dataPointCount=2`、`violations=[]`。浏览器 document 实际有 0 个点节点、0 个 tooltip、0 个候选 JSON 脚本、0 个点事件注册。节点存在于惰性 template content 不能建立页面点交互证据。

同根因的最小正反对照:

| 样例名 | 单一变化 | 应有结果 | 当前公开入口 / 浏览器结果 |
| --- | --- | --- | --- |
| `textarea-points` | 仅把原 SVG 包进 textarea | 拒绝无实际点 | 总体 true、计 2 点；DOM 0 点、0 点事件注册 |
| `quoted-gt-real-point` | 第一个 g 的 class 前增加 `data-note="a > b"` | 保持静态基线通过 | 总体 false、计 1 点；DOM 仍为 2 点、4 次点事件注册 |
| `tooltip-attribute-text` | `role="tooltip"` 改为 `data-note='role="tooltip"'` | 拒绝缺失 tooltip | 总体 true、tooltipFieldsOk=true；DOM 无 role=tooltip |
| `tooltip-unquoted` | 改为合法 `role=tooltip` | 保持静态基线通过 | 总体 false、`tooltip-missing`；DOM 有 1 个 tooltip |

`quoted-gt-real-point` 的实际 violations 是 `point-count-mismatch` 和 `rendered-point-index-coverage`，不是字体、CSS 或运行时异常。point 正则的 `[^>]*` 将合法引号内 `>` 当成标签边界。tooltip 正则则既扫描其他属性的值，也不接受合法无引号值。

最小修复方向: 复用同一份 parse5 document，在真实节点集合上抽取 point 和 tooltip；点标记按真实属性存在性或 class token 匹配。排除惰性 template 内容、rawtext/RCDATA 中的伪标签，按 namespace 保留真实 SVG 点与 HTML foreignObject 后代，不用“只允许 HTML namespace”删掉 SVG。脚本在这一遍遍历中另行收集原始文本，不能把其字符串当作 point 后代。

## 2. [P1] 任意第一个 JSON 模型可遮蔽回调实际读取的错误模型

位置: [point-interaction-quality.mjs:250](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:250)、[point-interaction-quality.mjs:256](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:256)、[point-interaction-quality.mjs:328](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:328)。

当前遇到第一个能 normalize 的 application/json 就返回，不绑定图、点集合或实际脚本使用的数据源。复现明确让浏览器回调读取 `document.getElementById('temperature-data').textContent`，其中第一条 ID 是 `WRONG`，DOM 点仍为 `P1`:

1. `wrong-model-control`: 只有这一个错误模型，当前总体 false，实际 violation 为 `rendered-observation-id-mismatch`，符合预期。
2. `first-model-decoy`: 仅在前面插入另一个 id 为 `unrelated`、记录为 `P1/P2` 的 JSON 脚本。当前总体变成 true、readerModelIds 为 `P1/P2`、violations 为空。
3. 浏览器仍选择 `temperature-data` 的 `WRONG/P2`，真实 DOM 点是 `P1/P2`。程序派发首点 pointerenter 后，实际 tooltip 的 `textContent` 是 `WRONG`，不是 P1。脚本无 pageerror。

这不是假定任意 JSON 都必须叫 temperature-data，也不是把多 JSON 文档一律判错；反例明确给出了回调使用哪一个模型，并保持它在插入前后不变。另一个 JSON 的存在不应修复原本确实不一致的绑定。

最小修复方向: 先用 DOM 定位候选，再为图/点集合建立明确且唯一的模型引用；没有引用的旧包可保留“唯一候选”路径，多个可用候选不得静默按先后挑选。新增引用名称需同步契约和 producer，本轮不指定现有包必须有新 id。静态声明绑定仍不能证明任意 JS 真正读取了同一对象，运行时选择/tooltip 核对须单独取证，不应仅改 DOM 后就宣称此项完整解决。

## 3. [P2] point 属性的手写实体解码使身份比较双向失真

位置: [point-interaction-quality.mjs:240](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:240)、[point-interaction-quality.mjs:346](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:346)、[point-interaction-quality.mjs:668](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:668)。

数据 JSON 脚本内容是 rawtext，`P&#49;` 在 JSON 字符串中就是这六个字符；HTML 属性中同样的源码则被浏览器解码成 `P1`。当前手写 decoder 没处理一般数字实体，出现以下公开入口实测:

| 样例名 | HTML data-observation-id 源码 | JSON id 原文 | DOM id | 预期 / 当前总体 |
| --- | --- | --- | --- | --- |
| `numeric-id-equivalent` | `P&#49;` | `P1` | `P1` | true / false，`rendered-observation-id-mismatch` |
| `numeric-id-conflict` | `P&#49;` | `P&#49;` | `P1` | false / true，violations=[] |
| `named-amp-equivalent` | `A&amp;B` | `A&B` | `A&B` | true / true，对照 |
| `double-encoded-equivalent` | `P&amp;#49;` | `P&#49;` | `P&#49;` | true / true，对照 |

最小修复方向: 比较 parse5 已按 HTML 规则解码一次的属性值与 `JSON.parse(script 原始文本)` 的结果；不再给 DOM 属性二次解码，尤其不能给 JSON 字符串补 HTML 解码来“修好”第一行，因为那会把第二行的真实冲突也抹掉。保留 ID 精确性和现有索引覆盖/唯一性断言，不扩大规范化范围。

## 4. [P2] 全文删 HTML 注释会改写合法 JSON 字符串

位置: [point-interaction-quality.mjs:248](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:248)、[point-interaction-quality.mjs:254](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:254)、[point-interaction-quality.mjs:619](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:619)。

给 JSON 第一条 ID 写入合法字符串 `P<!--ignored-->1`，浏览器 `JSON.parse(script.textContent)` 保留原值。消费者先全文 `stripHtmlComments`，却将模型 ID 改成 `P 1`。

| 样例名 | DOM 真实 id | 浏览器模型真实 id | reader 模型 id | 预期 / 当前总体 |
| --- | --- | --- | --- | --- |
| `json-comment-conflict` | `P 1` | `P<!--ignored-->1` | `P 1` | false / true，violations=[] |
| `json-comment-equivalent` | `P<!--ignored-->1` | `P<!--ignored-->1` | `P 1` | true / false，`rendered-observation-id-mismatch` |

第二行 HTML 属性用 `P&lt;!--ignored--&gt;1` 编码，避免把标签字符本身混成另一个因素。JSON 里的内容不是 DOM Comment 节点，不能按 HTML 注释删除。最小修复是直接取真实 JSON script 的文本节点内容后 JSON.parse，跳过真实注释节点即可；不再对脚本原始文本做全文 HTML 注释预处理。该条与第三条各自有独立反例，不是泛称“正则不可靠”。

## 5. [P2] “脚本存在”和同名变量被误当作实际点集合绑定

位置: [point-interaction-quality.mjs:547](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:547)、[point-interaction-quality.mjs:558](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:558)、[point-interaction-quality.mjs:564](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:564)。

三个定向负例均保留 2 个实际 DOM 点，当前 `pointInteractionOk=true`、总体 true、violations=[]，但浏览器点事件注册均为 0:

| 样例名 | 变化 | 浏览器事实 / 根因 |
| --- | --- | --- |
| `inert-handler-type` | 唯一处理器 script 改为 `type="text/plain"` | 惰性数据块不执行；消费者将所有非 application/json script 当作可执行 |
| `empty-selector` | 选择器改成 `#missing .temperature-point` | 实际选中空集合；消费者只寻找选择器含 `.temperature-point` |
| `wrong-receiver` | forEach 空体，随后在外层把同名 point 设为 document.body 并注册两个事件 | 浏览器有 2 次 body 注册、0 次点注册；消费者在整个脚本寻找同名变量，不检查词法绑定 |

最小 wrong-receiver 源码:

```js
document.querySelectorAll('.temperature-point').forEach((point) => {});
const point = document.body;
point.addEventListener('pointerenter', showTooltip);
point.addEventListener('focus', showTooltip);
function showTooltip() {}
```

处理建议分层而不是宣称一次 DOM 迁移解决交互执行:

- DOM 层先排除 template 内及非支持可执行类型的脚本，保持 module/经典脚本等支持范围明确。
- 若静态 contract 继续认证特定绑定模式，用成熟 JS parser 检查回调词法作用域与 receiver，再对可解析的选择器核对实际点集合覆盖。仅把文本 token 对比写复杂仍会留下同名变量问题；动态选择器/复杂控制流应明确未验证或不支持，不能自动通过。
- 空函数基线本身已说明：合法注册不等于提示内容正确。完整交互要求还需独立浏览器运行，逐点 hover/focus 及字段/模型核对，不应把静态 `pointInteractionOk` 重命名成视觉或桌面成功。本轮只记录注册和一个程序派发事件，没有把它们冒充该运行验收。

## 最小可覆盖的迁移顺序

1. 在当前公开入口只解析一次 document，保留 R21 duplicate/shadow/select guard 与所有现有科学/运行声明检查；point、tooltip、JSON script、候选 executable script 都从这同一文档导出。保留真实 SVG 点，普通 template 仍被允许但不能贡献活动证据。
2. DOM 属性只解码一次，JSON 原文不做 HTML 注释删除或实体解码。先将本报告的普通点、引号内 `>`、无引号 tooltip、数字实体双向对照、JSON 注释双向对照加入公开入口回归。
3. 给模型选择建立独立且明确的静态绑定规则，保留旧单模型包；多候选歧义不能因前置一个可用 JSON 而通过。用 `wrong-model-control` / `first-model-decoy` 验证插入无关模型不会提升结果。
4. 对脚本 MIME/活动上下文作 DOM 过滤，再单独决定受支持 JS 绑定模式与运行证据边界。保留 wrong-receiver/empty-selector 负例，不能通过删除原契约要求或只检查 handler 字样收敛。

本轮没有完整审计所有 legend/resource/CSS/JS 语法，不能据此保证迁移后已无其他边界。主报告在 [illustrated-report-contract.mjs:258](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:258) 使用同一公开 point 入口，并在 [illustrated-report-contract.mjs:277](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:277) 消费其总体布尔值，说明风险可传递到交互子项；本轮没有修改/重签报告 artifact 去证明整个主报告最终 gate 的结果。

## 可执行复现

以下命令只读取当前测试的 fixture 工厂与公开生产入口，17 个样例只存在内存和独立 data: 页面。VM 只用于取出测试 fixture 工厂，不调用生产私有函数。第三列布尔断言是**本轮实测现行为**，修复后其中的反例应改变，不是安全通过断言。`CASES` 可指定逗号分隔的样例名，只运行所需最小案例；例如 `CASES=template-all` 或 `CASES=wrong-model-control,first-model-decoy`。

命令使用已有 Playwright 与 Chromium 缓存，无安装、下载、源码改写或 raw artifact 文件写入；浏览器退出时关闭临时 profile。

```bash
PLAYWRIGHT_BROWSERS_PATH=/tmp/report-machine-fields-round20-5aFo0m/browser-cache node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { chromium } from '/opt/ocean-intelligence/frontend/node_modules/playwright/index.mjs';
import { inspectPointInteractionQuality as inspect } from '/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs';
const source = readFileSync('/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.test.mjs', 'utf8');
const fixture = vm.runInNewContext(
  source.slice(source.indexOf('function validHtml('), source.indexOf("test('accepts complete")) + '\n'
  + source.slice(source.indexOf('function scientificHtml('), source.indexOf("test('strict mode"))
  + '\n({ validHtml, validPoints, scientificHtml });');
const baseline = fixture.scientificHtml();
const bodyStart = baseline.match(/<body[^>]*>/u)[0];
const build = points => fixture.validHtml({ points }).replace('<body>', bodyStart);
const svg = baseline.match(/<svg>[\s\S]*?<\/svg>/u)[0];
const makePoints = firstId => { const points = fixture.validPoints(); points[0].id = firstId; return points; };
const dataTag = baseline.match(/<script type="application\/json"[\s\S]*?<\/script>/u)[0];
const script = baseline.match(/<script>[\s\S]*?<\/script>/u)[0];
const boundDataScript = script.replace('function showTooltip() {}', `
const selectedModel = JSON.parse(document.getElementById('temperature-data').textContent);
window.selectedModelIds = selectedModel.points.map(point => point.id);
function showTooltip(event) {
  document.querySelector('[role="tooltip"]').textContent = selectedModel.points[Number(event.currentTarget.dataset.pointIndex)].id;
}`);
const decoy = dataTag.replace('id="temperature-data"', 'id="unrelated"');
const conflictingData = dataTag.replace('"id":"P1"', '"id":"WRONG"');
const commentModel = baseline.replace('"id":"P1"', '"id":"P<!--ignored-->1"');
const cases = [
  ['baseline', baseline, true],
  ['template-all', baseline.replace(bodyStart, bodyStart + '<template>').replace('</body>', '</template></body>'), true],
  ['textarea-points', baseline.replace(svg, '<textarea>' + svg + '</textarea>'), true],
  ['quoted-gt-real-point', baseline.replace('<g class=', '<g data-note="a > b" class='), false],
  ['numeric-id-equivalent', baseline.replace('data-observation-id="P1"', 'data-observation-id="P&#49;"'), false],
  ['numeric-id-conflict', build(makePoints('P&#49;')), true],
  ['named-amp-equivalent', build(makePoints('A&B')).replace('data-observation-id="A&B"', 'data-observation-id="A&amp;B"'), true],
  ['double-encoded-equivalent', build(makePoints('P&#49;')).replace('data-observation-id="P&#49;"', 'data-observation-id="P&amp;#49;"'), true],
  ['tooltip-unquoted', baseline.replace('role="tooltip"', 'role=tooltip'), false],
  ['tooltip-attribute-text', baseline.replace('role="tooltip"', `data-note='role="tooltip"'`), true],
  ['inert-handler-type', baseline.replace('<script>', '<script type="text/plain">'), true],
  ['empty-selector', baseline.replace("querySelectorAll('.temperature-point')", "querySelectorAll('#missing .temperature-point')"), true],
  ['wrong-receiver', baseline.replace(script, `<script>document.querySelectorAll('.temperature-point').forEach((point) => {});
const point = document.body;
point.addEventListener('pointerenter', showTooltip);
point.addEventListener('focus', showTooltip);
function showTooltip() {}</script>`), true],
  ['wrong-model-control', baseline.replace(dataTag, conflictingData).replace(script, boundDataScript), false],
  ['first-model-decoy', baseline.replace(dataTag, decoy + conflictingData).replace(script, boundDataScript), true],
  ['json-comment-conflict', commentModel.replace('data-observation-id="P1"', 'data-observation-id="P 1"'), true],
  ['json-comment-equivalent', commentModel.replace('data-observation-id="P1"', 'data-observation-id="P&lt;!--ignored--&gt;1"'), false],
];
const selected = process.env.CASES ? new Set(process.env.CASES.split(',')) : null;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
console.log(JSON.stringify({ node: process.version, chromium: browser.version(), scope: 'SYNTHETIC DOM and callback probe, not MATLAB/visual/desktop evidence' }));
try {
  for (const [name, html, expectedCurrent] of cases) {
    if (selected && !selected.has(name)) continue;
    const result = inspect({ html, requireScientificEvidence: true, requireMatlabEvidence: true });
    assert.equal(result.pointInteractionQualityOk, expectedCurrent, name + JSON.stringify(result.violations));
    assert.equal(result.evidenceMarkupOk, true, name);
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.auditListeners = [];
      const original = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, callback, options) {
        if (['pointerenter', 'focus'].includes(type)) window.auditListeners.push({ target: this, type });
        return original.call(this, type, callback, options);
      };
    });
    await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const dom = await page.evaluate(() => {
      const points = [...document.querySelectorAll('.temperature-point')];
      const tooltip = document.querySelector('[role="tooltip"]');
      if (points.length) points[0].dispatchEvent(new Event('pointerenter'));
      return {
        points: points.length,
        ids: points.map(point => point.getAttribute('data-observation-id')),
        tooltips: document.querySelectorAll('[role="tooltip"]').length,
        modelScripts: document.querySelectorAll('script[type="application/json"]').length,
        modelIds: [...document.querySelectorAll('script[type="application/json"]')]
          .map(script => JSON.parse(script.textContent).points.map(point => point.id)),
        selectedModelIds: window.selectedModelIds,
        pointListeners: window.auditListeners.filter(entry => points.includes(entry.target)).length,
        otherListeners: window.auditListeners.filter(entry => !points.includes(entry.target)).length,
        tooltipTextAfterSyntheticPointer: tooltip?.textContent,
      };
    });
    assert.deepEqual(errors, [], name);
    console.log(JSON.stringify({ name, overall: result.pointInteractionQualityOk,
      counted: result.renderedPointCount, modelCounted: result.dataPointCount,
      identity: result.stablePointIdentityOk, tooltip: result.tooltipFieldsOk, interaction: result.pointInteractionOk,
      readerModelIds: result.checkResults['stable-point-identity'].modelObservationIds,
      violations: result.violations, dom, errors }));
    await page.close();
  }
} finally { await browser.close(); }
NODE
```

## 修改状态与完整性

只新增本报告。没有运行 MATLAB、没有更改 CI/freeze/分数、没有把 synthetic runtime 声明当成真实运行证明，没有修改既有 report/PNG/JSON 原件。未重跑全量 Node，执行的是上面列出的定向公开入口与浏览器对照。

以下 SHA-256 在本轮浏览器复现前后保持一致:

```text
43e5fe18dbab08c0c0f78d336382190453b188937851340669c6542c374f4c7d  codex-runtime/server/point-interaction-quality.mjs
41a749d7ab0f19dc6e85922ad2ddf3bdb8e2b921750c8d338b29a3aa82d2330a  codex-runtime/server/point-interaction-quality.test.mjs
d8f68251e2e60e75586f64672b233828f1bd009167a98c4559181cc8bd6b1929  codex-runtime/server/ocean-report-html-parser.mjs
2c190e5785b02e3892d9427c9ac8eeed75d198bd6714fa2ec86f1c51f16ba3e1  codex-runtime/server/ocean-report-html-parser.test.mjs
c2d337ebb7fbe6cea9998be2698d39c6044ae40935176eacaa26ed061e5a23a1  codex-runtime/server/illustrated-report-contract.mjs
f1f4271731c2eb8a6acacdc16a1f265c2ab314a8728d0fb9dc992a522dd11b22  codex-runtime/server/illustrated-report-contract.test.mjs
e731b7ea7a6b1bae824beb66ed33c44e4c59c7129367907bd003dc60b1d6353e  codex-runtime/server/package.json
854fc9d4f9ef42c4206db0c032fca6e541eeb33b818e392149eab436ffba3cdb  codex-runtime/server/package-lock.json
```
