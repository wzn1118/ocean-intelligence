import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  POINT_INTERACTION_CHECK_IDS,
  composePointInteractionQuality,
  inspectPointInteractionQuality,
} from './point-interaction-quality.mjs';

function validHtml({ points = validPoints(), renderedCount = points.length, series = ['表层', '底层'] } = {}) {
  const pointMarkup = Array.from({ length: renderedCount }, (_, index) => {
    const point = points[index] || {};
    const attributes = [
      ['data-observation-id', point.id],
      ['data-temperature', point.temperature],
      ['data-unit', point.unit],
      ['data-time', point.time],
      ['data-longitude', point.longitude],
      ['data-latitude', point.latitude],
      ['data-qc', point.qc],
    ].filter(([, value]) => value !== undefined && value !== null)
      .map(([name, value]) => `${name}="${value}"`).join(' ');
    return `
    <g class="temperature-point" tabindex="0" role="img" data-point-index="${index}" ${attributes}
       aria-label="点位：${point.id || `P${index + 1}`}；温度：${point.temperature ?? '未知'} ${point.unit ?? '未知'}；时间：${point.time ?? '未知'}；经度：${point.longitude ?? '未知'}；纬度：${point.latitude ?? '未知'}；QC：${point.qc ?? '未知'}"></g>`;
  }).join('');
  const legendMarkup = series.map((name) => `<span data-series-name="${name}">${name}</span>`).join('');
  return `<!doctype html>
  <html><head><style>
    .temperature-point:hover { opacity: .8; }
    .temperature-point:focus-visible { outline: 2px solid black; }
  </style></head><body>
    <svg>${pointMarkup}</svg>
    <div class="legend" aria-label="系列图例">${legendMarkup}</div>
    <div role="tooltip" hidden></div>
    <script type="application/json" id="temperature-data">${JSON.stringify({ points })}</script>
    <script>
      document.querySelectorAll('.temperature-point').forEach((point) => {
        point.addEventListener('pointerenter', showTooltip);
        point.addEventListener('focus', showTooltip);
      });
      function showTooltip() {}
    </script>
  </body></html>`;
}

function validPoints() {
  return [
    { id: 'P1', series: '表层', temperature: 20, unit: '°C', time: '2026-09-03T00:00:00Z', longitude: 120, latitude: 30, qc: 'good' },
    { id: 'P2', series: '底层', temperature: 18, unit: '°C', time: '2026-09-03T00:00:00Z', longitude: 120, latitude: 30, qc: 'good' },
  ];
}

test('accepts complete standalone point-temperature interaction HTML', () => {
  const quality = inspectPointInteractionQuality({ html: validHtml() });

  assert.deepEqual(quality.checks.map((check) => check.id), POINT_INTERACTION_CHECK_IDS);
  assert.equal(quality.renderedPointCount, 2);
  assert.equal(quality.dataPointCount, 2);
  assert.equal(quality.pointCountOk, true);
  assert.equal(quality.stablePointIdentityOk, true);
  assert.equal(quality.hoverOk, true);
  assert.equal(quality.focusOk, true);
  assert.equal(quality.tooltipFieldsOk, true);
  assert.equal(quality.legendSeriesOk, true);
  assert.deepEqual(quality.expectedSeries, ['表层', '底层']);
  assert.equal(quality.selfContainedOk, true);
  assert.equal(quality.pointInteractionQualityOk, true);
});

test('rejects duplicate, missing and mismatched stable observation identities', () => {
  const duplicatePoints = validPoints();
  duplicatePoints[1].id = 'P1';
  const duplicate = inspectPointInteractionQuality({ html: validHtml({ points: duplicatePoints }) });
  assert.equal(duplicate.stablePointIdentityOk, false);
  assert.deepEqual(duplicate.checkResults['stable-point-identity'].violations.map(({ rule }) => rule), [
    'observation-id-duplicate',
    'rendered-observation-id-duplicate',
  ]);

  const mismatched = inspectPointInteractionQuality({
    html: validHtml().replace('data-observation-id="P2"', 'data-observation-id="WRONG"'),
  });
  assert.equal(mismatched.stablePointIdentityOk, false);
  assert.equal(mismatched.checkResults['stable-point-identity'].violations.at(-1).rule, 'rendered-observation-id-mismatch');

  const missingIndex = inspectPointInteractionQuality({
    html: validHtml().replace('data-point-index="1"', 'data-point-index="9"'),
  });
  assert.equal(missingIndex.stablePointIdentityOk, false);
  assert.equal(missingIndex.checkResults['stable-point-identity'].violations[0].rule, 'rendered-point-index-coverage');
});

test('reads HTML from a file path', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'point-interaction-quality-'));
  const htmlPath = path.join(directory, 'chart.html');
  writeFileSync(htmlPath, validHtml());

  const quality = inspectPointInteractionQuality(htmlPath);

  assert.equal(quality.htmlPresent, true);
  assert.equal(quality.htmlReadable, true);
  assert.equal(quality.htmlPath, htmlPath);
  assert.equal(quality.pointInteractionQualityOk, true);
});

test('rejects rendered and embedded point count mismatches', () => {
  const quality = inspectPointInteractionQuality({ html: validHtml({ renderedCount: 1 }) });

  assert.equal(quality.renderedPointCount, 1);
  assert.equal(quality.dataPointCount, 2);
  assert.equal(quality.pointCountOk, false);
  assert.deepEqual(quality.checkResults['point-count'].violations, [{
    rule: 'point-count-mismatch',
    renderedPointCount: 1,
    dataPointCount: 2,
  }]);
  assert.equal(quality.pointInteractionQualityOk, false);
});

