import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectReportQuality } from './report-quality.mjs';

function inspect(markdown) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ocean-editorial-quality-'));
  const htmlPath = path.join(directory, 'report.html');
  const markdownPath = path.join(directory, 'report.md');
  writeFileSync(htmlPath, '<!doctype html><html><body></body></html>');
  writeFileSync(markdownPath, markdown);
  try {
    return inspectReportQuality(htmlPath, markdownPath, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('rejects defensive AI-style constructions and canned transitions', () => {
  const quality = inspect(`# 风场\n这不是现场观测，而是融合分析。\n值得注意的是，西区风速较高。\n总体来看，海况平稳。`);
  assert.equal(quality.editorialStyleOk, false);
  assert.equal(quality.defensiveStyleMatches.length, 1);
  assert.equal(quality.cannedTransitionMatches.length, 2);
});

test('rejects colloquial single-character verbs that drive sentences', () => {
  const quality = inspect(`# 方法\n用数据计算九区均值。\n查结果并画图。`);
  assert.equal(quality.editorialStyleOk, false);
  assert.ok(quality.colloquialSingleVerbMatches.length >= 2);
});

test('accepts direct professional scientific prose and academic verbs', () => {
  const quality = inspect(`# 风场\nCopernicus L4风场在西北区给出4.2 m/s面积加权均值，较前窗增加0.8 m/s。\n设科氏参数为 f，并由纬度计算惯性周期。\n> 新闻标题：这不是演习，而是测试\n| 原始标题 | 不只是海浪 |`);
  assert.equal(quality.editorialStyleOk, true);
  assert.equal(quality.editorialStyleViolationCount, 0);
});
