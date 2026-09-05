import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectMatlabPlotQuality, scoreMatlabPlotQuality } from './matlab-plot-quality.mjs';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function writePng(filePath, width, height, bytes = 12_000) {
  const png = Buffer.alloc(bytes);
  PNG_SIGNATURE.copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png.writeUInt32BE(0, bytes - 12);
  png.write('IEND', bytes - 8, 'ascii');
  writeFileSync(filePath, png);
}

function writePdf(filePath, text = 'SST anomaly UTC') {
  writeFileSync(filePath, [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 630 360] /Contents 4 0 R >> endobj',
    `4 0 obj << /Length ${text.length + 24} >> stream`,
    `BT /F1 12 Tf 72 250 Td (${text}) Tj ET`,
    'endstream endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n'));
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function createValidFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'matlab-plot-quality-'));
  const sourcePath = path.join(root, 'plot_report.m');
  const manifestPath = path.join(root, 'figures.json');
  const pngPath = path.join(root, 'sst-overview.png');
  const pdfPath = path.join(root, 'sst-overview.pdf');
  writeFileSync(sourcePath, `
theme = oi_ocean_theme();
figure_handle = oi_figure(1400, 800, 'off');
axes_handle = axes('Parent', figure_handle);
plot(axes_handle, 1:10, 1:10, 'Color', theme.line_colors(1, :));
oi_apply_axes(axes_handle, theme);
oi_export_png(figure_handle, fullfile(output_directory, 'sst-overview.png'), 1400, 800, 160);
print(figure_handle, fullfile(output_directory, 'sst-overview.pdf'), '-dpdf', '-painters');
`);
  writePng(pngPath, 1400, 800);
  writePdf(pdfPath);
  const shared = {
    figure_id: 'sst-overview',
    title: 'SST overview',
    source: 'Copernicus Marine SST',
    theme: 'Ocean Intelligence',
  };
  const manifest = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    generator: 'Ocean Intelligence MATLAB/Octave plotting',
    figures: [{
      id: 'sst-overview',
      title: 'SST overview',
      source: 'Copernicus Marine SST',
      theme: 'Ocean Intelligence',
      exports: {
        png: {
          ...shared,
          format: 'png',
          file: path.basename(pngPath),
          width: 1400,
          height: 800,
          dpi: 160,
          bytes: statSync(pngPath).size,
          sha256: sha256(pngPath),
        },
        pdf: {
          ...shared,
          format: 'pdf',
          file: path.basename(pdfPath),
          width: 630,
          height: 360,
          bytes: statSync(pdfPath).size,
          sha256: sha256(pdfPath),
          text: 'SST anomaly UTC',
        },
      },
    }],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { root, sourcePath, manifestPath, pngPath, pdfPath, manifest };
}

test('accepts themed, auditable PNG and PDF MATLAB/Octave outputs', () => {
  const fixture = createValidFixture();
  const quality = inspectMatlabPlotQuality(fixture.sourcePath, fixture.manifestPath, fixture.root);

  assert.equal(quality.prohibitedPatternsOk, true);
  assert.equal(quality.themeUsageOk, true);
  assert.equal(quality.exportUsageOk, true);
  assert.equal(quality.manifestFieldsOk, true);
  assert.equal(quality.artifactPairsOk, true);
  assert.equal(quality.pngArtifactsOk, true);
  assert.equal(quality.pdfArtifactsOk, true);
  assert.equal(quality.crossFormatMetadataOk, true);
  assert.equal(quality.matlabPlotQualityOk, true);
  assert.equal(quality.figureCount, 1);
  assert.deepEqual(quality.artifacts.map((artifact) => artifact.format), ['png', 'pdf']);
});