test('rejects points without complete hover and focus support', () => {
  const html = validHtml()
    .replaceAll(' tabindex="0"', '')
    .replace("point.addEventListener('pointerenter', showTooltip);", '')
    .replace("point.addEventListener('focus', showTooltip);", '')
    .replace('.temperature-point:hover { opacity: .8; }', '')
    .replace('.temperature-point:focus-visible { outline: 2px solid black; }', '');
  const quality = inspectPointInteractionQuality({ html });

  assert.equal(quality.hoverOk, false);
  assert.equal(quality.focusOk, false);
  assert.equal(quality.pointInteractionOk, false);
  assert.deepEqual(quality.checkResults['point-interaction'].violations.map(({ rule }) => rule), [
    'hover-handler-missing',
    'hover-state-missing',
    'focus-handler-missing',
    'focus-state-missing',
    'points-not-focusable',
  ]);
});

test('does not accept interaction claims hidden in comments or inert strings', () => {
  const html = validHtml()
    .replace("point.addEventListener('pointerenter', showTooltip);", '')
    .replace("point.addEventListener('focus', showTooltip);", '')
    .replace('</script>', `
      // point.addEventListener('pointerenter', showTooltip);
      /* point.addEventListener('focus', showTooltip); */
      const claim = "document.querySelectorAll('.temperature-point').forEach((point) => point.addEventListener('focus', showTooltip))";
    </script>`);
  const quality = inspectPointInteractionQuality({ html });
  assert.equal(quality.hoverOk, false);
  assert.equal(quality.focusOk, false);
  assert.deepEqual(quality.checkResults['point-interaction'].violations.map(({ rule }) => rule), [
    'hover-handler-missing',
    'focus-handler-missing',
  ]);
});

test('rejects incomplete tooltip data fields for any point', () => {
  const points = validPoints();
  delete points[1].qc;
  delete points[1].longitude;
  const quality = inspectPointInteractionQuality({ html: validHtml({ points }) });

  assert.equal(quality.tooltipPresent, true);
  assert.equal(quality.tooltipFieldsOk, false);
  assert.deepEqual(quality.checkResults['tooltip-fields'].pointMissingFields, [{
    index: 1,
    fields: ['longitude', 'qc'],
  }]);
});

test('requires a legend containing every data series', () => {
  const missingSeries = inspectPointInteractionQuality({ html: validHtml({ series: ['表层'] }) });
  assert.equal(missingSeries.legendPresent, true);
  assert.equal(missingSeries.legendSeriesOk, false);
  assert.deepEqual(missingSeries.checkResults['legend-series'].missingSeries, ['底层']);

  const noLegend = inspectPointInteractionQuality({
    html: validHtml().replace(/<div class="legend"[\s\S]*?<\/div>/u, ''),
  });
  assert.equal(noLegend.legendPresent, false);
  assert.equal(noLegend.legendSeriesOk, false);
});

test('rejects remote, relative and runtime network resources', () => {
  const html = validHtml()
    .replace('</head>', '<link rel="stylesheet" href="styles.css"><style>.x{background:url(https://example.test/a.png)}</style></head>')
    .replace('</body>', '<img src="data:image/png;base64,AA=="><script src="app.js"></script><script>fetch("/api/points")</script></body>');
  const quality = inspectPointInteractionQuality({ html });

  assert.equal(quality.selfContainedOk, false);
  assert.deepEqual(quality.externalResources.map(({ rule }) => rule).sort(), [
    'external-css-resource',
    'external-resource',
    'external-resource',
    'network-fetch',
  ]);
});

test('rejects blob and javascript resource URLs', () => {
  const quality = inspectPointInteractionQuality({
    html: validHtml().replace('</body>', '<iframe src="blob:opaque"></iframe><a class="x" href="javascript:void(0)">x</a></body>'),
  });
  assert.equal(quality.selfContainedOk, false);
  assert.equal(quality.externalResources.some(({ reference }) => reference === 'blob:opaque'), true);
});

test('ignores network and CSS resource claims that only appear in comments or strings', () => {
  const html = validHtml()
    .replace('</style>', '/* url(https://example.test/decoy.png) */</style>')
    .replace('function showTooltip() {}', `
      // fetch('/decoy')
      const message = "WebSocket('wss://example.test')";
      function showTooltip() {}
    `);
  const quality = inspectPointInteractionQuality({ html });
  assert.equal(quality.selfContainedOk, true);
});

test('returns composable checks and flattened violations without throwing on missing HTML', () => {
  const missing = inspectPointInteractionQuality('/definitely/missing/chart.html');
  assert.equal(missing.htmlPresent, false);
  assert.equal(missing.pointInteractionQualityOk, false);
  assert.equal(missing.checkResults['html-readable'].ok, false);

  const composed = composePointInteractionQuality([
    { id: 'one', ok: true, violations: [] },
    { id: 'two', ok: false, violations: [{ rule: 'failed' }] },
  ]);
  assert.equal(composed.qualityOk, false);
  assert.equal(composed.checkResults.one.ok, true);
  assert.deepEqual(composed.violations, [{ check: 'two', rule: 'failed' }]);
});
