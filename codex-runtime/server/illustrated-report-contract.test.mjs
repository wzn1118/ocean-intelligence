import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
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
  assert.match(instructions, /data-uncertainty-status/u);
  assert.match(instructions, /data-uncertainty-method/u);
  assert.match(instructions, /cannot substitute for either machine field/u);
  assert.match(instructions, /generated_at/u);
  assert.match(instructions, /R2021a, R2024b, R2026a/u);
  assert.match(instructions, /ocean_report object/u);
  assert.match(instructions, /self-contained HTML export/u);
  assert.match(instructions, /scientific_context\.variables list must use unique names from ocean_report\.variables with exactly matching units/u);
  assert.match(instructions, /HTML attributes must still reference a variable in that same figure/u);
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

for (const field of ['htmlPath', 'markdownPath', 'manifestPath', 'png', 'pdf', 'html']) {
  for (const kind of ['absolute', 'traversal', 'symlink', 'intermediate-symlink', 'internal-symlink']) {
    test(`authorized paths reject ${field} ${kind} before external filesystem access`, (context) => {
      const fixture = createReportEvidenceFixture();
      const outside = mkdtempSync(`${fixture.root}-outside-`);
      context.after(() => {
        rmSync(fixture.root, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      });
      const entry = field.endsWith('Path');
      const source = entry ? fixture[field] : path.join(fixture.root, fixture.manifest.figures[0].exports[field].file);
      const externalFile = path.join(outside, path.basename(source));
      copyFileSync(source, externalFile);
      let reference = externalFile;
      let link;
      if (kind === 'traversal') {
        reference = `${fixture.root}/../${path.basename(outside)}/${path.basename(source)}`;
      } else if (kind.includes('symlink')) {
        link = path.join(fixture.root, 'linked');
        const directoryLink = kind === 'intermediate-symlink';
        symlinkSync(directoryLink ? outside : kind === 'internal-symlink' ? source : externalFile,
          link, directoryLink ? 'dir' : 'file');
        reference = directoryLink ? path.join(link, path.basename(source)) : link;
      }
      if (entry) fixture[field] = reference;
      else {
        fixture.manifest.figures[0].exports[field].file = kind === 'absolute'
          ? reference : kind === 'traversal'
            ? `../${path.basename(outside)}/${path.basename(source)}` : path.relative(fixture.root, reference);
        writeFixtureManifest(fixture);
      }
      const { result, accesses } = traceEvidenceFilesystem(context, fixture);
      assert.equal(result.ok, false);
      if (entry) {
        assert.equal(result.pathsOk, false);
        assert.ok(result.pathViolations.includes(`${field}.${link ? 'symlink' : 'outside_output_directory'}`),
          JSON.stringify(result.pathViolations));
        if (field === 'manifestPath') assert.equal(result.manifestOk, false);
      } else {
        const artifact = result.artifactChecks.find((candidate) => candidate.format === field);
        assert.equal(artifact.pathOk, false);
        assert.equal(artifact.present, false);
        assert.equal(artifact.bytes, 0);
        assert.equal(artifact.hashOk, false);
        assert.deepEqual(artifact.pathViolations, [link ? 'symlink' : kind]);
        if (field === 'html') assert.equal(artifact.interactionQuality, undefined);
      }
      assert.deepEqual(accesses.filter((access) => atOrInside(outside, access.file)), []);
      if (link) assert.deepEqual(accesses.filter((access) => atOrInside(link, access.file)
        && !(access.method === 'lstatSync' && access.file === link)), []);
    });
  }
}

test('authorized exports reject absolute in-root and parent-segment paths', (context) => {
  const fixture = createReportEvidenceFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  for (const reference of [fixture.artifactPath, 'nested/../figure.png', 'nested\\..\\figure.png', 'C:\\outside\\figure.png']) {
    fixture.manifest.figures[0].exports.png.file = reference;
    writeFixtureManifest(fixture);
    const { result, accesses } = traceEvidenceFilesystem(context, fixture);
    assert.equal(result.ok, false);
    assert.equal(result.artifactChecks[0].pathOk, false);
    assert.deepEqual(accesses.filter((access) => access.file === fixture.artifactPath), []);
  }
});

for (const kind of ['missing', 'empty', 'unavailable', 'not-directory', 'symlink', 'intermediate-symlink']) {
  test(`authorized outputDirectory fails closed for ${kind}`, (context) => {
    const fixture = createReportEvidenceFixture();
    const links = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'report-directory-links-')));
    context.after(() => {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(links, { recursive: true, force: true });
    });
    if (kind === 'missing') delete fixture.outputDirectory;
    else if (kind === 'empty') fixture.outputDirectory = '';
    else if (kind === 'unavailable') fixture.outputDirectory = path.join(fixture.root, 'missing');
    else if (kind === 'not-directory') fixture.outputDirectory = fixture.artifactPath;
    else {
      symlinkSync(fixture.root, path.join(links, 'alias'), 'dir');
      fixture.outputDirectory = path.join(links, 'alias');
      if (kind === 'intermediate-symlink') {
        mkdirSync(path.join(fixture.root, 'nested'));
        fixture.outputDirectory = path.join(fixture.outputDirectory, 'nested');
      }
    }
    const { result, accesses } = traceEvidenceFilesystem(context, fixture);
    assert.equal(result.ok, false);
    assert.equal(result.pathsOk, false);
    assert.equal(result.manifestOk, false);
    assert.deepEqual(accesses.filter((access) => ['readFileSync', 'openSync', 'statSync'].includes(access.method)), []);
    if (kind.includes('symlink')) assert.deepEqual(accesses.filter((access) => atOrInside(path.join(links, 'alias'), access.file)
      && !(access.method === 'lstatSync' && access.file === path.join(links, 'alias'))), []);
  });
}

test('authorized nested bundle preserves strict checks and reads interactive HTML only once', (context) => {
  const fixture = createReportEvidenceFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  mkdirSync(path.join(fixture.root, 'reports', 'nested'), { recursive: true });
  mkdirSync(path.join(fixture.root, 'assets', 'nested'), { recursive: true });
  for (const field of ['htmlPath', 'markdownPath', 'manifestPath']) {
    const destination = path.join(fixture.root, 'reports', 'nested', path.basename(fixture[field]));
    renameSync(fixture[field], destination);
    fixture[field] = destination;
  }
  for (const [format, field] of [['png', 'artifactPath'], ['pdf', 'pdfPath'], ['html', 'interactionPath']]) {
    const destination = path.join(fixture.root, 'assets', 'nested', path.basename(fixture[field]));
    renameSync(fixture[field], destination);
    fixture[field] = destination;
    fixture.manifest.figures[0].exports[format].file = path.relative(fixture.root, destination);
  }
  writeFixtureManifest(fixture);
  const files = [fixture.htmlPath, fixture.markdownPath, fixture.manifestPath,
    fixture.artifactPath, fixture.pdfPath, fixture.interactionPath];
  const before = files.map(fileHash);
  const { result, accesses } = traceEvidenceFilesystem(context, fixture);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.pathsOk, true);
  assert.deepEqual(result.pathViolations, []);
  assert.ok(result.artifactChecks.every((artifact) => artifact.pathOk && artifact.hashOk && artifact.bytesOk));
  assert.equal(result.artifactChecks.find((artifact) => artifact.format === 'html').interactionQuality.pointInteractionQualityOk, true);
  const htmlAccesses = accesses.filter((access) => access.file === fixture.interactionPath);
  assert.equal(htmlAccesses.filter((access) => access.method === 'openSync').length, 1);
  const reads = htmlAccesses.filter((access) => access.method === 'readFileSync');
  assert.equal(reads.length, 1);
  assert.equal(reads[0].descriptor, true);
  assert.deepEqual(files.map(fileHash), before);
});

