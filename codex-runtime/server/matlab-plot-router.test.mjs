import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import {
  generateMatlabPlotScript,
  matlabPlotRoutingInstructionBlock,
  resolveMatlabPlotRequest,
  routeMatlabPlot,
} from './matlab-plot-router.mjs';
import { MATLAB_RELEASE_CAPABILITY_MATRIX, selectMatlabExportStrategy } from './matlab-release-capabilities.mjs';
import { routeMatlabRuntimeRequest } from './matlab-runtime-route-service.mjs';

const ASSET_DIRECTORY = '/opt/ocean-intelligence/codex-runtime/matlab/assets';

function deliverable(overrides = {}) {
  return {
    assetDirectory: ASSET_DIRECTORY,
    title: 'Scientific figure',
    source: 'verified test fixture',
    qcStatus: 'absent',
    missingRepresentation: 'NaN',
    colorSemantics: 'sequential',
    ...overrides,
  };
}

function uncertaintyRequest(overrides = {}) {
  return deliverable({
    runtime: 'matlab', matlabAvailable: true, targetRelease: 'R2024b',
    question: 'uncertainty', hasUncertainty: true, uncertaintyType: 'standard-uncertainty',
    uncertaintyRepresentation: 'magnitude', uncertaintyAlignment: 'time',
    coordinates: ['time'], dimensions: [6], dimensionOrder: ['time'], observationDimension: 'time',
    dataType: 'datetime', timeZone: 'UTC', missing: true,
    qcStatus: 'present', qcAlignment: 'time',
    qc: { status: 'present', variable: 'sampleQC', accepted: ['good'], suspect: ['suspect'], rejected: ['bad'], action: 'preserve' },
    units: { value: 'degC', uncertainty: 'degC' }, quantities: { value: 'Temperature' },
    variableNames: { time: 'sampleTime', value: 'sampleValue', uncertainty: 'sampleUncertainty', observationId: 'sampleID', station: 'sampleStation', qcFlag: 'sampleQC' },
    ...overrides,
  });
}

function completePublicationContract({ chineseRequired = false, interactionMode = 'static' } = {}) {
  return {
    target: { medium: 'journal', width: 18, height: 12, units: 'cm', dpi: 300, formats: ['png', 'pdf'] },
    layout: {
      architecture: 'tiledlayout', rows: 1, columns: 1, tileSpacing: 'compact', padding: 'compact',
      readingOrder: 'row-major', explicitHandles: true, legendPlacement: 'none', colorbarPlacement: 'adjacent',
    },
    typography: {
      fontFamily: chineseRequired ? 'Noto Sans CJK SC' : 'Helvetica',
      fallbackFamilies: chineseRequired ? ['Source Han Sans SC'] : [],
      baseSizePt: 9, labelSizePt: 10, titleSizePt: 12, lineWidthPt: 1.3, interpreter: 'none',
    },
    color: {
      paletteClass: 'categorical', paletteSource: 'oi_ocean_theme', background: 'white',
      missingAppearance: 'gray mask distinct from data', minimumContrastRatio: 4.5,
      colorOnlyEncodingAllowed: false, colorVisionCheckRequired: true, grayscaleCheckRequired: true,
    },
    clipping: { drawnowBeforeAudit: true, boundsCheckRequired: true, overlapCheckRequired: true },
    localization: {
      encoding: 'UTF-8', languages: chineseRequired ? ['zh-CN', 'en'] : ['en'], chineseRequired,
      glyphCheckRequired: true, glyphFormats: ['png', 'pdf'],
    },
    accessibility: { descriptionRequired: true, redundantEncodingRequired: true, readingOrderCheckRequired: true },
    interaction: {
      mode: interactionMode, stableObservationIdsRequired: interactionMode === 'dual',
      targetScopedCallbacksRequired: interactionMode === 'dual', cleanupRequired: interactionMode === 'dual',
      staticFallbackRequired: interactionMode === 'dual',
    },
    headless: {
      supported: true, command: 'matlab -batch', figureVisible: 'off',
      exportApi: 'exportgraphics', desktopIndependent: true,
    },
  };
}

test('routes timetable-like time data to a gap-preserving time series', () => {
  const route = routeMatlabPlot({ dataType: 'timetable', dimensions: [96, 3], coordinates: ['time'] });
  assert.equal(route.schemaVersion, 5);
  assert.equal(route.plotType, 'time-series');
  assert.equal(route.helper, 'plot');
  assert.equal(route.template, 'inline MATLAB time series');
  assert.match(route.missingPolicy.representation, /NaN/u);
  assert.match(route.inputContract.requiredChecks.join(' '), /timezone/u);
});

test('explicit uncertainty question outranks generic time coordinate inference', () => {
  const route = routeMatlabPlot({ question: 'uncertainty', dimensions: [48, 1], coordinates: ['time'], hasUncertainty: true });
  assert.equal(route.plotType, 'uncertainty-series');
  assert.equal(route.template, 'inline MATLAB uncertainty series');
});

test('explicit interactive time-series requests select the native MATLAB template', () => {
  const route = routeMatlabPlot({
    taskType: 'interactive', question: 'trend', dimensions: [24], coordinates: ['time'], targetRelease: 'R2024b',
  });
  assert.equal(route.interactive, true);
  assert.equal(route.inputContract.interactive, true);
  assert.equal(route.helper, 'interactive_timeseries_native_template');
  assert.equal(route.template, 'interactive_timeseries_native_template.m');
  assert.match(route.inputContract.requiredChecks.join(' '), /ObservationID/u);
  assert.match(route.inputContract.requiredChecks.join(' '), /DataTipTemplate/u);
});

test('routes one-dimensional depth data to a positive-down profile', () => {
  const route = routeMatlabPlot({ dimensions: [200], coordinates: { depth: true } });
  assert.equal(route.plotType, 'profile');
  assert.equal(route.helper, 'oi_plot_profile');
  assert.match(route.axisPolicy.y, /positive-down/u);
});

test('routes time-depth matrices to Hovmoller before generic scalar fields', () => {
  const route = routeMatlabPlot({ dimensions: [80, 24], coordinates: ['time', 'depth'] });
  assert.equal(route.plotType, 'hovmoller');
  assert.equal(route.helper, 'oi_plot_hovmoller');
  assert.match(route.rationale, /time coordinate/u);
});

test('routes horizontal-depth matrices to ocean sections', () => {
  const route = routeMatlabPlot({ dimensions: [60, 18], coordinates: ['distance', 'depth'] });
  assert.equal(route.plotType, 'section');
  assert.equal(route.template, 'oi_plot_section.m');
});

test('routes longitude-latitude matrices to unprojected geospatial fields', () => {
  const route = routeMatlabPlot({ dimensions: [40, 50], coordinates: ['longitude', 'latitude'], longitudeConvention: '[-180, 180]' });
  assert.equal(route.plotType, 'geospatial-field');
  assert.equal(route.helper, 'surface/view(2)');
  assert.match(route.inputContract.requiredChecks.join(' '), /dateline/u);
});

test('paired vector components outrank scalar matrix inference', () => {
  const route = routeMatlabPlot({ dimensions: [20, 30], coordinates: ['longitude', 'latitude'], vectorComponents: true });
  assert.equal(route.plotType, 'vector-field');
  assert.equal(route.helper, 'oi_plot_vector_field');
  assert.match(route.inputContract.requiredChecks.join(' '), /u\/v units/u);
});

test('geospatial fields reject an unstated longitude convention', () => {
  assert.throws(
    () => routeMatlabPlot({ dimensions: [40, 50], coordinates: ['longitude', 'latitude'] }),
    /longitudeConvention/u,
  );
});

test('scientific comparison and T-S questions select specialized helpers', () => {
  assert.equal(routeMatlabPlot({ question: 'agreement', dimensions: [100] }).plotType, 'comparison');
  assert.equal(routeMatlabPlot({ question: 'temperature-salinity', dimensions: [100], coordinates: ['depth'] }).plotType, 'ts-diagram');
});

test('direction roses reject an unstated from/to convention', () => {
  assert.throws(() => routeMatlabPlot({ question: 'direction', dimensions: [360] }), /directionConvention/u);
  assert.equal(routeMatlabPlot({ question: 'direction', dimensions: [360], directionConvention: 'from' }).plotType, 'direction-rose');
});

test('two-dimensional routes reject a one-dimensional contract', () => {
  assert.throws(() => routeMatlabPlot({ question: 'map', dimensions: [100], coordinates: ['longitude', 'latitude'] }), /two-dimensional/u);
  assert.throws(() => routeMatlabPlot({ question: 'vector', dimensions: [100], vectorComponents: true }), /two-dimensional/u);
});