test('accepts the existing flat manifest style with one entry per format', () => {
  const fixture = createValidFixture();
  const figure = fixture.manifest.figures[0];
  fixture.manifest.figures = ['png', 'pdf'].map((format) => ({
    id: figure.id,
    title: figure.title,
    source: figure.source,
    theme: figure.theme,
    ...figure.exports[format],
  }));
  writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest, null, 2));

  const quality = inspectMatlabPlotQuality(fixture.sourcePath, fixture.manifestPath, fixture.root);

  assert.equal(quality.figureCount, 1);
  assert.equal(quality.manifestCompleteOk, true);
  assert.equal(quality.crossFormatAuditOk, true);
  assert.equal(quality.plotQualityOk, true);
});

test('rejects jet, saveas, missing shared theme and missing PDF export', () => {
  const fixture = createValidFixture();
  writeFileSync(fixture.sourcePath, `
figure_handle = figure();
imagesc(peaks(20));
colormap(jet(256));
saveas(figure_handle, fullfile(output_directory, 'sst-overview.png'));
`);

  const quality = inspectMatlabPlotQuality({
    sourcePath: fixture.sourcePath,
    manifestPath: fixture.manifestPath,
    outputDirectory: fixture.root,
  });

  assert.equal(quality.prohibitedPatternsOk, false);
  assert.equal(quality.themeUsageOk, false);
  assert.equal(quality.pngExportOk, false);
  assert.equal(quality.pdfExportOk, false);
  assert.equal(quality.sourceQualityOk, false);
  assert.deepEqual(quality.sourceViolations.map((violation) => violation.rule).sort(), [
    'jet-colormap',
    'saveas-export',
  ]);
  assert.equal(quality.matlabPlotQualityOk, false);
});

test('ignores prohibited patterns that only appear in MATLAB comments', () => {
  const fixture = createValidFixture();
  writeFileSync(fixture.sourcePath, `
% Do not use jet(256) or saveas(handle, 'legacy.png').
%{
colormap('jet');
saveas(figure_handle, 'legacy.png');
%}
theme = oi_ocean_theme();
figure_handle = oi_figure(1400, 800, 'off');
oi_apply_axes(gca(), theme);
oi_export_png(figure_handle, fullfile(output_directory, 'sst-overview.png'), 1400, 800, 160);
print(figure_handle, fullfile(output_directory, 'sst-overview.pdf'), '-dpdf', '-painters');
`);

  const quality = inspectMatlabPlotQuality(fixture.sourcePath, fixture.manifestPath, fixture.root);

  assert.equal(quality.prohibitedPatternsOk, true);
  assert.equal(quality.matlabPlotQualityOk, true);
});

test('recognizes the shared PNG and PDF figure export helper', () => {
  const fixture = createValidFixture();
  writeFileSync(fixture.sourcePath, `theme = oi_ocean_theme();\nfig = oi_figure(1200, 675);\nax = axes('Parent', fig);\nplot(ax, 1:3);\noi_apply_axes(ax, theme);\noi_export_figure(fig, pwd(), 'shared-export', 1200, 675, 180);`);
  const quality = inspectMatlabPlotQuality(fixture.sourcePath, fixture.manifestPath, fixture.root);
  assert.equal(quality.pngExportOk, true);
  assert.equal(quality.pdfExportOk, true);
});