for (const replacement of ['symlink', 'regular-file', 'parent-symlink', 'root-symlink']) {
  test(`authorized evidence rejects ${replacement} replacement at open before content read`, (context) => {
    const fixture = createReportEvidenceFixture();
    const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'report-race-fixture-')));
    const parkedRoot = `${fixture.root}-parked`;
    context.after(() => {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(parkedRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    });
    mkdirSync(path.join(fixture.root, 'assets'));
    const artifactPath = path.join(fixture.root, 'assets', 'figure.html');
    renameSync(fixture.interactionPath, artifactPath);
    fixture.manifest.figures[0].exports.html.file = 'assets/figure.html';
    writeFixtureManifest(fixture);
    copyFileSync(artifactPath, path.join(outside, 'figure.html'));
    let replaced = false;
    const { result, accesses } = traceEvidenceFilesystem(context, fixture, (method, args) => {
      if (replaced || method !== 'openSync' || args[0] !== artifactPath) return;
      replaced = true;
      assert.ok(args[1] & fs.constants.O_NOFOLLOW);
      if (replacement === 'root-symlink') {
        renameSync(fixture.root, parkedRoot);
        symlinkSync(parkedRoot, fixture.root, 'dir');
      } else if (replacement === 'parent-symlink') {
        renameSync(path.dirname(artifactPath), path.join(fixture.root, 'parked-assets'));
        symlinkSync(outside, path.dirname(artifactPath), 'dir');
      } else {
        renameSync(artifactPath, `${artifactPath}.original`);
        if (replacement === 'symlink') symlinkSync(path.join(outside, 'figure.html'), artifactPath, 'file');
        else copyFileSync(path.join(outside, 'figure.html'), artifactPath);
      }
    });
    assert.equal(replaced, true);
    assert.equal(result.ok, false);
    const artifact = result.artifactChecks.find((candidate) => candidate.format === 'html');
    assert.equal(artifact.hashOk, false);
    assert.equal(artifact.interactionQuality, undefined);
    assert.deepEqual(accesses.filter((access) => access.method === 'readFileSync' && access.file === artifactPath), []);
    assert.deepEqual(accesses.filter((access) => access.method === 'openSync' && access.file === artifactPath
      && access.succeeded).map((access) => access.fd),
      accesses.filter((access) => access.method === 'closeSync' && access.file === artifactPath).map((access) => access.fd));
  });
}

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

for (const [field, value, violation] of [
  ['name', 'unknown_temperature', 'name.unknown_reference'],
  ['unit', 'K', 'unit.mismatch'],
]) {
  for (const additional of [false, true]) {
    test(`synthetic variable catalog rejects ${field} mismatch, additional=${additional}`, (context) => {
      const fixture = createSyntheticIdentityFixture(context);
      const variables = fixture.manifest.figures[0].scientific_context.variables;
      if (additional) {
        fixture.manifest.ocean_report.variables.push({
          name: 'sea_water_salinity', quantity: 'sea water salinity', unit: 'g kg-1', source_ids: ['source-1'],
        });
        variables.push({ name: 'sea_water_salinity', unit: 'g kg-1' });
      }
      const index = additional ? 1 : 0;
      variables[index][field] = value;
      if (!additional) setReportFigureAttribute(fixture, field === 'name' ? 'data-variable' : 'data-unit', value);
      const result = assertSyntheticIdentityRejected(fixture, 'figureEvidenceOk',
        `manifest.figures[0].scientific_context.variables[${index}].${violation}`);
      assert.equal(result.oceanReportOk, true);
      assert.equal(result.matlabRuntimeOk, true);
      assert.equal(result.figureLinksOk, true);
    });
  }
}

for (const units of [['degree_Celsius', 'degree_Celsius'], ['degree_Celsius', 'K'], ['K', 'degree_Celsius']]) {
  test(`synthetic variable catalog rejects duplicate figure names with units ${units.join('/')}`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    fixture.manifest.figures[0].scientific_context.variables = units.map((unit) => ({ name: 'sea_water_temperature', unit }));
    setReportFigureAttribute(fixture, 'data-unit', units[0]);
    const result = assertSyntheticIdentityRejected(fixture, 'figureEvidenceOk',
      'manifest.figures[0].scientific_context.variables[1].name.duplicate');
    assert.equal(result.oceanReportOk, true);
  });

  test(`synthetic variable catalog rejects ambiguous directory units ${units.join('/')}`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    const definition = fixture.manifest.ocean_report.variables[0];
    fixture.manifest.ocean_report.variables = units.map((unit) => ({ ...structuredClone(definition), unit }));
    const result = assertSyntheticIdentityRejected(fixture, 'figureEvidenceOk',
      'manifest.figures[0].scientific_context.variables[0].name.ambiguous_reference');
    assert.equal(result.oceanReportOk, false);
    assert.ok(result.oceanReport.violations.includes('ocean_report.variables[1].name.duplicate'));
  });
}

test('synthetic variable catalog rejects a missing directory entry despite internally consistent HTML', (context) => {
  const fixture = createSyntheticIdentityFixture(context);
  fixture.manifest.ocean_report.variables = [];
  const result = assertSyntheticIdentityRejected(fixture, 'figureEvidenceOk',
    'manifest.figures[0].scientific_context.variables[0].name.unknown_reference');
  assert.equal(result.figureLinksOk, true);
  assert.equal(result.oceanReportOk, false);
});

for (const count of [1, 2]) {
  for (const reversed of [false, true]) {
    test(`synthetic variable catalog accepts a ${count}-variable subset with reversed=${reversed}`, (context) => {
      const fixture = createSyntheticIdentityFixture(context);
      fixture.manifest.ocean_report.variables.push(
        { name: 'sea_water_salinity', quantity: 'sea water salinity', unit: 'g kg-1', source_ids: ['source-1'] },
        { name: 'eastward_sea_water_velocity', quantity: 'eastward sea water velocity', unit: 'm s-1', source_ids: ['source-1'] },
      );
      fixture.manifest.figures[0].scientific_context.variables = fixture.manifest.ocean_report.variables.slice(0, count)
        .map(({ name, unit }) => ({ name, unit }));
      if (reversed) {
        fixture.manifest.ocean_report.variables.reverse();
        fixture.manifest.figures[0].scientific_context.variables.reverse();
      }
      writeFixtureManifest(fixture);
      const result = inspectIllustratedReportEvidence(fixture);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.figureEvidenceOk, true);
      assert.equal(result.figureLinksOk, true);
      assert.equal(result.oceanReportOk, true);
      assert.equal(result.oceanReport.variableCount, 3);
      assert.equal(fixture.manifest.figures[0].scientific_context.variables.length, count);
    });
  }
}

