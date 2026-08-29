import assert from 'node:assert/strict';
import test from 'node:test';

import { createIllustratedReportContract, FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT, illustratedReportInstructions } from './illustrated-report-contract.mjs';
import { OCEAN_REPORT_SPEC } from './ocean-report-spec.mjs';
import { UNIVERSAL_OCEAN_REPORT_MODULES, UNIVERSAL_OCEAN_REPORT_SPEC } from './beibu-gulf-report-spec.mjs';
import { WIND_REPORT_SPEC } from './wind-report-spec.mjs';
import { OCEAN_VARIABLE_REPORT_SPEC } from './ocean-variable-report-spec.mjs';
import { PHYSICAL_OCEANOGRAPHY_SPEC } from './physical-oceanography-spec.mjs';

test('creates an adaptive illustrated report contract', () => {
  const contract = createIllustratedReportContract('/tmp/generated', 'ocean-report-contract-test');

  assert.equal(contract.id, 'ocean-report-contract-test');
  assert.deepEqual(contract.relativePaths, [
    'generated/ocean-report-contract-test.html',
    'generated/ocean-report-contract-test.md',
  ]);
  assert.equal(contract.minimumVisuals, 20);
  assert.equal(contract.minimumHeadings, 28);
  assert.equal(contract.minimumMarkdownBytes, 18_000);
  assert.equal(contract.minimumHtmlBytes, 32_000);
  assert.equal(contract.minimumHtmlFigures, 24);
  assert.equal(contract.minimumChartTypes, 10);
  assert.equal(contract.minimumAnalyticalClaims, 15);
  assert.equal(contract.minimumComparisons, 9);
  assert.equal(contract.minimumEvidenceMarkers, 15);
  assert.equal(contract.requiredZoneCount, 9);
  assert.equal(contract.requiresPointInventory, true);
  assert.equal(contract.requiresWindAnalysis, true);
  assert.equal(contract.requiresVariableAnalysis, true);
  assert.equal(contract.requiresPhysicalOceanography, true);
  assert.equal(contract.visualPrefix, 'generated/ocean-report-contract-test-visual-');
  const instructions = illustratedReportInstructions(contract);
  assert.match(instructions, /There is no fixed maximum/u);
  assert.match(instructions, /publication-quality and responsive/u);
  assert.match(instructions, /《Ocean Intelligence 优秀海洋报告 Spec》/u);
  assert.match(FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT, /九区点位数量与覆盖表/u);
  assert.match(FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT, /固定报告结构与页面顺序/u);
  assert.match(FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT, /风场专题加强 Spec/u);
  assert.match(FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT, /全变量数值与专项分析加强 Spec/u);
  assert.match(FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT, /物理海洋学高级推理 Spec/u);
  assert.match(FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT, /全报告专业图表与可视化规范/u);
  assert.match(FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT, /海洋报告自然语言与去模板化编辑规范/u);
  assert.match(FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT, /禁止非学术单字动词/u);
  assert.match(FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT, /图表物理解释与现实意义强制规范/u);
  assert.match(FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT, /暴露—脆弱性—后果/u);
  assert.match(FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT, /异常点位与多源联动报告强制规范/u);
  assert.match(FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT, /ocean_anomaly_point_linkage/u);
  assert.match(WIND_REPORT_SPEC, /分量值数/u);
  assert.match(WIND_REPORT_SPEC, /方向一致性/u);
  assert.match(WIND_REPORT_SPEC, /前一个等长24小时/u);
  assert.match(OCEAN_VARIABLE_REPORT_SPEC, /Practical Salinity/u);
  assert.match(OCEAN_VARIABLE_REPORT_SPEC, /Hs_total/u);
  assert.match(OCEAN_VARIABLE_REPORT_SPEC, /共同时间戳数/u);
  assert.match(OCEAN_VARIABLE_REPORT_SPEC, /高叶绿素不能自动等同/u);
  assert.match(PHYSICAL_OCEANOGRAPHY_SPEC, /ocean_physics_diagnostics/u);
  assert.match(PHYSICAL_OCEANOGRAPHY_SPEC, /Rossby 数/u);
  assert.match(PHYSICAL_OCEANOGRAPHY_SPEC, /可证伪条件/u);
  assert.match(PHYSICAL_OCEANOGRAPHY_SPEC, /Stewart 2008/u);
  assert.match(PHYSICAL_OCEANOGRAPHY_SPEC, /教材引用与数据证据引用分栏呈现/u);
  assert.match(OCEAN_REPORT_SPEC, /最终质量闸门/u);
});

test('injects the complete universal 15-module report profile for every report topic', () => {
  const contract = createIllustratedReportContract('/tmp/generated', 'beibu-gulf-report-test');
  const instructions = illustratedReportInstructions(contract);
  assert.equal(UNIVERSAL_OCEAN_REPORT_MODULES.length, 15);
  assert.deepEqual(UNIVERSAL_OCEAN_REPORT_MODULES.map((module) => module.title).slice(-1), ['新闻页面']);
  assert.match(UNIVERSAL_OCEAN_REPORT_SPEC, /所有海域、所有专题/u);
  assert.match(UNIVERSAL_OCEAN_REPORT_SPEC, /中心点定位与九区空间框架/u);
  assert.match(UNIVERSAL_OCEAN_REPORT_SPEC, /西北、北、东北；西、中间、东；西南、南、东南/u);
  assert.match(UNIVERSAL_OCEAN_REPORT_SPEC, /ocean_region_nine_zone_grid/u);
  assert.match(UNIVERSAL_OCEAN_REPORT_SPEC, /ocean_resolve_marine_area/u);
  assert.match(UNIVERSAL_OCEAN_REPORT_SPEC, /用户明确文本海域或坐标范围/u);
  assert.match(UNIVERSAL_OCEAN_REPORT_SPEC, /九区点位数量与覆盖表/u);
  assert.match(UNIVERSAL_OCEAN_REPORT_SPEC, /原始记录数/u);
  assert.match(UNIVERSAL_OCEAN_REPORT_SPEC, /独立平台数/u);
  assert.match(instructions, /15 个强制一级章节/u);
  assert.match(instructions, /新闻页面/u);
  assert.match(illustratedReportInstructions(createIllustratedReportContract('/tmp/generated', 'atlantic-report-test')), /15 个强制一级章节/u);
});
