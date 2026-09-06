import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createIllustratedReportContract, REQUIRED_MATLAB_REPORT_RELEASES, REQUIRED_REPORT_ZONE_NAMES } from './illustrated-report-contract.mjs';
import { inspectReportStatusEvidence } from './report-status-evidence.mjs';

test('scoped synthetic component composition passes without certifying MATLAB or a full report', (context) => {
  const fixture = createFixture(context);
  const { result, accesses } = traceStatus(context, fixture);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.violations, []);
  assert.equal(result.matlabPlotQuality.matlabPlotQualityOk, true);
  assert.equal(result.illustratedReportEvidence.ok, true);
  assert.equal(result.illustratedReportEvidence.pathsOk, true);
  assert.deepEqual(result.matlabPlotQuality.manifestFreshness.evidenceFiles.filter((entry) => entry.file.endsWith('.m')).map((entry) => entry.file), [fixture.sourcePath]);
  assert.equal(result.pointInteractionQualities.length, 1);
  assert.strictEqual(result.pointInteractionQualities[0], result.illustratedReportEvidence.artifactChecks[2].interactionQuality);
  assert.equal(accesses.filter((entry) => entry.method === 'readFileSync' && entry.file === fixture.interactionPath).length, 1);
  assert.ok(result.illustratedReportEvidence.figureCount < fixture.report.minimumHtmlFigures);
  assert.ok(readFileSync(fixture.htmlPath).length < fixture.report.minimumHtmlBytes);
  assert.equal(fixture.manifest.synthetic, true);
});

test('missing scoped manifest and no MATLAB source never downgrade to a passing report', (context) => {
  const fixture = createFixture(context);
  renameSync(fixture.manifestPath, path.join(fixture.generatedRoot, 'figures.json'));
  rmSync(fixture.sourcePath);
  const { result, accesses } = traceStatus(context, fixture);
  assert.equal(result.ok, false);
  assert.equal(result.illustratedReportEvidence.manifestOk, false);
  assert.equal(result.illustratedReportEvidence.pathsOk, false);
  assert.ok(result.violations.includes('report-matlab-sources-missing'));
  assert.ok(result.violations.includes('report-point-interaction-missing'));
  assert.equal(result.matlabPlotQuality.skipped, true);
  assert.deepEqual(accesses.filter((entry) => entry.file === path.join(fixture.generatedRoot, 'figures.json')), []);
});

for (const policy of [undefined, null, {}, { profile: 'matlab-illustrated-v1', reportId: 'different-report' }]) {
  test(`requires a persisted policy binding: ${JSON.stringify(policy)}`, (context) => {
    const fixture = createFixture(context);
    fixture.policy = policy;
    const { result, accesses } = traceStatus(context, fixture);
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('report-policy-missing'));
    assert.ok(result.violations.every((code) => typeof code === 'string' && code.length > 0));
    assert.equal(result.illustratedReportEvidence.skipped, true);
    assert.equal(result.illustratedReportEvidence.pathsOk, false);
    assert.equal(result.matlabPlotQuality.skipped, true);
    assert.deepEqual(accesses, []);
  });
}

for (const profile of ['octave-illustrated-v1', 'html-only', 'MATLAB-illustrated-v1', '']) {
  test(`rejects unsupported policy profile ${JSON.stringify(profile)}`, (context) => {
    const fixture = createFixture(context);
    fixture.policy.profile = profile;
    const { result, accesses } = traceStatus(context, fixture);
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('report-policy-unsupported'));
    assert.equal(result.illustratedReportEvidence.skipped, true);
    assert.equal(result.illustratedReportEvidence.pathsOk, false);
    assert.equal(result.matlabPlotQuality.skipped, true);
    assert.deepEqual(accesses, []);
  });
}

test('missing point export fails even with a valid static bundle and a filename-matching decoy', (context) => {
  const fixture = createFixture(context);
  delete fixture.manifest.figures[0].exports.html;
  fixture.manifest.figures[0].interaction.required = false;
  const decoy = path.join(fixture.generatedRoot, `${fixture.report.id}-interactive-temperature-point.html`);
  copyFileSync(fixture.interactionPath, decoy);
  writeManifest(fixture);
  const { result, accesses } = traceStatus(context, fixture);
  assert.equal(result.ok, false);
  assert.equal(result.illustratedReportEvidence.pathsOk, true);
  assert.equal(result.illustratedReportEvidence.figureEvidenceOk, true);
  assert.equal(result.illustratedReportEvidence.interactiveFigureCount, 0);
  assert.ok(result.violations.includes('report-point-interaction-missing'));
  assert.equal(result.matlabPlotQuality.matlabPlotQualityOk, true);
  assert.deepEqual(accesses.filter((entry) => entry.file === decoy), []);
});

