import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectReportQuality } from './report-quality.mjs';

function inspect(markdown) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'physical-quality-'));
  const htmlPath = path.join(root, 'report.html');
  const markdownPath = path.join(root, 'report.md');
  writeFileSync(htmlPath, '<figure>physics</figure>');
  writeFileSync(markdownPath, markdown);
  return inspectReportQuality(htmlPath, markdownPath, 0, 0, 0, 0, 0, 0, 0, 9);
}

test('rejects qualitative mechanism prose without physical diagnostics', () => {
  const quality = inspect(`# 报告
## 8. 风浪流耦合
### 物理机制诊断
风可能推动海流，海流可能影响波浪。`);

  assert.equal(quality.physicalOceanographyOk, false);
  assert.equal(quality.physicalRotationOk, false);
  assert.equal(quality.physicalUncertaintyOk, false);
});

test('accepts a reproducible scale-aware physical mechanism section', () => {
  const quality = inspect(`# 报告
## 8. 风浪流耦合
### 物理机制诊断
调用 ocean_physics_diagnostics。中心点科氏参数 f = 4.99e-5 s-1，beta = 2.15e-11 m-1 s-1，惯性周期为 35.0 h。

U-L-H-T 物理尺度表：速度尺度 U=0.3 m/s，水平尺度 L=100 km，垂向尺度 H=30 m，时间尺度 T=24 h。Rossby 数 Ro=0.06。Froude 数与 Burger 数、变形半径因输入不足，缺少 N 与垂向尺度一致性验证，暂不计算。

水平动量方程和主导平衡的项量级排序包括局地加速度、平流、科氏力、压力梯度、风应力、底摩擦与混合；当前主导项为科氏力和压力梯度。替代机制包括潮汐、河流径流、岸线约束、垂向混合和底摩擦。

输入来源与输入证据来自数据集 DATASET-X 的流速变量和记录 ID E1。方程与公式逐项列出，所有结果保留单位和量纲。适用条件与假设为中纬度、小 Rossby 数；失效条件和限制包括近赤道、复杂近岸和强非稳态。

教材理论依据不是当前海况证据，当前判断仍来自本次数据。[Stewart 2008, Ch. 7 §7.6, textbook pp. 108-111] [Stewart 2008, Ch. 9 §9.4, textbook pp. 145-147] [Stewart 2008, Ch. 12 §12.1, textbook pp. 199-202]

九区物理机制分型：西北、北、东北、西、中间、东、西南、南、东南的主导过程不同，依据各区风、流和压力梯度差异分别判断。

敏感性分析改变 L 和阻力系数；不确定度与误差传播来自梯度和分辨率。可证伪条件：若同期 ADCP 不支持该流向，将削弱或否定该解释。`);

  assert.equal(quality.physicalRotationOk, true);
  assert.equal(quality.physicalScaleAnalysisOk, true);
  assert.equal(quality.physicalBalanceOk, true);
  assert.equal(quality.physicalProvenanceOk, true);
  assert.equal(quality.physicalZoneRegimeOk, true);
  assert.equal(quality.physicalUncertaintyOk, true);
  assert.equal(quality.textbookReferenceOk, true);
  assert.equal(quality.physicalOceanographyOk, true);
});
