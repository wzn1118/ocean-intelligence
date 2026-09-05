# 第19轮 HTML 不确定度对应关系对抗审计

## 结论

**[P2] 已复现：明确否定清单 uncertainty 状态或方法的 HTML 仍被判为对应一致，公开审计入口返回 `ok=true`。**

位置：[illustrated-report-contract.mjs:468](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:468) 与 [方法检查:469](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:469)。两个 `includes` 在同一自由说明串中搜索，没有区分状态、方法及否定关系。问题由完整公开入口实测确认，不是仅凭实现猜测。

本轮仓库仅新增此报告。生产与现有测试未修改；未提交、未更新 freeze。复现仅为现有 synthetic fixture 的 JavaScript 契约测试，不是 MATLAB、海洋观测、制图或视觉通过证据。

## 审计基线

- 实测：2026-09-05 23:29 UTC，Node `v22.14.0`，45 个独立临时样本。
- HEAD：`e9ca42d6346ca46420d526023f10da1fc5ac2fc8`；审查对象是含协作者修改的工作树，不是该提交的纯净版本。
- 生产模块 SHA256：`ce88bfa2562a8cb3303e0cfa5792b5893fe5d6deac73fea9a05ceab983b03be4`。
- 现有测试文件 SHA256：`83df758ff5d30d590d63118e3b336c0e67d3bce2c10c7f057a5a2045e8ea85a0`。
- 从现有 [createReportEvidenceFixture:612](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.test.mjs:612) 起读取原有 fixture 函数，在隔离 VM 中调用，临时根目录改到 `/tmp`。没有复制或替代生产检查函数，也没有运行整套既有测试。
- 每个样本先确认原 fixture 的公开入口基线 `ok=true`，随后只变更报告 `<figure data-uncertainty>` 及需要的两处清单 uncertainty，最后按现有方式重写清单。PNG/PDF/交互 HTML 字节不变；45 例的 `artifactsOk`、`manifestFreshnessOk` 均为 `true`。
- fixture 的 PNG/PDF 本来就是测试字节，MATLAB/visual passed 等字段也只是原有单测输入。临时清单的 generator 明示 synthetic；审计结果另设 `matlab_executed=false`、`visual_verified=false`，不能把检查器返回值提升为真实运行证据。

复现文件：[reproduce.mjs](/tmp/report-uncertainty-round19-WY7CNB/reproduce.mjs)。逐例输入、目录、完整相关 violations 与源文件哈希：[results.json](/tmp/report-uncertainty-round19-WY7CNB/results.json)。单次执行前后校验生产与 fixture 源哈希未变；协作者后续修复可能改变复跑结果。

## 契约与控制

[说明:95](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:95) 要求 HTML 不确定度字段与清单一致，没有规定整个说明串必须等于某个模板。[inspectExplicitAssessment:495](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:495) 接受 `present/absent/unknown/not-evaluated`，method 只要求非空，limitations 至少12字符。因此，多词 method、适当补充说明本身不是违规。

固定 `M = Instrument accuracy metadata`，对四种清单状态和 HTML `<status> M` 的16种组合，实测如下。`T/F` 是公开入口的 `ok`：

| 清单状态 / HTML 状态 | present | absent | unknown | not-evaluated |
| --- | --- | --- | --- | --- |
| present | T | F | F | F |
| absent | F | T | F | F |
| unknown | F | F | T | F |
| not-evaluated | F | F | F | T |

12个直接错配均只有 `figureViolations=["figures[0].data-uncertainty.mismatch"]`，其他相关 violations 为空。不能声称“任意不同状态都能通过”。

以下自然说明控制也通过，单凭串更长或出现其他状态词不能定为 bug：

- `Uncertainty is present; Instrument accuracy metadata from calibration logs; model uncertainty is absent.` 主体状态与 model 状态有明确区别。
- `Uncertainty is absent; Instrument accuracy metadata; instrument identifiers are present.` `present` 修饰 identifiers，不应全串禁用该词。
- `Uncertainty is unknown; Instrument accuracy metadata; sensor identifiers are present.`
- `Uncertainty is not-evaluated yet; Instrument accuracy metadata; observations are present.`
- 清单 method=`bootstrap`，说明为 `Uncertainty is present; bootstrap percentile intervals with limited calibration evidence.` 方法细化并不必然否定 bootstrap；此控制不证明细化内容有实际科学依据。

## 确认的漏检

下表8例都得到 **`ok=true`、`figureLinksOk=true`**，且 `figureViolations`、`figureEvidenceViolations`、`oceanReportViolations`、`claimViolations`、`matlabRuntimeViolations` 全部为 `[]`。

| 清单 status / method | HTML data-uncertainty 原值 | 矛盾 |
| --- | --- | --- |
| present / M | `Uncertainty is not-present; Instrument accuracy metadata.` | 否定 present |
| present / M | `Uncertainty is absent, not present; Instrument accuracy metadata.` | 明确 absent |
| absent / M | `Uncertainty is present, not absent; Instrument accuracy metadata.` | 明确 present |
| unknown / M | `Uncertainty is known, not unknown; Instrument accuracy metadata.` | 明确否定 unknown |
| not-evaluated / M | `Uncertainty has been evaluated; it is no longer not-evaluated; Instrument accuracy metadata.` | 明确已评估 |
| present / bootstrap | `present; method=not-bootstrap` | 否定方法 |
| present / M | `Uncertainty is present; method is bootstrap, not Instrument accuracy metadata.` | 多词方法也被明确否定 |
| present / Metadata present in calibration report | `Uncertainty is absent; method: Metadata present in calibration report.` | HTML 状态相反，目标状态仅出现在 method 中 |

