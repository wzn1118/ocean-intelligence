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

function scientificHtml({ timeStart = '2026-09-03T00:00:00Z', timeEnd = '2026-09-03T01:00:00Z', timezone = 'UTC' } = {}) {
  const scientificAttributes = [
    'data-snapshot-id="snapshot-20260905"',
    'data-source="source-1"',
    'data-variable="sea_water_temperature"',
    'data-unit="degree_Celsius"',
    `data-time-start="${timeStart}"`,
    `data-time-end="${timeEnd}"`,
    `data-timezone="${timezone}"`,
    'data-spatial-coverage="Test Sea 120-121E 30-31N"',
    'data-qc-summary="raw=2 valid=2 missing=0 qc_rejected=0"',
    'data-uncertainty="instrument accuracy; calibration evidence limited"',
    'data-anomaly-status="not-evaluated"',
    'data-authoritative-runtime="MATLAB"',
    'data-matlab-release="R2026a"',
    'data-runtime-status="passed"',
    'data-execution-verified="true"',
    'data-artifact-validation="passed"',
    'data-visual-inspection="passed"',
  ].join(' ');
  return validHtml().replace('<body>', `<body ${scientificAttributes}>`);
}

test('strict mode audits scientific context and real MATLAB evidence', () => {
  const html = scientificHtml();
  const quality = inspectPointInteractionQuality({ html, requireScientificEvidence: true, requireMatlabEvidence: true });
  assert.equal(quality.scientificContextOk, true, JSON.stringify(quality.checkResults['scientific-context']));
  assert.equal(quality.matlabEvidenceOk, true, JSON.stringify(quality.checkResults['matlab-evidence']));
  assert.equal(quality.pointInteractionQualityOk, true);

  const octave = inspectPointInteractionQuality({
    html: html.replace('data-authoritative-runtime="MATLAB"', 'data-authoritative-runtime="Octave"'),
    requireScientificEvidence: true,
    requireMatlabEvidence: true,
  });
  assert.equal(octave.matlabEvidenceOk, false);
  assert.equal(octave.checkResults['matlab-evidence'].violations[0].rule, 'authoritative-runtime-not-matlab');
});

for (const [timeStart, timeEnd, timezone] of [
  ['2026-09-03T00:00:00', '2026-09-03T01:00:00Z', 'UTC'],
  ['2026-09-03', '2026-09-03', 'UTC'],
  ['2026-09-03T08:00:00+08:00', '2026-09-03T01:00:00Z', 'UTC'],
  ['2024-02-29T00:00:00.1Z', '2024-02-29T00:00:00.100Z', 'UTC+00:00'],
]) {
  test(`scientific context uses explicit UTC for ${timeStart} through ${timeEnd}`, () => {
    const quality = inspectPointInteractionQuality({
      html: scientificHtml({ timeStart, timeEnd, timezone }), requireScientificEvidence: true,
    });
    assert.equal(quality.scientificContextOk, true, JSON.stringify(quality.checkResults['scientific-context']));
    assert.equal(quality.scientificContext.timeStart, timeStart);
    assert.equal(quality.scientificContext.timeEnd, timeEnd);
  });
}

for (const [overrides, rule, field] of [
  [{ timeStart: '2026-02-30T00:00:00Z' }, 'scientific-time-invalid', 'timeStart'],
  [{ timeEnd: '2026-02-29T01:00:00Z' }, 'scientific-time-invalid', 'timeEnd'],
  [{ timeStart: '2026-09-03T00:00:00.0001Z' }, 'scientific-time-invalid', 'timeStart'],
  [{ timeStart: '2026-09-03T24:00:00Z' }, 'scientific-time-invalid', 'timeStart'],
  [{ timeStart: '2026-09-03T02:00:00', timeEnd: '2026-09-03T01:00:00Z' }, 'scientific-time-reversed'],
  [{ timeStart: '2026-09-03T08:00:00-08:00', timeEnd: '2026-09-03T01:00:00Z' }, 'scientific-time-reversed'],
  [{ timezone: 'UTC+08:00' }, 'scientific-timezone-not-utc'],
]) {
  test(`scientific context rejects ${JSON.stringify(overrides)}`, () => {
    const quality = inspectPointInteractionQuality({
      html: scientificHtml(overrides), requireScientificEvidence: true,
    });
    assert.equal(quality.scientificContextOk, false);
    assert.equal(quality.pointInteractionQualityOk, false);
    assert.ok(quality.checkResults['scientific-context'].violations.some((violation) =>
      violation.rule === rule && (field === undefined || violation.field === field)));
  });
}

