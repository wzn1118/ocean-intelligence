import assert from 'node:assert/strict';
import childProcess, { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

import { inspectMatlabPlotRegression, runMatlabPlotRegressionCli } from './matlab-plot-regression.mjs';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const REGRESSION_MODULE = path.resolve('codex-runtime/server/matlab-plot-regression.mjs');

function pngChunk(type, data) {
  const body = Buffer.from(data);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length, 0);
  header.write(type, 4, 'ascii');
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), body])), 0);
  return Buffer.concat([header, body, checksum]);
}

function crc32(data) {
  let checksum = 0xffffffff;
  for (const byte of data) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (0xedb88320 & -(checksum & 1));
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function writePng(filePath, pixels, { width = 2, height = 2, dpi = 300 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanlines = [];
  for (let row = 0; row < height; row += 1) {
    scanlines.push(Buffer.from([0, ...pixels.slice(row * width * 4, (row + 1) * width * 4)]));
  }
  const chunks = [
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
  ];
  if (Number.isFinite(dpi) && dpi > 0) {
    const physicalDimensions = Buffer.alloc(9);
    const pixelsPerMeter = Math.round(dpi / 0.0254);
    physicalDimensions.writeUInt32BE(pixelsPerMeter, 0);
    physicalDimensions.writeUInt32BE(pixelsPerMeter, 4);
    physicalDimensions[8] = 1;
    chunks.push(pngChunk('pHYs', physicalDimensions));
  }
  chunks.push(pngChunk('IDAT', deflateSync(Buffer.concat(scanlines))));
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  writeFileSync(filePath, Buffer.concat(chunks));
}

function insertPngChunkBefore(filePath, beforeType, type, body = Buffer.alloc(0)) {
  const data = readFileSync(filePath);
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    if (data.toString('ascii', offset + 4, offset + 8) === beforeType) {
      writeFileSync(filePath, Buffer.concat([
        data.subarray(0, offset),
        pngChunk(type, body),
        data.subarray(offset),
      ]));
      return;
    }
    offset += length + 12;
  }
  throw new Error(`PNG chunk not found: ${beforeType}`);
}

function writeOversizedPng(filePath, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  writeFileSync(filePath, Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.from([0]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function writePdf(filePath, pages = 2) {
  const pageObjects = Array.from({ length: pages }, (_, index) => (
    `${index + 3} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 144 72] >> endobj`
  ));
  writeFileSync(filePath, [
    '%PDF-1.4',
    `2 0 obj << /Type /Pages /Count ${pages} >> endobj`,
    ...pageObjects,
    'BT /F1 12 Tf 10 40 Td (Ocean temperature) Tj ET',
    '%%EOF',
  ].join('\n'));
}

function writeSvg(filePath, {
  description = 'Temperature changes over time.',
  accessibleName = 'Ocean temperature chart',
  title = 'Ocean temperature',
  extra = '',
} = {}) {
  writeFileSync(filePath, [
    `<svg xmlns="http://www.w3.org/2000/svg" width="200px" height="100px" viewBox="0 0 200 100"${accessibleName ? ` role="img" aria-label="${accessibleName}"` : ''}>`,
    `<title>${title}</title>`,
    description ? `<desc>${description}</desc>` : '',
    '<path d="M 10 80 L 190 20" stroke="#005f73" fill="none"/>',
    extra,
    '</svg>',
  ].join(''));
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function artifactMetadata(filePath, additional) {
  return {
    file: path.basename(filePath),
    bytes: statSync(filePath).size,
    sha256: sha256(filePath),
    ...additional,
  };
}

function createFixture({ includeSvg = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'matlab-regression-'));
  const baseline = path.join(root, 'baseline');
  mkdirSync(baseline);
  const pngPath = path.join(root, 'figure.png');
  const pdfPath = path.join(root, 'figure.pdf');
  const svgPath = path.join(root, 'figure.svg');
  const pixels = Array.from({ length: 4 }, () => [10, 20, 30, 255]).flat();
  writePng(pngPath, pixels);
  writePng(path.join(baseline, 'figure.png'), pixels);
  writePdf(pdfPath, 2);
  if (includeSvg) writeSvg(svgPath);

  const exports = {
    png: artifactMetadata(pngPath, {
      width: 2, height: 2, dpi: 300, export_api: 'exportgraphics',
    }),
    pdf: artifactMetadata(pdfPath, {
      width: 144, height: 72, pages: 2, text: 'Ocean temperature', export_api: 'exportgraphics',
    }),
  };
  if (includeSvg) {
    exports.svg = artifactMetadata(svgPath, {
      width: 200,
      height: 100,
      title: 'Ocean temperature',
      description: 'Temperature changes over time.',
      accessible_name: 'Ocean temperature chart',
      export_api: 'print',
      export_device: '-dsvg',
    });
  }
  const manifest = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    generator: 'MATLAB regression fixture',
    figures: [{
      id: 'figure',
      title: 'Ocean temperature',
      source: 'deterministic fixture',
      theme: 'Ocean Intelligence',
      accessibility: {
        alt_text: 'Line chart of ocean temperature over time.',
        contrast_ratio: 7.2,
        color_only_encoding: false,
      },
      text_objects: [{
        role: 'title',
        string: 'Ocean temperature',
        font_name: 'Noto Sans',
        font_size: 14,
        bounds: [0, 0, 2, 1],
        clipped: false,
      }],
      axes_objects: [{
        id: 'main',
        xlabel: 'Time (h)',
        ylabel: 'Temperature (°C)',
        font_name: 'Noto Sans',
        font_size: 10,
        bounds: [0, 0, 2, 2],
        clipped: false,
      }],
      exports,
    }],
  };
  const manifestPath = path.join(root, 'figures.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { root, baseline, manifestPath, manifest, pngPath, pdfPath, svgPath };
}

function writeManifest(fixture) {
  writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest, null, 2));
}

function refreshArtifact(fixture, format, filePath) {
  fixture.manifest.figures[0].exports[format].bytes = statSync(filePath).size;
  fixture.manifest.figures[0].exports[format].sha256 = sha256(filePath);
  writeManifest(fixture);
}

function scienceContract() {
  return {
    dimensions: { shape: [2, 2], order: ['time', 'depth'] },
    units: { time: 'datetime', depth: 'm', value: 'degC' },
    coordinates: {
      time: {
        values: ['2024-01-01T00:00:00Z', '2024-01-01T01:00:00Z'],
        unit: 'datetime',
        timezone: 'UTC',
        direction: 'increasing',
      },
      depth: { values: [0, 10], unit: 'm', direction: 'positive_down' },
    },
    missing: {
      policy: 'preserve',
      representation: 'NaN',
      total_count: 4,
      valid_count: 3,
      missing_count: 1,
      masked_count: 0,
    },
    qc: { status: 'not_applicable' },
    uncertainty: { status: 'absent' },
  };
}

function publicationContract({ cjk = false } = {}) {
  return {
    layout: {
      stable: true,
      overlap_count: 0,
      clipped_count: 0,
      margins: [0.08, 0.08, 0.08, 0.08],
    },
    typography: {
      glyphs_verified: true,
      cjk_verified: cjk,
      pdf_fonts_embedded: true,
    },
    color: {
      colorblind_safe: true,
      redundant_encoding: true,
    },
  };
}

function headlessInteractionContract() {
  return {
    requested: true,
    enabled: false,
    desktop_available: false,
    headless: {
      supported: true,
      mode: 'static_export',
      verified: true,
    },
  };
}

function desktopInteractionContract(fixture, overrides = {}) {
  const evidencePath = path.join(fixture.root, 'interaction-evidence.json');
  const payload = {
    runtime: 'matlab',
    execution_verified: true,
    matlab_release: 'R2024b',
    nonce: 'interaction-run-20260905',
    events: [
      { type: 'datatip', observation_id: 'obs-001' },
      { type: 'brush', observation_ids: ['obs-001', 'obs-002'] },
    ],
    ...overrides,
  };
  writeFileSync(evidencePath, JSON.stringify(payload));
  return {
    requested: true,
    enabled: true,
    desktop_available: true,
    data_tips: true,
    brush_selection: true,
    keyboard_accessible: true,
    observation_id_mapping: true,
    cleanup_verified: true,
    evidence: {
      file: path.basename(evidencePath),
      bytes: statSync(evidencePath).size,
      sha256: createHash('sha256').update(readFileSync(evidencePath)).digest('hex'),
      generated_at: new Date().toISOString(),
    },
  };
}

function addRuntimeContract(fixture, {
  release = 'R2024b',
  exportApis = { png: 'exportgraphics', pdf: 'exportgraphics', svg: 'print' },
  installedToolboxes = [],
  requiredToolboxes = [],
  batchCommand = 'matlab -batch run_plot',
  headless = true,
} = {}) {
  for (const [format, artifact] of Object.entries(fixture.manifest.figures[0].exports)) {
    artifact.export_api = exportApis[format];
    if (format === 'svg') artifact.export_device = exportApis.svg === 'print' ? '-dsvg' : '';
  }
  Object.assign(fixture.manifest, {
    runtime_status: 'ready',
    execution_verified: true,
    matlab_release: release,
    toolboxes: installedToolboxes,
    required_toolboxes: requiredToolboxes,
    artifact_validation: { status: 'passed', verified: true, verified_by: 'fixture' },
    visual_inspection: { status: 'passed', verified: true, verified_by: 'fixture' },
    warnings: [],
    errors: [],
  });
  fixture.manifest.runtime = {
    engine: 'matlab',
    export_strategies: exportApis,
  };
  if (headless) {
    fixture.manifest.runtime.headless = {
      enabled: true,
      command: batchCommand,
      figure_visible: 'off',
      desktop_independent: true,
      non_interactive: true,
      dialogs: false,
      wait_for_input: false,
    };
    fixture.manifest.figures[0].interaction = headlessInteractionContract();
  }
  writeManifest(fixture);
}

function inspect(fixture, additional = {}) {
  return inspectMatlabPlotRegression({
    manifestPath: fixture.manifestPath,
    outputDirectory: fixture.root,
    baselineDirectory: fixture.baseline,
    requireMatlab: false,
    requireSvg: true,
    minimumPngBytes: 1,
    minimumPdfBytes: 1,
    minimumSvgBytes: 1,
    ...additional,
  });
}

function withUnitProbeProcesses(context, results, callback) {
  const pending = [...results];
  const simulated = context.mock.method(childProcess, 'spawnSync', () => {
    assert.ok(pending.length > 0, 'unexpected unit-only probe invocation');
    return pending.shift();
  });
  syncBuiltinESMExports();
  try {
    const result = callback(simulated);
    assert.equal(pending.length, 0, 'unit-only probe responses were not consumed');
    return result;
  } finally {
    simulated.mock.restore();
    syncBuiltinESMExports();
  }
}

function unitProbeProcesses(probe, help = {}) {
  return [
    { status: 0, signal: null, stdout: '/unit-only/matlab\n', stderr: '' },
    { status: 0, signal: null, stdout: '  -batch command\n', stderr: '', ...help },
    { status: 0, signal: null, stdout: '', stderr: '', ...probe },
  ];
}

test('validates PNG, multi-page PDF, accessible SVG, structure, clipping, and manifest', () => {
  const fixture = createFixture();
  const result = inspect(fixture);

  assert.equal(result.status, 'passed');
  assert.equal(result.regressionOk, true);
  assert.equal(result.manifestOk, true);
  assert.equal(result.figures[0].pdf.pages, 2);
  assert.equal(result.figures[0].pdf.pageSizes.length, 2);
  assert.equal(result.figures[0].svg.dimensionsOk, true);
  assert.equal(result.figures[0].svg.descriptionOk, true);
  assert.equal(result.figures[0].pixelDiff.differingPixels, 0);
});

test('accepts a real bilingual Chinese and English figure contract', () => {
  const fixture = createFixture();
  const figure = fixture.manifest.figures[0];
  const title = '海洋温度 / Ocean temperature';
  const description = '海洋温度随时间变化。 Ocean temperature changes over time.';
  figure.title = title;
  figure.text_objects[0].string = title;
  figure.text_objects[0].font_name = 'Noto Sans CJK SC';
  figure.axes_objects[0].xlabel = '时间 Time (h)';
  figure.axes_objects[0].font_name = 'Noto Sans CJK SC';
  figure.accessibility.alt_text = description;
  Object.assign(figure.exports.svg, {
    title,
    description,
    accessible_name: title,
  });
  figure.exports.pdf.text = title;
  writeSvg(fixture.svgPath, { title, description, accessibleName: title });
  refreshArtifact(fixture, 'svg', fixture.svgPath);

  const result = inspect(fixture);
  assert.equal(result.status, 'passed');
  assert.equal(result.cjkFontsOk, true);
  assert.equal(result.figures[0].svg.titleMatches, true);
  assert.equal(result.figures[0].svg.descriptionMatches, true);
  assert.equal(result.figures[0].svg.accessibleNameMatches, true);
});

test('accepts MATLAB jsonencode singleton structs for figures and axes objects', () => {
  const fixture = createFixture();
  fixture.manifest.figures[0].axes_objects = fixture.manifest.figures[0].axes_objects[0];
  fixture.manifest.figures = fixture.manifest.figures[0];
  writeManifest(fixture);

  const result = inspect(fixture);
  assert.equal(result.status, 'passed');
  assert.equal(result.figures.length, 1);
  assert.equal(result.figures[0].axesObjects.length, 1);
});

test('counts changed pixels rather than changed channels and enforces the ratio threshold', () => {
  const fixture = createFixture();
  writePng(fixture.pngPath, [
    11, 20, 30, 255,
    10, 20, 30, 255,
    10, 20, 30, 255,
    10, 20, 30, 255,
  ]);
  refreshArtifact(fixture, 'png', fixture.pngPath);

  const failed = inspect(fixture, { pixelChannelThreshold: 0, pixelDiffRatioThreshold: 0 });
  assert.equal(failed.imageRegressionOk, false);
  assert.equal(failed.figures[0].pixelDiff.differingPixels, 1);
  assert.equal(failed.figures[0].pixelDiff.ratio, 0.25);

  const tolerated = inspect(fixture, { pixelChannelThreshold: 1, pixelDiffRatioThreshold: 0 });
  assert.equal(tolerated.status, 'passed');
  assert.equal(tolerated.figures[0].pixelDiff.differingPixels, 0);
});

test('rejects adversarial pixel thresholds instead of disabling image regression', () => {
  const fixture = createFixture();
  writePng(fixture.pngPath, [
    255, 255, 255, 255,
    10, 20, 30, 255,
    10, 20, 30, 255,
    10, 20, 30, 255,
  ]);
  refreshArtifact(fixture, 'png', fixture.pngPath);

  const result = inspect(fixture, { pixelChannelThreshold: 256, pixelDiffRatioThreshold: 2 });
  assert.equal(result.status, 'failed');
  assert.equal(result.imageRegressionOk, false);
  assert.equal(result.figures[0].pixelDiff.reason, 'invalid_pixel_channel_threshold');
});

test('validates embedded PNG DPI and rejects CRC or dimension-bomb inputs', () => {
  const dpiFixture = createFixture();
  const pixels = Array.from({ length: 4 }, () => [10, 20, 30, 255]).flat();
  writePng(dpiFixture.pngPath, pixels, { dpi: 72 });
  refreshArtifact(dpiFixture, 'png', dpiFixture.pngPath);
  const dpiResult = inspect(dpiFixture);
  assert.equal(dpiResult.figures[0].png.dpiOk, false);
  assert.equal(Math.round(dpiResult.figures[0].png.embeddedDpi), 72);

  const missingDpiFixture = createFixture();
  writePng(missingDpiFixture.pngPath, pixels, { dpi: null });
  refreshArtifact(missingDpiFixture, 'png', missingDpiFixture.pngPath);
  const missingDpi = inspect(missingDpiFixture, { requireEmbeddedPngDpi: true });
  assert.equal(missingDpi.status, 'failed');
  assert.equal(missingDpi.figures[0].png.embeddedDpiPresent, false);

  const crcFixture = createFixture();
  const corrupt = readFileSync(crcFixture.pngPath);
  corrupt[corrupt.length - 1] ^= 0xff;
  writeFileSync(crcFixture.pngPath, corrupt);
  refreshArtifact(crcFixture, 'png', crcFixture.pngPath);
  const crcResult = inspect(crcFixture);
  assert.equal(crcResult.status, 'failed');
  assert.equal(crcResult.figures[0].pixelDiff.reason, 'invalid_png_crc');

  const oversizedFixture = createFixture();
  writeOversizedPng(oversizedFixture.pngPath, 100_000, 100_000);
  Object.assign(oversizedFixture.manifest.figures[0].exports.png, { width: 100_000, height: 100_000 });
  refreshArtifact(oversizedFixture, 'png', oversizedFixture.pngPath);
  const oversizedResult = inspect(oversizedFixture, { maximumPngPixels: 1_000_000 });
  assert.equal(oversizedResult.status, 'failed');
  assert.equal(oversizedResult.figures[0].pixelDiff.reason, 'png_pixel_limit_exceeded');

  const fileSizeFixture = createFixture();
  const fileSizeResult = inspect(fileSizeFixture, { maximumPngBytes: 1 });
  assert.equal(fileSizeResult.status, 'failed');
  assert.equal(fileSizeResult.figures[0].png.sizeOk, false);
  assert.equal(fileSizeResult.figures[0].pixelDiff.reason, 'artifact_size_limit_exceeded');
});

test('rejects malformed PNG chunk order, transparency, duplication, and trailing data', () => {
  const physicalDimensions = Buffer.alloc(9);
  const pixelsPerMeter = Math.round(300 / 0.0254);
  physicalDimensions.writeUInt32BE(pixelsPerMeter, 0);
  physicalDimensions.writeUInt32BE(pixelsPerMeter, 4);
  physicalDimensions[8] = 1;

  const firstChunkFixture = createFixture();
  insertPngChunkBefore(firstChunkFixture.pngPath, 'IHDR', 'tEXt', Buffer.from('premature'));
  refreshArtifact(firstChunkFixture, 'png', firstChunkFixture.pngPath);
  const firstChunk = inspect(firstChunkFixture);
  assert.equal(firstChunk.figures[0].png.headerError, 'invalid_png_chunk_order');
  assert.equal(firstChunk.figures[0].pixelDiff.reason, 'invalid_png_chunk_order');

  const duplicateDpiFixture = createFixture();
  insertPngChunkBefore(duplicateDpiFixture.pngPath, 'IDAT', 'pHYs', physicalDimensions);
  refreshArtifact(duplicateDpiFixture, 'png', duplicateDpiFixture.pngPath);
  const duplicateDpi = inspect(duplicateDpiFixture);
  assert.equal(duplicateDpi.figures[0].png.headerError, 'invalid_png_physical_dimensions');

  const transparencyFixture = createFixture();
  insertPngChunkBefore(transparencyFixture.pngPath, 'IDAT', 'tRNS', Buffer.from([0, 0, 0, 0, 0, 0]));
  refreshArtifact(transparencyFixture, 'png', transparencyFixture.pngPath);
  const transparency = inspect(transparencyFixture);
  assert.equal(transparency.figures[0].pixelDiff.reason, 'unsupported_png_transparency');

  const splitDataFixture = createFixture();
  insertPngChunkBefore(splitDataFixture.pngPath, 'IEND', 'tEXt', Buffer.from('split'));
  insertPngChunkBefore(splitDataFixture.pngPath, 'IEND', 'IDAT', Buffer.from([0]));
  refreshArtifact(splitDataFixture, 'png', splitDataFixture.pngPath);
  const splitData = inspect(splitDataFixture);
  assert.equal(splitData.figures[0].png.headerError, 'invalid_png_chunk_order');

  const trailingFixture = createFixture();
  writeFileSync(trailingFixture.pngPath, Buffer.concat([
    readFileSync(trailingFixture.pngPath),
    Buffer.from('trailing'),
  ]));
  refreshArtifact(trailingFixture, 'png', trailingFixture.pngPath);
  const trailing = inspect(trailingFixture);
  assert.equal(trailing.figures[0].png.headerError, 'invalid_png_trailing_data');
});

test('rejects PDF page count and page dimensions that disagree with the manifest', () => {
  const fixture = createFixture();
  fixture.manifest.figures[0].exports.pdf.pages = 1;
  fixture.manifest.figures[0].exports.pdf.width = 145;
  writeManifest(fixture);

  const result = inspect(fixture);
  assert.equal(result.figures[0].pdf.pagesOk, false);
  assert.equal(result.figures[0].pdf.dimensionsOk, false);
  assert.equal(result.artifactsOk, false);
  assert.equal(result.status, 'failed');
});

test('does not count PDF page dictionaries forged inside comments', () => {
  const fixture = createFixture();
  writeFileSync(fixture.pdfPath, [
    '%PDF-1.4',
    '% /Type /Page /MediaBox [0 0 144 72]',
    '% /Type /Page /MediaBox [0 0 144 72]',
    '%%EOF',
  ].join('\n'));
  refreshArtifact(fixture, 'pdf', fixture.pdfPath);

  const result = inspect(fixture);
  assert.equal(result.status, 'failed');
  assert.equal(result.figures[0].pdf.pages, 0);
  assert.equal(result.figures[0].pdf.pagesOk, false);
});

test('rejects SVG without a description or accessible name', () => {
  const fixture = createFixture();
  writeSvg(fixture.svgPath, { description: false, accessibleName: false });
  refreshArtifact(fixture, 'svg', fixture.svgPath);

  const result = inspect(fixture);
  assert.equal(result.figures[0].svg.descriptionOk, false);
  assert.equal(result.figures[0].svg.accessibleNameOk, false);
  assert.equal(result.artifactsOk, false);
});

test('rejects active SVG content, comment-forged metadata, and actual metadata drift', () => {
  const activeFixture = createFixture();
  writeSvg(activeFixture.svgPath, { extra: '<script>alert(1)</script>' });
  refreshArtifact(activeFixture, 'svg', activeFixture.svgPath);
  const active = inspect(activeFixture);
  assert.equal(active.status, 'failed');
  assert.equal(active.figures[0].svg.securityOk, false);
  assert.ok(active.figures[0].svg.unsafeFeatures.includes('script'));

  const commentFixture = createFixture();
  writeFileSync(commentFixture.svgPath, [
    '<!-- <svg width="200" height="100" role="img" aria-label="Ocean temperature chart">',
    '<title>Ocean temperature</title><desc>Temperature changes over time.</desc></svg> -->',
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><path d="M0 0"/></svg>',
  ].join(''));
  refreshArtifact(commentFixture, 'svg', commentFixture.svgPath);
  const comment = inspect(commentFixture);
  assert.equal(comment.status, 'failed');
  assert.equal(comment.figures[0].svg.titleOk, false);

  const driftFixture = createFixture();
  driftFixture.manifest.figures[0].title = 'Different title';
  driftFixture.manifest.figures[0].exports.svg.title = 'Different title';
  writeManifest(driftFixture);
  const drift = inspect(driftFixture);
  assert.equal(drift.status, 'failed');
  assert.equal(drift.figures[0].svg.titleMatches, false);
});

test('rejects malformed SVG roots, trailing markup, and external CSS references', () => {
  const missingClosureFixture = createFixture();
  writeFileSync(
    missingClosureFixture.svgPath,
    readFileSync(missingClosureFixture.svgPath, 'utf8').replace('</svg>', ''),
  );
  refreshArtifact(missingClosureFixture, 'svg', missingClosureFixture.svgPath);
  const missingClosure = inspect(missingClosureFixture);
  assert.equal(missingClosure.status, 'failed');
  assert.ok(missingClosure.figures[0].svg.unsafeFeatures.includes('invalid_root_closure'));

  const trailingFixture = createFixture();
  writeFileSync(trailingFixture.svgPath, `${readFileSync(trailingFixture.svgPath, 'utf8')}<metadata/>`);
  refreshArtifact(trailingFixture, 'svg', trailingFixture.svgPath);
  const trailing = inspect(trailingFixture);
  assert.ok(trailing.figures[0].svg.unsafeFeatures.includes('content_outside_root'));

  const cssFixture = createFixture();
  writeSvg(cssFixture.svgPath, {
    extra: '<style>@import url("https://example.invalid/figure.css");</style>',
  });
  refreshArtifact(cssFixture, 'svg', cssFixture.svgPath);
  const css = inspect(cssFixture);
  assert.ok(css.figures[0].svg.unsafeFeatures.includes('external_css_reference'));
  assert.equal(css.figures[0].svg.securityOk, false);
});

test('supports optional SVG while failing when SVG is explicitly required', () => {
  const fixture = createFixture({ includeSvg: false });
  const optional = inspect(fixture, { requireSvg: false });
  const required = inspect(fixture, { requireSvg: true });

  assert.equal(optional.status, 'passed');
  assert.equal(required.manifestOk, false);
  assert.equal(required.status, 'failed');
});

test('rejects missing fonts, undersized typography, clipped bounds, and inaccessible color use', () => {
  const fixture = createFixture();
  const figure = fixture.manifest.figures[0];
  figure.text_objects[0].font_name = '';
  figure.text_objects[0].font_size = 7;
  figure.text_objects[0].bounds = [1, 0, 2, 1];
  figure.text_objects[0].clipped = true;
  figure.axes_objects[0].xlabel = '';
  figure.accessibility.contrast_ratio = 3.2;
  figure.accessibility.color_only_encoding = true;
  writeManifest(fixture);

  const result = inspect(fixture);
  assert.equal(result.fontsOk, false);
  assert.equal(result.axesOk, false);
  assert.equal(result.clippingOk, false);
  assert.equal(result.accessibilityOk, false);
  assert.equal(result.structureOk, false);
  assert.equal(result.status, 'failed');
});

test('requires meaningful and control-character-free text object roles and strings', () => {
  const emptyFixture = createFixture();
  emptyFixture.manifest.figures[0].text_objects[0].role = '';
  emptyFixture.manifest.figures[0].text_objects[0].string = '   ';
  writeManifest(emptyFixture);
  const empty = inspect(emptyFixture);
  assert.equal(empty.textObjectsOk, false);
  assert.equal(empty.structureOk, false);
  assert.deepEqual(empty.figures[0].textAudit.violations, ['0.role', '0.string']);

  const controlFixture = createFixture();
  controlFixture.manifest.figures[0].text_objects[0].role = 'title\u0000';
  controlFixture.manifest.figures[0].text_objects[0].string = 'Ocean\u0001 temperature';
  writeManifest(controlFixture);
  const control = inspect(controlFixture);
  assert.deepEqual(control.figures[0].textAudit.violations, [
    '0.role.control_characters',
    '0.string.control_characters',
  ]);
  assert.equal(control.status, 'failed');
});

test('validates normalized and point bounds while rejecting unsupported coordinate units', () => {
  const fixture = createFixture();
  const figure = fixture.manifest.figures[0];
  figure.text_objects[0].bounds = [0, 0, 1, 0.5];
  figure.text_objects[0].bounds_units = 'normalized';
  figure.axes_objects[0].bounds = [0, 0, 2 / 300, 2 / 300];
  figure.axes_objects[0].bounds_units = 'inches';
  writeManifest(fixture);

  const valid = inspect(fixture);
  assert.equal(valid.clippingOk, true);
  assert.equal(valid.figures[0].clipping.resolvedBounds[0].units, 'normalized');
  assert.equal(valid.figures[0].clipping.resolvedBounds[1].units, 'inches');

  figure.text_objects[0].bounds_units = 'data';
  writeManifest(fixture);
  const invalid = inspect(fixture);
  assert.equal(invalid.clippingOk, false);
  assert.ok(invalid.figures[0].clipping.violations.includes('0.bounds_units.unsupported'));
});

test('requires a CJK-capable font whenever rendered labels contain Chinese text', () => {
  const fixture = createFixture();
  const text = fixture.manifest.figures[0].text_objects[0];
  text.string = '海洋温度';
  text.font_name = 'Noto Sans CJK SC';
  writeManifest(fixture);
  const valid = inspect(fixture);
  assert.equal(valid.cjkFontsOk, true);

  text.font_name = 'Helvetica';
  writeManifest(fixture);
  const invalid = inspect(fixture);
  assert.equal(invalid.cjkFontsOk, false);
  assert.ok(invalid.figures[0].fonts.cjkViolations.includes('0.font_name.cjk'));
});

test('computes foreground/background contrast instead of trusting declared metadata', () => {
  const fixture = createFixture();
  const accessibility = fixture.manifest.figures[0].accessibility;
  accessibility.foreground = '#000000';
  accessibility.background = '#ffffff';
  accessibility.contrast_ratio = 21;
  writeManifest(fixture);
  const valid = inspect(fixture);
  assert.equal(valid.accessibilityOk, true);
  assert.equal(valid.figures[0].accessibility.actualContrastRatio, 21);

  accessibility.contrast_ratio = 7.2;
  writeManifest(fixture);
  const invalid = inspect(fixture);
  assert.equal(invalid.accessibilityOk, false);
  assert.ok(invalid.figures[0].accessibility.violations.includes('contrast_ratio.mismatch'));
});

test('enforces publication layout, typography, embedded-font, and color contracts', () => {
  const fixture = createFixture();
  const figure = fixture.manifest.figures[0];
  figure.publication = publicationContract();
  writeManifest(fixture);
  const options = {
    requirePublicationContract: true,
    minimumPublicationWidth: 2,
    minimumPublicationHeight: 2,
  };
  const valid = inspect(fixture, options);
  assert.equal(valid.publicationQualityOk, true);
  assert.equal(valid.publicationContractsComplete, true);
  assert.equal(valid.publicationContractsPresent, 1);

  figure.publication.layout.overlap_count = 1;
  figure.publication.typography.pdf_fonts_embedded = false;
  figure.publication.color.colorblind_safe = false;
  writeManifest(fixture);
  const invalid = inspect(fixture, options);
  assert.equal(invalid.publicationQualityOk, false);
  assert.ok(invalid.figures[0].publicationQuality.violations.includes('layout.overlap_count'));
  assert.ok(invalid.figures[0].publicationQuality.violations.includes('typography.pdf_fonts_embedded'));
  assert.ok(invalid.figures[0].publicationQuality.violations.includes('color.colorblind_safe'));
});

test('validates headless static fallback without claiming interaction succeeded', () => {
  const fixture = createFixture();
  fixture.manifest.figures[0].interaction = headlessInteractionContract();
  writeManifest(fixture);
  const valid = inspect(fixture, { requireInteractionContract: true, expectHeadless: true });
  assert.equal(valid.interactionOk, true);
  assert.equal(valid.interactionContractsComplete, true);
  assert.equal(valid.interactionContractsPresent, 1);
  assert.equal(valid.figures[0].interaction.enabled, false);
  assert.equal(valid.figures[0].interaction.status, 'valid');

  fixture.manifest.figures[0].interaction.enabled = true;
  fixture.manifest.figures[0].interaction.headless.verified = false;
  writeManifest(fixture);
  const invalid = inspect(fixture, { requireInteractionContract: true, expectHeadless: true });
  assert.equal(invalid.interactionOk, false);
  assert.ok(invalid.figures[0].interaction.violations.includes('desktop.required_when_enabled'));
  assert.ok(invalid.figures[0].interaction.violations.includes('headless.enabled'));
  assert.ok(invalid.figures[0].interaction.violations.includes('headless.verified'));
});

test('requires interaction accessibility and cleanup evidence on desktop', () => {
  const fixture = createFixture();
  fixture.manifest.figures[0].interaction = desktopInteractionContract(fixture);
  writeManifest(fixture);
  const valid = inspect(fixture, {
    requireInteractionContract: true,
    expectedInteractionNonce: 'interaction-run-20260905',
  });
  assert.equal(valid.interactionOk, true);
  assert.equal(valid.figures[0].interaction.evidence.ok, true);

  fixture.manifest.figures[0].interaction.keyboard_accessible = false;
  fixture.manifest.figures[0].interaction.cleanup_verified = false;
  writeManifest(fixture);
  const invalid = inspect(fixture, { requireInteractionContract: true });
  assert.ok(invalid.figures[0].interaction.violations.includes('keyboard_accessible'));
  assert.ok(invalid.figures[0].interaction.violations.includes('cleanup_verified'));
});

test('rejects forged, cross-runtime, or tampered interaction evidence', () => {
  const fixture = createFixture();
  fixture.manifest.figures[0].interaction = desktopInteractionContract(fixture, { runtime: 'octave' });
  writeManifest(fixture);
  const crossRuntime = inspect(fixture, {
    requireInteractionContract: true,
    requireInteractionEvidence: true,
    expectedInteractionNonce: 'interaction-run-20260905',
  });
  assert.equal(crossRuntime.interactionOk, false);
  assert.ok(crossRuntime.figures[0].interaction.violations.includes('evidence.payload.runtime'));

  const evidencePath = path.join(fixture.root, 'interaction-evidence.json');
  writeFileSync(evidencePath, JSON.stringify({ runtime: 'matlab', execution_verified: true }));
  const tampered = inspect(fixture, { requireInteractionContract: true, requireInteractionEvidence: true });
  assert.equal(tampered.interactionOk, false);
  assert.ok(tampered.figures[0].interaction.violations.includes('evidence.bytes.mismatch'));
  assert.ok(tampered.figures[0].interaction.violations.includes('evidence.sha256.mismatch'));
});

test('rejects duplicate and non-deterministically ordered figure ids', () => {
  const fixture = createFixture();
  const second = structuredClone(fixture.manifest.figures[0]);
  second.id = 'alpha';
  fixture.manifest.figures.push(second);
  writeManifest(fixture);

  const result = inspect(fixture);
  assert.equal(result.manifestOk, false);
  assert.ok(result.manifest.violations.includes('figures[1].id.order'));

  fixture.manifest.figures[1].id = 'figure';
  writeManifest(fixture);
  const duplicate = inspect(fixture);
  assert.ok(duplicate.manifest.violations.includes('figures[1].id.duplicate'));
});

test('rejects duplicate artifact paths and non-ISO manifest timestamps', () => {
  const fixture = createFixture();
  const second = structuredClone(fixture.manifest.figures[0]);
  second.id = 'z-figure';
  fixture.manifest.figures.push(second);
  fixture.manifest.generated_at = '09/04/2026';
  writeManifest(fixture);

  const result = inspect(fixture);
  assert.equal(result.status, 'failed');
  assert.ok(result.manifest.violations.includes('generated_at'));
  assert.ok(result.manifest.violations.includes('figures[1].exports.png.file.duplicate'));
  assert.ok(result.manifest.violations.includes('figures[1].exports.pdf.file.duplicate'));
  assert.ok(result.manifest.violations.includes('figures[1].exports.svg.file.duplicate'));

  const limited = inspect(fixture, { maximumManifestBytes: 1 });
  assert.equal(limited.status, 'failed');
  assert.ok(limited.manifest.violations.includes('manifest.too_large'));
});

test('rejects stale generated_at even when refreshed hashes match current artifacts', () => {
  const fixture = createFixture();
  fixture.manifest.generated_at = new Date(statSync(fixture.pngPath).mtimeMs - 60_000).toISOString();
  writeManifest(fixture);

  const result = inspect(fixture, { freshnessToleranceMs: 1 });

  assert.equal(result.artifactsOk, true);
  assert.equal(result.manifestFreshnessOk, false);
  assert.ok(result.manifest.violations.some((entry) => /newer_than_generated_at/u.test(entry)));
  assert.equal(result.regressionOk, false);
});

test('rejects artifact symlinks that escape the output directory', () => {
  const fixture = createFixture();
  const externalDirectory = mkdtempSync(path.join(os.tmpdir(), 'matlab-regression-external-'));
  const externalPng = path.join(externalDirectory, 'outside.png');
  const pixels = Array.from({ length: 4 }, () => [10, 20, 30, 255]).flat();
  writePng(externalPng, pixels);
  rmSync(fixture.pngPath);
  symlinkSync(externalPng, fixture.pngPath);
  refreshArtifact(fixture, 'png', fixture.pngPath);

  const result = inspect(fixture);
  assert.equal(result.status, 'failed');
  assert.equal(result.figures[0].png.present, false);
  assert.equal(result.figures[0].pixelDiff.reason, 'artifact_path_outside_root');
});

test('requires manifest schema v2 and format-specific export evidence', () => {
  const fixture = createFixture();
  fixture.manifest.schema_version = 1;
  delete fixture.manifest.figures[0].exports.pdf.text;
  delete fixture.manifest.figures[0].exports.svg.description;
  fixture.manifest.figures[0].exports.svg.export_device = '';
  writeManifest(fixture);

  const result = inspect(fixture);
  assert.equal(result.manifestOk, false);
  assert.ok(result.manifest.violations.includes('schema_version.expected_2'));
  assert.ok(result.manifest.violations.includes('figures[0].exports.pdf.text'));
  assert.ok(result.manifest.violations.includes('figures[0].exports.svg.description'));
  assert.ok(result.manifest.violations.includes('figures[0].exports.svg.export_device.print'));
});

test('accepts release-aware legacy and modern MATLAB export strategies', () => {
  const legacy = createFixture();
  addRuntimeContract(legacy, {
    release: '2018b',
    exportApis: { png: 'print', pdf: 'print', svg: 'print' },
    batchCommand: 'matlab -nodesktop -nodisplay -r run_plot',
  });
  const legacyResult = inspect(legacy, {
    requireRuntimeContract: true,
    expectHeadless: true,
    targetMatlabRelease: 'R2018b',
  });
  assert.equal(legacyResult.status, 'passed');
  assert.equal(legacyResult.runtime.release, 'R2018b');
  assert.equal(legacyResult.exportCompatibilityOk, true);
  assert.equal(legacyResult.headlessRuntimeOk, true);
  assert.equal(legacyResult.runtime.exportStrategiesComplete, true);

  const modern = createFixture();
  addRuntimeContract(modern);
  const modernResult = inspect(modern, {
    requireRuntimeContract: true,
    expectHeadless: true,
    targetMatlabRelease: '2024b',
  });
  assert.equal(modernResult.status, 'passed');
  assert.deepEqual(
    modernResult.runtime.exportPlans.map(({ format, api }) => [format, api]),
    [['png', 'exportgraphics'], ['pdf', 'exportgraphics'], ['svg', 'print']],
  );
  assert.equal(modernResult.visualInspectionVerified, true);
  assert.equal(modernResult.runtime.visualInspectionStatus, 'passed');
});

test('accepts the current top-level MATLAB manifest runtime fields', () => {
  const fixture = createFixture();
  Object.assign(fixture.manifest, {
    runtime_status: 'ready',
    execution_verified: true,
    matlab_release: '2024b',
    toolboxes: [],
    artifact_validation: { status: 'passed', verified: true, verified_by: 'oi_write_manifest' },
    visual_inspection: { status: 'passed', verified: true, verified_by: 'fixture-review' },
    warnings: [],
    errors: [],
  });
  writeManifest(fixture);

  const result = inspect(fixture, { requireRuntimeContract: true });
  assert.equal(result.status, 'passed');
  assert.equal(result.runtimeMetadataOk, true);
  assert.equal(result.runtime.release, 'R2024b');
  assert.equal(result.runtime.exportStrategiesComplete, true);
});

test('rejects contradictory runtime, error, and visual-inspection success claims', () => {
  const fixture = createFixture();
  addRuntimeContract(fixture, { headless: false });
  fixture.manifest.execution_verified = false;
  fixture.manifest.visual_inspection = { status: 'passed', verified: false };
  fixture.manifest.runtime.errors = [{ code: 'EXPORT_FAILED' }];
  writeManifest(fixture);

  const result = inspect(fixture, { requireRuntimeContract: true });
  assert.equal(result.status, 'failed');
  assert.ok(result.runtime.violations.includes('execution_verified.ready'));
  assert.ok(result.runtime.violations.includes('visual_inspection.claim_mismatch'));
  assert.ok(result.runtime.violations.includes('errors.not_empty'));
});

test('rejects export and batch APIs unavailable in the declared MATLAB release', () => {
  const fixture = createFixture();
  addRuntimeContract(fixture, {
    release: 'R2018b',
    exportApis: { png: 'exportgraphics', pdf: 'print', svg: 'print' },
    batchCommand: 'matlab -batch run_plot',
  });

  const result = inspect(fixture, { requireRuntimeContract: true, expectHeadless: true });
  assert.equal(result.status, 'failed');
  assert.equal(result.exportCompatibilityOk, false);
  assert.equal(result.headlessRuntimeOk, false);
  assert.ok(result.runtime.violations.includes('figures[0].exports.png.api_release_mismatch'));
  assert.ok(result.runtime.violations.includes('headless.batch_api.release_mismatch'));
});

test('rejects SVG on releases older than print -dsvg support', () => {
  const fixture = createFixture();
  addRuntimeContract(fixture, {
    release: 'R2013b',
    exportApis: { png: 'print', pdf: 'print', svg: 'print' },
    batchCommand: 'matlab -nodesktop -nodisplay -r run_plot',
  });

  const result = inspect(fixture, { requireRuntimeContract: true, expectHeadless: true });
  assert.equal(result.status, 'failed');
  assert.equal(result.exportCompatibilityOk, false);
  assert.ok(result.runtime.violations.includes('figures[0].exports.svg.release_unsupported'));
});

test('reports missing required toolboxes without treating base MATLAB as optional', () => {
  const fixture = createFixture();
  addRuntimeContract(fixture, {
    installedToolboxes: ['MATLAB'],
    requiredToolboxes: ['MATLAB', 'Signal Processing Toolbox'],
    headless: false,
  });

  const result = inspect(fixture, { requireRuntimeContract: true });
  assert.equal(result.status, 'failed');
  assert.equal(result.toolboxesOk, false);
  assert.deepEqual(result.runtime.missingToolboxes, ['Signal Processing Toolbox']);
  assert.ok(result.runtime.violations.includes('toolboxes.missing'));
});

test('rejects artifact extension drift and unsupported manifest export keys', () => {
  const fixture = createFixture();
  fixture.manifest.figures[0].exports.png.file = 'figure.pdf';
  fixture.manifest.figures[0].exports.jpeg = { ...fixture.manifest.figures[0].exports.png };
  writeManifest(fixture);

  const result = inspect(fixture);
  assert.equal(result.status, 'failed');
  assert.ok(result.manifest.violations.includes('figures[0].exports.png.file.extension'));
  assert.ok(result.manifest.violations.includes('figures[0].exports.jpeg.unsupported'));
});

test('turns an explicit unavailable runtime manifest into a skip, never a pass', () => {
  const fixture = createFixture();
  Object.assign(fixture.manifest, {
    runtime_status: 'runtime-unavailable',
    execution_verified: false,
    skip_reason: 'matlab_not_found',
    toolboxes: [],
    warnings: [],
    errors: [],
  });
  writeManifest(fixture);

  const result = inspect(fixture, { requireRuntimeContract: true });
  assert.equal(result.status, 'skipped');
  assert.equal(result.skipped, true);
  assert.equal(result.skipReason, 'matlab_not_found');
  assert.equal(result.runtimeMetadataOk, true);
  assert.equal(result.regressionOk, false);
});

test('reports an explicit skip rather than a pass when MATLAB is unavailable', () => {
  const fixture = createFixture();
  const result = inspectMatlabPlotRegression({
    manifestPath: fixture.manifestPath,
    outputDirectory: fixture.root,
    baselineDirectory: fixture.baseline,
    requireSvg: true,
    matlabCommand: 'matlab-command-that-does-not-exist',
    minimumPngBytes: 1,
    minimumPdfBytes: 1,
    minimumSvgBytes: 1,
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.skipped, true);
  assert.equal(result.skipReason, 'matlab_not_found');
  assert.equal(result.regressionOk, false);
  assert.equal(result.artifactsOk, true);
});

test('accepts a complete scientific data contract in strict mode', () => {
  const fixture = createFixture();
  fixture.manifest.figures[0].science = scienceContract();
  writeManifest(fixture);

  const result = inspect(fixture, { requireScienceContract: true });
  assert.equal(result.status, 'passed');
  assert.equal(result.scienceSemanticsOk, true);
  assert.equal(result.figures[0].scienceSemantics.status, 'valid');
  assert.deepEqual(result.figures[0].scienceSemantics.dimensions.shape, [2, 2]);
});

test('reports an explicit not-provided status for legacy manifests and fails strict mode', () => {
  const fixture = createFixture();
  const compatible = inspect(fixture);
  const strict = inspect(fixture, { requireScienceContract: true });

  assert.equal(compatible.status, 'passed');
  assert.equal(compatible.scienceContractsComplete, false);
  assert.equal(compatible.scienceContractsPresent, 0);
  assert.equal(compatible.figures[0].scienceContractPresent, false);
  assert.equal(compatible.figures[0].scienceSemantics.status, 'not_provided');
  assert.equal(strict.status, 'failed');
  assert.ok(strict.figures[0].scienceSemantics.violations.includes('contract.missing'));
});

test('rejects dimension shape/order, unit, coordinate length, and direction inconsistencies', () => {
  const fixture = createFixture();
  const science = scienceContract();
  science.dimensions.shape = [3, 2];
  science.dimensions.order = ['depth', 'depth', 'time'];
  science.coordinates.depth.values = [0, -10];
  science.coordinates.depth.direction = 'positive_up';
  delete science.coordinates.depth.unit;
  science.units.depth = '';
  fixture.manifest.figures[0].science = science;
  writeManifest(fixture);

  const result = inspect(fixture, { requireScienceContract: true });
  assert.equal(result.scienceSemanticsOk, false);
  assert.ok(result.figures[0].scienceSemantics.violations.includes('dimensions.shape_order_length'));
  assert.ok(result.figures[0].scienceSemantics.violations.includes('dimensions.order_duplicate'));
  assert.ok(result.figures[0].scienceSemantics.violations.includes('units.depth'));
  assert.ok(result.figures[0].scienceSemantics.violations.includes('coordinates.depth.nonnegative'));
  assert.ok(result.figures[0].scienceSemantics.violations.includes('coordinates.depth.direction.positive_down'));
  assert.equal(result.status, 'failed');
});

test('rejects timezone omission, invalid timezone, and coordinate timezone mismatch', () => {
  const fixture = createFixture();
  const science = scienceContract();
  delete science.coordinates.time.timezone;
  delete science.timezone;
  fixture.manifest.figures[0].science = science;
  writeManifest(fixture);
  const missing = inspect(fixture, { requireScienceContract: true });
  assert.ok(missing.figures[0].scienceSemantics.violations.includes('time_zone.missing'));

  science.timezone = 'Not/AZone';
  science.coordinates.time.timezone = 'UTC';
  writeManifest(fixture);
  const invalid = inspect(fixture, { requireScienceContract: true });
  assert.ok(invalid.figures[0].scienceSemantics.violations.includes('time_zone.invalid'));
  assert.ok(invalid.figures[0].scienceSemantics.violations.includes('time_zone.mismatch'));
});

test('rejects malformed and non-monotonic datetime coordinates', () => {
  const fixture = createFixture();
  const science = scienceContract();
  science.coordinates.time.values = ['2024-01-01T01:00:00Z', 'not-a-time'];
  fixture.manifest.figures[0].science = science;
  writeManifest(fixture);
  const malformed = inspect(fixture, { requireScienceContract: true });
  assert.ok(malformed.figures[0].scienceSemantics.violations.includes('coordinates.time.datetime'));

  science.coordinates.time.values = ['2024-01-01T01:00:00Z', '2024-01-01T00:00:00Z'];
  writeManifest(fixture);
  const reversed = inspect(fixture, { requireScienceContract: true });
  assert.ok(reversed.figures[0].scienceSemantics.violations.includes('coordinates.time.order'));
});

test('rejects silent missing-value transforms, inconsistent counts, QC, and uncertainty contracts', () => {
  const fixture = createFixture();
  const science = scienceContract();
  science.missing.policy = 'fill';
  delete science.missing.representation;
  science.missing.valid_count = 4;
  science.missing.missing_count = 2;
  science.missing.masked_count = 1;
  science.qc = { status: 'applied' };
  science.uncertainty = { status: 'present', representation: 'bounds', unit: 'degC', alignment: 'time' };
  fixture.manifest.figures[0].science = science;
  writeManifest(fixture);

  const result = inspect(fixture, { requireScienceContract: true });
  const violations = result.figures[0].scienceSemantics.violations;
  assert.ok(violations.includes('missing.policy'));
  assert.ok(violations.includes('missing.silent_transform'));
  assert.ok(violations.includes('missing.counts_sum'));
  assert.ok(violations.includes('missing.representation'));
  assert.ok(violations.includes('qc.field'));
  assert.ok(violations.includes('qc.policy'));
  assert.ok(violations.includes('uncertainty.type'));
  assert.ok(violations.includes('uncertainty.bounds'));
  assert.equal(result.status, 'failed');
});

test('accepts the canonical runtime scientific contract with magnitude uncertainty', () => {
  const fixture = createFixture();
  fixture.manifest.figures[0].scientific_data_contract = {
    schemaVersion: 1,
    required: true,
    provided: true,
    dataType: 'datetime',
    shape: [2, 2],
    rank: 2,
    dimensionOrder: ['time', 'depth'],
    observationDimension: 'time',
    coordinates: {
      names: ['time', 'depth'],
      timeZone: 'UTC',
      directions: { time: 'strictly-increasing' },
      vertical: { coordinate: 'depth', positive: 'down', reference: 'mean sea level' },
    },
    units: { value: 'degC', depth: 'm' },
    missing: {
      status: 'present', policy: 'preserve', representation: 'NaN',
      total_count: 4, valid_count: 3, missing_count: 1, masked_count: 0,
    },
    qc: { status: 'present', variable: 'QCFlag', alignment: 'time', action: 'preserve' },
    uncertainty: {
      status: 'present', type: 'standard-deviation', representation: 'magnitude',
      unit: 'degC', alignment: 'time',
    },
    unresolvedRequirements: [],
  };
  writeManifest(fixture);

  const result = inspect(fixture, { requireScienceContract: true });
  assert.equal(result.status, 'passed');
  assert.equal(result.scienceSemanticsOk, true);
  assert.equal(result.figures[0].scienceSemantics.status, 'valid');
});

test('rejects an executable named matlab that does not prove it is MATLAB', () => {
  const fixture = createFixture();
  const fakeMatlab = path.join(fixture.root, 'matlab');
  writeFileSync(fakeMatlab, '#!/bin/sh\nexit 0\n');
  chmodSync(fakeMatlab, 0o755);

  const result = inspectMatlabPlotRegression({
    manifestPath: fixture.manifestPath,
    outputDirectory: fixture.root,
    baselineDirectory: fixture.baseline,
    requireSvg: true,
    matlabCommand: fakeMatlab,
    minimumPngBytes: 1,
    minimumPdfBytes: 1,
    minimumSvgBytes: 1,
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.skipReason, 'matlab_probe_failed');
  assert.equal(result.matlabAvailable, false);
  assert.equal(result.matlabVerified, false);
  assert.equal(result.regressionOk, false);
});

test('unit-only process diagnostics preserve exit code, signal, system error and skip semantics', (context) => {
  const fixture = createFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const cases = [
    { status: 17, stderr: 'Unit-only simulated startup failure\n' },
    { status: 23, stdout: 'OI_MATLAB_RUNTIME=2024b\n', stderr: 'Unit-only failure after marker\n' },
    { status: null, signal: 'SIGKILL' },
    { status: null, signal: 'SIGTERM', error: Object.assign(new Error('unit-only timeout'), {
      code: 'ETIMEDOUT', errno: -110, syscall: 'spawnSync /unit-only/matlab',
    }) },
    { status: null, error: Object.assign(new Error('unit-only launch failure'), {
      code: 'EACCES', errno: -13, syscall: 'spawnSync /unit-only/matlab',
    }) },
    { status: null, error: Object.assign(new Error('unit-only buffer exhaustion'), {
      code: 'ENOBUFS', errno: -105,
    }) },
  ];
  for (const probe of cases) {
    const result = withUnitProbeProcesses(context, unitProbeProcesses(probe), () => inspect(fixture, {
      requireMatlab: true, matlabProbeTimeoutMs: 25,
    }));
    assert.equal(result.status, 'skipped');
    assert.equal(result.skipReason, probe.error?.code === 'ETIMEDOUT' ? 'matlab_probe_timeout' : 'matlab_probe_failed');
    assert.equal(result.regressionOk, false);
    assert.equal(result.matlabVerified, false);
    const diagnostics = result.matlabProbeDiagnostics;
    assert.equal(diagnostics.scope, 'local_process_probe_only');
    assert.equal(diagnostics.failureStage, 'probe');
    assert.deepEqual(Object.keys(diagnostics.stages), ['lookup', 'help', 'probe']);
    assert.equal(diagnostics.stages.probe.status, probe.status);
    assert.equal(diagnostics.stages.probe.signal, probe.signal || null);
    assert.equal(diagnostics.stages.probe.error?.code, probe.error?.code);
    assert.equal(diagnostics.stages.probe.error?.errno, probe.error?.errno);
    assert.equal(diagnostics.stages.probe.stdout.text, probe.stdout || '');
    assert.equal(diagnostics.stages.probe.stderr.text, probe.stderr || '');
    assert.equal(diagnostics.stages.probe.timeoutMs, 25);
    assert.equal(Object.hasOwn(diagnostics, 'licenseAvailable'), false);
  }
});

test('unit-only lookup failure diagnostics do not invent help or startup results', (context) => {
  const fixture = createFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const error = Object.assign(new Error('unit-only missing shell'), { code: 'ENOENT', errno: -2, syscall: 'spawnSync sh' });
  const result = withUnitProbeProcesses(context, [{ status: null, signal: null, error, stdout: null, stderr: null }],
    () => inspect(fixture, { requireMatlab: true }));
  assert.equal(result.skipReason, 'matlab_not_found');
  assert.equal(result.matlabProbeDiagnostics.failureStage, 'lookup');
  assert.deepEqual(Object.keys(result.matlabProbeDiagnostics.stages), ['lookup']);
  assert.equal(result.matlabProbeDiagnostics.stages.lookup.status, null);
  assert.equal(result.matlabProbeDiagnostics.stages.lookup.error.code, 'ENOENT');
  assert.equal(result.regressionOk, false);
});

test('unit-only marker diagnostics distinguish missing, malformed and parsed release markers', (context) => {
  const fixture = createFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  for (const [stdout, present] of [
    ['Unit-only output without a marker\n', false],
    ['OI_MATLAB_RUNTIME=\n', true],
    ['OI_MATLAB_RUNTIME=R9.10.0.2198249 (R2021a) Update 8\n', true],
  ]) {
    const result = withUnitProbeProcesses(context, unitProbeProcesses({ stdout }),
      () => inspect(fixture, { requireMatlab: true }));
    assert.equal(result.status, 'skipped');
    assert.equal(result.skipReason, 'matlab_probe_failed');
    assert.equal(result.matlabProbeDiagnostics.failureStage, 'marker');
    assert.deepEqual(result.matlabProbeDiagnostics.marker, { present, releaseParsed: false });
    assert.equal(result.matlabProbeDiagnostics.stages.probe.status, 0);
  }
  const result = withUnitProbeProcesses(context,
    unitProbeProcesses({ stderr: 'OI_MATLAB_RUNTIME=2024b\n' }), () => inspect(fixture, {
      requireMatlab: true, requireRuntimeContract: true,
    }));
  assert.deepEqual(result.matlabProbeDiagnostics.marker, { present: true, releaseParsed: true });
  assert.equal(result.matlabRelease, 'R2024b');
  assert.equal(result.matlabProbeDiagnostics.failureStage, null);
  assert.equal(result.status, 'failed');
  assert.equal(result.runtimeMetadataOk, false);
  assert.equal(result.visualInspectionVerified, false);
});

test('unit-only help diagnostics preserve existing batch and legacy mode selection', (context) => {
  const fixture = createFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const cases = [
    { help: { status: 0, stdout: '  -batch command\n' }, mode: 'batch', described: true, batch: true },
    { help: { status: 0, stdout: '  -r command\n' }, mode: 'legacy-r', described: true, batch: false },
    { help: { status: 1, stdout: '', stderr: 'Unit-only help startup failure\n' }, mode: 'legacy-r', described: true, batch: false },
    { help: { status: null, stdout: '', error: { code: 'ETIMEDOUT' } }, mode: 'batch', described: false, batch: false },
  ];
  for (const { help, mode, described, batch } of cases) {
    const result = withUnitProbeProcesses(context, unitProbeProcesses({ status: 9 }, help), (simulated) => {
      const inspected = inspect(fixture, { requireMatlab: true });
      const probeArguments = simulated.mock.calls[2].arguments[1];
      assert.equal(probeArguments[0], mode === 'batch' ? '-batch' : '-nodesktop');
      assert.equal(Object.hasOwn(simulated.mock.calls[2].arguments[2], 'env'), false);
      return inspected;
    });
    assert.equal(result.matlabProbeMode, mode);
    assert.deepEqual(result.matlabProbeDiagnostics.modeSelection, {
      helpDescribesOptions: described, supportsBatch: batch, probeMode: mode,
    });
    assert.equal(result.matlabProbeDiagnostics.stages.help.status, help.status);
    assert.equal(result.skipReason, 'matlab_probe_failed');
  }
});

test('unit-only diagnostic text is redacted before truncation in every process phase', (context) => {
  const fixture = createFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const secretName = 'OI_MATLAB_UNIT_DIAGNOSTIC_SECRET';
  const original = process.env[secretName];
  const secret = 'unit-only-secret+/with space\nand-a-second-line';
  process.env[secretName] = secret;
  context.after(() => {
    if (original === undefined) delete process.env[secretName];
    else process.env[secretName] = original;
  });
  const privateKey = '-----BEGIN PRIVATE KEY-----\nunit-only-private-key-body\n-----END PRIVATE KEY-----';
  const output = [
    'Unit-only License Manager Error -15; cause not inferred',
    secret, encodeURIComponent(secret), JSON.stringify(secret),
    'TOKEN=unit-only-unlisted-token',
    'Authorization: Bearer unit-only-bearer-token',
    'https://unit-only-user:unit-only-password@example.invalid/endpoint?api_key=unit-only-query-key',
    privateKey,
    'x'.repeat(10_000),
    secret,
    'END OF UNIT-ONLY OUTPUT',
  ].join('\n');
  const responses = unitProbeProcesses({ status: 19, stdout: output, stderr: output,
    error: Object.assign(new Error(output), { code: 'EIO', errno: -5, env: { secret } }),
  }, { stdout: '  -batch command\n' + output, stderr: output });
  responses[0].stderr = output;
  const result = withUnitProbeProcesses(context, responses, () => inspect(fixture, { requireMatlab: true }));
  const diagnostics = result.matlabProbeDiagnostics;
  const serialized = JSON.stringify(diagnostics);
  for (const leaked of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1),
    'unit-only-unlisted-token', 'unit-only-bearer-token', 'unit-only-password',
    'unit-only-query-key', 'unit-only-private-key-body']) {
    assert.equal(serialized.includes(leaked), false, leaked);
  }
  assert.equal(serialized.includes('"env"'), false);
  for (const stage of Object.values(diagnostics.stages)) {
    for (const stream of [stage.stdout, stage.stderr]) {
      assert.ok(stream.text.length <= diagnostics.outputLimitCharacters);
    }
    assert.equal(stage.stderr.sanitized, true);
    assert.equal(stage.stderr.truncated, true);
    assert.ok(stage.stderr.capturedBytes > diagnostics.outputLimitCharacters);
    assert.ok(stage.stderr.text.startsWith('Unit-only License Manager Error -15'));
    assert.ok(stage.stderr.text.endsWith('END OF UNIT-ONLY OUTPUT'));
  }
  assert.ok(diagnostics.stages.probe.error.message.text.length <= 1_024);
  assert.equal(diagnostics.stages.probe.error.message.truncated, true);
  assert.equal(result.status, 'skipped');
});

test('unit-only diagnostics redact credentials split by terminal controls', (context) => {
  const fixture = createFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const secretName = 'OI_MATLAB_UNIT_WEB_CRED';
  const original = process.env[secretName];
  const secret = 'unit-only-control-split-credential';
  process.env[secretName] = secret;
  context.after(() => {
    if (original === undefined) delete process.env[secretName];
    else process.env[secretName] = original;
  });
  const stdout = [
    'Unit-only startup detail retained',
    secret.slice(0, 10) + '\u001b[31m' + secret.slice(10) + '\u001b[0m',
    secret.slice(0, 10) + '\u001b]8;;https://example.invalid\u0007' + secret.slice(10) + '\u001b]8;;\u0007',
    secret.slice(0, 10) + '\u0008' + secret.slice(10),
    'WEB_CRED="unit-only-unlisted-credential"',
    'details: TOKEN=unit-only-nested-token',
    'state=failed',
  ].join('\n');
  const result = withUnitProbeProcesses(context, unitProbeProcesses({ status: 17, stdout }),
    () => inspect(fixture, { requireMatlab: true }));
  const text = result.matlabProbeDiagnostics.stages.probe.stdout.text;
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes('unit-only-unlisted-credential'), false);
  assert.equal(text.includes('unit-only-nested-token'), false);
  assert.equal(text.includes('\u001b'), false);
  assert.equal(text.includes('\u0008'), false);
  assert.equal(text.match(/\[REDACTED\]/gu)?.length, 5);
  assert.ok(text.startsWith('Unit-only startup detail retained\n'));
  assert.ok(text.endsWith('\nstate=failed'));
  assert.equal(result.status, 'skipped');
});

test('unit-only truncated diagnostics do not change marker parsing or visual gates', (context) => {
  const fixture = createFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  addRuntimeContract(fixture);
  fixture.manifest.visual_inspection = { status: 'not_run', verified: false };
  writeManifest(fixture);
  const stdout = 'x'.repeat(5_000) + '\nOI_MATLAB_RUNTIME=2024b\n' + 'y'.repeat(5_000);
  const result = withUnitProbeProcesses(context, unitProbeProcesses({ stdout }), () => inspect(fixture, {
    requireMatlab: true, requireRuntimeContract: true,
  }));
  assert.equal(result.matlabAvailable, true);
  assert.equal(result.matlabProbeDiagnostics.stages.probe.stdout.truncated, true);
  assert.equal(result.matlabProbeDiagnostics.stages.probe.stdout.text.includes('OI_MATLAB_RUNTIME='), false);
  assert.equal(result.matlabProbeDiagnostics.marker.releaseParsed, true);
  assert.equal(result.visualInspectionVerified, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.regressionOk, false);
  assert.ok(result.runtime.violations.includes('visual_inspection.required'));
});

test('unit-only CLI exposes structured process failures without changing skip exit codes', (context) => {
  const fixture = createFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const cli = withUnitProbeProcesses(context, unitProbeProcesses({ status: 17, stderr: 'Unit-only startup failure\n' }),
    () => runMatlabPlotRegressionCli(['--manifest', fixture.manifestPath, '--output', fixture.root]));
  assert.equal(cli.exitCode, 0);
  assert.equal(cli.output.status, 'skipped');
  assert.equal(cli.output.regressionOk, false);
  assert.equal(cli.output.matlabProbeDiagnostics.stages.probe.status, 17);
});

test('unit-only CLI child process prints bounded redacted startup diagnostics', (context) => {
  const fixture = createFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const executable = path.join(fixture.root, 'unit-only-startup-failure');
  writeFileSync(executable, [
    '#!/bin/sh',
    'if [ "$1" = "-help" ]; then printf "  -batch command\\n"; exit 0; fi',
    'printf "Unit-only simulated startup failure\\n" >&2',
    'printf "UNIT_SECRET=%s\\n" "$OI_MATLAB_UNIT_DIAGNOSTIC_SECRET" >&2',
    'exit 17',
    '',
  ].join('\n'));
  chmodSync(executable, 0o755);
  const secret = 'unit-only-cli-secret-must-not-appear';
  const cli = spawnSync(process.execPath, [REGRESSION_MODULE, '--manifest', fixture.manifestPath,
    '--output', fixture.root, '--matlab-command', executable], {
    encoding: 'utf8', env: { ...process.env, OI_MATLAB_UNIT_DIAGNOSTIC_SECRET: secret },
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout.includes(secret), false);
  const result = JSON.parse(cli.stdout);
  assert.equal(result.status, 'skipped');
  assert.equal(result.regressionOk, false);
  assert.equal(result.matlabVerified, false);
  assert.equal(result.matlabProbeDiagnostics.stages.lookup.status, 0);
  assert.equal(result.matlabProbeDiagnostics.stages.help.status, 0);
  assert.equal(result.matlabProbeDiagnostics.stages.probe.status, 17);
  assert.match(result.matlabProbeDiagnostics.stages.probe.stderr.text, /Unit-only simulated startup failure/u);
  assert.match(result.matlabProbeDiagnostics.stages.probe.stderr.text, /\[REDACTED\]/u);
});

test('rejects GNU Octave even when a wrapper exposes a matlab-like batch interface', (context) => {
  const octaveLookup = spawnSync('sh', ['-c', 'command -v octave'], { encoding: 'utf8' });
  if (octaveLookup.status !== 0) {
    context.skip('GNU Octave is not installed');
    return;
  }
  const fixture = createFixture();
  const octavePath = octaveLookup.stdout.trim();
  const disguisedOctave = path.join(fixture.root, 'matlab');
  writeFileSync(disguisedOctave, [
    '#!/bin/sh',
    'if [ "$1" = "-help" ]; then printf "  -batch command\\n"; exit 0; fi',
    'if [ "$1" = "-batch" ]; then shift; exec ' + JSON.stringify(octavePath) + ' --quiet --no-gui --eval "$1"; fi',
    'exit 2',
    '',
  ].join('\n'));
  chmodSync(disguisedOctave, 0o755);

  const result = inspectMatlabPlotRegression({
    manifestPath: fixture.manifestPath,
    outputDirectory: fixture.root,
    baselineDirectory: fixture.baseline,
    requireSvg: true,
    matlabCommand: disguisedOctave,
    matlabProbeTimeoutMs: 10_000,
    minimumPngBytes: 1,
    minimumPdfBytes: 1,
    minimumSvgBytes: 1,
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.skipReason, 'matlab_probe_failed');
  assert.equal(result.matlabAvailable, false);
  assert.equal(result.matlabVerified, false);
  assert.equal(result.regressionOk, false);
});

test('provides a directly executable CLI with pass and expected-failure exit codes', () => {
  const fixture = createFixture();
  const commonArguments = [
    REGRESSION_MODULE,
    '--manifest', fixture.manifestPath,
    '--output', fixture.root,
    '--baseline', fixture.baseline,
    '--require-svg',
    '--no-require-matlab',
    '--minimum-png-bytes', '1',
    '--minimum-pdf-bytes', '1',
    '--minimum-svg-bytes', '1',
    '--maximum-png-pixels', '100',
    '--maximum-png-bytes', '1048576',
    '--maximum-pdf-bytes', '1048576',
    '--maximum-svg-bytes', '1048576',
    '--maximum-manifest-bytes', '1048576',
    '--require-embedded-png-dpi',
  ];
  const passed = spawnSync(process.execPath, commonArguments, { encoding: 'utf8' });
  const passedResult = JSON.parse(passed.stdout);
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(passedResult.status, 'passed');
  assert.equal(passedResult.regressionOk, true);
  assert.equal(passedResult.matlabAvailable, false);

  const strict = spawnSync(process.execPath, [...commonArguments, '--require-science-contract'], { encoding: 'utf8' });
  const strictResult = JSON.parse(strict.stdout);
  assert.equal(strict.status, 1);
  assert.equal(strictResult.status, 'failed');
  assert.equal(strictResult.scienceSemanticsOk, false);

  const strictPresentation = spawnSync(process.execPath, [
    ...commonArguments,
    '--require-publication-contract',
    '--require-interaction-contract',
    '--expect-headless',
    '--minimum-publication-width', '2',
    '--minimum-publication-height', '2',
  ], { encoding: 'utf8' });
  const strictPresentationResult = JSON.parse(strictPresentation.stdout);
  assert.equal(strictPresentation.status, 1);
  assert.equal(strictPresentationResult.publicationQualityOk, false);
  assert.equal(strictPresentationResult.interactionOk, false);

  const strictRuntime = spawnSync(process.execPath, [
    ...commonArguments,
    '--require-runtime-contract',
    '--target-matlab-release', 'R2024b',
  ], { encoding: 'utf8' });
  const strictRuntimeResult = JSON.parse(strictRuntime.stdout);
  assert.equal(strictRuntime.status, 1);
  assert.equal(strictRuntimeResult.runtimeMetadataOk, false);

  fixture.manifest.figures[0].accessibility.contrast_ratio = 2;
  writeManifest(fixture);
  const failed = spawnSync(process.execPath, commonArguments, { encoding: 'utf8' });
  const failedResult = JSON.parse(failed.stdout);
  assert.equal(failed.status, 1);
  assert.equal(failedResult.status, 'failed');
  assert.equal(failedResult.accessibilityOk, false);
});

test('CLI returns a skip exit code and machine-readable reason without MATLAB', () => {
  const fixture = createFixture();
  const cli = spawnSync(process.execPath, [
    REGRESSION_MODULE,
    '--manifest', fixture.manifestPath,
    '--output', fixture.root,
    '--baseline', fixture.baseline,
    '--require-svg',
    '--matlab-command', 'matlab-command-that-does-not-exist',
    '--minimum-png-bytes', '1',
    '--minimum-pdf-bytes', '1',
    '--minimum-svg-bytes', '1',
  ], { encoding: 'utf8' });
  const result = JSON.parse(cli.stdout);

  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(result.status, 'skipped');
  assert.equal(result.skipReason, 'matlab_not_found');
  assert.equal(result.regressionOk, false);
});