test('generated script is deterministic, sanitized and includes scientific guards', () => {
  const input = Object.freeze(deliverable({
    question: 'time-depth',
    dimensions: [24, 40],
    coordinates: ['time', 'depth'],
    functionName: 'make_hovmoller',
    figureId: 'time depth',
    outputDirectory: 'generated/plots',
    variableNames: { time: 'sampleTime', depth: 'depthM', field: 'temperature' },
    units: { depth: 'm', value: 'degC' },
    quantities: { depth: 'Depth', value: 'Sea water temperature' },
    timeZone: 'UTC',
    verticalCoordinate: 'depth',
    verticalPositive: 'down',
    missing: true,
    gridType: 'rectilinear',
    dimensionOrder: ['depth', 'time'],
    dataType: 'datetime',
    colorLimits: [5, 30],
  }));
  const first = generateMatlabPlotScript(input);
  const second = generateMatlabPlotScript(input);
  assert.equal(first, second);
  assert.match(first, /function result = make_hovmoller\(sampleTime, depthM, temperature\)/u);
  assert.match(first, /assert\(~exist\('OCTAVE_VERSION'/u);
  assert.match(first, /isdatetime\(sampleTime\)/u);
  assert.match(first, /oi_plot_hovmoller\(axesHandle, sampleTime/u);
  assert.match(first, /Selection reason: hovmoller communicates gridded time\/depth evolution/u);
  assert.match(first, /'DepthUnit', 'm'/u);
  assert.match(first, /'QuantityLabel', 'Sea water temperature', 'QuantityUnit', 'degC'/u);
  assert.match(first, /publicationWidthPixels = 1200/u);
  assert.match(first, /publicationHeightPixels = 675/u);
  assert.match(first, /oi_export_figure\(figureHandle, outputDirectory, 'time_depth', publicationWidthPixels, publicationHeightPixels, publicationDpi/u);
  assert.match(first, /oi_write_manifest\(fullfile\(outputDirectory, 'figures\.json'\), exportEntry\)/u);
  assert.match(first, /plotResult\.ValidCount/u);
  assert.doesNotMatch(first, /generated\nignore/u);
});

test('release plan is explicit for older MATLAB without native exportgraphics', () => {
  const route = routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [12], targetRelease: 'R2019b' });
  assert.equal(route.apiPlan.layout.status, 'native');
  assert.equal(route.apiPlan.export.status, 'fallback');
  assert.equal(route.apiPlan.export.api, 'print');
});

test('legacy MATLAB release is routed to an explicit audited-generator limitation', () => {
  const input = deliverable({
    question: 'trend',
    coordinates: ['time'],
    dimensions: [12],
    targetRelease: 'R2013b',
    dataType: 'datetime',
    units: { value: 'degC' },
    quantities: { value: 'Sea water temperature' },
    timeZone: 'UTC',
    missing: false,
  });
  const route = routeMatlabPlot(input);
  assert.ok(route.unresolvedRequirements.includes('targetRelease R2019b or newer for arguments-based audited assets'));
  assert.throws(() => generateMatlabPlotScript(input), /R2019b or newer/u);
  const resolved = resolveMatlabPlotRequest(input);
  assert.equal(resolved.status, 'needs-input');
  assert.equal(resolved.plotRoute.apiPlan.exportFormats.png.api, 'print');
  assert.equal(resolved.script, null);
});

test('routing instruction block documents deterministic priority and prohibited transforms', () => {
  const block = matlabPlotRoutingInstructionBlock();
  assert.match(block, /显式科学问题 > 坐标组合 > 数据类型\/维数/u);
  assert.match(block, /time\+depth 二维场→hovmoller/u);
  assert.match(block, /时间必须非 NaT、严格递增且唯一/u);
  assert.match(block, /不得自动 fillmissing、smooth、sort、squeeze、transpose/u);
  assert.match(block, /R2019b-R2024b 的 PNG\/PDF\/SVG.*print 回退/u);
  assert.match(block, /R2020a-R2024b 仍有 exportgraphics/u);
  assert.match(block, /R2025a 起使用 exportgraphics/u);
  assert.match(block, /2\/3\/6（含 P-code）/u);
  assert.doesNotMatch(block, /R2020a 起使用 exportgraphics/u);
  assert.match(block, /工具箱许可证/u);
  assert.match(block, /中英文科学问题和坐标名称仅按内置白名单归一化/u);
  assert.match(block, /三坐标立方体必须拒绝/u);
  assert.match(block, /未明确的 3-D 不得路由到 surf/u);
  assert.match(block, /unresolvedRequirements/u);
});

test('routing instruction builder recommends only real MATLAB assets and native surface geometry', () => {
  const block = matlabPlotRoutingInstructionBlock();
  const assets = readdirSync(new URL('../matlab/assets/', import.meta.url))
    .filter((filename) => filename.endsWith('.m'));
  for (const helper of new Set(block.match(/\boi_[a-z0-9_]+\b/gu))) {
    assert.ok(assets.includes(`${helper}.m`), `No MATLAB helper asset: ${helper}`);
  }
  for (const template of new Set(block.match(/\b[A-Za-z][A-Za-z0-9_]*\.m\b/gu))) {
    assert.ok(assets.includes(template), `No MATLAB template asset: ${template}`);
  }
  assert.match(block, /oi_font_available/u);
  assert.match(block, /listfonts 或 fc-list 精确安装证据按声明候选链/u);
  assert.match(block, /普通文本使用 Interpreter='none'；无字体时明确失败/u);
  assert.match(block, /字体存在和最终 PNG\/PDF 字形、PDF 嵌入是不同证据/u);
  assert.match(block, /科学问题确需表面几何时使用原生 surf 并验证维度、坐标与单位/u);
  assert.match(block, /不声称仓库已有 3D 模板/u);
  assert.doesNotMatch(block, /surface_3d_native_template|oi_resolve_font|oi_configure_graphics|oi_plot_timeseries/u);
});

test('routing instructions separate native raster pixels from vector inches and unverified rendering', () => {
  const block = matlabPlotRoutingInstructionBlock();
  assert.match(block, /PNG 使用 Units="pixels"、整数 Width\/Height 和 Resolution=dpi/u);
  assert.match(block, /PDF\/SVG 使用 Units="inches"、Width=widthPixels\/dpi、Height=heightPixels\/dpi/u);
  assert.match(block, /两类均保留 Padding="figure" 和 PreserveAspectRatio="on"/u);
  assert.match(block, /绘图前的 figure\/layout 仍按像素\/DPI 设置最终 inches，不把屏幕像素作为输出尺寸/u);
  assert.match(block, /runtime\.export_size_units 按实际路径记录：原生 PNG 为 pixels，print PNG 为 inches，PDF 及请求的 SVG 为 inches/u);
  assert.match(block, /不做导出后 resize，不通过重采样、裁切或填边掩盖尺寸错误/u);
  assert.match(block, /本次 PNG 单位策略调整尚待 CI 验证，不得声称尺寸偏差已经修复/u);
  assert.match(block, /目标策略不能冒充运行证据/u);
  assert.match(block, /结合源图实测边界与导出器几何证据检查布局，保留未测覆盖/u);
  assert.match(block, /不得冒充 PNG\/PDF 裁剪、重叠、中文字形、灰度、色觉或字体嵌入验收/u);
  assert.doesNotMatch(block, /Width\/Height、Units inches/u);
});

test('returns unresolved metadata instead of inventing units, timezone or missingness', () => {
  const route = routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [12] });
  assert.equal(route.readyForGeneration, false);
  assert.deepEqual(route.unitPolicy.units, {});
  assert.ok(route.unresolvedRequirements.includes('units.value'));
  assert.ok(route.unresolvedRequirements.includes('quantities.value'));
  assert.ok(route.unresolvedRequirements.includes('timeZone'));
  assert.ok(route.unresolvedRequirements.includes('missing status (present/absent)'));
  assert.equal(route.selectionReason.priority, 'scientific-question');
});

test('rejects unknown questions and question-coordinate contradictions', () => {
  assert.throws(() => routeMatlabPlot({ question: 'make-it-pretty', dimensions: [20] }), /Unknown scientific question/u);
  assert.throws(() => routeMatlabPlot({ question: 'trend', dimensions: [20] }), /explicit time coordinate/u);
  assert.throws(() => routeMatlabPlot({ question: 'profile', dimensions: [20] }), /depth or pressure coordinate/u);
  assert.throws(() => routeMatlabPlot({ question: 'uncertainty', dimensions: [20], coordinates: ['time'] }), /hasUncertainty=true/u);
});

test('rejects ambiguous coordinate rank and implicit dimension permutation', () => {
  assert.throws(
    () => routeMatlabPlot({ dimensions: [20, 30], coordinates: ['longitude', 'latitude', 'depth'], longitudeConvention: '[-180, 180]' }),
    /ambiguous below rank 3|Coordinate count exceeds/u,
  );
  assert.throws(
    () => routeMatlabPlot({ dimensions: [20, 30], coordinates: ['time', 'depth'], dimensionOrder: ['time', 'depth'] }),
    /no silent permute\/transpose/u,
  );
});

test('rejects scattered fields without explicit interpolation and masking policy', () => {
  assert.throws(
    () => routeMatlabPlot({
      dimensions: [20, 30],
      coordinates: ['longitude', 'latitude'],
      longitudeConvention: '[0, 360]',
      gridType: 'scattered',
    }),
    /interpolation method and mask policy/u,
  );
  const route = routeMatlabPlot({
    dimensions: [20, 30],
    coordinates: ['longitude', 'latitude'],
    longitudeConvention: '[0, 360]',
    gridType: 'scattered',
    interpolation: { method: 'natural', maskPolicy: 'retain convex-hull exterior as missing' },
  });
  assert.equal(route.plotType, 'geospatial-field');
  assert.equal(route.readyForGeneration, false);
  assert.ok(route.unresolvedRequirements.includes('pregridded field for deterministic script generation'));
});

test('script generation rejects incomplete or incompatible uncertainty metadata', () => {
  const base = {
    question: 'uncertainty',
    hasUncertainty: true,
    coordinates: ['time'],
    dimensions: [24],
    units: { value: 'degC', uncertainty: 'm/s' },
    quantities: { value: 'Temperature' },
    timeZone: 'UTC',
    missing: true,
    uncertaintyType: 'standard-deviation',
  };
  assert.throws(() => generateMatlabPlotScript(base), /uncertainty unit compatible/u);
  assert.throws(
    () => generateMatlabPlotScript({ ...base, units: { value: 'degC', uncertainty: 'degC' }, uncertaintyType: '' }),
    /uncertaintyType/u,
  );
});

test('routing preserves pressure units but generation rejects a depth-specific asset mismatch', () => {
  const route = routeMatlabPlot({
    question: 'profile',
    coordinates: ['depth'],
    dimensions: [30],
    units: { depth: 'dbar', value: 'umol kg^-1' },
    quantities: { depth: 'Sea pressure', value: 'Dissolved oxygen' },
    verticalCoordinate: 'pressure',
    verticalPositive: 'down',
    missing: true,
  });
  assert.deepEqual(route.unitPolicy.units, { depth: 'dbar', value: 'umol kg^-1' });
  assert.equal(route.selectionReason.selected, 'profile');
  assert.ok(route.unresolvedRequirements.includes('explicit pressure-coordinate implementation; selected assets are depth-specific'));
  assert.throws(() => generateMatlabPlotScript(deliverable({
    question: 'profile',
    coordinates: ['depth'],
    dimensions: [30],
    units: { depth: 'dbar', value: 'umol kg^-1' },
    quantities: { depth: 'Sea pressure', value: 'Dissolved oxygen' },
    verticalCoordinate: 'pressure',
    verticalPositive: 'down',
    verticalReference: 'sea surface',
    missing: true,
  })), /pressure-coordinate implementation/u);

  const script = generateMatlabPlotScript(deliverable({
    question: 'profile',
    coordinates: ['depth'],
    dimensions: [30],
    units: { depth: 'm', value: 'umol kg^-1' },
    quantities: { depth: 'Depth', value: 'Dissolved oxygen' },
    verticalCoordinate: 'depth',
    verticalPositive: 'down',
    verticalReference: 'sea surface',
    missing: true,
  }));
  assert.match(script, /'QuantityLabel', 'Dissolved oxygen'/u);
  assert.match(script, /'DepthUnit', 'm'/u);
  assert.match(script, /'VerticalReference', 'sea surface'/u);
});

test('rejects positive-up vertical coordinates instead of silently reversing them', () => {
  assert.throws(
    () => routeMatlabPlot({
      question: 'profile',
      coordinates: ['depth'],
      dimensions: [30],
      verticalCoordinate: 'depth',
      verticalPositive: 'up',
    }),
    /Positive-up vertical coordinates/u,
  );
});

test('preserves a non-UTC timezone in generated Hovmoller code', () => {
  const script = generateMatlabPlotScript(deliverable({
    question: 'time-depth',
    coordinates: ['time', 'depth'],
    dimensions: [12, 8],
    dimensionOrder: ['depth', 'time'],
    gridType: 'rectilinear',
    timeZone: 'Asia/Shanghai',
    verticalCoordinate: 'depth',
    verticalPositive: 'down',
    missing: true,
    units: { depth: 'm', value: 'degC' },
    quantities: { depth: 'Depth', value: 'Temperature' },
    dataType: 'datetime',
    colorLimits: [10, 30],
  }));
  assert.match(script, /'TimeZone', 'Asia\/Shanghai'/u);
  assert.match(script, /oi_plot_hovmoller[\s\S]*'TimeZone', 'Asia\/Shanghai'/u);
});

test('requires compatible units for comparison and vector components', () => {
  const comparison = routeMatlabPlot({
    question: 'comparison',
    dimensions: [20],
    missing: false,
    units: { reference: 'degC', candidate: 'K' },
    quantities: { reference: 'Observed temperature', candidate: 'Modeled temperature' },
  });
  assert.ok(comparison.unresolvedRequirements.includes('matching comparison units'));
  const vector = routeMatlabPlot({
    dimensions: [10, 12],
    vectorComponents: true,
    gridType: 'rectilinear',
    dimensionOrder: ['y', 'x'],
    missing: true,
    units: { x: 'km', y: 'km', u: 'm/s', v: 'cm/s' },
    quantities: { x: 'East distance', y: 'North distance', u: 'East current', v: 'North current' },
  });
  assert.ok(vector.unresolvedRequirements.includes('matching u/v component units'));
  assert.ok(vector.unresolvedRequirements.includes('positive referenceVector'));
});

test('spectrum generation requires provenance and emits positive-domain guards', () => {
  const incomplete = routeMatlabPlot({ question: 'spectrum', dimensions: [64] });
  assert.ok(incomplete.unresolvedRequirements.includes('precomputedSpectrum=true'));
  const script = generateMatlabPlotScript(deliverable({
    question: 'spectrum',
    dimensions: [64],
    missing: true,
    precomputedSpectrum: true,
    units: { frequency: 'cycles/day', density: 'degC^2/(cycles/day)' },
    quantities: { frequency: 'Frequency', density: 'Temperature spectral density' },
    spectrumMetadata: {
      periodUnit: 'day',
      windowDescription: 'Hann, 128 samples',
      detrendDescription: 'linear',
      segmentDescription: '50 percent overlap',
      degreesOfFreedom: 12,
    },
  }));
  assert.match(script, /Frequency must be finite and positive/u);
  assert.match(script, /Finite spectral density must be positive/u);
  assert.match(script, /'WindowDescription', 'Hann, 128 samples'/u);
});