test('a different report HTML cannot substitute for the requested main report', (context) => {
  const fixture = createFixture(context);
  const foreign = path.join(fixture.generatedRoot, 'different-report.html');
  renameSync(fixture.htmlPath, foreign);
  fixture.report.absolutePaths[0] = foreign;
  const { result, accesses } = traceStatus(context, fixture);
  assert.equal(result.ok, false);
  assert.equal(result.illustratedReportEvidence.pathsOk, false);
  assert.deepEqual(accesses.filter((entry) => entry.file === foreign), []);
});

for (const format of ['png', 'pdf', 'html']) {
  test(`same main report ID cannot borrow another report's ${format}`, (context) => {
    const fixture = createFixture(context);
    const foreign = path.join(fixture.generatedRoot, `different-report-output.${format}`);
    copyFileSync(path.join(fixture.generatedRoot, fixture.manifest.figures[0].exports[format].file), foreign);
    fixture.manifest.figures[0].exports[format].file = path.basename(foreign);
    writeManifest(fixture);
    const { result, accesses } = traceStatus(context, fixture);
    assert.equal(result.ok, false);
    assert.equal(result.illustratedReportEvidence.pathsOk, true);
    assert.equal(result.illustratedReportEvidence.artifactPathsOk, false);
    assert.equal(result.matlabPlotQuality.skipped, true);
    assert.deepEqual(accesses.filter((entry) => entry.file === foreign), []);
  });
}

for (const kind of ['hash', 'unit', 'main-time', 'interactive-time', 'inert-point', 'inert-template-points', 'no-points', 'matlab-matrix']) {
  test(`propagates ${kind} failure without bypassing the illustrated inspector`, (context) => {
    const fixture = createFixture(context);
    const figure = fixture.manifest.figures[0];
    if (kind === 'hash') figure.exports.html.sha256 = '0'.repeat(64);
    if (kind === 'unit') figure.scientific_context.variables[0].unit = 'K';
    if (kind === 'main-time') writeFileSync(fixture.htmlPath, readFileSync(fixture.htmlPath, 'utf8').replace('data-time-start="2026-09-03T00:00:00Z"', 'data-time-start="2026-02-30T00:00:00Z"'));
    if (kind === 'interactive-time') mutateInteraction(fixture, (html) => html.replace('data-time-end="2026-09-03T01:00:00Z"', 'data-time-end="2026-09-03T02:00:00Z"'));
    if (kind === 'inert-point') mutateInteraction(fixture, (html) => html.replace(/<script>[^]*?<\/script>/u, ''));
    if (kind === 'inert-template-points') mutateInteraction(fixture, (html) => html.replace('<svg>', '<template><svg>').replace('</svg>', '</svg></template>'));
    if (kind === 'no-points') mutateInteraction(fixture, () => '<!doctype html><html><body>No point data.</body></html>');
    if (kind === 'matlab-matrix') fixture.manifest.matlab_ci.runs[0].execution_verified = false;
    writeManifest(fixture);
    const result = inspectReportStatusEvidence(fixture);
    assert.equal(result.ok, false);
    assert.equal(result.illustratedReportEvidence.pathsOk, true);
    assert.equal(result.illustratedReportEvidence.ok, false);
    assert.equal(result.illustratedReportEvidence.artifactPathsOk, true);
    assert.equal(result.matlabPlotQuality.matlabPlotQualityOk, true);
    assert.notEqual(result.matlabPlotQuality.skipped, true);
    assert.ok(result.violations.includes('report-illustrated-evidence-failed'));
    if (['inert-point', 'inert-template-points', 'no-points'].includes(kind)) assert.ok(result.violations.includes('report-point-interaction-failed'));
    if (kind === 'hash') assert.equal(result.illustratedReportEvidence.artifactChecks[2].hashOk, false);
    if (kind === 'unit') assert.equal(result.illustratedReportEvidence.figureEvidenceOk, false);
    if (kind === 'interactive-time') assert.ok(result.illustratedReportEvidence.artifactChecks[2].metadataViolations.includes('html.temporal_coverage.end.mismatch'));
    if (kind === 'matlab-matrix') assert.equal(result.illustratedReportEvidence.matlabRuntimeOk, false);
  });
}