test('synthetic variable catalog does not let HTML borrow a variable absent from its own figure', (context) => {
  const fixture = createSyntheticIdentityFixture(context);
  fixture.manifest.ocean_report.variables.push({
    name: 'sea_water_salinity', quantity: 'sea water salinity', unit: 'g kg-1', source_ids: ['source-1'],
  });
  setReportFigureAttribute(fixture, 'data-variable', 'sea_water_salinity');
  setReportFigureAttribute(fixture, 'data-unit', 'g kg-1');
  writeFixtureManifest(fixture);
  const result = inspectIllustratedReportEvidence(fixture);
  assert.equal(result.ok, false);
  assert.equal(result.figureLinksOk, false);
  assert.ok(result.figureViolations.includes('figures[0].data-variable.mismatch'));
  assert.equal(result.figureEvidenceOk, true);
  assert.equal(result.oceanReportOk, true);
});

for (const declared of ['present', 'absent', 'unknown', 'not-evaluated']) {
  for (const reported of ['present', 'absent', 'unknown', 'not-evaluated']) {
    test(`synthetic uncertainty compares explicit status ${declared}/${reported}`, (context) => {
      const fixture = createSyntheticIdentityFixture(context);
      fixture.manifest.figures[0].scientific_context.uncertainty.status = declared;
      setReportFigureAttribute(fixture, 'data-uncertainty-status', reported);
      setReportFigureAttribute(fixture, 'data-uncertainty',
        'Calibration evidence is limited; identifiers can be present while model uncertainty remains unknown.');
      if (declared === reported) {
        writeFixtureManifest(fixture);
        const result = inspectIllustratedReportEvidence(fixture);
        assert.equal(result.ok, true, JSON.stringify(result));
      } else {
        assertSyntheticUncertaintyRejected(fixture, 'data-uncertainty-status');
      }
    });
  }
}

for (const [name, status, method, machineStatus, machineMethod, description] of [
  ['not-present', 'present', 'Instrument accuracy metadata', 'not-present', 'Instrument accuracy metadata',
    'Uncertainty is not-present; Instrument accuracy metadata.'],
  ['absent-not-present', 'present', 'Instrument accuracy metadata', 'absent', 'Instrument accuracy metadata',
    'Uncertainty is absent, not present; Instrument accuracy metadata.'],
  ['present-not-absent', 'absent', 'Instrument accuracy metadata', 'present', 'Instrument accuracy metadata',
    'Uncertainty is present, not absent; Instrument accuracy metadata.'],
  ['known-not-unknown', 'unknown', 'Instrument accuracy metadata', 'known', 'Instrument accuracy metadata',
    'Uncertainty is known, not unknown; Instrument accuracy metadata.'],
  ['already-evaluated', 'not-evaluated', 'Instrument accuracy metadata', 'evaluated', 'Instrument accuracy metadata',
    'Uncertainty has been evaluated; no longer not-evaluated; Instrument accuracy metadata.'],
  ['negated-method', 'present', 'bootstrap', 'present', 'not-bootstrap', 'present; method=not-bootstrap'],
  ['negated-multiword-method', 'present', 'Instrument accuracy metadata', 'present', 'bootstrap',
    'Uncertainty is present; method is bootstrap, not Instrument accuracy metadata.'],
  ['status-only-in-method', 'present', 'Metadata present in calibration report', 'absent', 'Metadata present in calibration report',
    'Uncertainty is absent; method: Metadata present in calibration report.'],
  ['word-in-present', 'present', 'bootstrap', 'representative', 'bootstrap', 'status=representative; bootstrap'],
  ['word-in-absent', 'absent', 'bootstrap', 'absentee', 'bootstrap', 'status=absentee; bootstrap'],
  ['word-in-unknown', 'unknown', 'bootstrap', 'unknownish', 'bootstrap', 'status=unknownish; bootstrap'],
  ['word-in-not-evaluated', 'not-evaluated', 'bootstrap', 'not-evaluatedness', 'bootstrap', 'status=not-evaluatedness; bootstrap'],
  ['word-in-method', 'present', 'bootstrap', 'present', 'nonbootstrap', 'present; nonbootstrap'],
]) {
  test(`synthetic uncertainty rejects R19 ${name} without narrative fallback`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    Object.assign(fixture.manifest.figures[0].scientific_context.uncertainty, { status, method });
    setReportFigureAttribute(fixture, 'data-uncertainty-status', machineStatus);
    setReportFigureAttribute(fixture, 'data-uncertainty-method', machineMethod);
    setReportFigureAttribute(fixture, 'data-uncertainty', description);
    assertSyntheticUncertaintyRejected(fixture, status === machineStatus ? 'data-uncertainty-method' : 'data-uncertainty-status');
  });
}

for (const attribute of ['data-uncertainty-status', 'data-uncertainty-method']) {
  test(`synthetic uncertainty requires ${attribute} even with the old complete free string`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    const html = readFileSync(fixture.htmlPath, 'utf8');
    writeFileSync(fixture.htmlPath, html.replace(new RegExp(` ${attribute}="[^"]*"`, 'u'), ''));
    assertSyntheticUncertaintyRejected(fixture, attribute);
  });
}

for (const [name, method, reported, passed] of [
  ['trimmed', '  Instrument accuracy metadata \t', '\t Instrument accuracy metadata  ', true],
  ['matching-internal-whitespace', 'Instrument  accuracy\tmetadata', 'Instrument  accuracy\tmetadata', true],
  ['different-case', 'Instrument accuracy metadata', 'instrument accuracy metadata', false],
  ['collapsed-internal-whitespace', 'Instrument  accuracy metadata', 'Instrument accuracy metadata', false],
  ['expanded-internal-whitespace', 'Instrument accuracy metadata', 'Instrument  accuracy metadata', false],
  ['method-suffix', 'bootstrap', 'bootstrap percentile intervals', false],
]) {
  test(`synthetic uncertainty ${name} uses only symmetric edge trimming`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    fixture.manifest.figures[0].scientific_context.uncertainty.method = method;
    setReportFigureAttribute(fixture, 'data-uncertainty-status', '  present \t');
    setReportFigureAttribute(fixture, 'data-uncertainty-method', reported);
    setReportFigureAttribute(fixture, 'data-uncertainty', 'Only the supplied calibration records support this estimate.');
    if (passed) {
      writeFixtureManifest(fixture);
      const result = inspectIllustratedReportEvidence(fixture);
      assert.equal(result.ok, true, JSON.stringify(result));
    } else {
      assertSyntheticUncertaintyRejected(fixture, 'data-uncertainty-method');
    }
  });
}

for (const attribute of ['data-uncertainty', 'data-uncertainty-status', 'data-uncertainty-method']) {
  for (const value of ['', ' \t\n ']) {
    test(`synthetic uncertainty rejects blank ${attribute}=${JSON.stringify(value)}`, (context) => {
      const fixture = createSyntheticIdentityFixture(context);
      setReportFigureAttribute(fixture, attribute, value);
      assertSyntheticUncertaintyRejected(fixture, attribute);
    });
  }
}

for (const method of ['', ' \t\n ']) {
  test(`synthetic uncertainty retains the manifest nonempty-method gate for ${JSON.stringify(method)}`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    fixture.manifest.figures[0].scientific_context.uncertainty.method = method;
    setReportFigureAttribute(fixture, 'data-uncertainty-method', method);
    const result = assertSyntheticIdentityRejected(fixture, 'figureEvidenceOk',
      'manifest.figures[0].scientific_context.uncertainty.method');
    assert.equal(result.figureLinksOk, false);
  });
}

