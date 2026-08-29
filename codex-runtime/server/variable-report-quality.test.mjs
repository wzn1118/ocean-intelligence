import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectReportQuality } from './report-quality.mjs';

function inspect(markdown) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'variable-quality-'));
  const htmlPath = path.join(root, 'report.html');
  const markdownPath = path.join(root, 'report.md');
  writeFileSync(htmlPath, '<figure>report</figure>');
  writeFileSync(markdownPath, markdown);
  return inspectReportQuality(htmlPath, markdownPath, 0, 0, 0, 0, 0, 0, 0, 9);
}

test('rejects shallow non-wind numerical chapters', () => {
  const quality = inspect(`# 报告
## 1. 海表温度
平均温度 28 °C。
## 2. 盐度与温盐结构
平均盐度 33。
## 3. 表层流
平均流速 0.2 m/s。
## 5. 总浪、涌浪、风浪
总浪 1.2 m。
## 6. 叶绿素与生态指标
叶绿素较高。
## 8. 风浪流耦合
风浪流相关。
## 9. 异常候选
发现异常。
## 10. 数据时效、缺口和质量
数据质量良好。`);

  assert.equal(quality.variableSectionsOk, false);
  assert.deepEqual(Object.values(quality.variableSectionChecks), Array(8).fill(false));
});

test('keeps nested subsections inside their parent quality section', () => {
  const quality = inspect(`# 报告
## 1. 海表温度
### 数据能力缺口
当前未获得海表温度数据，原因是数据集调用失败；已尝试 Copernicus 数据集和工具调用，下一步所需数据为有效 SST 子集。
## 2. 盐度与温盐结构
当前未获得盐度与温盐剖面，原因是数据集未返回；已尝试目录数据集与工具调用，下一步所需数据为带深度和 QC 的剖面。
## 3. 表层流
当前未获得表层流数据，原因是工具调用失败；已尝试流场数据集，下一步所需数据为 u/v 分量。
## 5. 总浪、涌浪、风浪
当前未获得总浪、涌浪、风浪数据，原因是数据集不可用；已尝试波浪工具调用，下一步所需数据为海况子集。
## 6. 叶绿素与生态指标
当前未获得叶绿素与生态指标，原因是云掩膜后无可用值；已尝试生态数据集工具调用，下一步所需数据为有效像元。
## 8. 风浪流耦合
当前未获得风浪流耦合结果，原因是共同时间戳缺口；已尝试数据集匹配工具，下一步所需数据为同期变量。
## 9. 异常候选
当前未获得异常候选判断，原因是历史基线不可用；已尝试基线数据集调用，下一步所需数据为多年气候态。
## 10. 数据时效、缺口和质量
当前未获得完整数据质量矩阵，原因是来源状态工具调用失败；已尝试各数据集和状态工具，下一步所需数据为调用日志与缓存年龄。`);

  assert.equal(quality.variableSectionsOk, true);
  assert.deepEqual(Object.values(quality.variableSectionChecks), Array(8).fill(true));
});