function inspectSyntheticEvidence(html, required = true) {
  return inspectPointInteractionQuality({ html, requireScientificEvidence: required, requireMatlabEvidence: required });
}

for (const tag of ['html', 'body', 'main', 'section']) {
  test(`synthetic evidence accepts a real ${tag} declaration`, () => {
    const original = scientificHtml();
    const attributes = original.match(/<body ([^>]*)>/u)[1];
    let html = original.replace(/<body [^>]*>/u, '<body>');
    if (tag === 'html' || tag === 'body') html = html.replace(`<${tag}>`, `<${tag} ${attributes}>`);
    else html = html.replace('<body>', `<body><${tag} ${attributes}></${tag}>`);
    const quality = inspectSyntheticEvidence(html);
    assert.equal(quality.pointInteractionQualityOk, true, JSON.stringify(quality.violations));
    assert.equal(quality.scientificContext.snapshotId, 'snapshot-20260905');
    assert.equal(quality.matlabEvidence.authoritativeRuntime, 'MATLAB');
  });
}

test('synthetic evidence decodes numeric and named entities once in both declaration consumers', () => {
  const html = scientificHtml()
    .replace('data-source="source-1"', 'data-source="A &amp; B &quot;C&quot; &#x3e; D"')
    .replace('data-variable="sea_water_temperature"', 'data-variable="&amp;deg;C"')
    .replace('data-unit="degree_Celsius"', 'data-unit="&deg;C"')
    .replace('data-time-start="2026-09-03T00:00:00Z"', 'data-time-start="2026-09-03T00&#58;00&#x3a;00Z"')
    .replace('data-timezone="UTC"', 'data-timezone="&#85;TC"')
    .replace('data-authoritative-runtime="MATLAB"', 'data-authoritative-runtime="&#77;ATLAB"')
    .replace('data-execution-verified="true"', 'data-execution-verified="tr&#117;e"')
    .replace('data-runtime-status="passed"', 'data-runtime-status="p&#x61;ssed"');
  const quality = inspectSyntheticEvidence(html);
  assert.equal(quality.pointInteractionQualityOk, true, JSON.stringify(quality.violations));
  assert.equal(quality.scientificContext.source, 'A & B "C" > D');
  assert.equal(quality.scientificContext.variable, '&deg;C');
  assert.equal(quality.scientificContext.unit, '\u00b0C');
  assert.equal(quality.scientificContext.timeStart, '2026-09-03T00:00:00Z');
  assert.equal(quality.scientificContext.timezone, 'UTC');
  assert.equal(quality.matlabEvidence.authoritativeRuntime, 'MATLAB');
  assert.equal(quality.matlabEvidence.executionVerified, 'true');
  assert.equal(quality.matlabEvidence.runtimeStatus, 'passed');
});

test('synthetic evidence accepts single quotes, unquoted values and quoted tag boundaries', () => {
  const html = scientificHtml()
    .replace('data-snapshot-id="snapshot-20260905"', 'DATA-SNAPSHOT-ID=snapshot-20260905')
    .replace('data-spatial-coverage="Test Sea 120-121E 30-31N"', "data-spatial-coverage='Test Sea > shelf, < coast'")
    .replace('data-timezone="UTC"', 'data-timezone=UTC')
    .replace('data-authoritative-runtime="MATLAB"', "DATA-AUTHORITATIVE-RUNTIME='MATLAB'")
    .replace('data-runtime-status="passed"', 'data-runtime-status=passed');
  const quality = inspectSyntheticEvidence(html);
  assert.equal(quality.pointInteractionQualityOk, true, JSON.stringify(quality.violations));
  assert.equal(quality.scientificContext.spatialCoverage, 'Test Sea > shelf, < coast');
  assert.equal(quality.matlabEvidence.runtimeStatus, 'passed');
});

test('synthetic evidence does not double-decode an invalid UTC timestamp', () => {
  const timeStart = '2026-09-03T00&amp;#58;00:00Z';
  const quality = inspectSyntheticEvidence(scientificHtml({ timeStart }));
  assert.equal(quality.scientificContext.timeStart, '2026-09-03T00&#58;00:00Z');
  assert.equal(quality.pointInteractionQualityOk, false);
  assert.ok(quality.checkResults['scientific-context'].violations.some(({ rule, field }) =>
    rule === 'scientific-time-invalid' && field === 'timeStart'));
});