test('rejects undersized PNGs, textless PDFs and incomplete manifests', () => {
  const fixture = createValidFixture();
  writePng(fixture.pngPath, 800, 450);
  writePdf(fixture.pdfPath, '');
  fixture.manifest.figures[0].exports.png.width = 800;
  fixture.manifest.figures[0].exports.png.height = 450;
  fixture.manifest.figures[0].exports.png.bytes = statSync(fixture.pngPath).size;
  fixture.manifest.figures[0].exports.png.sha256 = sha256(fixture.pngPath);
  fixture.manifest.figures[0].exports.pdf.bytes = statSync(fixture.pdfPath).size;
  fixture.manifest.figures[0].exports.pdf.sha256 = sha256(fixture.pdfPath);
  delete fixture.manifest.figures[0].source;
  delete fixture.manifest.figures[0].exports.pdf.text;
  writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest, null, 2));

  const quality = inspectMatlabPlotQuality(fixture.sourcePath, fixture.manifestPath, fixture.root);

  assert.equal(quality.manifestFieldsOk, false);
  assert.match(quality.manifestMissingFields.join('\n'), /sst-overview\.source/u);
  assert.match(quality.manifestMissingFields.join('\n'), /exports\.pdf\.text/u);
  assert.equal(quality.pngArtifactsOk, false);
  assert.equal(quality.pdfArtifactsOk, false);
  assert.equal(quality.artifacts.find((artifact) => artifact.format === 'png').dimensionsOk, false);
  assert.equal(quality.artifacts.find((artifact) => artifact.format === 'pdf').textOk, false);
  assert.equal(quality.matlabPlotQualityOk, false);
});

test('rejects cross-format metadata that cannot be traced to one figure', () => {
  const fixture = createValidFixture();
  fixture.manifest.figures[0].exports.pdf.source = 'Untracked spreadsheet';
  writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest, null, 2));

  const quality = inspectMatlabPlotQuality(fixture.sourcePath, fixture.manifestPath, fixture.root);

  assert.equal(quality.manifestFieldsOk, true);
  assert.equal(quality.pngArtifactsOk, true);
  assert.equal(quality.pdfArtifactsOk, true);
  assert.equal(quality.crossFormatMetadataOk, false);
  assert.equal(quality.manifestOk, false);
  assert.equal(quality.matlabPlotQualityOk, false);
});

test('reports missing and malformed manifests without throwing', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'matlab-plot-quality-missing-'));
  const sourcePath = path.join(root, 'plot_report.m');
  const manifestPath = path.join(root, 'figures.json');
  mkdirSync(path.join(root, 'output'));
  writeFileSync(sourcePath, 'theme = oi_ocean_theme(); figure_handle = oi_figure(); oi_apply_axes(gca(), theme); oi_export_png(figure_handle, "a.png"); print(figure_handle, "a.pdf", "-dpdf");');

  const missing = inspectMatlabPlotQuality(sourcePath, manifestPath, root);
  assert.equal(missing.manifestPresent, false);
  assert.equal(missing.manifestParseOk, false);
  assert.equal(missing.matlabPlotQualityOk, false);

  writeFileSync(manifestPath, '{invalid');
  const malformed = inspectMatlabPlotQuality(sourcePath, manifestPath, root);
  assert.equal(malformed.manifestPresent, true);
  assert.equal(malformed.manifestParseOk, false);
  assert.equal(malformed.matlabPlotQualityOk, false);

  writeFileSync(manifestPath, JSON.stringify({
    schema_version: 1,
    generated_at: 'not-a-date',
    generator: 'test',
    figures: [{
      id: 'a',
      title: 'A',
      source: 'source',
      theme: 'theme',
      exports: {
        png: { file: 1, bytes: 1, sha256: 1, width: 1, height: 1, dpi: 1 },
        pdf: { file: 1, bytes: 1, sha256: 1, width: 1, height: 1, text: 'A' },
      },
    }],
  }));
  const invalidTypes = inspectMatlabPlotQuality(sourcePath, manifestPath, root);
  assert.equal(invalidTypes.manifestParseOk, true);
  assert.equal(invalidTypes.manifestFieldsOk, false);
  assert.equal(invalidTypes.matlabPlotQualityOk, false);
});