test('keeps unsupported SVG evidence and fails instead of filtering it out', (context) => {
  const fixture = createFixture(context);
  const svg = path.join(fixture.generatedRoot, `${fixture.report.id}-chart.svg`);
  writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  fixture.manifest.figures[0].exports.svg = { ...artifactMetadata(svg), snapshot_id: 'synthetic-snapshot-23' };
  writeManifest(fixture);
  const result = inspectReportStatusEvidence(fixture);
  assert.equal(result.ok, false);
  const artifact = result.illustratedReportEvidence.artifactChecks.find((entry) => entry.format === 'svg');
  assert.ok(artifact.metadataViolations.includes('format.unsupported'));
  assert.equal(readFileSync(svg, 'utf8'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
});

for (const kind of ['png-structure', 'pdf-text', 'source-prohibited']) {
  test(`missing visual evidence does not suppress ${kind} diagnostics`, (context) => {
    const fixture = createFixture(context);
    delete fixture.manifest.figures[0].runtime.visual_inspection;
    if (kind === 'png-structure') {
      const bytes = readFileSync(fixture.pngPath);
      bytes.fill(0, 0, 8);
      writeFileSync(fixture.pngPath, bytes);
      Object.assign(fixture.manifest.figures[0].exports.png, artifactMetadata(fixture.pngPath));
    }
    if (kind === 'pdf-text') {
      writeFileSync(fixture.pdfPath, readFileSync(fixture.pdfPath, 'utf8').replace(/\([^)]*\) Tj/u, '() Tj'));
      Object.assign(fixture.manifest.figures[0].exports.pdf, artifactMetadata(fixture.pdfPath));
    }
    if (kind === 'source-prohibited') writeFileSync(fixture.sourcePath, `${readFileSync(fixture.sourcePath, 'utf8')}\ncolormap(jet(16));\n`);
    writeManifest(fixture);
    const result = inspectReportStatusEvidence(fixture);
    assert.equal(result.ok, false);
    assert.equal(result.illustratedReportEvidence.pathsOk, true);
    assert.equal(result.illustratedReportEvidence.manifestOk, true);
    assert.equal(result.illustratedReportEvidence.artifactPathsOk, true);
    assert.equal(result.illustratedReportEvidence.figureEvidenceOk, false);
    assert.notEqual(result.matlabPlotQuality.skipped, true);
    assert.equal(result.matlabPlotQuality.matlabPlotQualityOk, false);
    const field = { 'png-structure': 'pngArtifactsOk', 'pdf-text': 'pdfArtifactsOk', 'source-prohibited': 'sourceQualityOk' }[kind];
    assert.equal(result.matlabPlotQuality[field], false);
  });
}

for (const kind of ['absolute', 'traversal', 'symlink', 'intermediate-symlink', 'text-file', 'whitespace']) {
  test(`preflights ${kind} exports before the MATLAB reader`, (context) => {
    const fixture = createFixture(context);
    const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'report-status-outside-')));
    context.after(() => rmSync(outside, { recursive: true, force: true }));
    const foreign = path.join(outside, `${fixture.report.id}-chart.pdf`);
    copyFileSync(fixture.pdfPath, foreign);
    const artifact = fixture.manifest.figures[0].exports.pdf;
    if (kind === 'absolute') artifact.file = foreign;
    if (kind === 'traversal') artifact.file = `../${path.basename(outside)}/${path.basename(foreign)}`;
    if (kind === 'text-file') artifact.text_file = foreign;
    if (kind === 'whitespace') artifact.file = ` ${artifact.file} `;
    if (kind === 'symlink') {
      rmSync(fixture.pdfPath);
      symlinkSync(foreign, fixture.pdfPath);
    }
    if (kind === 'intermediate-symlink') {
      symlinkSync(outside, path.join(fixture.generatedRoot, 'nested'), 'dir');
      artifact.file = `nested/${path.basename(foreign)}`;
    }
    writeManifest(fixture);
    const { result, accesses } = traceStatus(context, fixture);
    assert.equal(result.ok, false);
    assert.equal(result.illustratedReportEvidence.artifactPathsOk, false);
    assert.equal(result.matlabPlotQuality.skipped, true);
    assert.deepEqual(accesses.filter((entry) => typeof entry.file === 'string' && entry.file.startsWith(`${outside}${path.sep}`)), []);
    assert.deepEqual(accesses.filter((entry) => entry.method === 'readFileSync' && entry.file === fixture.pdfPath), []);
  });
}

