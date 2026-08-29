import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectReportQuality } from './report-quality.mjs';

function inspect(html) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ocean-chart-quality-'));
  const htmlPath = path.join(directory, 'report.html');
  const markdownPath = path.join(directory, 'report.md');
  writeFileSync(htmlPath, html);
  writeFileSync(markdownPath, '# 报告\n');
  try {
    return inspectReportQuality(htmlPath, markdownPath, 0, 0, 0, 24, 0, 0, 0, 0, 10);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('rejects repeated charts without scientific metadata or family coverage', () => {
  const html = Array.from({ length: 24 }, (_, index) => `<figure data-chart-type="line" data-chart-family="temporal"><svg><title>图 ${index}</title></svg></figure>`).join('');
  const quality = inspect(html);
  assert.equal(quality.chartMetadataOk, false);
  assert.equal(quality.chartDiversityOk, false);
  assert.equal(quality.professionalVisualizationOk, false);
});

test('accepts a diverse, sourced and scientifically annotated chart programme', () => {
  const families = [
    'spatial', 'spatial', 'spatial',
    'temporal', 'temporal', 'temporal',
    'profile', 'profile',
    'directional', 'directional',
    'uncertainty', 'uncertainty',
    'physics', 'physics', 'physics',
    'distribution', 'distribution', 'coupling', 'coupling', 'quality', 'quality', 'impact', 'impact', 'spatial',
  ];
  const types = ['nine-zone-map', 'heatmap', 'contour', 'line-band', 'small-multiple', 'change-point', 'depth-profile', 'ts-diagram', 'quiver', 'wind-rose', 'coverage-matrix', 'uncertainty-fan', 'force-balance', 'budget-waterfall', 'dispersion-curve', 'boxplot', 'histogram', 'lag-correlation', 'vector-angle', 'qc-calendar', 'latency-bars', 'impact-matrix', 'evidence-chain', 'station-map'];
  const figures = families.map((family, index) => `<figure data-chart-type="${types[index]}" data-chart-family="${family}" data-source="dataset-${index}"><svg role="img"><title>${types[index]}</title><desc>经度 longitude、纬度 latitude、UTC时间、单位 m/s、样本量 n=${index + 10}、QC、缺测和不确定性</desc></svg><figcaption>图 ${index + 1}：数据来源、时间、空间范围与限制。</figcaption></figure>`).join('');
  const quality = inspect(`<!doctype html><html><body>${figures}</body></html>`);
  assert.equal(quality.uniqueChartTypes, 24);
  assert.equal(quality.chartMetadataOk, true);
  assert.equal(quality.chartDiversityOk, true);
  assert.equal(quality.scientificChartFamiliesOk, true);
  assert.equal(quality.chartSemanticsOk, true);
  assert.equal(quality.professionalVisualizationOk, true);
});