test('diverging fields require a scientific color reference', () => {
  const route = routeMatlabPlot({
    question: 'field',
    dimensions: [8, 12],
    dimensionOrder: ['y', 'x'],
    gridType: 'regular',
    colorSemantics: 'diverging',
    missing: true,
    units: { x: 'km', y: 'km', value: 'degC' },
    quantities: { x: 'East distance', y: 'North distance', value: 'Temperature anomaly' },
  });
  assert.ok(route.unresolvedRequirements.includes('colorReference for diverging data'));
  const resolved = routeMatlabPlot(deliverable({
    question: 'field',
    dimensions: [8, 12],
    dimensionOrder: ['y', 'x'],
    gridType: 'regular',
    colorSemantics: 'diverging',
    colorReference: 0,
    colorLimits: [-3, 3],
    missing: true,
    units: { x: 'km', y: 'km', value: 'degC' },
    quantities: { x: 'East distance', y: 'North distance', value: 'Temperature anomaly' },
  }));
  assert.equal(resolved.colorPolicy.reference, 0);
  assert.equal(resolved.readyForGeneration, true);
});

test('vector and directional generators retain physical scale conventions', () => {
  const vectorScript = generateMatlabPlotScript(deliverable({
    dimensions: [10, 12],
    vectorComponents: true,
    gridType: 'rectilinear',
    dimensionOrder: ['y', 'x'],
    missing: true,
    referenceVector: 0.5,
    componentFrame: 'east-north',
    units: { x: 'km', y: 'km', u: 'm/s', v: 'm/s' },
    quantities: { x: 'East distance', y: 'North distance', u: 'East current', v: 'North current' },
  }));
  assert.match(vectorScript, /'VectorUnit', 'm\/s', 'ComponentFrame', 'east-north', 'ReferenceMagnitude', 0\.5/u);

  const directionScript = generateMatlabPlotScript(deliverable({
    question: 'direction',
    dimensions: [36],
    directionConvention: 'from',
    directionNormalization: 'percent',
    missing: true,
    units: { direction: 'degree', weight: '1' },
    quantities: { direction: 'Wind direction' },
  }));
  assert.match(directionScript, /'DirectionConvention', 'from', 'DirectionUnit', 'degree', 'Normalization', 'percent'/u);
  assert.throws(
    () => routeMatlabPlot({ question: 'direction', dimensions: [36], directionConvention: 'from', directionNormalization: 'fraction' }),
    /normalization must be/u,
  );
});

test('end-to-end resolver joins runtime, plot readiness and script generation', () => {
  const ready = resolveMatlabPlotRequest(deliverable({
    runtime: 'matlab',
    matlabAvailable: true,
    question: 'trend',
    coordinates: ['time'],
    dimensions: [24],
    dataType: 'datetime',
    timeZone: 'UTC',
    missing: false,
    units: { value: 'degC' },
    quantities: { value: 'Sea water temperature' },
  }));
  assert.equal(ready.status, 'ready');
  assert.equal(ready.taskRoute.status, 'ready');
  assert.equal(ready.plotRoute.plotType, 'time-series');
  assert.match(ready.script, /graphicsHandle = plot/u);
  assert.match(ready.script, /oi_write_manifest/u);

  const needsInput = resolveMatlabPlotRequest({
    runtime: 'matlab', question: 'trend', coordinates: ['time'], dimensions: [24],
  });
  assert.equal(needsInput.status, 'needs-input');
  assert.equal(needsInput.script, null);
  assert.ok(needsInput.plotRoute.unresolvedRequirements.includes('units.value'));
});