test('accepts owned nested exports but never scans nested or foreign MATLAB sources', (context) => {
  const fixture = createFixture(context);
  const nested = path.join(fixture.generatedRoot, 'nested');
  mkdirSync(nested);
  const ignored = [path.join(nested, `${fixture.report.id}-ignored.m`), path.join(fixture.generatedRoot, 'different-report-code.m')];
  for (const file of ignored) writeFileSync(file, 'jet(99);');
  for (const artifact of Object.values(fixture.manifest.figures[0].exports)) {
    renameSync(path.join(fixture.generatedRoot, artifact.file), path.join(nested, artifact.file));
    artifact.file = `nested/${artifact.file}`;
  }
  writeManifest(fixture);
  const { result, accesses } = traceStatus(context, fixture);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.matlabPlotQuality.manifestFreshness.evidenceFiles.filter((entry) => entry.file.endsWith('.m')).map((entry) => entry.file), [fixture.sourcePath]);
  assert.deepEqual(accesses.filter((entry) => ignored.includes(entry.file)), []);
});

test('the main report HTML can itself be the declared point export', (context) => {
  const fixture = createFixture(context);
  const mainBody = readFileSync(fixture.htmlPath, 'utf8').match(/<body>([^]*)<\/body>/u)[1];
  writeFileSync(fixture.htmlPath, readFileSync(fixture.interactionPath, 'utf8').replace('</body>', `${mainBody}</body>`));
  Object.assign(fixture.manifest.figures[0].exports.html, artifactMetadata(fixture.htmlPath));
  writeManifest(fixture);
  const result = inspectReportStatusEvidence(fixture);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.pointInteractionQualities.length, 1);
  assert.strictEqual(result.pointInteractionQualities[0], result.illustratedReportEvidence.artifactChecks[2].interactionQuality);
});

test('scoped array exports retain the same strict composition', (context) => {
  const fixture = createFixture(context);
  fixture.manifest.figures[0].exports = Object.entries(fixture.manifest.figures[0].exports)
    .map(([format, artifact]) => ({ ...artifact, format }));
  writeManifest(fixture);
  const result = inspectReportStatusEvidence(fixture);
  assert.equal(result.ok, true, JSON.stringify(result));
});

for (const kind of ['nonobject-export', 'flat-foreign-figure']) {
  test(`uninspected ${kind} cannot reach the MATLAB checker`, (context) => {
    const fixture = createFixture(context);
    const foreign = path.join(fixture.generatedRoot, 'different-report-chart.png');
    copyFileSync(fixture.pngPath, foreign);
    if (kind === 'nonobject-export') fixture.manifest.figures[0].exports.unchecked = path.basename(foreign);
    else fixture.manifest.figures.push({ id: 'foreign-figure', ...artifactMetadata(foreign), format: 'png' });
    writeManifest(fixture);
    const { result, accesses } = traceStatus(context, fixture);
    assert.equal(result.ok, false);
    assert.equal(result.matlabPlotQuality.skipped, true);
    assert.deepEqual(accesses.filter((entry) => entry.file === foreign), []);
  });
}

test('owned flat artifact paths permit physical diagnostics without passing the illustrated contract', (context) => {
  const fixture = createFixture(context);
  fixture.manifest.figures = ['png', 'pdf'].map((format) => ({
    ...fixture.manifest.figures[0].exports[format], id: 'fig-1', format,
  }));
  writeManifest(fixture);
  const result = inspectReportStatusEvidence(fixture);
  assert.equal(result.ok, false);
  assert.equal(result.illustratedReportEvidence.ok, false);
  assert.equal(result.illustratedReportEvidence.artifactPathsOk, true);
  assert.equal(result.matlabPlotQuality.matlabPlotQualityOk, true);
  assert.notEqual(result.matlabPlotQuality.skipped, true);
});

