import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_MATLAB_REPORT_RELEASES,
  REQUIRED_REPORT_EXPORT_FORMATS,
  REQUIRED_REPORT_ZONE_NAMES,
} from './illustrated-report-contract.mjs';
import { PROFESSIONAL_VISUALIZATION_SPEC } from './professional-visualization-spec.mjs';

const expectedZones = ['西北', '北', '东北', '西', '中间', '东', '西南', '南', '东南'];

test('freezes the complete ocean-region and MATLAB release evidence baseline', () => {
  assert.deepEqual(REQUIRED_REPORT_ZONE_NAMES, expectedZones);
  assert.deepEqual(REQUIRED_MATLAB_REPORT_RELEASES, ['R2021a', 'R2024b', 'R2026a']);
  assert.deepEqual(REQUIRED_REPORT_EXPORT_FORMATS, ['png', 'pdf']);
  assert.equal(Object.isFrozen(REQUIRED_REPORT_ZONE_NAMES), true);
  assert.equal(Object.isFrozen(REQUIRED_MATLAB_REPORT_RELEASES), true);
  assert.equal(Object.isFrozen(REQUIRED_REPORT_EXPORT_FORMATS), true);
});

test('requires auditable ocean context, cross-format artifacts and MATLAB-only proof', () => {
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /figures\.json 必须包含 ocean_report/u);
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /scientific_context\.snapshot_id/u);
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /raw\/valid\/missing\/qc_rejected/u);
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /同一快照的 PNG 和 PDF/u);
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /完全自包含交互 HTML/u);
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /R2021a、R2024b、R2026a/u);
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /以 Octave 代替时，整份报告不得标记为通过/u);
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /观测事实、派生统计和物理推断/u);
});
