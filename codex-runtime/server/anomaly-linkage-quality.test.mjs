import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectReportQuality } from './report-quality.mjs';

function inspect(markdown) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ocean-anomaly-linkage-quality-'));
  const htmlPath = path.join(directory, 'report.html');
  const markdownPath = path.join(directory, 'report.md');
  writeFileSync(htmlPath, '<!doctype html><html><body></body></html>');
  writeFileSync(markdownPath, markdown);
  try {
    return inspectReportQuality(htmlPath, markdownPath, 0, 0, 0, 0, 0, 0, 0, 9, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('rejects an extreme-value list without linkage methods or validation', () => {
  const quality = inspect('# 异常\n最大风速点为20 m/s，附近可能存在浮标。');
  assert.equal(quality.anomalyRankingOk, false);
  assert.equal(quality.collocatedPointInventoryOk, false);
  assert.equal(quality.independentValidationOk, false);
  assert.equal(quality.anomalyLinkageOk, false);
});

test('accepts ranked nine-zone candidates with collocation and falsification paths', () => {
  const quality = inspect(`# 异常点位综合排行榜
全区前10（Top 10）同时列出正异常和负异常。评分分量包含稳健Z、百分位、持续时间、空间支持、来源一致性和权重。

## 九区异常候选
九区各区前3：西北、北、东北、西、中间、东、西南、南、东南；各区首名均保留证据。

## 联动点位表
平台ID、距离（km）、时间差（h）、深度差、QC、来源独立性和联动等级完整记录。L1直接验证；L2同变量支持；L3机制支持；L4背景参照；L5无有效联动。

## 配准方法
核心半径25 km、局地半径75 km、背景半径150 km。共同时间轴采用6小时的时间容差，深度容差10 m，并依据产品空间分辨率和网格对角线开展敏感性检查。

## 独立验证
同源产品不能获得独立验证资格。候选A的L1点位数量为2，具备直接验证资格；其余来源只形成支持。

## 跨变量联动矩阵
共同样本量24，相关系数0.62，效应方向为正，最佳滞后6小时，同时列出方向夹角和来源关系。
调用 ocean_statistical_diagnostics 的 lag_correlation；最大滞后48小时，重叠样本数24，并说明自相关与多重检验限制。

## 验证路径与可证伪条件
新增观测若在同期支持异常将增强结论；独立浮标若持续低于基线将削弱或否定当前机制。补测优先覆盖东区。`);
  assert.equal(quality.anomalyRankingOk, true);
  assert.equal(quality.zoneAnomalyCoverageOk, true);
  assert.equal(quality.collocatedPointInventoryOk, true);
  assert.equal(quality.collocationMethodOk, true);
  assert.equal(quality.independentValidationOk, true);
  assert.equal(quality.crossVariableMatrixOk, true);
  assert.equal(quality.lagAnalysisOk, true);
  assert.equal(quality.falsificationPathOk, true);
  assert.equal(quality.anomalyLinkageOk, true);
});
