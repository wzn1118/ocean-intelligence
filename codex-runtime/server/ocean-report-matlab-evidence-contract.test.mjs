import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_MATLAB_REPORT_RELEASES,
  REQUIRED_REPORT_EXPORT_FORMATS,
  REQUIRED_REPORT_ZONE_NAMES,
} from './illustrated-report-contract.mjs';
import { PROFESSIONAL_VISUALIZATION_SPEC } from './professional-visualization-spec.mjs';
import { POINT_TEMPERATURE_INTERACTION_SPEC } from './point-temperature-interaction-spec.mjs';

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

test('requires exact uncertainty machine fields without certifying free prose by substring matching', () => {
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /每个主报告 figure 必须声明 data-uncertainty-status 和 data-uncertainty-method/u);
  for (const [attribute, field] of [
    ['data-uncertainty-status', 'scientific_context.uncertainty.status'],
    ['data-uncertainty-method', 'scientific_context.uncertainty.method'],
  ]) {
    assert.ok(PROFESSIONAL_VISUALIZATION_SPEC.includes(`${attribute} 精确等于 ${field}`));
  }
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /仅去除首尾空白，大小写和内部空白保持区分/u);
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /data-uncertainty 保留非空自然语言说明/u);
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /不能替代这两个机器字段/u);
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /不得通过 includes 子串命中认证语义/u);
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /自由说明仍需人审，字段一致不等于说明科学有效/u);
});

test('requires unique per-figure variables with exact catalog units while allowing ordered subsets', () => {
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /scientific_context\.variables 名称必须非空且唯一/u);
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /ocean_report\.variables 目录中的唯一同名条目，单位必须精确一致/u);
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /允许按顺序选取目录子集/u);
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /未知变量、重复名称、歧义目录或单位冲突必须拒绝/u);
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /data-variable 必须属于该 figure 的变量列表，data-unit 与所选变量一致/u);
  assert.match(PROFESSIONAL_VISUALIZATION_SPEC, /不能仅在总目录中找到同名项就通过/u);
});

test('documents the shared bounded calendar and timezone contract for coverage endpoints', () => {
  for (const instructions of [PROFESSIONAL_VISUALIZATION_SPEC, POINT_TEMPERATURE_INTERACTION_SPEC]) {
    assert.match(instructions, /coverage 端点/u);
    assert.match(instructions, /共享 parseOceanEvidenceTime/u);
    assert.ok(instructions.includes('YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss[.1-3位小数][Z|±HH:mm|±HHmm]'));
    assert.match(instructions, /日期时间必须完整到秒，可选小数仅 1-3 位/u);
    assert.match(instructions, /无后缀明确按 UTC/u);
    assert.match(instructions, /合法 offset 按其表示的原时刻换算，不依赖宿主 TZ/u);
    assert.match(instructions, /coverage 的 timezone 元数据仍声明 UTC/u);
    assert.match(instructions, /校验真实日历分量/u);
    assert.match(instructions, /拒绝无效日期、rollover、24:00 和超毫秒精度/u);
    assert.match(instructions, /结束时间不得早于开始时间/u);
  }
});

test('separates literal main-report time binding from interactive endpoint instant binding', () => {
  for (const instructions of [PROFESSIONAL_VISUALIZATION_SPEC, POINT_TEMPERATURE_INTERACTION_SPEC]) {
    assert.match(instructions, /主报告 HTML figure 的 data-time-start\/data-time-end[^\n]+逐字一致/u);
    assert.match(instructions, /交互 HTML[^\n]+解析后的实际 instant[^\n]+所属[^\n]+figure/u);
    assert.match(instructions, /允许同一时刻的合法 offset 写法/u);
    assert.match(instructions, /不同 figure 之间、图件与总报告 requested\/effective coverage 之间不要求所有时间窗相等/u);
    assert.match(instructions, /不代表已逐条认证原始 point 时间/u);
    assert.match(instructions, /MATLAB 执行或视觉检查通过/u);
  }
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /逐点提示、ObservationID 和源键检查仍按原契约执行/u);
  assert.match(POINT_TEMPERATURE_INTERACTION_SPEC, /时间窗端点实际 instant/u);
});