for (const [name, method, attribute] of [
  ['named-amp', 'Instrument & calibration metadata', 'data-uncertainty-method="Instrument &amp; calibration metadata"'],
  ['named-quot', 'Instrument "A" accuracy', 'data-uncertainty-method="Instrument &quot;A&quot; accuracy"'],
  ['single-quoted-apos', "Instrument 'A' accuracy", "data-uncertainty-method='Instrument &apos;A&apos; accuracy'"],
  ['decimal-amp', 'Instrument & calibration metadata', 'data-uncertainty-method="Instrument &#38; calibration metadata"'],
  ['hex-amp', 'Instrument & calibration metadata', 'data-uncertainty-method="Instrument &#x26; calibration metadata"'],
  ['decimal-letter', 'bootstrap', 'data-uncertainty-method="boot&#115;trap"'],
  ['unquoted-hex-letter', 'bootstrap', 'data-uncertainty-method=boot&#x73;trap'],
  ['unquoted-spaces', 'Instrument accuracy metadata', 'data-uncertainty-method=Instrument&#32;accuracy&#32;metadata'],
  ['unquoted-tab', 'Instrument\taccuracy metadata', 'data-uncertainty-method=Instrument&#9;accuracy&#32;metadata'],
  ['uppercase-name', 'Instrument accuracy metadata', 'DATA-UNCERTAINTY-METHOD="Instrument accuracy metadata"'],
  ['quoted-greater-than', 'Estimate > calibration threshold', 'data-uncertainty-method="Estimate > calibration threshold"'],
  ['literal-entity-decoded-once', 'Instrument &amp; calibration metadata', 'data-uncertainty-method="Instrument &amp;amp; calibration metadata"'],
]) {
  test(`synthetic HTML parsing accepts equivalent ${name} method`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    fixture.manifest.figures[0].scientific_context.uncertainty.method = method;
    fixture.manifest.ocean_report.uncertainty.method = method;
    const html = readFileSync(fixture.htmlPath, 'utf8');
    writeFileSync(fixture.htmlPath, html.replace(/ data-uncertainty-method="[^"]*"/u, () => ` ${attribute}`));
    writeFixtureManifest(fixture);
    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.htmlParsingOk, true);
    assert.deepEqual(result.htmlParsingViolations, []);
    assert.equal(result.figureLinksOk, true);
    assert.deepEqual(result.figureViolations, []);
  });
}

for (const [status, encoded] of [
  ['present', 'pre&#115;ent'], ['absent', 'ab&#x73;ent'],
  ['unknown', '&#117;nknown'], ['not-evaluated', 'not&#45;evaluated'],
]) {
  test(`synthetic HTML parsing accepts encoded unquoted ${status} and uppercase tags`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    fixture.manifest.figures[0].scientific_context.uncertainty.status = status;
    fixture.manifest.ocean_report.uncertainty.status = status;
    const html = readFileSync(fixture.htmlPath, 'utf8')
      .replace('data-uncertainty-status="present"', `DATA-UNCERTAINTY-STATUS=${encoded}`)
      .replace('<figure ', '<FIGURE ').replace('</figure>', '</FIGURE>');
    writeFileSync(fixture.htmlPath, html);
    writeFixtureManifest(fixture);
    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.htmlParsingOk, true);
    assert.deepEqual(result.htmlParsingViolations, []);
    assert.equal(result.figureCount, 1);
    assert.deepEqual(result.figureViolations, []);
  });
}

for (const [name, method, encoded] of [
  ['source-spelling-is-not-dom-value', 'Instrument &amp; calibration metadata', 'Instrument &amp; calibration metadata'],
  ['does-not-decode-twice', 'Instrument & calibration metadata', 'Instrument &amp;amp; calibration metadata'],
]) {
  test(`synthetic HTML parsing rejects ${name} method mismatch`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    fixture.manifest.figures[0].scientific_context.uncertainty.method = method;
    fixture.manifest.ocean_report.uncertainty.method = method;
    setReportFigureAttribute(fixture, 'data-uncertainty-method', encoded);
    writeFixtureManifest(fixture);
    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.htmlParsingOk, true);
    assert.deepEqual(result.htmlParsingViolations, []);
    assert.equal(result.figureLinksOk, false);
    assert.deepEqual(result.figureViolations, ['figures[0].data-uncertainty-method.mismatch']);
    assert.equal(result.figureEvidenceOk, true);
    assert.equal(result.artifactsOk, true);
    assert.equal(result.manifestFreshnessOk, true);
  });
}

for (const [name, attribute, replacement] of [
  ['status-wrong-first', 'data-uncertainty-status', 'data-uncertainty-status="absent" data-uncertainty-status="present"'],
  ['status-right-first', 'data-uncertainty-status', 'data-uncertainty-status="present" data-uncertainty-status="absent"'],
  ['status-identical', 'data-uncertainty-status', 'data-uncertainty-status="present" data-uncertainty-status="present"'],
  ['status-casefold', 'data-uncertainty-status', 'data-uncertainty-status="absent" DATA-UNCERTAINTY-STATUS="present"'],
  ['status-unquoted-first', 'data-uncertainty-status', 'data-uncertainty-status=absent data-uncertainty-status="present"'],
  ['status-unquoted-last', 'data-uncertainty-status', 'data-uncertainty-status="present" data-uncertainty-status=absent'],
  ['method-wrong-first', 'data-uncertainty-method', 'data-uncertainty-method="bootstrap" data-uncertainty-method="Instrument accuracy metadata"'],
  ['method-right-first', 'data-uncertainty-method', 'data-uncertainty-method="Instrument accuracy metadata" data-uncertainty-method="bootstrap"'],
  ['method-identical', 'data-uncertainty-method', 'data-uncertainty-method="Instrument accuracy metadata" data-uncertainty-method="Instrument accuracy metadata"'],
  ['narrative-blank-first', 'data-uncertainty', 'data-uncertainty="" data-uncertainty="Synthetic calibration limitations."'],
]) {
  test(`synthetic HTML parsing rejects duplicate ${name}`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    const html = readFileSync(fixture.htmlPath, 'utf8');
    writeFileSync(fixture.htmlPath, html.replace(new RegExp(` ${attribute}="[^"]*"`, 'u'), () => ` ${replacement}`));
    writeFixtureManifest(fixture);
    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.htmlParsingOk, false);
    assert.ok(Array.isArray(result.htmlParsingViolations));
    assert.match(JSON.stringify(result.htmlParsingViolations), /duplicate-attribute/u);
    assert.equal(result.figureEvidenceOk, true);
    assert.equal(result.artifactsOk, true, JSON.stringify(result.artifactChecks));
    assert.equal(result.manifestFreshnessOk, true);
  });
}

