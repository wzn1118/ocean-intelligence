import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createIllustratedReportContract,
  FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT,
  illustratedReportInstructions,
  inspectIllustratedReportEvidence,
  REQUIRED_MATLAB_REPORT_RELEASES,
  REQUIRED_REPORT_EXPORT_FORMATS,
  REQUIRED_REPORT_ZONE_NAMES,
} from './illustrated-report-contract.mjs';
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
  assert.deepEqual(contract.requiredZoneNames, REQUIRED_REPORT_ZONE_NAMES);
  assert.deepEqual(contract.requiredMatlabReleases, REQUIRED_MATLAB_REPORT_RELEASES);
  assert.deepEqual(contract.requiredExportFormats, REQUIRED_REPORT_EXPORT_FORMATS);
  assert.equal(contract.minimumInteractiveFigures, 1);
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
  assert.match(FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT, /MathWorks MATLAB 权威制图与证据流程/u);
  assert.match(FULL_OCEAN_OBSERVATION_REPORT_SPEC_PROMPT, /runtime_pending\/static-only/u);
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
  assert.match(instructions, /only a real MathWorks MATLAB run/u);
  assert.match(instructions, /data-claim-id/u);
  assert.match(instructions, /generated_at/u);
  assert.match(instructions, /R2021a, R2024b, R2026a/u);
  assert.match(instructions, /ocean_report object/u);
  assert.match(instructions, /self-contained HTML export/u);
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

test('audits conclusion evidence, limitations, figure links, hashes, and manifest freshness', () => {
  const fixture = createReportEvidenceFixture();
  const result = inspectIllustratedReportEvidence(fixture);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.claimsOk, true);
  assert.equal(result.figureLinksOk, true);
  assert.equal(result.artifactsOk, true);
  assert.equal(result.manifestFreshnessOk, true);
  assert.equal(result.oceanReportOk, true);
  assert.equal(result.matlabRuntimeOk, true);
  assert.equal(result.figureEvidenceOk, true);
  assert.equal(result.interactiveFigureCount, 1);
});

test('rejects comment-forged claims, fake hashes, and stale regenerated manifests', () => {
  const fixture = createReportEvidenceFixture();
  writeFileSync(fixture.htmlPath, '<!-- <p data-claim-id="fake" data-evidence-ids="fig-1" data-limitations="fake limitation">fake</p> -->');
  fixture.manifest.generated_at = new Date().toISOString();
  writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
  const forgedClaim = inspectIllustratedReportEvidence(fixture);
  assert.equal(forgedClaim.claimCount, 0);
  assert.equal(forgedClaim.claimsOk, false);

  const valid = createReportEvidenceFixture();
  writeFileSync(valid.artifactPath, 'tampered-artifact');
  const fakeHash = inspectIllustratedReportEvidence(valid);
  assert.equal(fakeHash.artifactsOk, false);

  valid.manifest.figures[0].exports.png.bytes = statSync(valid.artifactPath).size;
  valid.manifest.figures[0].exports.png.sha256 = fileHash(valid.artifactPath);
  valid.manifest.generated_at = new Date(statSync(valid.artifactPath).mtimeMs - 60_000).toISOString();
  writeFileSync(valid.manifestPath, JSON.stringify(valid.manifest));
  const stale = inspectIllustratedReportEvidence({ ...valid, freshnessToleranceMs: 1 });
  assert.equal(stale.artifactsOk, true);
  assert.equal(stale.manifestFreshnessOk, false);
  assert.match(stale.freshness.violations.join('\n'), /newer_than_generated_at/u);
});

test('rejects incomplete ocean context, cross-format drift, and non-MATLAB runtime evidence', () => {
  const incomplete = createReportEvidenceFixture();
  delete incomplete.manifest.ocean_report.variables[0].unit;
  incomplete.manifest.figures[0].exports.pdf.snapshot_id = 'different-snapshot';
  incomplete.manifest.matlab_ci.runs[1].authoritative_runtime = 'Octave';
  incomplete.manifest.matlab_ci.runs[1].runtime_status = 'static-only';
  writeFileSync(incomplete.manifestPath, JSON.stringify(incomplete.manifest));

  const result = inspectIllustratedReportEvidence(incomplete);
  assert.equal(result.ok, false);
  assert.equal(result.oceanReportOk, false);
  assert.equal(result.figureEvidenceOk, false);
  assert.equal(result.matlabRuntimeOk, false);
  assert.match(result.oceanReport.violations.join('\n'), /variables\[0\]\.unit/u);
  assert.match(result.figureEvidenceViolations.join('\n'), /exports\[1\]\.snapshot_id/u);
  assert.match(result.matlabRuntime.violations.join('\n'), /R2024b\.runtime/u);
});

function createReportEvidenceFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'illustrated-report-evidence-'));
  const htmlPath = path.join(root, 'report.html');
  const markdownPath = path.join(root, 'report.md');
  const artifactPath = path.join(root, 'figure.png');
  const pdfPath = path.join(root, 'figure.pdf');
  const interactionPath = path.join(root, 'figure.html');
  const manifestPath = path.join(root, 'figures.json');
  writeFileSync(htmlPath, [
    '<html><body>',
    '<p data-claim-id="claim-1" data-evidence-ids="fig-1" data-limitations="Only the observed UTC window is supported.">SST increased.</p>',
    '<figure data-figure-id="fig-1" data-chart-type="line" data-chart-family="temporal" data-source="fixture" data-snapshot-id="snapshot-20260905" data-variable="sea_water_temperature" data-unit="degree_Celsius" data-time-start="2026-09-03T00:00:00Z" data-time-end="2026-09-03T01:00:00Z" data-spatial-coverage="Test Sea 120-121E 30-31N" data-qc-summary="raw=2 valid=2 missing=0 qc_rejected=0" data-uncertainty="present Instrument accuracy metadata" data-anomaly-status="not-evaluated" data-matlab-release="R2026a">',
    '<figcaption>SST in degrees Celsius over the observed UTC window; n=24 after QC, supporting claim-1 while not establishing a long-term trend.</figcaption>',
    '</figure>',
    '</body></html>',
  ].join(''));
  writeFileSync(markdownPath, '# Report\n\nConclusion with evidence and explicit limitations.');
  writeFileSync(artifactPath, 'real-artifact-bytes-for-contract-test');
  writeFileSync(pdfPath, 'real-pdf-artifact-bytes-for-contract-test');
  writeFileSync(interactionPath, interactionFixtureHtml());
  const manifest = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    generator: 'report evidence fixture',
    ocean_report: {
      area: { name: 'Test Sea', bounds: [120, 30, 121, 31], zones: REQUIRED_REPORT_ZONE_NAMES },
      requested_coverage: { start: '2026-09-03T00:00:00Z', end: '2026-09-03T01:00:00Z', timezone: 'UTC', spatial: 'Test Sea bounds', depth: 'surface and bottom observations' },
      effective_coverage: { start: '2026-09-03T00:00:00Z', end: '2026-09-03T01:00:00Z', timezone: 'UTC', spatial: 'Test Sea 120-121E 30-31N', depth: 'observed surface and bottom levels' },
      data_sources: [{ id: 'source-1', name: 'Fixture observations', version: '2026-09-03', accessed_at: '2026-09-05T00:00:00Z' }],
      variables: [{ name: 'sea_water_temperature', quantity: 'sea water temperature', unit: 'degree_Celsius', source_ids: ['source-1'] }],
      anomaly: { status: 'not-evaluated', method: 'No baseline available', limitations: 'The fixture does not support anomaly attribution.' },
      uncertainty: { status: 'present', method: 'Instrument accuracy metadata', limitations: 'Calibration evidence is limited to the supplied snapshot.' },
      conclusion: { status: 'audited', limitations: 'Only the stated one-hour UTC fixture window is supported.' },
    },
    matlab_ci: {
      required_releases: REQUIRED_MATLAB_REPORT_RELEASES,
      runs: REQUIRED_MATLAB_REPORT_RELEASES.map((release) => ({
        release,
        authoritative_runtime: 'MATLAB',
        runtime_status: 'passed',
        execution_verified: true,
        command: `matlab -batch "run_report('${release}')"`,
        toolboxes: ['MATLAB'],
        artifact_validation: { status: 'passed' },
        visual_inspection: { status: 'passed' },
        evidence_id: `ci-${release.toLowerCase()}`,
      })),
    },
    figures: [{
      id: 'fig-1',
      source: 'source-1',
      scientific_context: {
        snapshot_id: 'snapshot-20260905',
        variables: [{ name: 'sea_water_temperature', unit: 'degree_Celsius' }],
        temporal_coverage: { start: '2026-09-03T00:00:00Z', end: '2026-09-03T01:00:00Z', timezone: 'UTC' },
        spatial_coverage: { name: 'Test Sea', bounds: [120, 30, 121, 31] },
        qc: { raw: 2, valid: 2, missing: 0, qc_rejected: 0 },
        uncertainty: { status: 'present', method: 'Instrument accuracy metadata', limitations: 'Calibration evidence is limited to the supplied snapshot.' },
        anomaly: { status: 'not-evaluated', method: 'No baseline available', limitations: 'The fixture does not support anomaly attribution.' },
      },
      interaction: { required: true, self_contained: true, validation_status: 'passed', snapshot_id: 'snapshot-20260905' },
      runtime: {
        authoritative_runtime: 'MATLAB',
        matlab_release: 'R2026a',
        runtime_status: 'passed',
        execution_verified: true,
        artifact_validation: { status: 'passed' },
        visual_inspection: { status: 'passed' },
      },
      exports: {
        png: {
          file: path.basename(artifactPath),
          snapshot_id: 'snapshot-20260905',
          width: 1200,
          height: 800,
          dpi: 200,
          bytes: statSync(artifactPath).size,
          sha256: fileHash(artifactPath),
        },
        pdf: {
          file: path.basename(pdfPath),
          snapshot_id: 'snapshot-20260905',
          width: 432,
          height: 288,
          text: 'Sea water temperature degree Celsius UTC Test Sea',
          bytes: statSync(pdfPath).size,
          sha256: fileHash(pdfPath),
        },
        html: {
          file: path.basename(interactionPath),
          snapshot_id: 'snapshot-20260905',
          self_contained: true,
          bytes: statSync(interactionPath).size,
          sha256: fileHash(interactionPath),
        },
      },
    }],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { root, htmlPath, markdownPath, artifactPath, pdfPath, interactionPath, manifestPath, outputDirectory: root, manifest };
}

