import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

for (const key of ['raw', 'valid', 'missing', 'qc_rejected']) {
  test(`rejects a QC ${key}=20 prefix match against manifest ${key}=2`, () => {
    const fixture = createReportEvidenceFixture();
    fixture.manifest.figures[0].scientific_context.qc[key] = 2;
    const summary = Object.entries(fixture.manifest.figures[0].scientific_context.qc)
      .map(([name, count]) => `${name}=${name === key ? 20 : count}`).join(' ');
    setReportFigureAttribute(fixture, 'data-qc-summary', summary);
    writeFixtureManifest(fixture);

    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, false);
    assert.equal(result.figureLinksOk, false);
    assert.ok(result.figureViolations.includes(`figures[0].data-qc-summary.${key}.mismatch`));
    assert.equal(result.figureEvidenceOk, true);
    assert.equal(result.artifactsOk, true);
    assert.equal(result.matlabRuntimeOk, true);
    assert.equal(result.manifestFreshnessOk, true);
  });

  for (const conflicting of [false, true]) {
    test(`rejects ${conflicting ? 'conflicting' : 'identical'} duplicate QC ${key} tokens`, () => {
      const fixture = createReportEvidenceFixture();
      const duplicate = fixture.manifest.figures[0].scientific_context.qc[key] + (conflicting ? 1 : 0);
      setReportFigureAttribute(fixture, 'data-qc-summary',
        `raw=2 valid=2 missing=0 qc_rejected=0 ${key}=${duplicate}`);
      writeFixtureManifest(fixture);

      const result = inspectIllustratedReportEvidence(fixture);
      assert.equal(result.ok, false);
      assert.equal(result.figureLinksOk, false);
      assert.ok(result.figureViolations.some((violation) => violation.startsWith('figures[0].data-qc-summary.')));
    });
  }
}

for (const [name, summary, raw] of [
  ['decimal', 'raw=2.0 valid=2 missing=0 qc_rejected=0'],
  ['fraction', 'raw=2.5 valid=2 missing=0 qc_rejected=0'],
  ['exponent', 'raw=2e0 valid=2 missing=0 qc_rejected=0'],
  ['negative', 'raw=-2 valid=2 missing=0 qc_rejected=0'],
  ['explicit plus sign', 'raw=+2 valid=2 missing=0 qc_rejected=0'],
  ['leading zero', 'raw=02 valid=2 missing=0 qc_rejected=0'],
  ['hexadecimal', 'raw=0x2 valid=2 missing=0 qc_rejected=0'],
  ['NaN', 'raw=NaN valid=2 missing=0 qc_rejected=0'],
  ['Infinity', 'raw=Infinity valid=2 missing=0 qc_rejected=0'],
  ['unsafe integer', 'raw=9007199254740992 valid=2 missing=0 qc_rejected=0', 9007199254740992],
  ['rounded unsafe integer', 'raw=9007199254740993 valid=2 missing=0 qc_rejected=0', 9007199254740992],
  ['unknown key', 'raw=2 valid=2 missing=0 qc_rejected=0 total=2'],
  ['trailing prose', 'raw=2 valid=2 missing=0 qc_rejected=0 verified'],
  ['concatenated tokens', 'raw=2valid=2 missing=0 qc_rejected=0'],
  ['semicolon separator', 'raw=2; valid=2 missing=0 qc_rejected=0'],
  ['repeated equals sign', 'raw=2=20 valid=2 missing=0 qc_rejected=0'],
  ['prefixed key', 'draw=2 valid=2 missing=0 qc_rejected=0'],
  ['missing key', 'raw=2 valid=2 missing=0'],
]) {
  test(`rejects QC summary with ${name}`, () => {
    const fixture = createReportEvidenceFixture();
    if (raw !== undefined) fixture.manifest.figures[0].scientific_context.qc.raw = raw;
    setReportFigureAttribute(fixture, 'data-qc-summary', summary);
    writeFixtureManifest(fixture);

    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, false);
    assert.equal(result.figureLinksOk, false);
    assert.ok(result.figureViolations.some((violation) => violation.startsWith('figures[0].data-qc-summary.')));
    assert.equal(result.figureEvidenceOk, true);
    assert.equal(result.matlabRuntimeOk, true);
    assert.equal(result.manifestFreshnessOk, true);
  });
}