for (const [name, markup] of [
  ['outside-figure', '<section id="first" id="second"></section>'],
  ['inside-template', '<template><section id="same" id="same"></section></template>'],
]) {
  test(`synthetic HTML parsing rejects document duplicate attributes ${name}`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    const html = readFileSync(fixture.htmlPath, 'utf8');
    writeFileSync(fixture.htmlPath, html.replace('</body>', `${markup}</body>`));
    writeFixtureManifest(fixture);
    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.htmlParsingOk, false);
    assert.ok(Array.isArray(result.htmlParsingViolations));
    assert.match(JSON.stringify(result.htmlParsingViolations), /duplicate-attribute/u);
    assert.equal(result.artifactsOk, true);
    assert.equal(result.manifestFreshnessOk, true);
  });
}

for (const [name, opening, closing] of [
  ['script', '<script type="text/plain">', '</script>'],
  ['style', '<style>', '</style>'],
  ['template', '<template>', '</template>'],
  ['comment', '<!--', '-->'],
]) {
  test(`synthetic HTML parsing ignores extra forged evidence in ${name}`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    const html = readFileSync(fixture.htmlPath, 'utf8');
    const figure = html.match(/<figure\b[\s\S]*?<\/figure>/u)[0];
    const claim = html.match(/<p data-claim-id="claim-1"[\s\S]*?<\/p>/u)[0];
    writeFileSync(fixture.htmlPath, html.replace('</body>', `${opening}${figure}${claim}${closing}</body>`));
    writeFixtureManifest(fixture);
    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.htmlParsingOk, true);
    assert.deepEqual(result.htmlParsingViolations, []);
    assert.equal(result.figureCount, 1);
    assert.equal(result.claimCount, 1);
    assert.deepEqual(result.figureViolations, []);
    assert.deepEqual(result.claimViolations, []);
  });

  for (const kind of ['figure', 'claim']) {
    test(`synthetic HTML parsing cannot use ${name} as the only ${kind} evidence`, (context) => {
      const fixture = createSyntheticIdentityFixture(context);
      const html = readFileSync(fixture.htmlPath, 'utf8');
      const expression = kind === 'figure' ? /<figure\b[\s\S]*?<\/figure>/u : /<p data-claim-id="claim-1"[\s\S]*?<\/p>/u;
      writeFileSync(fixture.htmlPath, html.replace(expression, (markup) => `${opening}${markup}${closing}`));
      writeFixtureManifest(fixture);
      const result = inspectIllustratedReportEvidence(fixture);
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.htmlParsingOk, true);
      assert.deepEqual(result.htmlParsingViolations, []);
      assert.equal(kind === 'figure' ? result.figureCount : result.claimCount, 0);
      assert.equal(kind === 'figure' ? result.figureLinksOk : result.claimsOk, false);
      assert.equal(result.figureEvidenceOk, true);
      assert.equal(result.artifactsOk, true);
      assert.equal(result.manifestFreshnessOk, true);
    });
  }

  test(`synthetic HTML parsing cannot borrow evidence ids from ${name}`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    const html = readFileSync(fixture.htmlPath, 'utf8')
      .replace('data-evidence-ids="fig-1"', 'data-evidence-ids="forged-only"')
      .replace('</body>', `${opening}<span data-evidence-id="forged-only">Synthetic evidence</span>${closing}</body>`);
    writeFileSync(fixture.htmlPath, html);
    writeFixtureManifest(fixture);
    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.htmlParsingOk, true);
    assert.deepEqual(result.htmlParsingViolations, []);
    assert.equal(result.claimCount, 1);
    assert.equal(result.claimsOk, false);
    assert.deepEqual(result.claimViolations, ['claims[0].evidence_missing']);
    assert.equal(result.figureLinksOk, true);
    assert.equal(result.artifactsOk, true);
    assert.equal(result.manifestFreshnessOk, true);
  });

  test(`synthetic HTML parsing excludes ${name} content from caption text`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    const html = readFileSync(fixture.htmlPath, 'utf8');
    const caption = `<figcaption>Short.${opening}Synthetic calibration prose must not inflate visible caption length.${closing}</figcaption>`;
    writeFileSync(fixture.htmlPath, html.replace(/<figcaption>[\s\S]*?<\/figcaption>/u, () => caption));
    writeFixtureManifest(fixture);
    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.htmlParsingOk, true);
    assert.deepEqual(result.htmlParsingViolations, []);
    assert.equal(result.figureCount, 1);
    assert.equal(result.figureLinksOk, false);
    assert.deepEqual(result.figureViolations, ['figures[0].caption']);
    assert.equal(result.artifactsOk, true);
    assert.equal(result.manifestFreshnessOk, true);
  });
}

for (const [name, markup, accepted] of [
  ['nested-visible-text', '<figcaption>Calibration <em>uncertainty</em> describes the observed sample &amp; its explicit limitations within this snapshot.</figcaption>', true],
  ['decoded-short-text', `<figcaption>${'&#65;'.repeat(8)}</figcaption>`, false],
  ['attribute-is-not-caption', '<span data-note="<figcaption>Calibration uncertainty for the observed sample has explicit limitations.</figcaption>">Short.</span>', false],
]) {
  test(`synthetic HTML parsing measures actual caption nodes for ${name}`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    const html = readFileSync(fixture.htmlPath, 'utf8');
    writeFileSync(fixture.htmlPath, html.replace(/<figcaption>[\s\S]*?<\/figcaption>/u, () => markup));
    writeFixtureManifest(fixture);
    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, accepted, JSON.stringify(result));
    assert.equal(result.htmlParsingOk, true);
    assert.deepEqual(result.htmlParsingViolations, []);
    assert.equal(result.figureLinksOk, accepted);
    assert.deepEqual(result.figureViolations, accepted ? [] : ['figures[0].caption']);
    assert.equal(result.artifactsOk, true);
    assert.equal(result.manifestFreshnessOk, true);
  });
}

for (const [name, markup, code] of [
  ['open-shadow', '<div><template shadowrootmode=open><figure id=unmanifested></figure></template></div>', 'unsupported-shadow-dom'],
  ['closed-shadow', '<div><template shadowrootmode=closed><figure id=unmanifested></figure></template></div>', 'unsupported-shadow-dom'],
  ['select-figure', '<select><option><figure id=unmanifested></figure></option></select>', 'unsupported-select-content'],
  ['select-claim', '<select><option><section data-claim-id=unmanifested>Unverified</section></option></select>', 'unsupported-select-content'],
]) {
  test(`R21 report rejects unsupported structure ${name}`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    const html = readFileSync(fixture.htmlPath, 'utf8');
    writeFileSync(fixture.htmlPath, html.replace('</body>', `${markup}</body>`));
    writeFixtureManifest(fixture);
    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.htmlParsingOk, false);
    assert.ok(result.htmlParsingViolations.some((violation) => violation.startsWith(`html.${code}:`)));
    assert.equal(result.artifactsOk, true);
    assert.equal(result.manifestFreshnessOk, true);
  });
}

for (const markup of [
  '<select><option>One<option>Two<optgroup label=group><option>Three</optgroup><hr></select>',
  '<select><template><div>Inert content</div></template><option>One</option></select>',
  '<template><figure id=unmanifested><figcaption>Ordinary inert content.</figcaption></figure></template>',
]) {
  test(`R21 report preserves ordinary select and inert template ${markup}`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    const html = readFileSync(fixture.htmlPath, 'utf8');
    writeFileSync(fixture.htmlPath, html.replace('</body>', `${markup}</body>`));
    writeFixtureManifest(fixture);
    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.htmlParsingOk, true);
    assert.deepEqual(result.htmlParsingViolations, []);
    assert.equal(result.figureCount, 1);
  });
}