test('scores the eight second-round MATLAB figure quality criteria', () => {
  const fixture = createValidFixture();
  writeFileSync(fixture.sourcePath, `
theme = oi_ocean_theme();
fig = oi_figure(1400, 800);
ax = axes('Parent', fig, 'FontSize', 12, 'LineWidth', 1.5);
plot(ax, 1:10, 1:10, 'LineWidth', 1.5, 'Marker', 'o');
xlabel(ax, 'Longitude (deg E)'); ylabel(ax, 'SST (deg C)');
legend(ax, 'SST', 'Location', 'bestoutside');
cb = colorbar(ax); cb.Label.String = 'SST anomaly (deg C)';
colormap(ax, parula(256));
oi_apply_axes(ax, theme);
oi_export_figure(fig, pwd(), 'sst-overview', 1400, 800, 180);
`);
  const quality = scoreMatlabPlotQuality(fixture.sourcePath, fixture.manifestPath, fixture.root);

  assert.equal(quality.plotQualityScore, 100);
  assert.equal(quality.plotQualityGrade, 'A');
  assert.equal(quality.plotQualityScoreOk, true);
  assert.deepEqual(Object.keys(quality.plotQualityCriteria).sort(), [
    'accessibility', 'axisLabelsUnits', 'clippingRisk', 'colorbarLabels',
    'fontSize', 'legendOcclusion', 'lineWidth', 'outputResolution',
  ]);
  assert.ok(Object.values(quality.plotQualityCriteria).every((criterion) => criterion.ok));
});

test('penalizes missing labels, small typography, weak lines, overlap and inaccessible color', () => {
  const fixture = createValidFixture();
  writeFileSync(fixture.sourcePath, `
fig = figure(); ax = axes('Parent', fig, 'FontSize', 8, 'LineWidth', 0.5);
plot(ax, 1:3, 1:3, 'LineWidth', 0.5); axis tight;
legend(ax, 'series', 'Location', 'best');
colorbar(ax); colormap(ax, jet(256));
exportgraphics(fig, 'plot.png', 'Resolution', 96);
`);
  const quality = scoreMatlabPlotQuality(fixture.sourcePath, fixture.manifestPath, fixture.root);

  assert.equal(quality.plotQualityScoreOk, false);
  assert.equal(quality.plotQualityCriteria.axisLabelsUnits.ok, false);
  assert.equal(quality.plotQualityCriteria.fontSize.ok, false);
  assert.equal(quality.plotQualityCriteria.lineWidth.ok, false);
  assert.equal(quality.plotQualityCriteria.legendOcclusion.ok, false);
  assert.equal(quality.plotQualityCriteria.colorbarLabels.ok, false);
  assert.equal(quality.plotQualityCriteria.clippingRisk.ok, false);
  assert.equal(quality.plotQualityCriteria.accessibility.ok, false);
  assert.match(quality.plotQualityIssues.join('\n'), /axisLabelsUnits/u);
  assert.match(quality.plotQualityIssues.join('\n'), /accessibility/u);
});

test('does not allow self-reported visual audit booleans to manufacture a score', () => {
  const fixture = createValidFixture();
  const quality = scoreMatlabPlotQuality({
    sourcePath: fixture.sourcePath,
    manifestPath: fixture.manifestPath,
    outputDirectory: fixture.root,
    minimumPlotQualityScore: 95,
    plotQualityAudit: {
      axisLabelsUnits: true,
      fontSize: true,
      lineWidth: true,
      legendOcclusion: true,
      colorbarLabels: true,
      clippingRisk: true,
      outputResolution: true,
      accessibility: true,
    },
  });

  assert.ok(quality.plotQualityScore < 100);
  assert.equal(quality.plotQualityScoreOk, false);
  assert.equal(quality.plotQualityCriteria.axisLabelsUnits.ok, false);
  assert.doesNotMatch(quality.plotQualityIssues.join('\n'), /explicit audit marked this criterion as failed/u);
});