for (const [name, summary, qc] of [
  ['zero counts', 'raw=0 valid=0 missing=0 qc_rejected=0', { raw: 0, valid: 0, missing: 0, qc_rejected: 0 }],
  ['reordered space-separated counts', '  qc_rejected=0   missing=0 valid=2  raw=2  ', { raw: 2, valid: 2, missing: 0, qc_rejected: 0 }],
  ['maximum safe integer without a new total constraint', 'raw=9007199254740991 valid=2 missing=0 qc_rejected=0', { raw: Number.MAX_SAFE_INTEGER, valid: 2, missing: 0, qc_rejected: 0 }],
]) {
  test(`accepts QC ${name}`, () => {
    const fixture = createReportEvidenceFixture();
    fixture.manifest.figures[0].scientific_context.qc = qc;
    setReportFigureAttribute(fixture, 'data-qc-summary', summary);
    writeFixtureManifest(fixture);

    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.figureViolations, []);
  });
}

for (const release of REQUIRED_MATLAB_REPORT_RELEASES) {
  test(`accepts a figure whose actual ${release} release matches its passed matrix entry`, () => {
    const fixture = createReportEvidenceFixture();
    fixture.manifest.figures[0].runtime.matlab_release = release;
    setReportFigureAttribute(fixture, 'data-matlab-release', release);
    writeFixtureManifest(fixture);

    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, true, JSON.stringify(result));
  });
}

for (const release of ['R2021a', 'R2024b']) {
  test(`rejects HTML ${release} for an actual R2026a figure even when both matrix releases passed`, () => {
    const fixture = createReportEvidenceFixture();
    setReportFigureAttribute(fixture, 'data-matlab-release', release);
    writeFixtureManifest(fixture);

    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, false);
    assert.equal(result.figureLinksOk, false);
    assert.deepEqual(result.figureViolations, ['figures[0].data-matlab-release.mismatch']);
    assert.equal(result.matlabRuntimeOk, true);
    assert.equal(result.figureEvidenceOk, true);
  });
}

test('binds each HTML figure to its own actual release rather than the report release set', () => {
  const fixture = createReportEvidenceFixture();
  const html = readFileSync(fixture.htmlPath, 'utf8');
  const figureBlock = html.match(/<figure\b[\s\S]*?<\/figure>/u)[0];
  const secondBlock = figureBlock.replace('data-figure-id="fig-1"', 'data-figure-id="fig-2"')
    .replace('data-matlab-release="R2026a"', 'data-matlab-release="R2021a"');
  writeFileSync(fixture.htmlPath, html.replace('</body>', `${secondBlock}</body>`));
  const secondFigure = structuredClone(fixture.manifest.figures[0]);
  secondFigure.id = 'fig-2';
  secondFigure.runtime.matlab_release = 'R2021a';
  fixture.manifest.figures.push(secondFigure);
  writeFixtureManifest(fixture);
  assert.equal(inspectIllustratedReportEvidence(fixture).ok, true);

  writeFileSync(fixture.htmlPath, readFileSync(fixture.htmlPath, 'utf8')
    .replace(/data-matlab-release="(R2026a|R2021a)"/gu,
      (_, release) => `data-matlab-release="${release === 'R2026a' ? 'R2021a' : 'R2026a'}"`));
  writeFixtureManifest(fixture);
  const result = inspectIllustratedReportEvidence(fixture);
  assert.equal(result.ok, false);
  assert.equal(result.matlabRuntimeOk, true);
  assert.equal(result.figureEvidenceOk, true);
  assert.deepEqual(result.figureViolations, [
    'figures[0].data-matlab-release.mismatch',
    'figures[1].data-matlab-release.mismatch',
  ]);
});

for (const status of ['missing', 'failed', 'unknown', 'static-only']) {
  test(`rejects a matching figure release with ${status} matrix evidence`, () => {
    const fixture = createReportEvidenceFixture();
    if (status === 'missing') {
      fixture.manifest.matlab_ci.runs = fixture.manifest.matlab_ci.runs.filter((run) => run.release !== 'R2026a');
    } else {
      fixture.manifest.matlab_ci.runs.find((run) => run.release === 'R2026a').runtime_status = status;
    }
    writeFixtureManifest(fixture);

    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, false);
    assert.equal(result.matlabRuntimeOk, false);
    assert.equal(result.figureLinksOk, false);
    assert.deepEqual(result.figureViolations, ['figures[0].data-matlab-release.mismatch']);
  });
}