for (const [name, markup, accepted] of [
  ['borrowed-before-short', '<div><figcaption>Observed temperature during the stated UTC window, with explicit limitations.</figcaption></div><figcaption>Short.</figcaption>', false],
  ['borrowed-before-real', '<div><figcaption>Short.</figcaption></div><figcaption>Observed temperature during the stated UTC window, with explicit limitations.</figcaption>', true],
  ['descendant-only', '<div><figcaption>Observed temperature during the stated UTC window, with explicit limitations.</figcaption></div>', false],
  ['inline-character-padding', `<figcaption>${[...'Temperature increased.'].map((letter) => `<span>${letter}</span>`).join('')}</figcaption>`, false],
  ['iframe-fallback', '<figcaption>Short.<iframe>Observed temperature during the stated UTC window, with explicit limitations.</iframe></figcaption>', false],
  ['svg-title', '<figcaption>Short.<svg><title>Observed temperature during the stated UTC window, with explicit limitations.</title></svg></figcaption>', false],
  ['svg-desc', '<figcaption>Short.<svg><desc>Observed temperature during the stated UTC window, with explicit limitations.</desc></svg></figcaption>', false],
  ['svg-text', '<figcaption>Short.<svg><text>Observed temperature during the stated UTC window, with explicit limitations.</text></svg></figcaption>', true],
  ['repaired-direct-caption', '<table><figcaption>Observed temperature during the stated UTC window, with explicit limitations.</figcaption></table>', true],
]) {
  test(`R21 report caption ownership and text ${name}`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    const html = readFileSync(fixture.htmlPath, 'utf8');
    writeFileSync(fixture.htmlPath, html.replace(/<figcaption>[\s\S]*?<\/figcaption>/u, () => markup));
    writeFixtureManifest(fixture);
    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, accepted, JSON.stringify(result));
    assert.equal(result.htmlParsingOk, true);
    assert.deepEqual(result.htmlParsingViolations, []);
    assert.equal(result.figureLinksOk, accepted);
    assert.deepEqual(result.figureViolations, accepted ? [] : ['figures[0].caption']);
    assert.equal(result.artifactsOk, true);
    assert.equal(result.manifestFreshnessOk, true);
  });
}

for (const scope of ['requested_coverage', 'effective_coverage', 'figure']) {
  for (const [field, value, violation] of [
    ['start', '2026-02-30T00:00:00Z', 'start'],
    ['start', '2026-02-29T00:00:00Z', 'start'],
    ['start', '2026-13-03T00:00:00Z', 'start'],
    ['start', '2026-09-03T00:00:00.0001Z', 'start'],
    ['end', '2026-02-30T01:00:00Z', 'end'],
    ['start', '2026-09-04T00:00:00Z', 'reversed'],
    ['timezone', 'UTC+08:00', 'timezone'],
  ]) {
    test(`synthetic time rejects ${scope}.${field}=${value}`, (context) => {
      const fixture = createSyntheticIdentityFixture(context);
      if (scope === 'figure') setSyntheticFigureCoverage(fixture, { [field]: value });
      else fixture.manifest.ocean_report[scope][field] = value;
      writeFixtureManifest(fixture);
      const result = inspectIllustratedReportEvidence(fixture);
      const violations = scope === 'figure' ? result.figureEvidenceViolations : result.oceanReport.violations;
      const prefix = scope === 'figure' ? 'manifest.figures[0].scientific_context.temporal_coverage' : `ocean_report.${scope}`;
      assert.equal(result.ok, false);
      assert.equal(scope === 'figure' ? result.figureEvidenceOk : result.oceanReportOk, false);
      assert.ok(violations.includes(`${prefix}.${violation}`), JSON.stringify(violations));
      assert.equal(result.figureLinksOk, true);
      assert.ok(result.artifactChecks.every((artifact) => artifact.bytesOk && artifact.hashOk));
      assert.equal(result.manifestFreshnessOk, true);
    });
  }
}

for (const [name, figureCoverage, interactionCoverage] of [
  ['equivalent-figure-offset', { start: '2026-09-03T08:00:00+08:00', end: '2026-09-03T09:00:00+08:00' }, {}],
  ['equivalent-interaction-offset', {}, { start: '2026-09-02T20:00:00-04:00', end: '2026-09-02T21:00:00-04:00' }],
  ['mixed-suffix-UTC', { start: '2026-09-03T00:00:00', end: '2026-09-03T01:00:00Z' },
    { start: '2026-09-03T00:00:00', end: '2026-09-03T01:00:00Z' }],
  ['both-without-suffix', { start: '2026-09-03T00:00:00', end: '2026-09-03T01:00:00' },
    { start: '2026-09-03T00:00:00', end: '2026-09-03T01:00:00' }],
  ['date-only', { start: '2026-09-03', end: '2026-09-04' },
    { start: '2026-09-03T00:00:00Z', end: '2026-09-04T00:00:00Z' }],
  ['fractional-seconds', { start: '2026-09-03T00:00:00.0Z', end: '2026-09-03T01:00:00.00Z' },
    { start: '2026-09-03T00:00:00.000Z', end: '2026-09-03T01:00:00.000Z' }],
  ['UTC-zero-aliases', { timezone: 'UTC-00:00' }, { timezone: 'UTC+00:00' }],
]) {
  test(`synthetic time accepts ${name} by instant without rewriting main HTML`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    setSyntheticFigureCoverage(fixture, figureCoverage);
    setSyntheticInteractionCoverage(fixture, interactionCoverage);
    writeFixtureManifest(fixture);
    const result = inspectIllustratedReportEvidence(fixture);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.figureLinksOk, true);
    assert.equal(result.artifactsOk, true);
  });
}