test('does not count comments or strings as theme, export, or quality evidence', () => {
  const fixture = createValidFixture();
  writeFileSync(fixture.sourcePath, `
message = "oi_ocean_theme(); oi_figure(); oi_apply_axes(gca(), theme); xlabel('Time (h)'); exportgraphics(gcf, 'fake.png')";
% oi_export_figure(gcf, pwd(), 'fake', 1400, 800, 180)
disp(message);
`);
  fixture.manifest.generated_at = new Date().toISOString();
  writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest, null, 2));

  const quality = inspectMatlabPlotQuality(fixture.sourcePath, fixture.manifestPath, fixture.root);

  assert.equal(quality.themeUsageOk, false);
  assert.equal(quality.exportUsageOk, false);
  assert.equal(quality.plotQualityScore, 0);
  assert.equal(quality.matlabPlotQualityOk, false);
});

test('requires fresh manifest timestamps even when artifact hashes still match', () => {
  const fixture = createValidFixture();
  fixture.manifest.generated_at = new Date(statSync(fixture.sourcePath).mtimeMs - 60_000).toISOString();
  writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest, null, 2));

  const quality = inspectMatlabPlotQuality({
    sourcePath: fixture.sourcePath,
    manifestPath: fixture.manifestPath,
    outputDirectory: fixture.root,
    freshnessToleranceMs: 1,
  });

  assert.equal(quality.artifactsOk, true);
  assert.equal(quality.manifestFreshnessOk, false);
  assert.match(quality.manifestFreshness.violations.join('\n'), /evidence\.newer_than_generated_at/u);
  assert.equal(quality.plotQualityScore, 0);
  assert.equal(quality.matlabPlotQualityOk, false);
});

test('never awards an auditable score to prohibited or non-themed source', () => {
  const fixture = createValidFixture();
  writeFileSync(fixture.sourcePath, `
fig = figure('Visible','off'); ax = axes('Parent',fig,'FontSize',12,'LineWidth',1.5);
plot(ax,1:10,1:10,'LineWidth',1.5,'Marker','o');
xlabel(ax,'Time (h)'); ylabel(ax,'SST (deg C)');
legend(ax,'SST','Location','eastoutside'); cb=colorbar(ax); cb.Label.String='SST (deg C)';
colormap(ax,parula(256)); saveas(fig,'forbidden.png');
exportgraphics(fig,'plot.png','Resolution',180); exportgraphics(fig,'plot.pdf');
`);
  fixture.manifest.generated_at = new Date().toISOString();
  writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest, null, 2));

  const quality = scoreMatlabPlotQuality({
    sourcePath: fixture.sourcePath,
    manifestPath: fixture.manifestPath,
    outputDirectory: fixture.root,
    minimumPlotQualityScore: 100,
  });

  assert.equal(quality.plotQualityScore, 0);
  assert.equal(quality.plotQualitySourceEvidenceOk, false);
  assert.equal(quality.plotQualityScoreOk, false);
});

test('rejects duplicate figure evidence and manifest-only PDF text claims', () => {
  const fixture = createValidFixture();
  fixture.manifest.figures.push(structuredClone(fixture.manifest.figures[0]));
  fixture.manifest.figures[1].id = 'sst-overview';
  writePdf(fixture.pdfPath, '');
  fixture.manifest.figures[0].exports.pdf.bytes = statSync(fixture.pdfPath).size;
  fixture.manifest.figures[0].exports.pdf.sha256 = sha256(fixture.pdfPath);
  fixture.manifest.figures[0].exports.pdf.text = 'fabricated ocean evidence';
  fixture.manifest.figures[1].exports.pdf = structuredClone(fixture.manifest.figures[0].exports.pdf);
  fixture.manifest.generated_at = new Date().toISOString();
  writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest, null, 2));

  const quality = inspectMatlabPlotQuality(fixture.sourcePath, fixture.manifestPath, fixture.root);

  assert.equal(quality.manifestIntegrityOk, false);
  assert.match(quality.manifestIntegrity.violations.join('\n'), /duplicate/u);
  assert.equal(quality.pdfArtifactsOk, false);
  assert.equal(quality.artifacts.find((artifact) => artifact.format === 'pdf').textOk, false);
  assert.equal(quality.matlabPlotQualityOk, false);
});
