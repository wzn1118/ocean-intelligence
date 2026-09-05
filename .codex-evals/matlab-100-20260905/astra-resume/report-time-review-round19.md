# 第19轮报告时间边界只读复核

## 结论

已用现有 Node fixture 实际复现三个校验风险：非法日历日期被自动滚动后接受、无时区时间的判定依赖进程 TZ、主报告与交互 HTML 的时间窗口不一致仍可整体通过。主 HTML 的 `data-time-start/end` 与对应 manifest 声明已有逐字比对，直接篡改该属性会被拒绝，不能称其完全未绑定。

这是合成输入下的校验器复现，不是对当前真实海区数据、MATLAB 产物或 CI 报告存在时间错误的证明。没有运行 MATLAB、没有产生运行或视觉验收证据。

## 复核快照

- 时间：2026-09-05 UTC；Node v22.14.0，Linux；分别使用进程 `TZ=UTC`、`TZ=America/New_York`。
- HEAD：`e9ca42d6346ca46420d526023f10da1fc5ac2fc8`。
- 完整16组初测的 contract SHA-256：`ef581ee0bc8855d6d128bba23f73d863395b22d945a1da1ab2bdf2ea8769367a`。
- 协作者随后增加变量关联检查；在更新后的 contract 上重新执行六个关键用例，结果未变。复测 SHA-256：`95149c1d01904f5b52cbae27393a710c7433772af35030500e0f7f0442bff548`。下文行号对应此快照。
- fixture 来源：`/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.test.mjs` 的 `createReportEvidenceFixture`、`interactionFixtureHtml`、`fileHash`；该文件 SHA-256：`caa12ea0b6799975819f7efe143ebb39ab36bfd341d8439c812fc1988c16fb4f`。
- 仅在内存加载上述 fixture 工厂，临时文件位于系统 `/tmp`，每例结束均删除。沿用的 fixture 含合成运行状态声明及非真实图片字节，仅用于契约单元复现，不保留或推广为 MATLAB 证据。未修改生产代码、既有测试或 CI 文件。

## 已证实的问题

### P2：Date.parse 的有限结果不等于日历日期有效

[inspectCoverage](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:433) 只判断 `Date.parse` 是否有限、终点是否早于起点，并独立验证 timezone 字符串。

最小 coverage：

```json
{"start":"2026-02-30T00:00:00Z","end":"2026-02-30T01:00:00Z","timezone":"UTC"}
```

将三个 coverage 和主 HTML 对应属性同步设为该窗口，公开入口 `inspectIllustratedReportEvidence` 返回 `ok=true`、`oceanReportOk=true`、`figureEvidenceOk=true`、`figureLinksOk=true`，无 violations。Node 实际解析得到 `2026-03-02T00:00:00.000Z` 至 `01:00:00.000Z`，但保留在声明及主 HTML 中的仍是不存在的2月30日。非闰年 `2026-02-29` 同样通过并滚动到3月1日。

负对照 `2026-13-03`、`not-a-date` 均被正确拒绝。因此不是所有无效文本都能通过，具体缺口是解析器可自动归一化的无效日历值。

### P2：timezone=UTC 未参与无时区字符串的解释

同一位置直接解析 start/end，没有将单独的 `timezone="UTC"` 应用于无偏移的民用时间。

最小 coverage：

```json
{"start":"2026-09-03T00:00:00","end":"2026-09-03T01:00:00Z","timezone":"UTC"}
```

相同 fixture 和字符串，在 `TZ=UTC` 下整体 `ok=true`；在 `TZ=America/New_York` 下 `ok=false`，三个 coverage 均报 `.reversed`。后者把 start 解释为 `04:00Z`，而不是声明时区下的 `00:00Z`。

起止均无时区时，两环境都通过，但解释的 UTC 窗口分别为 `00:00-01:00Z` 和 `04:00-05:00Z`。已证明解释及部分判定不稳定，未据此推断当前线上实际采用了错误时区。

