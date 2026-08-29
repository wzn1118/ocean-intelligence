import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectReportQuality } from './report-quality.mjs';

function inspect(html, markdown, minimumFigures = 2) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ocean-interpretation-quality-'));
  const htmlPath = path.join(directory, 'report.html');
  const markdownPath = path.join(directory, 'report.md');
  writeFileSync(htmlPath, html);
  writeFileSync(markdownPath, markdown);
  try {
    return inspectReportQuality(htmlPath, markdownPath, 0, 0, 0, minimumFigures, 0, 0, 0, 0, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const interpretation = (id) => `<section class="figure-interpretation" data-figure-id="${id}">
  <p data-role="observation">西区在UTC时间窗内达到4.2 m/s。</p>
  <p data-role="physical-mechanism">风应力与风速平方近似相关。</p>
  <p data-role="operational-meaning">小型船舶甲板作业暴露增加。</p>
  <p data-role="uncertainty">样本量n=24，存在产品误差。</p>
  <p data-role="validation">浮标风速能够检验该解释。</p>
</section>`;

test('rejects charts followed only by captions and generic impact prose', () => {
  const html = `<figure id="fig-1"><figcaption>风速图</figcaption></figure><figure id="fig-2"><figcaption>波高图</figcaption></figure>`;
  const quality = inspect(html, '# 风浪\n风速增加，波高下降。可能影响船舶。');
  assert.equal(quality.figureInterpretationOk, false);
  assert.equal(quality.waveEnergySemanticsOk, false);
  assert.equal(quality.crossVariableConsistencyOk, false);
  assert.equal(quality.operationalImpactOk, false);
  assert.equal(quality.physicalRealityInterpretationOk, false);
});

test('accepts linked five-part explanations and quantified reality framing', () => {
  const html = `<figure id="fig-1"></figure>${interpretation('fig-1')}<figure id="fig-2"></figure>${interpretation('fig-2')}`;
  const markdown = `# 风浪物理解释
波能密度遵循 E=ρgHs²/16，与有效波高的平方关系一致。波高变化为下降20%，对应波能降幅36%。
## 跨变量一致性诊断
风浪趋势背离采用共同时间窗和时间对齐。候选机制包括有效风区fetch不足、风向转变和区外涌浪源区传播时间差。滞后相关用于判别响应时滞，独立浮标验证可以区分替代机制。
## 现实影响
暴露覆盖西区航线；脆弱性取决于船型和甲板作业方式；后果限定为作业难度增加。触发指标为持续6小时风速超过内部筛查条件，空间边界为西区，证据等级E3，解除条件为连续3小时低于条件。`;
  const quality = inspect(html, markdown);
  assert.equal(quality.completeFigureInterpretationCount, 2);
  assert.equal(quality.figureInterpretationOk, true);
  assert.equal(quality.waveEnergySemanticsOk, true);
  assert.equal(quality.crossVariableConsistencyOk, true);
  assert.equal(quality.operationalImpactOk, true);
  assert.equal(quality.physicalRealityInterpretationOk, true);
});