for (const release of REQUIRED_MATLAB_REPORT_RELEASES) {
  for (const statuses of [['passed', 'passed'], ['passed', 'failed'], ['failed', 'passed']]) {
    test(`synthetic identity rejects duplicate ${release} runs ordered ${statuses.join('/')}`, (context) => {
      const fixture = createSyntheticIdentityFixture(context, release);
      fixture.manifest.matlab_ci.runs = fixture.manifest.matlab_ci.runs.flatMap((run) => (
        run.release === release ? statuses.map((runtime_status) => ({ ...structuredClone(run), runtime_status })) : [run]
      ));
      if (statuses[0] === statuses[1]) {
        const duplicates = fixture.manifest.matlab_ci.runs.filter((run) => run.release === release);
        assert.deepEqual(duplicates[0], duplicates[1]);
      }
      const result = assertSyntheticIdentityRejected(fixture, 'matlabRuntimeOk', `matlab_ci.runs.${release}.duplicate`);
      assert.equal(Object.hasOwn(result.matlabRuntime.releases, release), false);
      assert.equal(result.figureLinksOk, false);
      assert.ok(result.figureViolations.includes('figures[0].data-matlab-release.mismatch'));
    });
  }

  test(`synthetic identity rejects a missing required ${release} run`, (context) => {
    const fixture = createSyntheticIdentityFixture(context, release);
    fixture.manifest.matlab_ci.runs = fixture.manifest.matlab_ci.runs.filter((run) => run.release !== release);
    assertSyntheticIdentityRejected(fixture, 'matlabRuntimeOk', `matlab_ci.runs.${release}.missing`);
  });

  test(`synthetic identity rejects duplicate ${release} in required_releases`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    fixture.manifest.matlab_ci.required_releases = [...fixture.manifest.matlab_ci.required_releases, release];
    assertSyntheticIdentityRejected(fixture, 'matlabRuntimeOk', 'matlab_ci.required_releases.duplicate');
  });

  for (const reversed of [false, true]) {
    test(`synthetic identity accepts ${release} with distinct sources and variables, reversed=${reversed}`, (context) => {
      const fixture = createSyntheticIdentityFixture(context, release);
      fixture.manifest.ocean_report.data_sources.push({
        id: 'source-2', name: 'Synthetic second source', version: 'unit-fixture-v2', accessed_at: '2026-09-05T00:00:00Z',
      });
      fixture.manifest.ocean_report.variables[0].source_ids.push('source-2');
      fixture.manifest.ocean_report.variables.push({
        name: 'sea_water_salinity', quantity: 'sea water salinity', unit: 'g kg-1', source_ids: ['source-2'],
      });
      if (reversed) {
        fixture.manifest.matlab_ci.required_releases = [...fixture.manifest.matlab_ci.required_releases].reverse();
        fixture.manifest.matlab_ci.runs.reverse();
        fixture.manifest.ocean_report.data_sources.reverse();
        fixture.manifest.ocean_report.variables.forEach((variable) => variable.source_ids.reverse());
        fixture.manifest.ocean_report.variables.reverse();
      }
      writeFixtureManifest(fixture);
      const result = inspectIllustratedReportEvidence(fixture);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.matlabRuntimeOk, true);
      assert.equal(result.figureEvidenceOk, true);
      assert.equal(result.oceanReportOk, true);
      assert.equal(result.oceanReport.sourceCount, 2);
      assert.equal(result.oceanReport.variableCount, 2);
      assert.deepEqual(Object.keys(result.matlabRuntime.releases).sort(), [...REQUIRED_MATLAB_REPORT_RELEASES].sort());
    });
  }
}

test('synthetic identity rejects identical manifest figure ids despite valid exports', (context) => {
  const fixture = createSyntheticIdentityFixture(context);
  fixture.manifest.figures.push(structuredClone(fixture.manifest.figures[0]));
  assertSyntheticIdentityRejected(fixture, 'figureEvidenceOk', 'manifest.figures.id.duplicate');
});

for (const id of ['', ' \t\n ']) {
  test(`synthetic identity rejects an extra blank figure id ${JSON.stringify(id)} with valid exports`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    fixture.manifest.figures.push({ ...structuredClone(fixture.manifest.figures[0]), id });
    assertSyntheticIdentityRejected(fixture, 'figureEvidenceOk', 'manifest.figures[1].id');
  });
}

for (const [collection, field] of [['data_sources', 'id'], ['variables', 'name']]) {
  test(`synthetic identity rejects identical ocean_report.${collection}.${field} duplicates`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    const entries = fixture.manifest.ocean_report[collection];
    entries.push(structuredClone(entries[0]));
    assertSyntheticIdentityRejected(fixture, 'oceanReportOk', `ocean_report.${collection}[1].${field}.duplicate`);
  });
}

for (const sourceIds of [['unknown-source'], ['source-1', 'unknown-source'], ['unknown-source', 'source-1']]) {
  test(`synthetic identity rejects unknown source references ${JSON.stringify(sourceIds)}`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    fixture.manifest.ocean_report.variables[0].source_ids = sourceIds;
    const badIndex = sourceIds.indexOf('unknown-source');
    assertSyntheticIdentityRejected(fixture, 'oceanReportOk', `ocean_report.variables[0].source_ids[${badIndex}]`);
  });
}

test('synthetic identity rejects a duplicate variable source reference', (context) => {
  const fixture = createSyntheticIdentityFixture(context);
  fixture.manifest.ocean_report.variables[0].source_ids.push('source-1');
  assertSyntheticIdentityRejected(fixture, 'oceanReportOk', 'ocean_report.variables[0].source_ids[1].duplicate');
});