test('end-to-end interactive routing calls the native template with aligned metadata', () => {
  const input = deliverable({
    runtime: 'matlab', matlabAvailable: true, taskType: 'interactive', targetRelease: 'R2024b',
    question: 'trend', coordinates: ['time'], dimensions: [24], dimensionOrder: ['time'], dataType: 'datetime', timeZone: 'UTC', missing: false,
    qcStatus: 'present', qc: { status: 'present', variable: 'sampleQC', accepted: ['good'], suspect: ['suspect'], rejected: ['bad'], action: 'preserve' },
    observationDimension: 'time', qcAlignment: 'time',
    units: { value: 'degC' }, quantities: { value: 'Sea water temperature' },
    variableNames: { time: 'sampleTime', value: 'sampleValue', observationId: 'sampleID', station: 'sampleStation', qcFlag: 'sampleQC' },
  });
  const resolved = resolveMatlabPlotRequest(input);
  assert.equal(resolved.status, 'ready');
  assert.equal(resolved.plotRoute.template, 'interactive_timeseries_native_template.m');
  assert.match(resolved.script, /function result = make_ocean_figure\(sampleTime, sampleValue, sampleID, sampleStation, sampleQC\)/u);
  assert.match(resolved.script, /interactive_timeseries_native_template\(interactionData/u);
  assert.match(resolved.script, /desktopAvailable = usejava\('desktop'\)/u);
  assert.match(resolved.script, /'Interactive', interactionRequested/u);
  assert.match(resolved.script, /'Export', false/u);
  assert.match(resolved.script, /'FontName', selectedFontName/u);
  assert.doesNotMatch(resolved.script, /title\(axesHandle,/u);
  assert.match(resolved.script, /interactionPlot\.Layout\.Title\.FontSize = theme\.TitleSize/u);
  assert.match(resolved.script, /runtime_bounds = "pending";\s+if exportEntry\.rendering_evidence\.bounds_audit_complete\s+publicationContract\.verification\.runtime_bounds = "passed";/u);
  assert.match(resolved.script, /interactionPlot\.Layout\.Padding = 'loose'/u);
  assert.match(resolved.script, /'ValueLabel', 'Sea water temperature', 'ValueUnit', 'degC'/u);
  assert.match(resolved.script, /'ObservationID', 'Station', 'QCFlag'/u);
  assert.match(resolved.script, /ObservationID must be nonmissing, nonempty and unique/u);
  assert.doesNotMatch(resolved.script, /figureHandle = oi_figure/u);
});

test('interactive uncertainty routes preserve magnitude and confidence-bound semantics', () => {
  const common = {
    runtime: 'matlab', matlabAvailable: true, taskType: 'interactive', targetRelease: 'R2024b',
    coordinates: ['time'], dimensions: [24], dimensionOrder: ['time'], observationDimension: 'time',
    dataType: 'datetime', timeZone: 'UTC', missing: false,
    qcStatus: 'present', qc: { status: 'present', variable: 'qcFlag', accepted: ['good'], suspect: ['suspect'], rejected: ['bad'], action: 'preserve' },
    qcAlignment: 'time', units: { value: 'degC', uncertainty: 'degC' },
    quantities: { value: 'Sea water temperature' },
    uncertaintyAlignment: 'time',
    variableNames: { time: 'sampleTime', value: 'sampleValue', uncertainty: 'sampleUncertainty', uncertaintyLower: 'sampleLower', uncertaintyUpper: 'sampleUpper', observationId: 'sampleID', station: 'sampleStation', qcFlag: 'sampleQC' },
  };
  const magnitude = resolveMatlabPlotRequest(deliverable({
    ...common, question: 'trend', hasUncertainty: true,
    uncertaintyType: 'standard-deviation', uncertaintyRepresentation: 'magnitude',
  }));
  assert.equal(magnitude.status, 'ready');
  assert.equal(magnitude.plotRoute.plotType, 'uncertainty-series');
  assert.equal(magnitude.plotRoute.template, 'interactive_timeseries_native_template.m');
  assert.match(magnitude.script, /function result = make_ocean_figure\(sampleTime, sampleValue, sampleUncertainty, sampleID, sampleStation, sampleQC\)/u);
  assert.match(magnitude.script, /'Time', 'Value', 'Uncertainty', 'ObservationID', 'Station', 'QCFlag'/u);
  assert.match(magnitude.script, /'TimeZone', 'UTC'/u);
  assert.match(magnitude.script, /'UncertaintyType', 'standard-deviation', 'UncertaintyUnit', 'degC', 'ConfidenceLevel', NaN/u);
  assert.match(magnitude.script, /'ValidCount', interactionPlot\.ValidCount/u);

  const bounds = resolveMatlabPlotRequest(deliverable({
    ...common, question: 'confidence', hasUncertainty: true,
    uncertaintyType: 'confidence-interval', uncertaintyRepresentation: 'bounds', confidenceLevel: 0.95,
  }));
  assert.equal(bounds.status, 'ready');
  assert.match(bounds.script, /sampleLower, sampleUpper, sampleID, sampleStation, sampleQC/u);
  assert.match(bounds.script, /'UncertaintyLower', 'UncertaintyUpper', 'ObservationID'/u);
  assert.match(bounds.script, /'ConfidenceLevel', 0\.95/u);
});

test('standard uncertainty remains distinct in static and interactive routes for both spellings', () => {
  for (const uncertaintyType of ['standard-uncertainty', 'standard_uncertainty']) {
    for (const interactive of [false, true]) {
      const resolved = resolveMatlabPlotRequest(uncertaintyRequest({ uncertaintyType, interactive }));
      assert.equal(resolved.status, 'ready');
      assert.equal(resolved.plotRoute.inputContract.uncertaintyType, 'standard-uncertainty');
      assert.equal(resolved.plotRoute.inputContract.uncertaintyRepresentation, 'magnitude');
      assert.equal(resolved.plotRoute.inputContract.confidenceLevel, null);
      assert.match(resolved.script, /Uncertainty semantics: standard-uncertainty; representation: magnitude; confidence level: not-applicable/u);
      assert.doesNotMatch(resolved.script, /standard-deviation|\bstd\s*\(|\bvar\s*\(/u);
      if (interactive) {
        assert.equal(resolved.plotRoute.template, 'interactive_timeseries_native_template.m');
        assert.match(resolved.script, /table\(sampleTime\(:\), sampleValue\(:\), sampleUncertainty\(:\), sampleID\(:\), sampleStation\(:\), sampleQC\(:\)/u);
        assert.match(resolved.script, /'UncertaintyType', 'standard-uncertainty', 'UncertaintyUnit', 'degC', 'ConfidenceLevel', NaN/u);
      } else {
        assert.match(resolved.script, /errorbar\(axesHandle, sampleTime, sampleValue, sampleUncertainty,/u);
        assert.match(resolved.script, /validMask = isfinite\(sampleValue\) & isfinite\(sampleUncertainty\)/u);
      }
    }
  }
  const nested = resolveMatlabPlotRequest(uncertaintyRequest({
    interactive: true, uncertaintyType: undefined,
    uncertainty: { status: 'present', type: 'standard_uncertainty', unit: 'degC', alignment: 'time' },
  }));
  assert.equal(nested.status, 'ready');
  assert.equal(nested.plotRoute.inputContract.uncertaintyType, 'standard-uncertainty');
});

test('uncertainty routing rejects unknown types and preserves existing explicit types', () => {
  for (const uncertaintyType of ['variance', 'stdev', 'unknown-uncertainty']) {
    const input = uncertaintyRequest({ uncertaintyType });
    const route = routeMatlabPlot(input);
    assert.equal(route.readyForGeneration, false);
    assert.ok(route.unresolvedRequirements.includes('uncertaintyType'));
    assert.equal(route.inputContract.confidenceLevel, null);
    assert.throws(() => generateMatlabPlotScript(input), /uncertaintyType/u);
    assert.equal(resolveMatlabPlotRequest(input).script, null);
  }
  for (const uncertaintyType of ['standard-deviation', 'standard_error', 'instrument-accuracy', 'ensemble_spread']) {
    const resolved = resolveMatlabPlotRequest(uncertaintyRequest({ uncertaintyType }));
    assert.equal(resolved.status, 'ready');
    assert.equal(resolved.plotRoute.inputContract.uncertaintyType, uncertaintyType.replaceAll('_', '-'));
    assert.equal(resolved.plotRoute.inputContract.confidenceLevel, null);
  }
});

test('legacy uncertainty aliases retain their types and confidence normalization', () => {
  for (const interactive of [false, true]) {
    for (const [uncertaintyType, expectedType] of [
      ['sd', 'standard-deviation'], ['std', 'standard-deviation'], ['se', 'standard-error'],
    ]) {
      const resolved = resolveMatlabPlotRequest(uncertaintyRequest({ uncertaintyType, interactive }));
      assert.equal(resolved.status, 'ready');
      assert.equal(resolved.plotRoute.inputContract.uncertaintyType, expectedType);
      assert.equal(resolved.plotRoute.inputContract.confidenceLevel, null);
      if (interactive) {
        assert.ok(resolved.script.includes(`'UncertaintyType', '${expectedType}', 'UncertaintyUnit', 'degC', 'ConfidenceLevel', NaN`));
      }
    }
    for (const uncertaintyType of ['95-confidence-interval', '95%-confidence-interval', '95_confidence_interval']) {
      for (const confidenceLevel of [undefined, 0.9]) {
        const resolved = resolveMatlabPlotRequest(uncertaintyRequest({ uncertaintyType, interactive, confidenceLevel }));
        assert.equal(resolved.status, 'ready');
        assert.equal(resolved.plotRoute.inputContract.uncertaintyType, 'confidence-interval');
        assert.equal(resolved.plotRoute.inputContract.confidenceLevel, confidenceLevel ?? 0.95);
        if (interactive) {
          assert.ok(resolved.script.includes(`'UncertaintyType', 'confidence-interval', 'UncertaintyUnit', 'degC', 'ConfidenceLevel', ${confidenceLevel ?? 0.95}`));
        }
      }
    }
    const explicitCI = resolveMatlabPlotRequest(uncertaintyRequest({
      interactive, uncertaintyType: 'ci', confidenceLevel: 0.9,
    }));
    assert.equal(explicitCI.status, 'ready');
    assert.equal(explicitCI.plotRoute.inputContract.uncertaintyType, 'confidence-interval');
    assert.equal(explicitCI.plotRoute.inputContract.confidenceLevel, 0.9);
    const implicitCI = uncertaintyRequest({ interactive, uncertaintyType: 'ci' });
    assert.equal(routeMatlabPlot(implicitCI).inputContract.confidenceLevel, null);
    assert.throws(() => generateMatlabPlotScript(implicitCI), /confidenceLevel between 0 and 1/u);
    assert.throws(() => generateMatlabPlotScript(uncertaintyRequest({
      interactive, uncertaintyType: '95-confidence-interval', confidenceLevel: 1,
    })), /confidenceLevel between 0 and 1/u);
  }
});

test('uncertainty routes reject confidence levels on non-CI types and invalid CI levels', () => {
  for (const interactive of [false, true]) {
    for (const uncertaintyType of ['standard-uncertainty', 'standard_uncertainty', 'standard_deviation', 'standard-error', 'instrument-accuracy', 'ensemble-spread', 'sd', 'std', 'se']) {
      const input = uncertaintyRequest({ interactive, uncertaintyType, confidenceLevel: 0.95 });
      assert.throws(() => generateMatlabPlotScript(input), /confidenceLevel omitted for non-confidence uncertainty/u);
      assert.equal(resolveMatlabPlotRequest(input).script, null);
    }
    for (const confidenceLevel of [undefined, 0, 1, -0.1, 95]) {
      const input = uncertaintyRequest({ interactive, uncertaintyType: 'confidence_interval', confidenceLevel });
      assert.throws(() => generateMatlabPlotScript(input), /confidenceLevel between 0 and 1/u);
    }
    const confidence = resolveMatlabPlotRequest(uncertaintyRequest({
      interactive, uncertaintyType: 'confidence_interval', confidenceLevel: 0.95,
    }));
    assert.equal(confidence.status, 'ready');
    assert.equal(confidence.plotRoute.inputContract.uncertaintyType, 'confidence-interval');
    assert.equal(confidence.plotRoute.inputContract.confidenceLevel, 0.95);
  }
  for (const confidenceLevel of [NaN, Infinity, '0.95']) {
    assert.throws(() => generateMatlabPlotScript(uncertaintyRequest({ confidenceLevel })), /confidenceLevel|finite/u);
  }
  assert.throws(() => generateMatlabPlotScript(uncertaintyRequest({
    units: { value: 'degC', uncertainty: 'K' },
  })), /uncertainty unit compatible/u);
  assert.throws(() => generateMatlabPlotScript(uncertaintyRequest({
    uncertaintyRepresentation: 'bounds',
  })), /only for a stated confidence interval/u);
});

test('interactive evaluator consumes fixture uncertainty semantics and verifies raw metadata without expanding evidence', () => {
  const fixture = JSON.parse(readFileSync(new URL('../matlab/evals/fixtures/crossed_time_depth_temperature.json', import.meta.url), 'utf8'));
  const gate = readFileSync(new URL('../matlab/evals/run_matlab_gate.m', import.meta.url), 'utf8');
  const asset = readFileSync(new URL('../matlab/assets/interactive_timeseries_native_template.m', import.meta.url), 'utf8');
  const outputDefinition = /outputs = struct\(([\s\S]*?)\);\s*setappdata\(figure_handle, 'OceanCallerOwnsFigure'/u.exec(asset);
  const metadataDefinition = /line_handle\.UserData = struct\(([\s\S]*?)\);/u.exec(asset);
  assert.ok(outputDefinition);
  assert.ok(metadataDefinition);
  for (const [, field] of gate.matchAll(/\binteractive_output\.([A-Za-z]\w*)/gu)) {
    assert.ok(outputDefinition[1].includes(`'${field}',`), `Missing template output field: ${field}`);
  }
  for (const [, field] of gate.matchAll(/\binteractive_metadata\.([A-Za-z]\w*)/gu)) {
    assert.ok(metadataDefinition[1].includes(`'${field}',`), `Missing line metadata field: ${field}`);
  }
  assert.match(outputDefinition[1], /'UncertaintyUnit', uncertainty_unit/u);
  assert.ok(asset.includes("sprintf('Uncertainty (%s, %s): %.6g'"));
  assert.ok(asset.includes("sprintf('%s (%s): %.6g'"));
  assert.equal(fixture.variables.temperature_standard_uncertainty.type, 'standard_uncertainty');
  const resolved = resolveMatlabPlotRequest(uncertaintyRequest({
    interactive: true,
    uncertaintyType: fixture.variables.temperature_standard_uncertainty.type,
    units: { value: fixture.variables.temperature.unit, uncertainty: fixture.variables.temperature_standard_uncertainty.unit },
  }));
  assert.equal(resolved.status, 'ready');
  assert.equal(resolved.plotRoute.inputContract.uncertaintyType, 'standard-uncertainty');
  assert.match(gate, /interactive_uncertainty_type = replace\(strtrim\(string\([\s\S]*?temperature_fixture\.variables\.temperature_standard_uncertainty\.type\)\), "_", "-"\)/u);
  assert.match(gate, /"UncertaintyType", interactive_uncertainty_type/u);
  assert.match(gate, /"UncertaintyUnit", interactive_uncertainty_unit/u);
  assert.doesNotMatch(gate, /"UncertaintyType", "standard-deviation"/u);
  assert.match(gate, /interactive_output\.UncertaintyType == interactive_uncertainty_type/u);
  assert.match(gate, /isequaln\(interactive_metadata\.Uncertainty, uncertainty\)/u);
  assert.match(gate, /isequaln\(interactive_metadata\.PlottedValue, observation_values\)/u);
  assert.match(gate, /strcmp\(tip_text, expected_uncertainty_tip\)/u);
});

test('interactive generation supports the audited R2019b print fallback', () => {
  const input = deliverable({
    runtime: 'matlab', matlabAvailable: true, taskType: 'interactive', targetRelease: 'R2019b',
    question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'], dataType: 'datetime', timeZone: 'UTC', missing: false,
    qcStatus: 'present', qc: { status: 'present', variable: 'sampleQC', accepted: ['good'], suspect: ['suspect'], rejected: ['bad'], action: 'preserve' },
    observationDimension: 'time', qcAlignment: 'time',
    units: { value: 'degC' }, quantities: { value: 'Sea water temperature' },
  });
  const route = routeMatlabPlot(input);
  assert.equal(route.template, 'interactive_timeseries_native_template.m');
  assert.equal(route.readyForGeneration, true);
  assert.equal(route.apiPlan.exportFormats.png.api, 'print');
  assert.equal(route.apiPlan.exportFormats.pdf.api, 'print');
  const script = generateMatlabPlotScript(input);
  assert.match(script, /targetMatlabRelease = 'R2019b'/u);
  assert.match(script, /targetMatlabVersion = '9\.7'/u);
  assert.match(script, /"png".*"api":"print"/u);
});

test('end-to-end resolver stops invalid, unavailable and Octave-routed requests', () => {
  const invalid = resolveMatlabPlotRequest({ runtime: 'matlab', question: 'unknown-science', dimensions: [10] });
  assert.equal(invalid.status, 'invalid-plot-contract');
  assert.equal(invalid.error.code, 'MATLAB_PLOT_CONTRACT_INVALID');
  assert.equal(invalid.script, null);

  const unavailable = resolveMatlabPlotRequest({ runtime: 'matlab', matlabAvailable: false, question: 'trend' });
  assert.equal(unavailable.status, 'runtime-unavailable');
  assert.equal(unavailable.plotRoute, null);

  const octave = resolveMatlabPlotRequest({ runtime: 'octave', question: 'trend' });
  assert.equal(octave.status, 'routed-to-octave');
  assert.equal(octave.script, null);

  const invalidTask = resolveMatlabPlotRequest({ runtime: 'matlab', taskType: 'decorate', question: 'trend' });
  assert.equal(invalidTask.status, 'needs-input');
  assert.equal(invalidTask.error.code, 'MATLAB_TASK_TYPE_INVALID');
});

test('generated source enforces declared shape, timezone and missing-data status', () => {
  const script = generateMatlabPlotScript(deliverable({
    question: 'trend',
    coordinates: ['time'],
    dimensions: [24],
    dataType: 'datetime',
    timeZone: 'UTC',
    missing: false,
    units: { value: 'degC' },
    quantities: { value: 'Sea water temperature' },
  }));
  assert.match(script, /Datetime TimeZone must match the declared timeZone/u);
  assert.match(script, /Values do not match the declared observation count/u);
  assert.match(script, /Input declares no missing data but missing values were found/u);
  assert.match(script, /may contain NaN but not Inf/u);
  assert.match(script, /exportEntry\.scientific_data_contract = scientificDataContract/u);
  assert.match(script, /scientificDataContract\.missing\.valid_count = plotResult\.ValidCount/u);
});

test('generated helper calls match MATLAB asset option and result contracts', () => {
  const vectorScript = generateMatlabPlotScript(deliverable({
    dimensions: [4, 5], vectorComponents: true, gridType: 'rectilinear', dimensionOrder: ['y', 'x'],
    missing: false, referenceVector: 0.25, componentFrame: 'eastward/northward',
    units: { x: 'km', y: 'km', u: 'm/s', v: 'm/s' },
    quantities: { x: 'East distance', y: 'North distance', u: 'East current', v: 'North current' },
  }));
  for (const token of ["'XUnit'", "'YUnit'", "'VectorUnit'", "'ComponentFrame'", "'ReferenceMagnitude'", 'plotResult.ValidCount']) {
    assert.match(vectorScript, new RegExp(token.replaceAll('.', '\\.'), 'u'));
  }
  assert.doesNotMatch(vectorScript, /ReferenceSpeed|plotResult\.valid_count/u);
});

test('R2020 field generation gates clim with the documented caxis fallback', () => {
  const script = generateMatlabPlotScript(deliverable({
    targetRelease: 'R2020a',
    question: 'field',
    dimensions: [4, 5],
    dimensionOrder: ['y', 'x'],
    gridType: 'regular',
    missing: false,
    colorLimits: [0, 10],
    units: { x: 'km', y: 'km', value: 'degC' },
    quantities: { x: 'East distance', y: 'North distance', value: 'Temperature' },
  }));
  assert.match(script, /exist\('clim', 'file'\).*caxis\(axesHandle, \[0 10\]\)/u);
});

test('rejects malformed dimensions and rank drift instead of dropping extents', () => {
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [24, 0] }),
    /invalid dimensions cannot be dropped/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'field', dimensions: [8, 12], rank: 3 }),
    /rank must equal/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: 2 }),
    /must be an array/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'relationship', dimensions: [12], dimensionOrder: ['sample', 'sample'] }),
    /length must match|must be unique/u,
  );
  const script = generateMatlabPlotScript(deliverable({
    question: 'trend', coordinates: ['time'], dimensions: [24, 3], dimensionOrder: ['time', 'series'],
    dataType: 'datetime', timeZone: 'UTC', missing: false,
    units: { value: 'degC' }, quantities: { value: 'Sea water temperature' },
  }));
  assert.match(script, /size\(values, 1\) == numel\(time\)/u);
  assert.match(script, /isequal\(size\(values\), \[24 3\]\)/u);
});