末例尤其说明：给 `present` 增加 `\b` 仍会接受，因为 method 内确实存在完整单词 `present`。词边界也不能处理 `not present`，不能作为完整修复。

另有5个辅助词串探针通过：`status=representative` 对 present、`status=absentee` 对 absent、`status=unknownish` 对 unknown、`status=not-evaluatedness` 对 not-evaluated，以及 method=`nonbootstrap` 对 bootstrap。它们证明词内碰撞；不将这些人为标签等同于前述明确自然语言矛盾，也不据此否定所有 superset 描述。

## Method 与空白边界

当前 [stringValue:565](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:565) 只做首尾 trim；对应检查再转小写，不压缩内部空白。

| 变体 | 实测 |
| --- | --- |
| 清单 method 首尾空白，HTML 正常 method | `ok=true` |
| HTML 首尾空白及大写，清单正常 | `ok=true` |
| 两边完全相同的 `Instrument  accuracy\tmetadata` | `ok=true` |
| 清单 `Instrument  accuracy\tmetadata`，HTML 单空格版本 | `ok=false`，仅 uncertainty mismatch |
| 清单单空格，HTML 两空格或 method 内换行 | `ok=false`，仅 uncertainty mismatch，共2例 |
| 清单 method=`" \t\n "` 或 `""` | `figureLinksOk=true`，但 **`ok=false`** |

最后两例实际 violations 分别来自 `manifest.figures[0].scientific_context.uncertainty.method` 与 `ocean_report.uncertainty.method`；`includes('')` 没有绕过上层非空契约，不能报告成整体成功漏洞。

三个额外负控制：缺少 method、换成不含目标串的方法、仅有 method 而无状态，均 `ok=false` 且仅 uncertainty mismatch。内部空白差异属于已证实的兼容性行为，契约未明确是否应归一化，暂不独立定性为科学一致性漏洞。不能用忽略 method 或只检查非空来“修复”。

## 最小可执行复核

以下只读已生成的临时样本，再次调用真实公开入口，输出实际结果，不依赖保存的判定值：

```bash
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inspectIllustratedReportEvidence as inspect } from '/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs';
const saved = JSON.parse(readFileSync('/tmp/report-uncertainty-round19-WY7CNB/results.json', 'utf8'));
for (const name of ['matrix-present-present', 'matrix-present-absent', 'present-negated-hyphen', 'status-leaks-from-method', 'method-negated-multiword', 'whitespace-only-method']) {
  const root = saved.results.find(entry => entry.name === name).synthetic_directory;
  const result = inspect({ outputDirectory: root,
    htmlPath: path.join(root, 'report.html'), markdownPath: path.join(root, 'report.md'),
    manifestPath: path.join(root, 'figures.json') });
  console.log(JSON.stringify({ name, ok: result.ok, figureLinksOk: result.figureLinksOk,
    figureViolations: result.figureViolations,
    figureEvidenceViolations: result.figureEvidenceViolations,
    oceanReportViolations: result.oceanReport.violations }));
}
JS
```

实测顺序为 `true, false, true, true, true, false`；第二例对应 mismatch，最后一例对应两处 method 非空约束。重新从现有 fixture 构造全部45例：

```bash
node /tmp/report-uncertainty-round19-WY7CNB/reproduce.mjs
```

## 保守修复建议

1. 将明确的状态、完整方法字段与自由说明分离，进行有字段边界的对应检查。可选择独立 `data-uncertainty-status` / `data-uncertainty-method`，或明确版本化的结构化属性；四种状态须精确匹配清单，method 不按空格拆成单词比较。
2. 自由说明继续承载限制条件，不再以“出现过预期词串”认证其语义一致。机器字段一致不证明整段自然语言无矛盾，不能提升为全文语义或科学结论审核成功。新增字段不能与旧 includes 检查取 OR。
3. 现契约没有强制整串模板，不能无提示收紧为 `<status> <method>` 并宣称历史自然说明仍兼容。需由所有者同步明确格式与迁移边界；无法无歧义解析的旧说明要求补充明确字段，不猜测状态。仅补词边界或全串禁止其他状态词，会分别漏检和误伤上述控制。
4. 明确 method 的首尾空白、大小写及内部空白政策。若选择自然语言空白折叠，须对两个已解析的 method 字段对称应用并测试；不删除否定词、连字符或词缀，不恢复到 superset/includes 匹配。
5. 定向回归保留四状态4×4控制、8个明确矛盾、带空格 method、合法补充说明、空 method 上层拒绝。维持既有哈希、freshness、运行与总体门禁，不用 synthetic 通过结果替代真实证据。

本轮没有审查时间/变量目录逻辑，没有运行 MATLAB，也未修改 Heisenberg 所有的生产与测试文件。