for (const kind of ['flat-absolute-file', 'flat-text-file', 'nested-foreign-text-file']) {
  test(`preflights every MATLAB file reference for ${kind}`, (context) => {
    const fixture = createFixture(context);
    const foreign = path.join(fixture.generatedRoot, 'different-report-artifact.pdf');
    copyFileSync(fixture.pdfPath, foreign);
    if (kind === 'nested-foreign-text-file') fixture.manifest.figures[0].exports.pdf.text_file = path.basename(foreign);
    else {
      const flat = { ...fixture.manifest.figures[0].exports.pdf, id: 'flat-figure', format: 'pdf' };
      if (kind === 'flat-absolute-file') flat.file = foreign;
      else flat.text_file = path.basename(foreign);
      fixture.manifest.figures.push(flat);
    }
    writeManifest(fixture);
    const { result, accesses } = traceStatus(context, fixture);
    assert.equal(result.ok, false);
    assert.equal(result.illustratedReportEvidence.artifactPathsOk, false);
    assert.equal(result.matlabPlotQuality.skipped, true);
    assert.deepEqual(accesses.filter((entry) => entry.file === foreign), []);
  });
}

test('owned text_file is checked without replacing the PDF physical text audit', (context) => {
  const fixture = createFixture(context);
  const textPath = path.join(fixture.generatedRoot, `${fixture.report.id}-pdf-text.txt`);
  writeFileSync(textPath, 'Synthetic sidecar, not a substitute for real PDF text.');
  fixture.manifest.figures[0].exports.pdf.text_file = path.basename(textPath);
  writeManifest(fixture);
  assert.equal(inspectReportStatusEvidence(fixture).ok, true);
  writeFileSync(fixture.pdfPath, readFileSync(fixture.pdfPath, 'utf8').replace(/\([^)]*\) Tj/u, '() Tj'));
  Object.assign(fixture.manifest.figures[0].exports.pdf, artifactMetadata(fixture.pdfPath));
  writeManifest(fixture);
  const result = inspectReportStatusEvidence(fixture);
  assert.equal(result.illustratedReportEvidence.artifactPathsOk, true);
  assert.equal(result.matlabPlotQuality.pdfArtifactsOk, false);
  assert.equal(result.ok, false);
});

for (const kind of ['export', 'flat-file', 'text-file']) {
  test(`failed guarded ${kind} read prevents a subsequent MATLAB path reopen`, (context) => {
    const fixture = createFixture(context);
    let protectedPath = fixture.pdfPath;
    if (kind === 'flat-file') fixture.manifest.figures.push({ ...fixture.manifest.figures[0].exports.pdf, id: 'flat-figure', format: 'pdf' });
    if (kind === 'text-file') {
      protectedPath = path.join(fixture.generatedRoot, `${fixture.report.id}-pdf-text.txt`);
      writeFileSync(protectedPath, 'Synthetic sidecar.');
      fixture.manifest.figures[0].exports.pdf.text_file = path.basename(protectedPath);
    }
    writeManifest(fixture);
    let replaced = false;
    const { result, accesses } = traceStatus(context, fixture, (method, args) => {
      if (!replaced && method === 'openSync' && args[0] === protectedPath) {
        replaced = true;
        renameSync(protectedPath, `${protectedPath}.original`);
        symlinkSync(`${protectedPath}.original`, protectedPath);
      }
    });
    assert.equal(replaced, true);
    assert.equal(result.ok, false);
    assert.equal(result.illustratedReportEvidence.artifactPathsOk, false);
    assert.equal(result.matlabPlotQuality.skipped, true);
    assert.deepEqual(accesses.filter((entry) => entry.method === 'readFileSync' && [protectedPath, `${protectedPath}.original`].includes(entry.file)), []);
  });
}

test('source replacement at open never reaches the weaker MATLAB source reader', (context) => {
  const fixture = createFixture(context);
  let replaced = false;
  const { result, accesses } = traceStatus(context, fixture, (method, args) => {
    if (!replaced && method === 'openSync' && args[0] === fixture.sourcePath) {
      replaced = true;
      renameSync(fixture.sourcePath, `${fixture.sourcePath}.original`);
      writeFileSync(fixture.sourcePath, 'jet(99);');
    }
  });
  assert.equal(replaced, true);
  assert.equal(result.ok, false);
  assert.equal(result.matlabPlotQuality.skipped, true);
  assert.deepEqual(accesses.filter((entry) => entry.method === 'readFileSync' && entry.file === fixture.sourcePath), []);
});