test('rejects placeholder units and ambiguous local time contracts', () => {
  const route = routeMatlabPlot({
    question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'], dataType: 'datetime',
    timeZone: 'UTC', missing: false, qcStatus: 'absent',
    units: { value: 'unknown' }, quantities: { value: 'Temperature' },
  });
  assert.ok(route.unresolvedRequirements.includes('units.value'));
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [12], timeZone: 'local' }),
    /IANA-style source timezone/u,
  );
});

test('requires explicit disjoint QC semantics and generates auditable QC counts', () => {
  const incomplete = routeMatlabPlot({
    question: 'trend', coordinates: ['time'], dimensions: [12], hasQC: true,
    qc: { accepted: ['1'] },
  });
  assert.ok(incomplete.unresolvedRequirements.includes('qcPolicy.suspect codes (use [] when none)'));
  assert.ok(incomplete.unresolvedRequirements.includes('qcPolicy.rejected codes (use [] when none)'));
  assert.throws(
    () => routeMatlabPlot({
      question: 'trend', coordinates: ['time'], dimensions: [12], hasQC: true,
      qc: { accepted: ['1'], suspect: ['1'], rejected: [], action: 'preserve' },
    }),
    /mutually exclusive/u,
  );

  const script = generateMatlabPlotScript(deliverable({
    question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'], dataType: 'datetime',
    timeZone: 'UTC', missing: false, qcStatus: 'present', observationDimension: 'time',
    qc: { status: 'present', variable: 'temperatureQC', alignment: 'time', accepted: ['1', '2'], suspect: ['3'], rejected: ['4'], action: 'preserve' },
    variableNames: { time: 'sampleTime', value: 'temperature', qcFlag: 'temperatureQC' },
    units: { value: 'degC' }, quantities: { value: 'Sea water temperature' },
  }));
  assert.match(script, /function result = make_ocean_figure\(sampleTime, temperature, temperatureQC\)/u);
  assert.match(script, /QC flags must match the primary value array exactly/u);
  assert.match(script, /qcAcceptedCodes = \["1" "2"\]/u);
  assert.match(script, /Every QC flag must map to accepted, suspect or rejected/u);
  assert.match(script, /'suspect_count', sum\(qcSuspectMask, 'all'\)/u);
  assert.doesNotMatch(script, /temperature\(qcRejectedMask\)\s*=\s*NaN/u);
});