### P2：主 HTML 字符串一致不保证交互导出的时间一致

[inspectReportArtifact](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:273) 对交互 HTML 单独调用 `inspectPointInteractionQuality`，未把返回的 scientificContext 时间与所属 figure 的 temporal_coverage 交叉比较。主 HTML 的比对则位于 [inspectHtmlFigureCorrespondence](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:457)。

实际复现：保持既有 `figure.html` 和其中两条观测时间 `2026-09-03T00:00:00Z`、`01:00:00Z` 不变；仅同步修改三个 coverage 和主 HTML 为 `2026-09-03T00:00:00+08:00` 至 `01:00:00+08:00`，timezone 字段仍为 UTC。整体仍 `ok=true`，`artifactsOk=true`、freshness 通过，violations 为空。新声明的实际时刻是前一天 `16:00-17:00Z`，与未动的交互窗口相差8小时。

更直接的对照：同步改为 `2030-01-01T00:00:00Z` 至 `01:00:00Z`，未修改交互导出的2026年窗口，仍整体通过。这说明缺少时间交叉绑定，不是仅偏移拼写问题。fixture 的交互文件 bytes/SHA-256 没有重写或失配；成功的文件绑定不能替代时间语义绑定。

## 已有防线及契约范围

- 仅修改主 HTML `data-time-start/end`，不改 manifest，会得到两条 `.mismatch`，整体失败。直接对应检查有效。
- `2026-09-03T08:00:00+08:00` 等价于 `2026-09-03T00:00:00Z`。主 HTML 与 manifest 同步使用该偏移拼写会通过，且与原交互时刻一致。非零偏移本身不证明数据错误。
- 只把主 HTML 改为上述等价偏移拼写也会 `.mismatch`，说明现有对应规则是字符串一致，不是仅比较时刻。不能未经契约决策就把此行为改成宽松等价比较。
- `timezone="UTC+08:00"` 被拒绝；当前接受的是 UTC 及零偏移 UTC 别名，而非任意时区。问题在于该字段与 start/end 的解释没有统一。
- [报告指令](/opt/ocean-intelligence/codex-runtime/server/illustrated-report-contract.mjs:95) 要求主 figure 属性与 scientific_context 一致，并要求 requested/effective UTC coverage；没有列出端点必须使用唯一 `...Z` 拼写的完整语法。
- [点交互规范](/opt/ocean-intelligence/codex-runtime/server/point-temperature-interaction-spec.mjs:42) 允许“时间包含时区或明确标注 UTC”；[交互上下文要求](/opt/ocean-intelligence/codex-runtime/server/point-temperature-interaction-spec.mjs:58) 另要求 `data-timezone="UTC"`。因此“无后缀一概不合法”需要明确机器字段契约，不能直接当作已有规定。
- date-only `2026-09-03` 的相同起止也被接受。现有代码允许零长度窗口，不能在未明确精度和窗口定义前把所有 date-only 或 start=end 均列为科学错误。
- requested、effective、各图窗口可因缺测、比较基线或图件子集而不同，不应修成三者一律完全相等。

## 最小修复建议

1. 将 coverage 时间解析与声明时区统一，增加严格日历校验。不能仅依靠 `Date.parse` 有限值；需要校验真实年月日和时间分量，拒绝自动滚动的日期。无后缀值若按既有“明确 UTC”规则保留，必须明确按 UTC 解释；如改为只接受带时区的机器时间戳，应同步明确生成契约及兼容性测试。
2. 明确偏移表示策略。合法 `+08:00` 可转换成相同 UTC 时刻后规范输出，不能直接改后缀而保留钟面值。若要求机器 coverage 严格 UTC 字面，应将其作为明确的序列化规则；保留合法等价偏移的正例，区分拼写不规范与真实时刻不一致。
3. 在报告检查器中把交互 HTML 返回的 timeStart/timeEnd/timezone 与所属 figure 的 temporal_coverage 比对，按选定规则拒绝时刻漂移。保留现有主 HTML 对应、hash 和 freshness 检查。跨图/报告总窗口是否要求包含关系需依各图角色定义，不能替代为强制相等。
4. 测试至少覆盖本报告下列六例，并补合法等价偏移、非闰年2月29日、无效月份、无偏移双端点、UTC零偏移别名和 date-only 政策。错误应落在具体时间字段，不应只表现为其它证据项失败。