for (const [attribute, declarations, firstValue, resultName, field] of [
  ['data-time-start', 'data-time-start="2026-02-30T00:00:00Z" data-time-start="2026-09-03T00:00:00Z"',
    '2026-02-30T00:00:00Z', 'scientificContext', 'timeStart'],
  ['data-timezone', 'DATA-TIMEZONE=UTC+08:00 data-timezone="UTC"', 'UTC+08:00', 'scientificContext', 'timezone'],
  ['data-authoritative-runtime', 'data-authoritative-runtime=Octave DATA-AUTHORITATIVE-RUNTIME="MATLAB"',
    'Octave', 'matlabEvidence', 'authoritativeRuntime'],
  ['data-runtime-status', 'data-runtime-status="passed" data-runtime-status=failed', 'passed', 'matlabEvidence', 'runtimeStatus'],
  ['data-execution-verified', 'data-execution-verified=false data-execution-verified=true', 'false', 'matlabEvidence', 'executionVerified'],
  ['data-snapshot-id', 'data-snapshot-id="snapshot-20260905" data-snapshot-id="snapshot-20260905"',
    'snapshot-20260905', 'scientificContext', 'snapshotId'],
]) {
  test(`synthetic evidence rejects duplicate ${attribute} in strict and optional modes`, () => {
    const html = scientificHtml().replace(new RegExp(`${attribute}="[^"]*"`, 'u'), declarations);
    for (const required of [true, false]) {
      const quality = inspectSyntheticEvidence(html, required);
      assert.equal(quality.pointInteractionQualityOk, false, JSON.stringify({ required, violations: quality.violations }));
      assert.equal(quality.evidenceMarkupOk, false);
      assert.equal(quality[resultName][field], firstValue);
      const violations = quality.checkResults['evidence-markup'].violations;
      assert.equal(violations.length, 1, JSON.stringify(violations));
      assert.equal(violations[0].rule, 'html-duplicate-attribute');
      assert.ok(Number.isInteger(violations[0].line) && violations[0].line > 0);
      assert.ok(Number.isInteger(violations[0].column) && violations[0].column > 0);
      assert.ok(quality.violations.some(({ check, rule }) => check === 'evidence-markup' && rule === 'html-duplicate-attribute'));
    }
  });
}

test('synthetic evidence rejects duplicate attributes even outside the selected declaration', () => {
  const quality = inspectSyntheticEvidence(scientificHtml().replace('</body>', '<aside title="one" title="two"></aside></body>'));
  assert.equal(quality.scientificContextOk, true);
  assert.equal(quality.matlabEvidenceOk, true);
  assert.equal(quality.pointInteractionQualityOk, false);
  assert.equal(quality.evidenceMarkupOk, false);
  assert.equal(quality.checkResults['evidence-markup'].violations[0].rule, 'html-duplicate-attribute');
});

for (const [attribute, field, check, rule] of [
  ['data-time-start', 'timeStart', 'scientific-context', 'scientific-context-field-missing'],
  ['data-timezone', 'timezone', 'scientific-context', 'scientific-context-field-missing'],
  ['data-authoritative-runtime', 'authoritativeRuntime', 'matlab-evidence', 'authoritative-runtime-not-matlab'],
  ['data-visual-inspection', 'visualInspection', 'matlab-evidence', 'matlab-visual-inspection-not-passed'],
]) {
  test(`synthetic evidence preserves the missing ${attribute} diagnostic`, () => {
    const html = scientificHtml().replace(new RegExp(` ${attribute}="[^"]*"`, 'u'), '');
    const quality = inspectSyntheticEvidence(html);
    assert.equal(quality.pointInteractionQualityOk, false);
    assert.equal(quality.evidenceMarkupOk, true);
    assert.equal(quality[check === 'scientific-context' ? 'scientificContext' : 'matlabEvidence'][field], '');
    assert.ok(quality.checkResults[check].violations.some((violation) => violation.rule === rule
      && (check !== 'scientific-context' || violation.field === field)), JSON.stringify(quality.violations));
  });
}

