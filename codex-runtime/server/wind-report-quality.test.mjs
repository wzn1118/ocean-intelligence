import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectReportQuality } from './report-quality.mjs';

test('rejects a wind chapter that only reports a regional mean', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wind-quality-'));
  const htmlPath = path.join(root, 'report.html');
  const markdownPath = path.join(root, 'report.md');
  writeFileSync(htmlPath, '<figure>wind</figure>');
  writeFileSync(markdownPath, '# 报告\n## 4. 风场\n区域平均风速为 3.183 m/s，数据延迟 34.734 小时。');

  const quality = inspectReportQuality(htmlPath, markdownPath, 0, 0, 0, 0, 0, 0, 0, 9);
  assert.equal(quality.windTimeSemanticsOk, false);
  assert.equal(quality.windVectorSemanticsOk, false);
  assert.equal(quality.windSpatialMethodOk, false);
  assert.equal(quality.windComparisonOk, false);
  assert.equal(quality.windPointValidationOk, false);
});

test('accepts explicit wind-data unavailability with a documented reason', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wind-unavailable-'));
  const htmlPath = path.join(root, 'report.html');
  const markdownPath = path.join(root, 'report.md');
  writeFileSync(htmlPath, '<figure>gap</figure>');
  writeFileSync(markdownPath, '# 报告\n## 4. 风场\n当前未获得可用风场数据。原因：数据源查询失败；本节保留数据缺口和限制。');

  const quality = inspectReportQuality(htmlPath, markdownPath, 0, 0, 0, 0, 0, 0, 0, 9);
  assert.equal(quality.windTimeSemanticsOk, true);
  assert.equal(quality.windVectorSemanticsOk, true);
  assert.equal(quality.windSpatialMethodOk, true);
  assert.equal(quality.windComparisonOk, true);
  assert.equal(quality.windPointValidationOk, true);
});