同类宽松解析还存在于 [交互上下文检查](/opt/ocean-intelligence/codex-runtime/server/point-interaction-quality.mjs:470)。这是只读指出的相邻风险；本轮没有修改该模块，也没有证明完成交叉绑定后就能独立认证每条原始观测的时间或真实数据来源。

## 最小公开入口复现

以下命令从仓库根目录执行，只调用现有 fixture 工厂并在 `/tmp` 创建临时合成文件，结束即删除。不是 MATLAB 命令，不生成可交付图件或运行证据。六例在复测快照均实际执行并符合断言。

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { inspectIllustratedReportEvidence as inspect, REQUIRED_REPORT_ZONE_NAMES,
  REQUIRED_MATLAB_REPORT_RELEASES } from './codex-runtime/server/illustrated-report-contract.mjs';
const source = fs.readFileSync('codex-runtime/server/illustrated-report-contract.test.mjs', 'utf8');
const context = vm.createContext({ ...fs, os, path, createHash,
  REQUIRED_REPORT_ZONE_NAMES, REQUIRED_MATLAB_REPORT_RELEASES });
vm.runInContext(source.slice(source.indexOf('\nfunction createReportEvidenceFixture()')), context);
const cases = [
  ['invalid-day', '2026-02-30T00:00:00Z', '2026-02-30T01:00:00Z', 'UTC', false, true],
  ['mixed-UTC', '2026-09-03T00:00:00', '2026-09-03T01:00:00Z', 'UTC', false, true],
  ['mixed-NY', '2026-09-03T00:00:00', '2026-09-03T01:00:00Z', 'America/New_York', false, false],
  ['offset-drift', '2026-09-03T00:00:00+08:00', '2026-09-03T01:00:00+08:00', 'UTC', false, true],
  ['HTML-only', '2026-09-03T00:00:00+08:00', '2026-09-03T01:00:00+08:00', 'UTC', true, false],
  ['disjoint-window', '2030-01-01T00:00:00Z', '2030-01-01T01:00:00Z', 'UTC', false, true],
];
for (const [name, start, end, timezone, htmlOnly, expected] of cases) {
  process.env.TZ = timezone;
  const fixture = context.createReportEvidenceFixture();
  try {
    assert.equal(inspect(fixture).ok, true);
    if (!htmlOnly) {
      const coverages = [fixture.manifest.ocean_report.requested_coverage,
        fixture.manifest.ocean_report.effective_coverage,
        fixture.manifest.figures[0].scientific_context.temporal_coverage];
      for (const coverage of coverages) Object.assign(coverage, { start, end, timezone: 'UTC' });
    }
    const html = fs.readFileSync(fixture.htmlPath, 'utf8')
      .replace(/data-time-start="[^"]*"/u, `data-time-start="${start}"`)
      .replace(/data-time-end="[^"]*"/u, `data-time-end="${end}"`);
    fs.writeFileSync(fixture.htmlPath, html);
    fixture.manifest.generator = 'SYNTHETIC Node validation reproduction, not MATLAB evidence';
    fixture.manifest.generated_at = new Date().toISOString();
    fs.writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
    const result = inspect(fixture);
    assert.equal(result.ok, expected, name);
    console.log(name, result.ok, result.oceanReport.violations,
      result.figureEvidenceViolations, result.figureViolations);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}
JS
```

预期总体结果依次为 `true, true, false, true, false, true`。各例 artifact/freshness 均为 true；两个 false 分别来自时区导致的 `.reversed` 与主 HTML 的 `.mismatch`，不是由缺文件、坏 hash 或假失败引起。