test('confidence intervals require explicit semantics and generate asymmetric bounds safely', () => {
  const unresolved = routeMatlabPlot({
    question: 'uncertainty', hasUncertainty: true, uncertaintyType: 'confidence-interval',
    coordinates: ['time'], dimensions: [12], units: { value: 'degC', uncertainty: 'degC' },
  });
  assert.ok(unresolved.unresolvedRequirements.includes('uncertaintyRepresentation (magnitude/bounds)'));
  assert.ok(unresolved.unresolvedRequirements.includes('confidenceLevel between 0 and 1'));

  const script = generateMatlabPlotScript(deliverable({
    question: 'uncertainty', hasUncertainty: true, uncertaintyType: 'confidence-interval',
    uncertaintyRepresentation: 'bounds', confidenceLevel: 0.95,
    observationDimension: 'time', uncertaintyAlignment: 'time',
    coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'], dataType: 'datetime', timeZone: 'UTC', missing: true,
    units: { value: 'degC', uncertainty: 'degC' }, quantities: { value: 'Sea water temperature' },
    variableNames: { time: 'sampleTime', value: 'meanValue', uncertaintyLower: 'lower95', uncertaintyUpper: 'upper95' },
  }));
  assert.match(script, /function result = make_ocean_figure\(sampleTime, meanValue, lower95, upper95\)/u);
  assert.match(script, /Confidence bounds must enclose every complete value/u);
  assert.match(script, /lowerError = meanValue - lower95/u);
  assert.match(script, /errorbar\(axesHandle, sampleTime, meanValue, lowerError, upperError/u);
  assert.match(script, /confidence level: 0\.95/u);
});

test('geospatial generation enforces declared ranges, monotonic coordinates and dateline policy', () => {
  const incomplete = routeMatlabPlot({
    question: 'map', coordinates: ['longitude', 'latitude'], dimensions: [3, 4],
    longitudeConvention: '[0, 360]',
  });
  assert.ok(incomplete.unresolvedRequirements.includes('datelinePolicy (none/prewrapped)'));

  const script = generateMatlabPlotScript(deliverable({
    question: 'map', coordinates: ['longitude', 'latitude'], dimensions: [3, 4],
    dimensionOrder: ['latitude', 'longitude'], gridType: 'rectilinear',
    longitudeConvention: '[0, 360]', datelinePolicy: 'none', missing: false,
    colorLimits: [5, 30], units: { longitude: 'degree_east', latitude: 'degree_north', value: 'degC' },
    quantities: { longitude: 'Longitude', latitude: 'Latitude', value: 'Sea surface temperature' },
  }));
  assert.match(script, /longitude >= 0 & longitude <= 360/u);
  assert.match(script, /Longitude must be unique and monotonic after the declared dateline policy/u);
  assert.match(script, /latitude >= -90 & latitude <= 90/u);
  assert.match(script, /no implicit reversal is performed/u);
});

test('direction routing refuses radian data for a degree-only native helper', () => {
  const route = routeMatlabPlot({
    question: 'direction', dimensions: [36], directionConvention: 'from', directionNormalization: 'percent',
    missing: false, qcStatus: 'absent', units: { direction: 'rad', weight: '1' },
    quantities: { direction: 'Wind direction' },
  });
  assert.ok(route.unresolvedRequirements.includes('units.direction must be degrees clockwise from true north'));
});

test('generator rejects variable names that collide after sanitization', () => {
  assert.throws(() => generateMatlabPlotScript(deliverable({
    question: 'relationship', dimensions: [12], missing: false,
    units: { x: 'degC', y: 'degC' }, quantities: { x: 'Observed temperature', y: 'Modeled temperature' },
    variableNames: { x: 'sameName', y: 'sameName' },
  })), /variableNames must be unique/u);
});

test('end-to-end resolver consumes the task-level nested scientific data contract', () => {
  const resolved = resolveMatlabPlotRequest(deliverable({
    runtime: 'matlab', matlabAvailable: true, question: 'trend',
    qcStatus: undefined, missingRepresentation: undefined,
    dataContract: {
      dataType: 'datetime', shape: [12], dimensionOrder: ['time'], observationDimension: 'time',
      coordinates: ['time'], timeZone: 'UTC', coordinateDirections: { time: 'increasing' },
      quantities: { value: 'Sea water temperature' }, units: { value: 'degC' },
      missing: { status: 'present', representation: 'NaN', maskVariables: ['missing', 'invalid', 'suspect'] },
      qc: {
        status: 'present', variable: 'temperatureQC', alignment: 'time',
        flagMeanings: { 1: 'good', 3: 'suspect', 4: 'bad' },
      },
      uncertainty: { status: 'absent' },
    },
  }));
  assert.equal(resolved.status, 'ready');
  assert.deepEqual(resolved.plotRoute.inputContract.shape, [12]);
  assert.equal(resolved.plotRoute.qcPolicy.variable, 'temperatureQC');
  assert.deepEqual(resolved.plotRoute.qcPolicy.accepted, ['1']);
  assert.match(resolved.script, /function result = make_ocean_figure\(time, values, temperatureQC\)/u);
  assert.match(resolved.script, /qcSuspectCodes = \["3"\]/u);
});

test('publication contract controls physical canvas, layout, typography and honest verification state', () => {
  const publicationContract = completePublicationContract();
  const input = deliverable({
    runtime: 'matlab', matlabAvailable: true, requirePublicationContract: true, publicationContract,
    question: 'trend', coordinates: ['time'], dimensions: [24], dimensionOrder: ['time'],
    dataType: 'datetime', timeZone: 'UTC', missing: false,
    units: { value: 'degC' }, quantities: { value: 'Sea water temperature' },
  });
  const resolved = resolveMatlabPlotRequest(input);
  assert.equal(resolved.status, 'ready');
  assert.equal(resolved.plotRoute.publicationPolicy.target.widthPixels, 2126);
  assert.equal(resolved.plotRoute.publicationPolicy.target.heightPixels, 1417);
  assert.equal(resolved.plotRoute.publicationPolicy.typography.lineWidthPt, 1.3);
  assert.equal(resolved.plotRoute.accessibilityPolicy.artifactVerificationStatus, 'not-run-by-router');
  assert.match(resolved.script, /publicationWidthPixels = 2126/u);
  assert.match(resolved.script, /layoutHandle = tiledlayout\(figureHandle, 1, 1, 'TileSpacing', 'compact', 'Padding', 'compact'\)/u);
  assert.match(resolved.script, /fontCandidates = \["Helvetica"\]/u);
  assert.match(resolved.script, /theme\.FontSize = 9/u);
  assert.match(resolved.script, /LineWidth', 1\.3/u);
  assert.match(resolved.script, /qualityFigureSizeInches = double\(figureHandle\.Position\(3:4\)\)/u);
  assert.match(resolved.script, /exportEntry\.rendering_evidence\.bounds_audited && exportEntry\.rendering_evidence\.physical_dimensions_verified/u);
  assert.match(resolved.script, /exportEntry\.publication\.contract = publicationContract/u);
  assert.match(resolved.script, /exportEntry\.publication\.typography\.selected_font = selectedFontName/u);
  assert.doesNotMatch(resolved.script, /exportEntry\.publication = publicationContract/u);
  assert.doesNotMatch(resolved.script, /publicationContract\.layout\.clipped_count/u);
  assert.doesNotMatch(resolved.script, /publicationContract\.typography\.glyphs_verified/u);
  assert.match(resolved.script, /exportEntry\.accessibility\.grayscale_status = "not-verified"/u);
  assert.doesNotMatch(resolved.script, /'ContrastRatio', 4\.5/u);
});

test('static generators establish physical canvas and page margins before axes on every audited release', () => {
  for (const targetRelease of ['R2021a', 'R2024b', 'R2026a']) {
    for (const architecture of ['single-axes', 'tiledlayout']) {
      for (const target of [{ width: 6, height: 4, units: 'in', dpi: 150 }, { width: 18, height: 12, units: 'cm', dpi: 600 }]) {
        const publicationContract = completePublicationContract();
        Object.assign(publicationContract.target, target);
        publicationContract.layout.architecture = architecture;
        publicationContract.headless.exportApi = targetRelease === 'R2026a' ? 'exportgraphics' : 'print';
        const resolved = resolveMatlabPlotRequest(deliverable({
          runtime: 'matlab', matlabAvailable: true, targetRelease, publicationContract,
          question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'],
          dataType: 'datetime', timeZone: 'UTC', missing: false,
          units: { value: 'degC' }, quantities: { value: 'Temperature' },
        }));
        assert.equal(resolved.status, 'ready', JSON.stringify({ targetRelease, architecture, target }));
        const { script } = resolved;
        const inchesPerUnit = target.units === 'cm' ? 1 / 2.54 : 1;
        assert.ok(script.includes(`publicationWidthPixels = ${Math.round(target.width * inchesPerUnit * target.dpi)};`));
        assert.ok(script.includes(`publicationHeightPixels = ${Math.round(target.height * inchesPerUnit * target.dpi)};`));
        assert.ok(script.includes(`publicationDpi = ${target.dpi};`));
        assert.match(script, /publicationSizeInches = \[publicationWidthPixels publicationHeightPixels\] \/ publicationDpi;/u);
        assert.match(script, /publicationPageMargin = min\(0\.25 \.\/ publicationSizeInches, 0\.1\);/u);
        const figureIndex = script.indexOf('figureHandle = oi_figure(');
        const sizingIndex = script.indexOf('figureHandle.Position(3:4) = publicationSizeInches;');
        const axesIndex = script.indexOf(architecture === 'tiledlayout' ? 'layoutHandle = tiledlayout(' : 'axesHandle = axes(');
        const plotIndex = script.indexOf('graphicsHandle = plot(');
        assert.ok(figureIndex < sizingIndex && sizingIndex < axesIndex && axesIndex < plotIndex);
        const physicalSetup = script.slice(sizingIndex, axesIndex);
        assert.match(physicalSetup, /figureHandle\.PaperPosition = \[0 0 publicationSizeInches\];/u);
        assert.match(physicalSetup, /figureHandle\.PaperSize = publicationSizeInches;/u);
        assert.match(physicalSetup, /figureHandle\.PaperPositionMode = 'manual';/u);
        const layoutSetup = script.slice(axesIndex, plotIndex);
        assert.match(layoutSetup, /\.OuterPosition = \[publicationPageMargin 1 - 2 \* publicationPageMargin\];/u);
        assert.match(layoutSetup, /PositionConstraint = 'outerposition'/u);
        assert.match(script, /abs\(qualityFigureSizeInches - publicationSizeInches\) <= 1e-6/u);
        assert.match(script, /abs\(figureHandle\.PaperSize - publicationSizeInches\) <= 1e-6/u);
        assert.match(script, /abs\(figureHandle\.PaperPosition - \[0 0 publicationSizeInches\]\) <= 1e-6/u);
        assert.match(script, /'plot:PaperSize'/u);
        assert.doesNotMatch(script.slice(plotIndex), /figureHandle\.(?:Position|PaperPosition|PaperSize)(?:\(3:4\))? =/u);
        assert.doesNotMatch(script, /figureHandle\.Units = 'pixels'|ScreenPixelsPerInch|round\(figureHandle\.Position/u);
        assert.match(script, /runtime_margins_inches = exportEntry\.rendering_evidence\.normalized_margins \.\* \[qualityFigureSizeInches qualityFigureSizeInches\]/u);
        assert.doesNotMatch(script, /qualityTightInset|qualityMargins = max|qualityAxesPosition/u);
        assert.equal(resolved.plotRoute.apiPlan.exportFormats.png.api, publicationContract.headless.exportApi);
      }
    }
  }
});

test('interactive generators pass nondefault physical dimensions into the template before rendering', () => {
  const asset = readFileSync(new URL('../matlab/assets/interactive_timeseries_native_template.m', import.meta.url), 'utf8');
  assert.ok(asset.indexOf("'Units', 'inches'") < asset.indexOf('layout = tiledlayout('));
  assert.match(asset, /publication_size = \[options\.PublicationWidthPixels options\.PublicationHeightPixels\] \.\.\.\s*\/ options\.PublicationDPI/u);
  assert.match(asset, /layout\.OuterPosition = \[page_margin 1 - 2 \* page_margin\]/u);
  for (const targetRelease of ['R2021a', 'R2024b', 'R2026a']) {
    for (const interactionEnvironment of ['auto', 'headless', 'desktop']) {
      const publicationContract = completePublicationContract({ interactionMode: 'dual' });
      Object.assign(publicationContract.target, { width: 6, height: 4, units: 'in', dpi: 450 });
      publicationContract.headless.exportApi = targetRelease === 'R2026a' ? 'exportgraphics' : 'print';
      const script = generateMatlabPlotScript(deliverable({
        taskType: 'interactive', targetRelease, interactionEnvironment, publicationContract,
        question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'],
        observationDimension: 'time', dataType: 'datetime', timeZone: 'UTC', missing: false,
        qc: { status: 'present', variable: 'qcFlag', alignment: 'time', accepted: ['good'], suspect: [], rejected: ['bad'], action: 'preserve' },
        units: { value: 'degC' }, quantities: { value: 'Temperature' },
      }));
      assert.match(script, /publicationWidthPixels = 2700;\s*publicationHeightPixels = 1800;\s*publicationDpi = 450;/u);
      const templateCall = script.split('\n').find((line) => line.startsWith('interactionPlot = '));
      assert.match(templateCall, /'PublicationWidthPixels', publicationWidthPixels, 'PublicationHeightPixels', publicationHeightPixels, 'PublicationDPI', publicationDpi/u);
      assert.match(templateCall, /'Export', false/u);
      assert.doesNotMatch(script, /figureHandle = oi_figure|figureHandle\.Position\(3:4\) =|figureHandle\.Units = 'pixels'/u);
      assert.match(script, /qualityFigureSizeInches - publicationSizeInches/u);
      assert.ok(script.indexOf('qualityFigureSizeInches = ') > script.indexOf('figureHandle = interactionPlot.Figure;'));
      assert.match(script, /'plot:PaperSize'/u);
      assert.match(script, /exportEntry\.interaction\.interaction_verified = false/u);
    }
  }
});

test('exact font probes preserve explicit candidate order and bind the selected theme to export evidence', () => {
  for (const targetRelease of ['R2021a', 'R2024b', 'R2026a']) {
    for (const interactive of [false, true]) {
      for (const candidates of [['Noto Sans CJK SC', 'WenQuanYi Zen Hei'], ['WenQuanYi Zen Hei', 'Noto Sans CJK SC']]) {
        const publicationContract = completePublicationContract({ chineseRequired: true, interactionMode: interactive ? 'dual' : 'static' });
        publicationContract.typography.fontFamily = candidates[0];
        publicationContract.typography.fallbackFamilies = candidates.slice(1);
        publicationContract.headless.exportApi = targetRelease === 'R2026a' ? 'exportgraphics' : 'print';
        const input = deliverable({
          targetRelease, publicationContract, title: '海温观测',
          question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'],
          dataType: 'datetime', timeZone: 'UTC', missing: false,
          units: { value: 'degC' }, quantities: { value: '海水温度' },
          ...(interactive ? {
            taskType: 'interactive', observationDimension: 'time',
            qc: { status: 'present', variable: 'qcFlag', alignment: 'time', accepted: ['good'], suspect: [], rejected: ['bad'], action: 'preserve' },
          } : {}),
        });
        const before = structuredClone(input);
        const script = generateMatlabPlotScript(input);
        assert.deepEqual(input, before);
        assert.deepEqual(routeMatlabPlot(input).publicationPolicy.typography.fontCandidates, candidates);
        assert.ok(script.includes(`fontCandidates = [${candidates.map((name) => JSON.stringify(name)).join(' ')}];`));
        assert.match(script, /if oi_font_available\(fontCandidates\(fontCandidateIndex\), availableFontNames\)\s*selectedFontName = fontCandidates\(fontCandidateIndex\);\s*break;/u);
        assert.match(script, /assert\(strlength\(selectedFontName\) > 0, 'plot:FontUnavailable'/u);
        assert.doesNotMatch(script, /if any\(strcmpi\(fontCandidates|selectedFontName = "(?:Noto|WenQuanYi)/u);
        const fontIndex = script.indexOf('theme.FontName = selectedFontName;');
        const figureIndex = script.indexOf(interactive ? 'figureHandle = interactionPlot.Figure;' : 'figureHandle = oi_figure(');
        const cacheIndex = script.indexOf("setappdata(figureHandle, 'OI_OceanTheme', theme);");
        const exportIndex = script.indexOf('exportEntry = oi_export_figure(');
        const evidenceIndex = script.indexOf("'plot:ExportFontMismatch'");
        assert.ok(fontIndex < figureIndex && figureIndex < cacheIndex && cacheIndex < exportIndex && exportIndex < evidenceIndex);
        assert.match(script, /exportedFontNames = string\(exportEntry\.publication\.typography\.selected_fonts\)/u);
        assert.match(script, /font_selection_verified && ~isempty\(exportedFontNames\) && all\(strcmpi\(exportedFontNames, selectedFontName\), 'all'\)/u);
        assert.ok(evidenceIndex < script.indexOf('exportEntry.publication.typography.selected_font = selectedFontName;'));
        assert.doesNotMatch(script, /(?:glyphs_verified|pdf_fonts_embedded|visual_inspection_verified) = true/u);
      }
    }
  }
});

test('implicit theme fonts use the same exact probe without adding a generator fallback preference', () => {
  const script = generateMatlabPlotScript(deliverable({
    question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'],
    dataType: 'datetime', timeZone: 'UTC', missing: false,
    units: { value: 'degC' }, quantities: { value: 'Temperature' },
  }));
  assert.match(script, /selectedFontName = string\(theme\.FontName\);/u);
  assert.match(script, /assert\(oi_font_available\(selectedFontName, availableFontNames\), 'plot:FontUnavailable'/u);
  assert.doesNotMatch(script, /any\(strcmpi\(selectedFontName, availableFontNames\)\)|fontCandidates =|WenQuanYi|Noto/u);
  assert.match(script, /set\(figureHandle, 'DefaultAxesFontName', selectedFontName, 'DefaultTextFontName', selectedFontName/u);
});

test('Chinese output requires a runtime CJK font and never fabricates glyph verification', () => {
  const script = generateMatlabPlotScript(deliverable({
    publicationContract: completePublicationContract({ chineseRequired: true }),
    title: '南海海表温度', question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'],
    dataType: 'datetime', timeZone: 'Asia/Shanghai', missing: false,
    units: { value: 'degC' }, quantities: { value: '海表温度' },
  }));
  assert.match(script, /availableFontNames = string\(listfonts\)/u);
  assert.match(script, /cjkFontCandidates = \["Noto Sans CJK SC"/u);
  assert.match(script, /plot:CJKFontUnavailable/u);
  assert.match(script, /title\(axesHandle, '南海海表温度'.*'Interpreter', 'none'/u);
  assert.doesNotMatch(script, /publicationContract\.typography\.cjk_verified/u);
  assert.match(script, /glyph_artifact_status = "not-verified"/u);

  assert.throws(() => routeMatlabPlot({
    publicationContract: completePublicationContract({ chineseRequired: false }),
    title: '南海海表温度', question: 'trend', coordinates: ['time'], dimensions: [12],
  }), /chineseRequired=false/u);
});

test('English publication contracts apply the declared text interpreter after helper rendering', () => {
  const publicationContract = completePublicationContract();
  publicationContract.typography.interpreter = 'tex';
  const script = generateMatlabPlotScript(deliverable({
    publicationContract, question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'],
    dataType: 'datetime', timeZone: 'UTC', missing: false,
    units: { value: 'degC' }, quantities: { value: 'Temperature_{sea}' },
  }));
  assert.match(script, /axesHandle\.XLabel\.Interpreter = 'tex'/u);
  assert.match(script, /axesHandle\.TickLabelInterpreter = 'tex'/u);
  assert.match(script, /interpreterHandles\(interpreterIndex\)\.Interpreter = 'tex'/u);
});

test('interactive generation makes automatic, forced-headless and desktop-only behavior explicit', () => {
  const common = deliverable({
    runtime: 'matlab', matlabAvailable: true, taskType: 'interactive', targetRelease: 'R2024b',
    question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'],
    observationDimension: 'time', dataType: 'datetime', timeZone: 'UTC', missing: false,
    qc: { status: 'present', variable: 'qcFlag', alignment: 'time', accepted: ['good'], suspect: [], rejected: ['bad'], action: 'preserve' },
    units: { value: 'degC' }, quantities: { value: 'Temperature' },
  });
  const automatic = generateMatlabPlotScript(common);
  assert.match(automatic, /desktopAvailable = usejava\('desktop'\)/u);
  assert.match(automatic, /interactionRequested = desktopAvailable/u);
  assert.match(automatic, /static-fallback-not-interactive/u);
  assert.match(automatic, /exportEntry\.interaction\.requested = true/u);
  assert.match(automatic, /exportEntry\.interaction\.enabled = logical\(interactionEnabled\)/u);
  assert.match(automatic, /exportEntry\.interaction\.headless\.verified = logical\(~interactionEnabled\)/u);
  assert.match(automatic, /exportEntry\.interaction\.interaction_verified = false/u);
  assert.match(automatic, /exportEntry\.interaction\.static_fallback_used = logical\(~interactionEnabled\)/u);
  assert.doesNotMatch(automatic, /exportEntry\.interaction = struct/u);

  const headless = generateMatlabPlotScript({ ...common, interactionEnvironment: 'headless' });
  assert.match(headless, /interactionRequested = false/u);
  assert.doesNotMatch(headless, /plot:DesktopRequired/u);

  const desktop = generateMatlabPlotScript({ ...common, interactionEnvironment: 'desktop' });
  assert.match(desktop, /assert\(desktopAvailable, 'plot:DesktopRequired'/u);
  assert.match(desktop, /interactionRequested = true/u);
  assert.throws(() => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [12], interactionEnvironment: 'headless' }), /interactive MATLAB task/u);
});

test('field routing refuses color guesses and emits accessible centered diverging code', () => {
  const unresolved = routeMatlabPlot({
    question: 'field', dimensions: [4, 5], dimensionOrder: ['y', 'x'], gridType: 'regular',
    units: { x: 'km', y: 'km', value: 'cm' }, quantities: { x: 'East', y: 'North', value: 'Sea-level anomaly' },
  });
  assert.ok(unresolved.unresolvedRequirements.includes('colorSemantics (sequential/diverging)'));
  assert.throws(() => routeMatlabPlot({ question: 'field', dimensions: [4, 5], colorSemantics: 'jet' }), /unsupported palettes/u);
  assert.throws(() => routeMatlabPlot({
    question: 'field', dimensions: [4, 5], colorSemantics: 'diverging', colorReference: 0, colorLimits: [-2, 3],
  }), /symmetric about colorReference/u);

  const script = generateMatlabPlotScript(deliverable({
    question: 'field', dimensions: [4, 5], dimensionOrder: ['y', 'x'], gridType: 'regular', missing: false,
    colorSemantics: 'diverging', colorReference: 0, colorLimits: [-3, 3],
    units: { x: 'km', y: 'km', value: 'cm' }, quantities: { x: 'East', y: 'North', value: 'Sea-level anomaly' },
  }));
  assert.match(script, /colormap\(axesHandle, theme\.DivergingMap\)/u);
  assert.match(script, /referenceContourHandle.*\[0 0\].*'LineStyle', '--'/u);
  assert.match(script, /color_vision_status = "not-verified"/u);
});

test('generator rejects publication requests it cannot honor exactly', () => {
  const multiplePanels = completePublicationContract();
  multiplePanels.layout.rows = 2;
  assert.throws(() => routeMatlabPlot({
    publicationContract: multiplePanels, question: 'trend', coordinates: ['time'], dimensions: [12],
  }), /single-route generator requires a 1-by-1/u);

  const pngOnly = completePublicationContract();
  pngOnly.target.formats = ['png'];
  assert.throws(() => generateMatlabPlotScript(deliverable({
    publicationContract: pngOnly, outputFormats: ['png'], question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'],
    dataType: 'datetime', timeZone: 'UTC', missing: false,
    units: { value: 'degC' }, quantities: { value: 'Temperature' },
  })), /outputFormats must include png and pdf/u);
});

test('release-aware SVG generation preserves format and records verified metadata', () => {
  const publicationContract = completePublicationContract();
  publicationContract.target.formats = ['png', 'pdf', 'svg'];
  publicationContract.localization.glyphFormats = ['png', 'pdf', 'svg'];
  publicationContract.headless.exportApi = 'print';
  publicationContract.headless.exportApis = { png: 'print', pdf: 'print', svg: 'print' };
  const input = deliverable({
    runtime: 'matlab', matlabAvailable: true, targetRelease: 'R2024b', outputFormats: ['png', 'pdf', 'svg'],
    publicationContract, question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'],
    dataType: 'datetime', timeZone: 'UTC', missing: false,
    units: { value: 'degC' }, quantities: { value: 'Temperature' },
  });
  const resolved = resolveMatlabPlotRequest(input);
  assert.equal(resolved.status, 'ready');
  assert.equal(resolved.plotRoute.apiPlan.exportFormats.png.api, 'print');
  assert.equal(resolved.plotRoute.apiPlan.exportFormats.svg.api, 'print');
  assert.equal(resolved.plotRoute.publicationPolicy.headless.exportApis.svg, 'print');
  const script = resolved.script;
  assert.match(script, /oi_export_figure\([\s\S]*'ExportSVG', true, 'RequiredToolboxes', requiredToolboxLabels\)/u);
  assert.match(script, /exportEntry\.export_contract\.actual_svg_api = exportEntry\.runtime\.export_api\.svg/u);
  assert.doesNotMatch(script, /local_sha256_file|local_xml_escape|StaleSvgArtifact/u);

  const modernContract = structuredClone(publicationContract);
  modernContract.headless.exportApi = 'exportgraphics';
  modernContract.headless.exportApis = { png: 'exportgraphics', pdf: 'exportgraphics', svg: 'exportgraphics' };
  const modern = generateMatlabPlotScript({ ...input, targetRelease: 'R2025a', publicationContract: modernContract });
  assert.match(modern, /'ExportSVG', true/u);
  assert.doesNotMatch(modern, /local_sha256_file|local_xml_escape/u);
});

for (const [targetRelease, expectedApi] of [
  ['R2021a', 'print'], ['R2024b', 'print'], ['R2025a', 'exportgraphics'], ['R2026a', 'exportgraphics'],
]) {
  test(`${targetRelease} audited route, runtime spec and generated metadata agree on ${expectedApi}`, () => {
    const capabilitiesBefore = structuredClone(MATLAB_RELEASE_CAPABILITY_MATRIX);
    const publicationContract = completePublicationContract();
    publicationContract.target.formats = ['png', 'pdf', 'svg'];
    publicationContract.localization.glyphFormats = ['png', 'pdf', 'svg'];
    publicationContract.headless.exportApi = expectedApi;
    publicationContract.headless.exportApis = { png: expectedApi, pdf: expectedApi, svg: expectedApi };
    const request = deliverable({
      runtime: 'matlab', matlabAvailable: true, targetRelease, outputFormats: ['png', 'pdf', 'svg'],
      publicationContract, question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'],
      dataType: 'datetime', timeZone: 'UTC', missing: false,
      units: { value: 'degC' }, quantities: { value: 'Temperature' },
    });
    const originalRequest = structuredClone(request);
    const { question, ...runtimeInput } = request;
    const resolved = routeMatlabRuntimeRequest({ ...runtimeInput, plotInput: { question } });
    assert.equal(resolved.status, 'ready', resolved.error?.reason);
    const route = resolved.plotRoute;
    assert.equal(route.apiPlan.export.api, 'exportgraphics');
    assert.equal(route.apiPlan.export.status, 'native');
    assert.equal(route.apiPlan.exportSizing.status, expectedApi === 'print' ? 'fallback' : 'native');
    assert.equal(resolved.taskRoute.capabilities.capabilities.exportgraphics.status, 'native');
    const expectedApis = { png: expectedApi, pdf: expectedApi, svg: expectedApi };
    assert.equal(resolved.publicationContract.headless.exportApi, expectedApi);
    assert.deepEqual(resolved.publicationContract.headless.exportApis, expectedApis);
    assert.deepEqual(route.publicationPolicy.headless.exportApis, expectedApis);
    const scriptContract = decodedScriptContract(resolved.script, 'exportEntry.export_contract');
    const scriptPublication = decodedScriptContract(resolved.script, 'publicationContract');
    assert.deepEqual(scriptContract.strategies, route.apiPlan.exportFormats);
    assert.deepEqual(scriptPublication.headless.exportApis, expectedApis);
    for (const format of ['png', 'pdf', 'svg']) {
      assert.equal(route.apiPlan.exportFormats[format].api, expectedApi);
      assert.equal(resolved.outputContract.exportStrategies[format].api, expectedApi);
      assert.equal(resolved.outputContract.exportStrategies[format].exactSizingRequired, true);
    }
    assert.match(resolved.script, new RegExp(`release-aware APIs: png=${expectedApi}, pdf=${expectedApi}, svg=${expectedApi}`, 'u'));
    assert.match(resolved.script, /actual_png_pdf_api = exportEntry\.runtime\.export_api\.png/u);
    assert.match(resolved.script, /actual_svg_api = exportEntry\.runtime\.export_api\.svg/u);
    assert.doesNotMatch(resolved.script, /exportEntry\.runtime\.(?:export_api|exportgraphics_available|exact_exportgraphics_available)\s*=/u);
    assert.deepEqual(request, originalRequest);
    assert.deepEqual(MATLAB_RELEASE_CAPABILITY_MATRIX, capabilitiesBefore);
    assert.equal(selectMatlabExportStrategy(targetRelease, 'png').api, 'exportgraphics');

    const { publicationContract: omittedContract, ...withoutPublication } = request;
    const defaults = resolveMatlabPlotRequest(withoutPublication);
    assert.equal(defaults.status, 'ready', defaults.error?.reason);
    assert.equal(defaults.plotRoute.publicationPolicy.headless.exportApi, expectedApi);
    assert.deepEqual(defaults.plotRoute.publicationPolicy.headless.exportApis, expectedApis);
    assert.equal(defaults.taskRoute.outputContract.exportStrategies.png.api, expectedApi);

    const perFormatOnly = structuredClone(request);
    delete perFormatOnly.publicationContract.headless.exportApi;
    const mapped = resolveMatlabPlotRequest(perFormatOnly);
    assert.equal(mapped.status, 'ready', mapped.error?.reason);
    assert.equal(mapped.plotRoute.readyForGeneration, true);
    assert.deepEqual(mapped.plotRoute.publicationPolicy.headless.exportApis, expectedApis);
  });
}

function decodedScriptContract(script, variable) {
  const expression = new RegExp(`${variable.replaceAll('.', '\\.')} = jsondecode\\('((?:[^']|'')*)'\\);`, 'u');
  const match = script.match(expression);
  assert.ok(match, `Missing generated ${variable}`);
  return JSON.parse(match[1].replaceAll("''", "'"));
}

test('audited generator rejects old general API declarations without silently rewriting them', () => {
  for (const targetRelease of ['R2021a', 'R2024b']) {
    const publicationContract = completePublicationContract();
    const request = deliverable({ runtime: 'matlab', matlabAvailable: true, targetRelease,
      publicationContract, question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'],
      dataType: 'datetime', timeZone: 'UTC', missing: false,
      units: { value: 'degC' }, quantities: { value: 'Temperature' } });
    const generic = routeMatlabRuntimeRequest(request);
    assert.equal(generic.status, 'ready');
    assert.equal(generic.outputContract.exportStrategies.png.api, 'exportgraphics');
    const resolved = resolveMatlabPlotRequest(request);
    assert.equal(resolved.status, 'needs-input');
    assert.equal(resolved.script, null);
    assert.match(resolved.error.reason, /headless.exportApi matching target release \(print\)/u);
    assert.throws(() => generateMatlabPlotScript(request), /headless.exportApi matching target release \(print\)/u);
    assert.equal(publicationContract.headless.exportApi, 'exportgraphics');
    assert.equal(routeMatlabPlot(request).readyForGeneration, false);

    publicationContract.headless.exportApi = '';
    const missingDeclaration = resolveMatlabPlotRequest(request);
    assert.equal(missingDeclaration.status, 'needs-input');
    assert.equal(routeMatlabPlot(request).readyForGeneration, false);
  }
});

test('audited export metadata matches asset exact geometry and callable P-code probe', () => {
  const asset = readFileSync(new URL('../matlab/assets/oi_export_figure.m', import.meta.url), 'utf8');
  assert.match(asset, /exportGraphicsAvailable && ~verLessThan\('matlab', '25\.1'\)/u);
  assert.match(asset, /exist\('exportgraphics', 'file'\) == \[2 3 6\]/u);
  assert.match(asset, /exist\('exportgraphics', 'builtin'\) == 5/u);
  assert.match(asset, /"Units", "inches", "Width", widthInches, "Height", heightInches/u);
  assert.match(asset, /"Padding", "figure", "PreserveAspectRatio", "on"/u);
  assert.match(asset, /exportgraphics\(figureHandle, pngPath, "Units", "pixels", \.\.\.\s+"Width", widthPixels, "Height", heightPixels, "Resolution", dpi, \.\.\.\s+"Padding", "figure", "PreserveAspectRatio", "on"/u);
  assert.match(asset, /exportgraphics\(figureHandle, pdfPath, geometryArgs\{:\}, "ContentType", "vector"\)/u);
  assert.match(asset, /exportgraphics\(figureHandle, svgPath, geometryArgs\{:\}\)/u);
  assert.match(asset, /pngApi = "exportgraphics";\s+pngSizeUnits = "pixels";\s+else\s+pngApi = "print";\s+pngSizeUnits = "inches";/u);
  assert.match(asset, /"export_size_units", struct\("png", pngSizeUnits, "pdf", "inches"\)/u);
  assert.match(asset, /if svgRequested\s+evidence\.export_size_units\.svg = "inches";/u);
  assert.doesNotMatch(asset, /exportgraphics\(figureHandle, pngPath, geometryArgs|\bimresize\s*\(/u);
  assert.match(asset, /export_fallback_reason = "exact sizing parameters require MATLAB R2025a"/u);
});

test('generator preflight rejects unavailable runtimes and toolboxes before emitting code', () => {
  const input = deliverable({
    runtime: 'matlab', targetRelease: 'R2024b', question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'],
    dataType: 'datetime', timeZone: 'UTC', missing: false,
    units: { value: 'degC' }, quantities: { value: 'Temperature' },
  });
  assert.throws(() => generateMatlabPlotScript({ ...input, matlabAvailable: false }), /runtime-unavailable/u);
  assert.throws(() => generateMatlabPlotScript({ ...input, runtime: 'octave' }), /routed-to-octave/u);
  assert.throws(() => generateMatlabPlotScript({
    ...input, requiredToolboxes: ['signal'], toolboxAvailability: { signal: false },
  }), /missing-toolbox/u);

  const script = generateMatlabPlotScript({
    ...input, matlabAvailable: true, requiredToolboxes: ['signal'], toolboxAvailability: { signal: true },
  });
  assert.match(script, /requiredToolboxIds = \["signal"\]/u);
  assert.match(script, /requiredToolboxLabels = \["Signal Processing Toolbox"\]/u);
  assert.match(script, /license\('test', requiredToolboxLicenseFeatures\(requiredToolboxIndex\)\)/u);
  assert.match(script, /'RequiredToolboxes', requiredToolboxLabels/u);
  assert.match(script, /exportEntry\.runtime\.authoritative_runtime = 'MATLAB'/u);
  assert.match(script, /exportEntry\.runtime\.octave_substitution = false/u);
  assert.doesNotMatch(script, /exportEntry\.runtime = struct/u);
});

test('generator rejects unsupported or incomplete format sets without substitution', () => {
  const input = deliverable({
    runtime: 'matlab', targetRelease: 'R2024b', question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time'],
    dataType: 'datetime', timeZone: 'UTC', missing: false,
    units: { value: 'degC' }, quantities: { value: 'Temperature' },
  });
  assert.throws(() => generateMatlabPlotScript({ ...input, outputFormats: ['svg'] }), /must include png and pdf/u);
  assert.throws(
    () => generateMatlabPlotScript({ ...input, outputFormats: ['png', 'pdf', 'jpeg'] }),
    /limited to png,pdf,svg/u,
  );
});

test('routes supported Chinese scientific questions and coordinate aliases deterministically', () => {
  const timeSeries = routeMatlabPlot({
    question: '时间序列', coordinates: ['时间'], dimensions: [12], dimensionOrder: ['时间'], observationDimension: '时间',
  });
  assert.equal(timeSeries.plotType, 'time-series');
  assert.equal(timeSeries.selectionReason.priority, 'scientific-question');
  assert.equal(timeSeries.selectionReason.scientificQuestion, '时间序列');
  assert.deepEqual(timeSeries.selectionReason.coordinateEvidence, ['time']);
  assert.deepEqual(timeSeries.inputContract.dimensionOrder, ['time']);
  assert.equal(timeSeries.inputContract.observationDimension, 'time');

  const section = routeMatlabPlot({ question: '海洋断面', coordinates: ['断面距离', '深度'], dimensions: [20, 30] });
  assert.equal(section.plotType, 'section');
  assert.deepEqual(section.selectionReason.coordinateEvidence, ['depth', 'distance']);

  const surface = routeMatlabPlot({ question: '三维表面', dimensions: [20, 30] });
  assert.equal(surface.plotType, 'surface');

  const script = generateMatlabPlotScript(deliverable({
    runtime: 'matlab', matlabAvailable: true, title: '南海温度时间序列', source: '已核验观测',
    question: '时间趋势', coordinates: ['时间'], dimensions: [12], dimensionOrder: ['time'],
    dataType: 'datetime', timeZone: 'Asia/Shanghai', missing: false,
    units: { value: 'degC' }, quantities: { value: '海水温度' },
  }));
  assert.match(script, /function result = make_ocean_figure\(time, values\)/u);
  assert.match(script, /Selection reason: time-series communicates ordered time evolution; selected from scientific question=时间趋势/u);
  assert.match(script, /Units preserved: \{"value":"degC"\}/u);
  assert.match(script, /assert\(strcmp\(string\(time\.TimeZone\), 'Asia\/Shanghai'\)/u);
  assert.ok(script.includes('"coordinates":{"names":["time"],"timeZone":"Asia/Shanghai"'));
});

test('rejects unknown, duplicated and pseudo-boolean coordinate declarations', () => {
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time', 'mystery-axis'], dimensions: [12] }),
    /Unknown coordinate name: mystery-axis/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time', 'datetime'], dimensions: [12, 1] }),
    /unique after alias normalization/u,
  );
  assert.throws(
    () => routeMatlabPlot({ dimensions: [12], coordinates: { time: 'false' } }),
    /Coordinate flag time must be boolean/u,
  );
  assert.throws(
    () => routeMatlabPlot({ dimensions: [12], coordinates: { mystery: false } }),
    /Unknown coordinate name: mystery/u,
  );
});

test('rejects duplicate and conflicting plot aliases before normalization', () => {
  assert.throws(
    () => routeMatlabPlot({ scientificQuestion: 'trend', question: 'map', coordinates: ['time'], dimensions: [12] }),
    /duplicate aliases/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], axes: ['depth'], dimensions: [12] }),
    /duplicate aliases/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], shape: [12], dimensions: [13] }),
    /duplicate aliases/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [12], targetRelease: 'R2024b', matlabRelease: 'R2025a' }),
    /duplicate aliases/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: ['trend'], coordinates: ['time'], dimensions: [12] }),
    /question must be a string/u,
  );
});

test('rejects coerced, unsafe and structurally ambiguous dimension metadata', () => {
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: ['12'] }),
    /cannot be coerced or dropped/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [Number.MAX_SAFE_INTEGER + 1] }),
    /safe-integer numeric extents/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'field', dimensions: [Number.MAX_SAFE_INTEGER, 2] }),
    /element count exceeds/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [12], dimensionOrder: ['time', ''] }),
    /dimensionOrder entries must be non-empty/u,
  );
  assert.throws(
    () => routeMatlabPlot({ coordinates: ['time', 'longitude', 'latitude'], dimensions: [12, 30, 40], longitudeConvention: '[-180, 180]' }),
    /explicit slice or reduction/u,
  );
});