function interactionFixtureHtml() {
  const points = [
    { id: 'P1', series: 'surface', temperature: 20, unit: 'degree_Celsius', time: '2026-09-03T00:00:00Z', longitude: 120.2, latitude: 30.2, qc: 'good' },
    { id: 'P2', series: 'bottom', temperature: 18, unit: 'degree_Celsius', time: '2026-09-03T01:00:00Z', longitude: 120.4, latitude: 30.4, qc: 'good' },
  ];
  const pointMarkup = points.map((point, index) => `<g class="temperature-point" tabindex="0" role="img" data-point-index="${index}" data-observation-id="${point.id}" data-temperature="${point.temperature}" data-unit="${point.unit}" data-time="${point.time}" data-longitude="${point.longitude}" data-latitude="${point.latitude}" data-qc="${point.qc}" aria-label="点位 ${point.id} 温度 ${point.temperature} 单位 ${point.unit} 时间 ${point.time} 经度 ${point.longitude} 纬度 ${point.latitude} QC ${point.qc}"></g>`).join('');
  return `<!doctype html><html><head><style>.temperature-point:hover{opacity:.8}.temperature-point:focus-visible{outline:2px solid black}</style></head><body data-snapshot-id="snapshot-20260905" data-source="source-1" data-variable="sea_water_temperature" data-unit="degree_Celsius" data-time-start="2026-09-03T00:00:00Z" data-time-end="2026-09-03T01:00:00Z" data-timezone="UTC" data-spatial-coverage="Test Sea 120-121E 30-31N" data-qc-summary="raw=2 valid=2 missing=0 qc_rejected=0" data-uncertainty="instrument accuracy; limited calibration evidence" data-anomaly-status="not-evaluated" data-authoritative-runtime="MATLAB" data-matlab-release="R2026a" data-runtime-status="passed" data-execution-verified="true" data-artifact-validation="passed" data-visual-inspection="passed"><svg>${pointMarkup}</svg><div class="legend" aria-label="系列图例"><span data-series-name="surface">surface</span><span data-series-name="bottom">bottom</span></div><div role="tooltip" hidden></div><script type="application/json">${JSON.stringify({ points })}</script><script>document.querySelectorAll('.temperature-point').forEach((point)=>{point.addEventListener('pointerenter',showTooltip);point.addEventListener('focus',showTooltip);});function showTooltip(){}</script></body></html>`;
}

function fileHash(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