test('symlink generatedRoot fails before any content read', (context) => {
  const fixture = createFixture(context);
  const links = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'report-status-links-')));
  context.after(() => rmSync(links, { recursive: true, force: true }));
  symlinkSync(fixture.generatedRoot, path.join(links, 'alias'), 'dir');
  fixture.generatedRoot = path.join(links, 'alias');
  const { result, accesses } = traceStatus(context, fixture);
  assert.equal(result.ok, false);
  assert.equal(result.illustratedReportEvidence.pathsOk, false);
  assert.deepEqual(accesses.filter((entry) => ['openSync', 'readFileSync'].includes(entry.method)), []);
});

for (const kind of ['missing', 'symlink', 'directory', 'invalid-source']) {
  test(`MATLAB sources fail closed for ${kind}`, (context) => {
    const fixture = createFixture(context);
    const foreign = path.join(fixture.generatedRoot, 'different-report-code.m');
    renameSync(fixture.sourcePath, foreign);
    if (kind === 'symlink') symlinkSync(foreign, fixture.sourcePath);
    if (kind === 'directory') mkdirSync(fixture.sourcePath);
    if (kind === 'invalid-source') writeFileSync(fixture.sourcePath, 'jet(99);');
    writeManifest(fixture);
    const { result, accesses } = traceStatus(context, fixture);
    assert.equal(result.ok, false);
    assert.equal(result.illustratedReportEvidence.ok, true);
    assert.equal(result.matlabPlotQuality.matlabPlotQualityOk, false);
    assert.deepEqual(accesses.filter((entry) => entry.file === foreign), []);
  });
}

for (const field of ['htmlPath', 'markdownPath', 'manifestPath']) {
  test(`unsafe ${field} stays visible as pathsOk=false for index short circuit`, (context) => {
    const fixture = createFixture(context);
    const original = `${fixture[field]}.original`;
    renameSync(fixture[field], original);
    symlinkSync(original, fixture[field]);
    const { result, accesses } = traceStatus(context, fixture);
    assert.equal(result.ok, false);
    assert.equal(result.illustratedReportEvidence.pathsOk, false);
    assert.deepEqual(accesses.filter((entry) => entry.method === 'readFileSync' && [original, fixture[field]].includes(entry.file)), []);
  });
}

test('missing root, invalid ID, and malformed manifest always return stable failure objects', (context) => {
  assert.equal(inspectReportStatusEvidence().illustratedReportEvidence.pathsOk, false);
  const fixture = createFixture(context);
  const invalid = inspectReportStatusEvidence({ ...fixture, report: { id: '../different-report' } });
  assert.ok(invalid.violations.includes('report-id-invalid'));
  assert.equal(invalid.illustratedReportEvidence.pathsOk, false);
  writeFileSync(fixture.manifestPath, '{not-json');
  const malformed = inspectReportStatusEvidence(fixture);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.illustratedReportEvidence.pathsOk, true);
  assert.equal(malformed.illustratedReportEvidence.manifestOk, false);
});