test('rejects structured metadata and invalid generator identifiers instead of guessing', () => {
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [12], units: { value: { unit: 'degC' } } }),
    /structured values are not inferred/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [12], vectorComponents: 'false' }),
    /vectorComponents must be boolean/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'field', dimensions: [4, 5], colorLimits: ['0', '1'] }),
    /string values are not coerced/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'vector', dimensions: [4, 5], vectorComponents: true, stride: '2' }),
    /stride must be a positive safe integer/u,
  );
  assert.throws(
    () => generateMatlabPlotScript(deliverable({
      runtime: 'matlab', matlabAvailable: true, question: 'trend', coordinates: ['time'], dimensions: [12],
      dimensionOrder: ['time'], dataType: 'datetime', timeZone: 'UTC', missing: false,
      units: { value: 'degC' }, quantities: { value: 'Temperature' },
      functionName: "bad');system('attack')",
    })),
    /Invalid MATLAB identifier/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [12], functionName: ['safeName'] }),
    /MATLAB identifiers must be strings/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [12], figureId: '../outside' }),
    /without path separators or traversal/u,
  );
});

test('accepts normalized coordinate objects and stops adversarial requests end to end', () => {
  const normalized = routeMatlabPlot({
    question: 'trend', dimensions: [12], dataType: 'datetime',
    coordinates: { names: ['time'], timeZone: 'Pacific/Auckland', directions: { time: 'strictly-increasing' } },
  });
  assert.equal(normalized.plotType, 'time-series');
  assert.equal(normalized.unresolvedRequirements.includes('timeZone'), false);

  const resolved = resolveMatlabPlotRequest({
    runtime: 'matlab', matlabAvailable: true, question: 'trend', dimensions: [12],
    coordinates: ['time', 'unknown-observation-axis'],
  });
  assert.equal(resolved.status, 'invalid-plot-contract');
  assert.equal(resolved.ready, false);
  assert.equal(resolved.script, null);
  assert.equal(resolved.error.code, 'MATLAB_PLOT_CONTRACT_INVALID');
  assert.match(resolved.error.reason, /Unknown coordinate name/u);

  const octave = resolveMatlabPlotRequest({
    runtime: 'octave', question: 'trend', dimensions: [12], coordinates: ['unknown-observation-axis'],
  });
  assert.equal(octave.status, 'routed-to-octave');
  assert.equal(octave.plotRoute, null);
  assert.equal(octave.script, null);
});

