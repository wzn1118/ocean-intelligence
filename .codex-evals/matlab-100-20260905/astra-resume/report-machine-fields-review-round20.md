# 第20轮报告机器字段独立核查

## 确认的风险

### [P2] 重复属性可让浏览器与检查器读取相反状态

位置：[parseAttributes:256](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:256) 使用 `Object.fromEntries`，同名键保留最后值；随后 [状态比较:486](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:486) 与 [方法比较:487](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:487) 信任该结果。本轮 Chromium 实际 DOM 保留首个属性值。

清单 status=`present`、method=`Instrument accuracy metadata`，仅替换现有 synthetic fixture 的 HTML 属性：

| HTML 源码片段 | Chromium getAttribute | 公开检查结果 |
| --- | --- | --- |
| `data-uncertainty-status="absent" data-uncertainty-status="present"` | status=`absent` | `ok=true`, `figureViolations=[]` |
| `data-uncertainty-status="present" data-uncertainty-status="absent"` | status=`present` | `ok=false`, status mismatch |
| `data-uncertainty-method="bootstrap" data-uncertainty-method="Instrument accuracy metadata"` | method=`bootstrap` | `ok=true`, `figureViolations=[]` |
| `data-uncertainty-method="Instrument accuracy metadata" data-uncertainty-method="bootstrap"` | method 与清单一致 | `ok=false`, method mismatch |

另实测第二个状态属性改为大写 `DATA-UNCERTAINTY-STATUS`，或首个错误值改为无引号 `data-uncertainty-status=absent`，仍是浏览器读 `absent`、检查器 `ok=true`。无引号属性未被当前属性正则读取。

重复且同值的 status/method 两个控制均通过，DOM 值一致。重复属性本身是非法 HTML，此发现限定为对抗输入的浏览器容错差异，不宣称普通单属性 HTML 也会选错值。当前入口不拒绝重复属性，却返回一致性成功，才是可触发问题。

同一解析原因还影响规定的说明非空检查：`data-uncertainty="" data-uncertainty="Synthetic calibration limitations."` 得到 DOM 空说明，但检查器 `ok=true`。这只涉及非空要求，不是自然语言语义审核。

### [P2] 未解码 HTML 实体，既误拒绝同值字段，也可误接受不同值

位置：[原始属性值收集:258](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:258) 与 [compare:471](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:471)。当前比较 HTML 源码中的转义拼写，不是 HTML 属性解码后的字符值。

下列都是独立、合法的单属性编码，Chromium `getAttribute('data-uncertainty-method')` 与清单字符串逐字符相同；无需自然语言推断：

| 清单 method | HTML 属性值源码 | 实测 |
| --- | --- | --- |
| `Instrument & calibration metadata` | `Instrument &amp; calibration metadata` | 误拒绝 |
| `Instrument "A" accuracy` | `Instrument &quot;A&quot; accuracy` | 误拒绝 |
| `Instrument 'A' accuracy` | `Instrument &apos;A&apos; accuracy` | 误拒绝 |
| `Instrument & calibration metadata` | `Instrument &#38; calibration metadata` / `Instrument &#x26; calibration metadata` | 两例误拒绝 |
| `bootstrap` | `boot&#115;trap` / `boot&#x73;trap` | 两例误拒绝 |
| `Instrument accuracy metadata` | `Instrument&#32;accuracy metadata` | 误拒绝 |
| `Instrument\taccuracy metadata`，中间是真 tab | `Instrument&#9;accuracy metadata` | 误拒绝 |
| `Instrument &amp; calibration metadata`，清单含字面 `&amp;` | `Instrument &amp;amp; calibration metadata` | 误拒绝 |

以上10例均 `ok=false`、`figureViolations=["figures[0].data-uncertainty-method.mismatch"]`。另一个状态控制 `data-uncertainty-status="pre&#115;ent"` 的 DOM 值是 `present`，清单也是 `present`，仍因 `figures[0].data-uncertainty-status.mismatch` 被拒绝。

反方向也已复现：清单 method 含字面 `Instrument &amp; calibration metadata`，HTML 源码也写该串。检查器得到 `ok=true`、`figureViolations=[]`，但 DOM 值是 `Instrument & calibration metadata`，已经不等于清单。不能只将此问题定性为展示或易用性缺陷。

上述问题均在真实公开入口 `inspectIllustratedReportEvidence` 上可达。其他相关 violations 为空，`artifactsOk`、`manifestFreshnessOk` 为 true；没有用其他门禁失败掩盖问题，也没有放宽比较。

## R19 修复复核

原8个矛盾模式逐一保留：not-present、absent/not present、present/not absent、known/not unknown、已 evaluated、not-bootstrap、否定多词方法、状态仅存在于 method。

每个模式分别测试缺 status、缺 method、错误机器字段，合计24例全部被拒绝：

- 缺 status：`["figures[0].data-uncertainty-status", "figures[0].data-uncertainty-status.mismatch"]`。
- 缺 method：对应两条 `data-uncertainty-method` 路径。
- 错误 status 或 method：只有对应的 `.mismatch`。

四状态4×4组合的16例中，四个同值控制通过、12个错配全部拒绝。每种状态另外搭配正常多词方法和保留双空格/tab/首尾空白的方法，8例通过，DOM 值按仅首尾 trim 比较也一致。