test('synthetic time keeps requested, effective and figure windows independent', (context) => {
  const fixture = createSyntheticIdentityFixture(context);
  Object.assign(fixture.manifest.ocean_report.requested_coverage, { start: '2026-08-01', end: '2026-09-05' });
  Object.assign(fixture.manifest.ocean_report.effective_coverage, { start: '2026-09-02', end: '2026-09-04' });
  writeFixtureManifest(fixture);
  const result = inspectIllustratedReportEvidence(fixture);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('synthetic time retains equal endpoints with a consistent interactive snapshot', (context) => {
  const fixture = createSyntheticIdentityFixture(context);
  setSyntheticFigureCoverage(fixture, { end: '2026-09-03T00:00:00Z' });
  const html = readFileSync(fixture.interactionPath, 'utf8').replaceAll('2026-09-03T01:00:00Z', '2026-09-03T00:00:00Z');
  writeFileSync(fixture.interactionPath, html);
  setSyntheticInteractionCoverage(fixture, { end: '2026-09-03T00:00:00Z' });
  writeFixtureManifest(fixture);
  const result = inspectIllustratedReportEvidence(fixture);
  assert.equal(result.ok, true, JSON.stringify(result));
});

for (const [name, side, coverage, fields] of [
  ['figure-2030', 'figure', { start: '2030-01-01T00:00:00Z', end: '2030-01-01T01:00:00Z' }, ['start', 'end']],
  ['interaction-2030', 'interaction', { start: '2030-01-01T00:00:00Z', end: '2030-01-01T01:00:00Z' }, ['start', 'end']],
  ['non-equivalent-offset', 'figure', { start: '2026-09-03T00:00:00+08:00', end: '2026-09-03T01:00:00+08:00' }, ['start', 'end']],
  ['one-millisecond', 'interaction', { end: '2026-09-03T01:00:00.001Z' }, ['end']],
  ['invalid-interaction-timezone', 'interaction', { timezone: 'UTC+08:00' }, ['timezone']],
]) {
  test(`synthetic time rejects ${name} despite matching bytes, hash and freshness`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    const previousHash = fixture.manifest.figures[0].exports.html.sha256;
    if (side === 'figure') setSyntheticFigureCoverage(fixture, coverage);
    else setSyntheticInteractionCoverage(fixture, coverage);
    writeFixtureManifest(fixture);
    const result = inspectIllustratedReportEvidence(fixture);
    const artifact = result.artifactChecks.find((entry) => entry.format === 'html');
    assert.equal(result.ok, false);
    assert.equal(result.artifactsOk, false);
    assert.equal(result.figureEvidenceOk, true);
    assert.equal(result.figureLinksOk, true);
    assert.equal(result.oceanReportOk, true);
    assert.equal(result.matlabRuntimeOk, true);
    assert.equal(result.manifestFreshnessOk, true);
    assert.equal(artifact.bytesOk, true);
    assert.equal(artifact.hashOk, true);
    assert.equal(artifact.metadataOk, false);
    for (const field of fields) assert.ok(artifact.metadataViolations.some((value) => value.startsWith(`html.temporal_coverage.${field}`)),
      JSON.stringify(artifact.metadataViolations));
    if (side === 'figure') assert.equal(fixture.manifest.figures[0].exports.html.sha256, previousHash);
    else assert.notEqual(fixture.manifest.figures[0].exports.html.sha256, previousHash);
  });
}

for (const [field, attribute, coverageFields] of [
  ['timeStart', 'data-time-start', ['start']],
  ['timeEnd', 'data-time-end', ['end']],
  ['timezone', 'data-timezone', ['timezone', 'start', 'end']],
]) {
  test(`synthetic time preserves missing ${field} diagnostics without defaulting the context`, (context) => {
    const fixture = createSyntheticIdentityFixture(context);
    const html = readFileSync(fixture.interactionPath, 'utf8');
    writeFileSync(fixture.interactionPath, html.replace(new RegExp(` ${attribute}="[^"]*"`, 'u'), ''));
    setSyntheticInteractionCoverage(fixture, {});
    writeFixtureManifest(fixture);
    const result = inspectIllustratedReportEvidence(fixture);
    const artifact = result.artifactChecks.find((entry) => entry.format === 'html');
    const quality = artifact.interactionQuality;
    const violations = quality.checkResults['scientific-context'].violations;
    assert.equal(result.ok, false);
    assert.equal(result.artifactsOk, false);
    assert.equal(result.figureEvidenceOk, true);
    assert.equal(result.figureLinksOk, true);
    assert.equal(result.manifestFreshnessOk, true);
    assert.equal(artifact.bytesOk, true);
    assert.equal(artifact.hashOk, true);
    assert.equal(artifact.metadataOk, false);
    assert.equal(artifact.interactionOk, false);
    assert.equal(quality.scientificContext[field], '');
    assert.equal(quality.scientificContextOk, false);
    assert.ok(violations.some((violation) => violation.rule === 'scientific-context-field-missing'
      && violation.field === field && violation.attribute === attribute), JSON.stringify(violations));
    for (const coverageField of coverageFields) {
      assert.ok(artifact.metadataViolations.some((value) => value.startsWith(`html.temporal_coverage.${coverageField}`)),
        JSON.stringify(artifact.metadataViolations));
    }
  });
}

test('synthetic time rejects identical invalid endpoints on both sides and preserves the original context', (context) => {
  const fixture = createSyntheticIdentityFixture(context);
  const coverage = { start: '2026-02-30T00:00:00Z', end: '2026-02-30T01:00:00Z', timezone: 'UTC' };
  setSyntheticFigureCoverage(fixture, coverage);
  setSyntheticInteractionCoverage(fixture, coverage);
  writeFixtureManifest(fixture);
  const result = inspectIllustratedReportEvidence(fixture);
  const artifact = result.artifactChecks.find((entry) => entry.format === 'html');
  const quality = artifact.interactionQuality;
  const violations = quality.checkResults['scientific-context'].violations;
  assert.equal(result.ok, false);
  assert.equal(result.figureEvidenceOk, false);
  assert.equal(result.figureLinksOk, true);
  assert.equal(result.artifactsOk, false);
  assert.equal(result.manifestFreshnessOk, true);
  assert.equal(artifact.bytesOk, true);
  assert.equal(artifact.hashOk, true);
  assert.equal(artifact.metadataOk, false);
  assert.equal(artifact.interactionOk, false);
  assert.equal(quality.scientificContextOk, false);
  assert.equal(quality.scientificContext.timezone, coverage.timezone);
  for (const [field, contextField] of [['start', 'timeStart'], ['end', 'timeEnd']]) {
    assert.equal(quality.scientificContext[contextField], coverage[field]);
    assert.ok(violations.some((violation) => violation.rule === 'scientific-time-invalid' && violation.field === contextField),
      JSON.stringify(violations));
    assert.ok(result.figureEvidenceViolations.includes(`manifest.figures[0].scientific_context.temporal_coverage.${field}`),
      JSON.stringify(result.figureEvidenceViolations));
    assert.ok(artifact.metadataViolations.includes(`html.temporal_coverage.${field}.mismatch`),
      JSON.stringify(artifact.metadataViolations));
  }
});

test('synthetic time still rejects equivalent but nonliteral main HTML endpoints', (context) => {
  const fixture = createSyntheticIdentityFixture(context);
  setReportFigureAttribute(fixture, 'data-time-start', '2026-09-03T08:00:00+08:00');
  setReportFigureAttribute(fixture, 'data-time-end', '2026-09-03T09:00:00+08:00');
  writeFixtureManifest(fixture);
  const result = inspectIllustratedReportEvidence(fixture);
  assert.equal(result.ok, false);
  assert.equal(result.figureLinksOk, false);
  assert.equal(result.artifactsOk, true);
  assert.ok(result.figureViolations.includes('figures[0].data-time-start.mismatch'));
  assert.ok(result.figureViolations.includes('figures[0].data-time-end.mismatch'));
});

test('synthetic time binds each interactive export to its owning figure, not the report window', (context) => {
  const fixture = createSyntheticIdentityFixture(context);
  const secondFigure = structuredClone(fixture.manifest.figures[0]);
  secondFigure.id = 'fig-2';
  Object.assign(secondFigure.scientific_context.temporal_coverage, { start: '2030-01-01T00:00:00Z', end: '2030-01-01T01:00:00Z' });
  const secondPath = path.join(fixture.root, 'second-interactive.html');
  writeFileSync(secondPath, readFileSync(fixture.interactionPath, 'utf8').replaceAll('2026-09-03', '2030-01-01'));
  Object.assign(secondFigure.exports.html, { file: path.basename(secondPath), bytes: statSync(secondPath).size, sha256: fileHash(secondPath) });
  fixture.manifest.figures.push(secondFigure);
  const html = readFileSync(fixture.htmlPath, 'utf8');
  const secondBlock = html.match(/<figure\b[\s\S]*?<\/figure>/u)[0]
    .replace('data-figure-id="fig-1"', 'data-figure-id="fig-2"').replaceAll('2026-09-03', '2030-01-01');
  writeFileSync(fixture.htmlPath, html.replace('</body>', `${secondBlock}</body>`));
  writeFixtureManifest(fixture);
  const baseline = inspectIllustratedReportEvidence(fixture);
  assert.equal(baseline.ok, true, JSON.stringify(baseline));
  const firstExport = fixture.manifest.figures[0].exports.html;
  fixture.manifest.figures[0].exports.html = secondFigure.exports.html;
  secondFigure.exports.html = firstExport;
  writeFixtureManifest(fixture);
  const result = inspectIllustratedReportEvidence(fixture);
  assert.equal(result.ok, false);
  assert.equal(result.artifactsOk, false);
  assert.equal(result.figureLinksOk, true);
  assert.equal(result.figureEvidenceOk, true);
  assert.equal(result.manifestFreshnessOk, true);
  const artifacts = result.artifactChecks.filter((entry) => entry.format === 'html');
  assert.equal(artifacts.length, 2);
  for (const artifact of artifacts) {
    assert.equal(artifact.bytesOk, true);
    assert.equal(artifact.hashOk, true);
    assert.ok(artifact.metadataViolations.includes('html.temporal_coverage.start.mismatch'));
    assert.ok(artifact.metadataViolations.includes('html.temporal_coverage.end.mismatch'));
  }
});

function setSyntheticFigureCoverage(fixture, coverage) {
  Object.assign(fixture.manifest.figures[0].scientific_context.temporal_coverage, coverage);
  for (const field of ['start', 'end']) if (Object.hasOwn(coverage, field)) {
    setReportFigureAttribute(fixture, `data-time-${field}`, coverage[field]);
  }
}

function setSyntheticInteractionCoverage(fixture, coverage) {
  let html = readFileSync(fixture.interactionPath, 'utf8');
  for (const [field, attribute] of [['start', 'data-time-start'], ['end', 'data-time-end'], ['timezone', 'data-timezone']]) {
    if (Object.hasOwn(coverage, field)) html = html.replace(new RegExp(`${attribute}="[^"]*"`, 'u'), `${attribute}="${coverage[field]}"`);
  }
  writeFileSync(fixture.interactionPath, html);
  Object.assign(fixture.manifest.figures[0].exports.html, { bytes: statSync(fixture.interactionPath).size, sha256: fileHash(fixture.interactionPath) });
}

function assertSyntheticUncertaintyRejected(fixture, attribute) {
  writeFixtureManifest(fixture);
  const result = inspectIllustratedReportEvidence(fixture);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.figureLinksOk, false);
  assert.ok(result.figureViolations.some((violation) => violation.startsWith(`figures[0].${attribute}`)),
    JSON.stringify(result.figureViolations));
  assert.equal(result.figureEvidenceOk, true);
  assert.equal(result.matlabRuntimeOk, true);
  assert.equal(result.artifactsOk, true, JSON.stringify(result.artifactChecks));
  assert.equal(result.manifestFreshnessOk, true);
}

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