for (const [kind, value] of [['null', null], ['number', 42], ['empty', ''], ['whitespace', ' \t\n ']]) {
  test(`synthetic identity rejects a mixed ${kind} required_releases entry`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    fixture.manifest.matlab_ci.required_releases = [...fixture.manifest.matlab_ci.required_releases, value];
    assertSyntheticIdentityRejected(fixture, 'matlabRuntimeOk', 'matlab_ci.required_releases');
  });

  test(`synthetic identity rejects an extra run with a ${kind} release`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    fixture.manifest.matlab_ci.runs.push({ ...structuredClone(fixture.manifest.matlab_ci.runs[0]), release: value });
    assertSyntheticIdentityRejected(fixture, 'matlabRuntimeOk', 'matlab_ci.runs[3].release');
  });

  test(`synthetic identity rejects a mixed ${kind} toolbox entry`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    fixture.manifest.matlab_ci.runs.find((run) => run.release === 'R2026a').toolboxes.push(value);
    assertSyntheticIdentityRejected(fixture, 'matlabRuntimeOk', 'matlab_ci.runs.R2026a.toolboxes');
  });

  for (const [collection, field] of [['data_sources', 'id'], ['variables', 'name']]) {
    test(`synthetic identity rejects ${kind} ocean_report.${collection}.${field}`, (context) => {
      const fixture = createSyntheticIdentityFixture(context);
      fixture.manifest.ocean_report[collection][0][field] = value;
      assertSyntheticIdentityRejected(fixture, 'oceanReportOk', `ocean_report.${collection}[0].${field}`);
    });
  }

  test(`synthetic identity rejects a mixed ${kind} variable source reference`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    if (typeof value === 'number') {
      fixture.manifest.ocean_report.data_sources.push({
        ...structuredClone(fixture.manifest.ocean_report.data_sources[0]), id: String(value),
      });
      fixture.manifest.ocean_report.variables[0].source_ids.push(String(value));
      writeFixtureManifest(fixture);
      assert.equal(inspectIllustratedReportEvidence(fixture).ok, true);
      fixture.manifest.ocean_report.variables[0].source_ids[1] = value;
    } else {
      fixture.manifest.ocean_report.variables[0].source_ids.push(value);
    }
    assertSyntheticIdentityRejected(fixture, 'oceanReportOk', 'ocean_report.variables[0].source_ids[1]');
  });
}

test('synthetic identity rejects an extra run with no release field', (context) => {
  const fixture = createSyntheticIdentityFixture(context);
  const run = structuredClone(fixture.manifest.matlab_ci.runs[0]);
  delete run.release;
  fixture.manifest.matlab_ci.runs.push(run);
  assertSyntheticIdentityRejected(fixture, 'matlabRuntimeOk', 'matlab_ci.runs[3].release');
});

function createSyntheticIdentityFixture(context, release = 'R2026a') {
  const fixture = createReportEvidenceFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  fixture.manifest.generator = 'Synthetic contract test only; not MATLAB execution, real rendering or 100-point evidence';
  fixture.manifest.figures[0].runtime.matlab_release = release;
  setReportFigureAttribute(fixture, 'data-matlab-release', release);
  writeFixtureManifest(fixture);
  const baseline = inspectIllustratedReportEvidence(fixture);
  assert.equal(baseline.ok, true, JSON.stringify(baseline));
  return fixture;
}

function assertSyntheticIdentityRejected(fixture, okField, expectedPath) {
  writeFixtureManifest(fixture);
  const result = inspectIllustratedReportEvidence(fixture);
  const violations = okField === 'matlabRuntimeOk' ? result.matlabRuntime.violations
    : okField === 'oceanReportOk' ? result.oceanReport.violations : result.figureEvidenceViolations;
  const diagnostics = JSON.stringify({ ok: result.ok, [okField]: result[okField], violations });
  assert.equal(result.ok, false, diagnostics);
  assert.equal(result[okField], false, diagnostics);
  assert.ok(violations.some((violation) => violation.includes(expectedPath)), `${expectedPath}: ${diagnostics}`);
  assert.equal(result.artifactsOk, true, JSON.stringify(result.artifactChecks));
  assert.equal(result.manifestFreshnessOk, true, JSON.stringify(result.freshness));
  return result;
}

function setReportFigureAttribute(fixture, attribute, value) {
  const html = readFileSync(fixture.htmlPath, 'utf8');
  writeFileSync(fixture.htmlPath, html.replace(new RegExp(`${attribute}="[^"]*"`, 'u'), `${attribute}="${value}"`));
}

function writeFixtureManifest(fixture) {
  fixture.manifest.generated_at = new Date().toISOString();
  writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
}

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