for (const wrapper of ['script', 'style', 'template', 'noscript', 'comment', 'textarea']) {
  test(`synthetic evidence never takes declarations from ${wrapper} content`, () => {
    const attributes = scientificHtml().match(/<body ([^>]*)>/u)[1];
    const decoy = `<section ${attributes}></section>`;
    const inert = wrapper === 'comment' ? `<!-- ${decoy} -->` : `<${wrapper}>${decoy}</${wrapper}>`;
    const missing = inspectSyntheticEvidence(validHtml().replace('<body>', `<body>${inert}`));
    assert.equal(missing.pointInteractionQualityOk, false);
    assert.equal(missing.scientificContext.snapshotId, '');
    assert.equal(missing.matlabEvidence.authoritativeRuntime, '');
    assert.ok(missing.checkResults['scientific-context'].violations.some(({ rule, field }) =>
      rule === 'scientific-context-field-missing' && field === 'snapshotId'));
    assert.ok(missing.checkResults['matlab-evidence'].violations.some(({ rule }) => rule === 'authoritative-runtime-not-matlab'));
    const real = `<main ${attributes.replace('snapshot-20260905', 'actual-snapshot').replace('R2026a', 'R2024b')}></main>`;
    const quality = inspectSyntheticEvidence(validHtml().replace('<body>', `<body>${inert}${real}`));
    assert.equal(quality.pointInteractionQualityOk, true, JSON.stringify(quality.violations));
    assert.equal(quality.scientificContext.snapshotId, 'actual-snapshot');
    assert.equal(quality.matlabEvidence.matlabRelease, 'R2024b');
  });
}

test('synthetic evidence does not promote markup inside an attribute value to a declaration', () => {
  const attributes = scientificHtml().match(/<body ([^>]*)>/u)[1];
  const quality = inspectSyntheticEvidence(validHtml().replace('<body>', `<body><div title='<section ${attributes}></section>'></div>`));
  assert.equal(quality.pointInteractionQualityOk, false);
  assert.equal(quality.scientificContext.snapshotId, '');
  assert.equal(quality.matlabEvidence.authoritativeRuntime, '');
});

test('synthetic evidence keeps the first real declaration without borrowing fields from another', () => {
  const attributes = scientificHtml().match(/<body ([^>]*)>/u)[1];
  const html = validHtml().replace('<body>', `<body><section data-snapshot-id="incomplete"></section><section ${attributes}></section>`);
  const quality = inspectSyntheticEvidence(html);
  assert.equal(quality.pointInteractionQualityOk, false);
  assert.equal(quality.scientificContext.snapshotId, 'incomplete');
  assert.equal(quality.scientificContext.timeStart, '');
  assert.equal(quality.matlabEvidence.authoritativeRuntime, '');
});

for (const [name, markup, rule] of [
  ['open-shadow', '<div><template shadowrootmode=open><section data-snapshot-id=hidden></section></template></div>', 'html-unsupported-shadow-dom'],
  ['closed-shadow', '<div><template shadowrootmode=closed><section data-snapshot-id=hidden></section></template></div>', 'html-unsupported-shadow-dom'],
  ['rich-select', '<select><option><section data-snapshot-id=hidden></section></option></select>', 'html-unsupported-select-content'],
]) {
  test(`R21 point evidence rejects shared unsupported structure ${name}`, () => {
    for (const required of [true, false]) {
      const quality = inspectSyntheticEvidence(scientificHtml().replace('</body>', `${markup}</body>`), required);
      assert.equal(quality.pointInteractionQualityOk, false, JSON.stringify(quality.violations));
      assert.equal(quality.evidenceMarkupOk, false);
      assert.equal(quality.scientificContextOk, true);
      assert.equal(quality.matlabEvidenceOk, true);
      assert.ok(quality.checkResults['evidence-markup'].violations.some((violation) => violation.rule === rule));
    }
  });
}

for (const markup of [
  '<select><option>One<option>Two<optgroup label=group><option>Three</optgroup><hr></select>',
  '<select><template><div>Ordinary inert content</div></template><option>One</option></select>',
  '<template><section data-snapshot-id=hidden></section></template>',
]) {
  test(`R21 point evidence preserves shared supported structure ${markup}`, () => {
    const quality = inspectSyntheticEvidence(scientificHtml().replace('</body>', `${markup}</body>`));
    assert.equal(quality.pointInteractionQualityOk, true, JSON.stringify(quality.violations));
    assert.equal(quality.evidenceMarkupOk, true);
    assert.deepEqual(quality.checkResults['evidence-markup'].violations, []);
  });
}

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