为每个旧矛盾说明补上正确的两个机器字段，8例都通过。这符合 [新契约:97](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:97)：说明须非空，但不替代机器字段；字段匹配不认证说明无矛盾。因此这8例不再列为漏洞，更不表示说明科学有效。不要求通用语义理解，不将大小写或内部空白的差异当作同义。

## 可重复证据

- 执行时间：2026-09-05 23:46 UTC；Node `v22.14.0`。
- 浏览器：Playwright 驱动的 Chrome Headless Shell `151.0.7922.34`；逐例 `page.setContent` 读取实际 `figure.getAttribute`，不是复刻一个 HTML 正则或仅引用规范。未推断其他浏览器版本全部相同。
- HEAD：`ef30a40faadef2bf00e881449b01b1b3065849e0`。实际测试含协作者修改的工作树，以下内容哈希才是基线。
- 生产模块 SHA256：`71fffcf3433f802b0739c2c00a62e1702d9b5134104e2bcf664889b64a169832`。
- 现有测试文件 SHA256：`0503ad977856773597646176c0640c52d967bf054d45b87b8be3d636208eb55c`。
- 每次检查使用现有 `createReportEvidenceFixture` 新建样本；从测试源码读取 fixture 构造器并隔离调用，不改生产函数或现有测试。单次完整执行前后，两份源文件哈希相同。
- 所有77例先验证未变更 fixture 的公开入口基线成功，再只改变 HTML uncertainty 属性和需要的清单 uncertainty。PNG/PDF/交互 HTML 字节不变；所有样本的 artifact/freshness 检查均通过。

| 分组 | 例数 | 检查器接受数 | 解释 |
| --- | --- | --- | --- |
| 四状态矩阵 | 16 | 4 | 与预期一致 |
| 多词/空白方法正例 | 8 | 8 | 与预期一致 |
| R19 缺字段 | 16 | 0 | 修复成立 |
| R19 错字段 | 8 | 0 | 修复成立 |
| 机器字段正确、说明仍矛盾 | 8 | 8 | 新契约允许，非语义证明 |
| 实体解码后同值 | 11 | 0 | 同值误拒绝 |
| 实体源码相同、DOM 不同 | 1 | 1 | 不同值误接受 |
| 重复属性 | 9 | 7 | 含4例错误机器字段被接受、2例反序拒绝、2例同值控制、1例空说明漏检 |

复现脚本：[reproduce.mjs](/tmp/report-machine-fields-round20-5aFo0m/reproduce.mjs)。完整输入、每例目录、实际 violations、DOM getter 值及源哈希：[results.json](/tmp/report-machine-fields-round20-5aFo0m/results.json)。浏览器缓存也位于同一 `/tmp` 根目录，未安装到项目。

```bash
PLAYWRIGHT_BROWSERS_PATH=/tmp/report-machine-fields-round20-5aFo0m/browser-cache \
  node /tmp/report-machine-fields-round20-5aFo0m/reproduce.mjs
```

只读查看最小反例的输入与实际结果：

```bash
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync('/tmp/report-machine-fields-round20-5aFo0m/results.json', 'utf8'));
for (const name of ['status-wrong-first', 'method-wrong-first', 'named-amp', 'named-quot', 'decimal-letter', 'entity-source-spelling-is-not-dom-value']) {
  const item = report.results.find(entry => entry.name === name);
  console.log(JSON.stringify({ name, declared: { status: item.status, method: item.method },
    html: item.synthetic_directory + '/report.html', dom: item.dom,
    ok: item.ok, violations: item.figureViolations }));
}
JS
```

第一条命令重新调用公开审计入口及实际浏览器；第二条只展示已记录诊断。源文件后续修复后，复跑结果可以变化，不应继续引用旧基线结论。

## 修复范围建议

1. 对机器字段使用 HTML 属性语义的解析结果，实体恰好解码一次后，继续仅首尾 trim、完整精确比较。HTML 传输编码等价不等于放宽大小写、内部空白或方法语义；不得重用 includes。
2. 在丢弃重复信息前，按 HTML 属性名称不区分大小写检测重复并明确拒绝。只把 `Object.fromEntries` 改成取首值虽能对齐本轮 DOM，却仍默许含歧义输入；保守门禁宜拒绝重复 uncertainty 字段。需覆盖引号/无引号混合，不依赖只匹配引号属性的正则。
3. 优先采用能处理 HTML 属性及重复属性诊断的成熟解析器。只在当前正则结果上解码值不能修复重复字段；反复 replace 实体也会把字面 `&amp;` 错解两次。保留一次解码正反例与原24例 R19 拒绝控制。
4. 保留自然说明非空检查及“不是语义证明”的边界。不扩展为自由文本推理，不变更真实性、哈希、freshness 或 MATLAB/视觉门禁。

本轮仓库仅新增本报告，未修改生产或现有测试，未提交。临时 fixture 的 artifact 字节与 MATLAB/visual passed 字段均来自既有 synthetic 单测输入；结果明确 `matlab_executed=false`、`visual_verified=false`。浏览器 DOM 测量不是 MATLAB 执行、真实海洋数据证明或报告视觉验收。本轮未重审时间、数据源和变量目录。