function createFixture(context) {
  const generatedRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'synthetic-report-status-')));
  context.after(() => rmSync(generatedRoot, { recursive: true, force: true }));
  const report = createIllustratedReportContract(generatedRoot, 'synthetic-report-23');
  const policy = { profile: 'matlab-illustrated-v1', reportId: report.id };
  const [htmlPath, markdownPath] = report.absolutePaths;
  const manifestPath = path.join(generatedRoot, `${report.id}-figures.json`);
  const sourcePath = path.join(generatedRoot, `${report.id}-plot.m`);
  const pngPath = path.join(generatedRoot, `${report.id}-chart.png`);
  const pdfPath = path.join(generatedRoot, `${report.id}-chart.pdf`);
  const interactionPath = path.join(generatedRoot, `${report.id}-detail.html`);
  const coverage = { start: '2026-09-03T00:00:00Z', end: '2026-09-03T01:00:00Z', timezone: 'UTC' };
  const uncertainty = { status: 'present', method: 'Synthetic standard uncertainty', limitations: 'Only synthetic test declarations, not field calibration evidence.' };
  const anomaly = { status: 'not-evaluated', method: 'No baseline', limitations: 'No real anomaly assessment is possible from this synthetic fixture.' };
  const variable = { name: 'sea_water_temperature', unit: 'degree_Celsius' };
  const attributes = `data-snapshot-id="synthetic-snapshot-23" data-source="synthetic-source" data-variable="${variable.name}" data-unit="${variable.unit}" data-time-start="${coverage.start}" data-time-end="${coverage.end}" data-timezone="UTC" data-spatial-coverage="Synthetic Sea 120-121E 30-31N" data-qc-summary="raw=2 valid=2 missing=0 qc_rejected=0" data-uncertainty="Synthetic uncertainty, no field evidence" data-uncertainty-status="present" data-uncertainty-method="${uncertainty.method}" data-anomaly-status="not-evaluated" data-matlab-release="R2026a"`;
  writeFileSync(htmlPath, `<!doctype html><html><body><p data-claim-id="claim-1" data-evidence-ids="fig-1" data-limitations="Only this synthetic test window is represented.">Synthetic component test.</p><figure data-figure-id="fig-1" ${attributes}><figcaption>Two synthetic temperatures in the declared UTC window, with supplied QC and uncertainty; no real sea-state inference is supported.</figcaption></figure></body></html>`);
  writeFileSync(markdownPath, '# Synthetic component fixture\nNot a complete ocean report or MATLAB execution record.');
  writeFileSync(sourcePath, `theme = oi_ocean_theme();\nfigure_handle = oi_figure(1400, 800, 'off');\naxes_handle = axes('Parent', figure_handle);\nplot(axes_handle, 1:2, [20 18]);\noi_apply_axes(axes_handle, theme);\noi_export_png(figure_handle, 'synthetic.png', 1400, 800, 160);\nprint(figure_handle, 'synthetic.pdf', '-dpdf', '-painters');\n`);
  const png = Buffer.alloc(12_000);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(1400, 16);
  png.writeUInt32BE(800, 20);
  png.write('IEND', png.length - 8, 'ascii');
  writeFileSync(pngPath, png);
  writeFileSync(pdfPath, '%PDF-1.4\n1 0 obj << /Type /Page /MediaBox [0 0 630 360] >> endobj\n2 0 obj << /Length 75 >> stream\nBT (Synthetic temperature degree Celsius UTC, not MATLAB output) Tj ET\nendstream endobj\n%%EOF');
  const points = [20, 18].map((temperature, index) => ({ id: `P${index + 1}`, series: index ? 'bottom' : 'surface', temperature, unit: variable.unit, time: index ? coverage.end : coverage.start, longitude: 120.2 + index / 10, latitude: 30.2 + index / 10, qc: 'good' }));
  const pointMarkup = points.map((point, index) => `<g class="temperature-point" tabindex="0" role="img" data-point-index="${index}" data-observation-id="${point.id}" data-temperature="${point.temperature}" data-unit="${point.unit}" data-time="${point.time}" data-longitude="${point.longitude}" data-latitude="${point.latitude}" data-qc="${point.qc}" aria-label="point ${point.id} temperature ${point.temperature} unit ${point.unit} time ${point.time} longitude ${point.longitude} latitude ${point.latitude} QC ${point.qc}"></g>`).join('');
  writeFileSync(interactionPath, `<!doctype html><html><head><style>.temperature-point:hover{opacity:.8}.temperature-point:focus-visible{outline:2px solid black}</style></head><body ${attributes} data-authoritative-runtime="MATLAB" data-runtime-status="passed" data-execution-verified="true" data-artifact-validation="passed" data-visual-inspection="passed"><svg>${pointMarkup}</svg><div class="legend" aria-label="Series legend"><span data-series-name="surface">surface</span><span data-series-name="bottom">bottom</span></div><div role="tooltip" hidden></div><script type="application/json">${JSON.stringify({ points })}</script><script>document.querySelectorAll('.temperature-point').forEach((point)=>{point.addEventListener('pointerenter',showTooltip);point.addEventListener('focus',showTooltip);});function showTooltip(){}</script></body></html>`);
  const shared = { figure_id: 'fig-1', title: 'Synthetic component figure', source: 'synthetic-source', theme: 'Ocean Intelligence', snapshot_id: 'synthetic-snapshot-23' };
  const runtime = { authoritative_runtime: 'MATLAB', runtime_status: 'passed', execution_verified: true, artifact_validation: { status: 'passed' }, visual_inspection: { status: 'passed' } };
  const manifest = {
    schema_version: 2, synthetic: true, generator: 'Synthetic unit-test composition, not MATLAB execution evidence',
    ocean_report: {
      area: { name: 'Synthetic Sea', bounds: [120, 30, 121, 31], zones: REQUIRED_REPORT_ZONE_NAMES },
      requested_coverage: { ...coverage, spatial: 'Synthetic Sea bounds', depth: 'Synthetic surface and bottom' },
      effective_coverage: { ...coverage, spatial: 'Synthetic Sea bounds', depth: 'Synthetic surface and bottom' },
      data_sources: [{ id: shared.source, name: 'Synthetic test data', version: '1', accessed_at: '2026-09-05T00:00:00Z' }],
      variables: [{ ...variable, quantity: 'sea water temperature', source_ids: [shared.source] }],
      uncertainty, anomaly, conclusion: { status: 'audited', limitations: 'Synthetic contract tests only, not a real ocean report assessment.' },
    },
    matlab_ci: {
      required_releases: REQUIRED_MATLAB_REPORT_RELEASES,
      runs: REQUIRED_MATLAB_REPORT_RELEASES.map((release) => ({ ...runtime, release, command: 'synthetic unit-test declaration, not executed', toolboxes: ['MATLAB'], evidence_id: `synthetic-${release}` })),
    },
    figures: [{
      id: shared.figure_id, title: shared.title, source: shared.source, theme: shared.theme,
      scientific_context: { snapshot_id: shared.snapshot_id, variables: [variable], temporal_coverage: coverage, spatial_coverage: { name: 'Synthetic Sea', bounds: [120, 30, 121, 31] }, qc: { raw: 2, valid: 2, missing: 0, qc_rejected: 0 }, uncertainty, anomaly },
      runtime: { ...runtime, matlab_release: 'R2026a' },
      interaction: { required: true, self_contained: true, validation_status: 'passed', snapshot_id: shared.snapshot_id },
      exports: {
        png: { ...shared, ...artifactMetadata(pngPath), width: 1400, height: 800, dpi: 160 },
        pdf: { ...shared, ...artifactMetadata(pdfPath), width: 630, height: 360, text: 'Synthetic temperature UTC' },
        html: { ...shared, ...artifactMetadata(interactionPath), self_contained: true },
      },
    }],
  };
  const fixture = { report, policy, generatedRoot, htmlPath, markdownPath, manifestPath, sourcePath, pngPath, pdfPath, interactionPath, manifest };
  writeManifest(fixture);
  return fixture;
}