test('closed-world plot routing blocks typos, nested semantic overrides and path escape', () => {
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [12], qusetion: 'map' }),
    /Unknown MATLAB request fields/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', dataContract: { question: 'map', shape: [12] } }),
    /Unknown fields in dataContract/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [12], outputDirectory: '../escape' }),
    /parent-directory traversal/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [12], assetDirectory: 'https://example.test/assets' }),
    /not a URI/u,
  );

  const nestedOctave = resolveMatlabPlotRequest({
    runtime: 'matlab', question: 'trend', dataContract: { shape: [12], requiresOctaveRender: true },
  });
  assert.equal(nestedOctave.status, 'needs-input');
  assert.equal(nestedOctave.error.code, 'MATLAB_REQUEST_INVALID');
  assert.notEqual(nestedOctave.status, 'routed-to-octave');
});

test('closed-world plot routing enforces bounded arrays, strings and nesting', () => {
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: Array.from({ length: 257 }, () => 'time'), dimensions: [12] }),
    /array limit/u,
  );
  assert.throws(
    () => routeMatlabPlot({ question: 'trend', coordinates: ['time'], dimensions: [12], title: '温'.repeat(16385) }),
    /string limit/u,
  );
  const request = { question: 'trend', coordinates: ['time'], dimensions: [12], variableNames: {} };
  let cursor = request.variableNames;
  for (let index = 0; index < 9; index += 1) {
    cursor.value = {};
    cursor = cursor.value;
  }
  assert.throws(() => routeMatlabPlot(request), /maximum JSON depth/u);
});