function atOrInside(root, file) {
  if (typeof file !== 'string') return false;
  const relative = path.relative(root, file);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function traceEvidenceFilesystem(context, options, beforeAccess = () => {}) {
  const accesses = [];
  const descriptors = new Map();
  const mocks = [];
  for (const method of ['lstatSync', 'statSync', 'realpathSync', 'existsSync', 'openSync', 'fstatSync', 'readFileSync', 'closeSync']) {
    const original = fs[method];
    mocks.push(context.mock.method(fs, method, (...args) => {
      const descriptor = typeof args[0] === 'number';
      const access = { method, file: descriptor ? descriptors.get(args[0]) : args[0], descriptor };
      accesses.push(access);
      beforeAccess(method, args);
      const result = original(...args);
      if (method === 'openSync') {
        descriptors.set(result, args[0]);
        access.succeeded = true;
        access.fd = result;
      } else if (method === 'closeSync') access.fd = args[0];
      return result;
    }));
  }
  syncBuiltinESMExports();
  try {
    return { result: inspectIllustratedReportEvidence(options), accesses };
  } finally {
    for (const mocked of mocks.reverse()) mocked.mock.restore();
    syncBuiltinESMExports();
  }
}

function createReportEvidenceFixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'illustrated-report-evidence-')));
  const htmlPath = path.join(root, 'report.html');
  const markdownPath = path.join(root, 'report.md');
  const artifactPath = path.join(root, 'figure.png');
  const pdfPath = path.join(root, 'figure.pdf');
  const interactionPath = path.join(root, 'figure.html');
  const manifestPath = path.join(root, 'figures.json');
  writeFileSync(htmlPath, [
    '<html><body>',
    '<p data-claim-id="claim-1" data-evidence-ids="fig-1" data-limitations="Only the observed UTC window is supported.">SST increased.</p>',
    '<figure data-figure-id="fig-1" data-chart-type="line" data-chart-family="temporal" data-source="fixture" data-snapshot-id="snapshot-20260905" data-variable="sea_water_temperature" data-unit="degree_Celsius" data-time-start="2026-09-03T00:00:00Z" data-time-end="2026-09-03T01:00:00Z" data-spatial-coverage="Test Sea 120-121E 30-31N" data-qc-summary="raw=2 valid=2 missing=0 qc_rejected=0" data-uncertainty="present Instrument accuracy metadata" data-uncertainty-status="present" data-uncertainty-method="Instrument accuracy metadata" data-anomaly-status="not-evaluated" data-matlab-release="R2026a">',
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
  return `<!doctype html><html><head><style>.temperature-point:hover{opacity:.8}.temperature-point:focus-visible{outline:2px solid black}</style></head><body data-snapshot-id="snapshot-20260905" data-source="source-1" data-variable="sea_water_temperature" data-unit="degree_Celsius" data-time-start="2026-09-03T00:00:00Z" data-time-end="2026-09-03T01:00:00Z" data-timezone="UTC" data-spatial-coverage="Test Sea 120-121E 30-31N" data-qc-summary="raw=2 valid=2 missing=0 qc_rejected=0" data-uncertainty="instrument accuracy; limited calibration evidence" data-uncertainty-status="present" data-uncertainty-method="Instrument accuracy metadata" data-anomaly-status="not-evaluated" data-authoritative-runtime="MATLAB" data-matlab-release="R2026a" data-runtime-status="passed" data-execution-verified="true" data-artifact-validation="passed" data-visual-inspection="passed"><svg>${pointMarkup}</svg><div class="legend" aria-label="系列图例"><span data-series-name="surface">surface</span><span data-series-name="bottom">bottom</span></div><div role="tooltip" hidden></div><script type="application/json">${JSON.stringify({ points })}</script><script>document.querySelectorAll('.temperature-point').forEach((point)=>{point.addEventListener('pointerenter',showTooltip);point.addEventListener('focus',showTooltip);});function showTooltip(){}</script></body></html>`;
}

function fileHash(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