function artifactMetadata(file) {
  const contents = readFileSync(file);
  return { file: path.basename(file), bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') };
}

function writeManifest(fixture) {
  fixture.manifest.generated_at = new Date().toISOString();
  writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
}

function mutateInteraction(fixture, transform) {
  writeFileSync(fixture.interactionPath, transform(readFileSync(fixture.interactionPath, 'utf8')));
  Object.assign(fixture.manifest.figures[0].exports.html, artifactMetadata(fixture.interactionPath));
}

function traceStatus(context, fixture, beforeAccess = () => {}) {
  const accesses = [];
  const descriptors = new Map();
  const mocks = ['lstatSync', 'statSync', 'realpathSync', 'existsSync', 'openSync', 'readFileSync'].map((method) => {
    const original = fs[method];
    return context.mock.method(fs, method, (...args) => {
      const file = typeof args[0] === 'number' ? descriptors.get(args[0]) : args[0];
      accesses.push({ method, file });
      beforeAccess(method, args);
      const result = original(...args);
      if (method === 'openSync') descriptors.set(result, args[0]);
      return result;
    });
  });
  syncBuiltinESMExports();
  try {
    return { result: inspectReportStatusEvidence(fixture), accesses };
  } finally {
    for (const mocked of mocks.reverse()) mocked.mock.restore();
    syncBuiltinESMExports();
  }
}
