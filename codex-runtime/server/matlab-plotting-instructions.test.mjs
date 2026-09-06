import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import {
  MATLAB_PLOTTING_INSTRUCTIONS,
  matlabPlotRequestResolutionBlock,
  matlabPlottingInstructions,
} from './matlab-plotting-instructions.mjs';
import { matlabPlotRoutingInstructionBlock } from './matlab-plot-router.mjs';

const repositorySkill = readFileSync(new URL('../matlab/SKILL.md', import.meta.url), 'utf8');
const repositoryReadme = readFileSync(new URL('../matlab/README.md', import.meta.url), 'utf8');
const evaluationReadme = readFileSync(new URL('../matlab/evals/README.md', import.meta.url), 'utf8');
const matlabAssetDirectory = new URL('../matlab/assets/', import.meta.url);
const matlabAssets = readdirSync(matlabAssetDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.m'))
  .map((entry) => entry.name);
const octaveOnlyHelpers = [
  'oi_resolve_font', 'oi_configure_graphics', 'oi_panel_grid', 'oi_stable_legend',
  'oi_plot_timeseries', 'oi_plot_field', 'oi_plot_geospatial_field', 'oi_plot_taylor_diagram',
  'oi_plot_target_diagram', 'oi_plot_ensemble', 'oi_plot_reliability_diagram', 'oi_export_png',
];

test('exports the complete Chinese MATLAB plotting contract with native repository helpers', () => {
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /运行时检测与兼容性/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /MATLAB 是本规范的权威运行时/u);
  const injected = matlabPlottingInstructions();
  assert.match(injected, /MATLAB release 能力矩阵/u);
  assert.match(injected, /禁止以 Octave 执行/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /MATLAB-first 仅探测 matlab/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /Octave-first 才探测 octave-cli、octave/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /仓库模板优先/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_ocean_theme/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_time_series/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_export_figure/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /surface\/view\(2\)、contourf/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_profile/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_vector_field/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /MATLAB 仓库尚无经纬度场或通用标量场专用 helper/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_section/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_comparison/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /MATLAB 仓库尚无 Taylor、target、ensemble、reliability 专用绘图 helper/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_hovmoller/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_ts_diagram/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_spectrum/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_direction_rose/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /MATLAB 原生 tiledlayout\/nexttile/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /legend\(axesHandle, seriesHandles, labels\)/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_font_available/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /实际选中 FontName 写回 theme 和 OI_OceanTheme 缓存/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /不得依赖 subplot 默认挤压/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /不得混用风来向、流去向和波来向/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /零频和非正谱值不得混入对数轴/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /不得用装饰性曲线冒充密度诊断/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /时间–深度图优先调用 oi_plot_hovmoller/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /禁止用填补值伪造海底以下数据/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /默认禁止静默裁点/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /不得把普通 Cartesian 坐标轴描述成地图投影/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /缺测 u\/v 分量不得被静默当作零值/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /不跨缺测连接不确定性带/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /专业视觉与科学表达/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /MATLAB 使用 -batch 或等价无头模式/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /JSON manifest/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /用户可见相对引用前缀/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /不得暴露宿主绝对路径/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /interactive_timeseries_native_template\.m/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /DataTipTemplate/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /brush\(figureHandle, "on"\)/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /Interactive=true/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /Interactive=false/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /event\.Target/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /不得在回调中搜索 gca、gcf/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /BrushData/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /ObservationID/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /关闭图窗时禁用 brush\/datacursormode/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /linkdata\(fig, "off"\)/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /uifigure 完整界面交付可使用 exportapp/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /显式要求 exportapp 时不得静默降级/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /确定性路由思路/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /MATLAB-first 任务分诊与状态契约/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /runtime-unavailable/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /missing-toolbox/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /unsupported-output/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /execution_verified=false/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /requireScientificContract=true/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /scientificDataContract/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /dimensionOrder/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /datetime\/timetable/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /missing\/invalid\/suspect/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /uncertainty/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /depth\/pressure\/height\/elevation/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /requirePublicationContract=true/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /publicationContract/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /最低 4\.5 对比度/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /CJK fallback/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /R2019a/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /try\/catch\/exit/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /headless\.exportApis/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /schema_version=2/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /outputContract/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /对抗输入门禁/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /Date\/Map\/类实例和自定义原型对象/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /runtime\/requestedRuntime/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /plotInput 与兼容别名 plot 互斥/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /MATLAB_REQUEST_INVALID/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /禁止展开对象时静默覆盖/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /JSON boolean/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /控制字符/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /exit\(0\)/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /PNG\/PDF\/SVG 分别检查真实字形/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /mode="dual"/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /Visible="off"/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /matlab -batch/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /inspectMatlabPlotQuality 八项标准/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /MATLAB 智能选图与脚本生成路由/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /listfonts 或 fc-list 精确安装证据按声明候选链选择 CJK 字体/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /静态 fallback 必须记录 interaction_verified=false/u);
});

test('every MATLAB helper and template recommendation resolves to a real native asset', () => {
  const actualPlotHelpers = matlabAssets.filter((name) => name.startsWith('oi_plot_'))
    .map((name) => name.slice(0, -2)).sort();
  assert.equal(actualPlotHelpers.length, 9);
  const contexts = [MATLAB_PLOTTING_INSTRUCTIONS, matlabPlottingInstructions(),
    ...['R2019b', 'R2021a', 'R2024b', 'R2026a'].map((matlabRelease) =>
      matlabPlottingInstructions({ runtime: 'MATLAB', matlabRelease }))];
  for (const instructions of contexts) {
    const helpers = [...new Set(instructions.match(/\boi_[a-z0-9_]+\b/gu))];
    assert.deepEqual(helpers.filter((name) => name.startsWith('oi_plot_')).sort(), actualPlotHelpers);
    for (const helper of helpers) {
      const filename = `${helper}.m`;
      assert.ok(matlabAssets.includes(filename), `MATLAB recommendation has no asset: ${filename}`);
      const asset = readFileSync(new URL(filename, matlabAssetDirectory), 'utf8');
      assert.match(asset, new RegExp(`^function[^\\n]*\\b${helper}\\(`, 'u'), filename);
    }
    const templates = [...new Set(instructions.match(/\b[A-Za-z][A-Za-z0-9_]*\.m\b/gu))];
    assert.ok(templates.includes('interactive_timeseries_native_template.m'));
    for (const template of templates) {
      assert.ok(matlabAssets.includes(template), `MATLAB recommendation has no template: ${template}`);
    }
    for (const helper of octaveOnlyHelpers) {
      assert.ok(!helpers.includes(helper), `Octave-only helper leaked into MATLAB instructions: ${helper}`);
    }
    assert.doesNotMatch(instructions, /xvfb-run|优先 Noto Sans CJK SC，其次 WenQuanYi Zen Hei|使用 gnuplot 导出时/u);
  }
});

test('native helper guidance preserves data contracts and reports unsupported plot families honestly', () => {
  const instructions = matlabPlottingInstructions();
  assert.match(instructions, /oi_plot_time_series\(axesHandle, data, options\)/u);
  assert.match(instructions, /data 为 table\/timetable/u);
  assert.match(instructions, /ValueVariables、ValueUnits、时区、QC 与不确定度语义/u);
  assert.match(instructions, /保留观测值 NaN 缺口，输入时间不得 NaT，必须严格递增且唯一/u);
  assert.doesNotMatch(instructions, /保留 NaN\/NaT 空档/u);
  const timeSeriesAsset = readFileSync(new URL('oi_plot_time_series.m', matlabAssetDirectory), 'utf8');
  assert.match(timeSeriesAsset, /~any\(isnat\(rowTimes\)\), "oi_plot_time_series:InvalidTime"/u);
  assert.match(timeSeriesAsset, /assert\(all\(diff\(rowTimes\) > seconds\(0\)\), "oi_plot_time_series:TimeOrder"/u);
  assert.match(instructions, /GapThreshold 明确分段/u);
  assert.match(instructions, /当前服务器静态时间序列仍为内联 plot\/errorbar 路径/u);
  assert.match(instructions, /未经声明不得自动重排字段列/u);
  assert.match(instructions, /投影需求须核对产品、工具箱与 release/u);
  assert.match(instructions, /plot\/scatter\/errorbar\/patch\/polaraxes/u);
  assert.match(instructions, /needs-input、missing-toolbox 或相应不支持状态/u);
  assert.match(instructions, /单图生成器收到多面板请求仍须拒绝/u);
  assert.match(instructions, /不得臆造仓库 helper、模板或强行通过现有路由/u);
  assert.match(instructions, /未明确的 3-D 不得路由到 surf/u);
  assert.match(instructions, /使用原生 surf 并验证维度、坐标与单位/u);
  const unsupported = matlabPlotRequestResolutionBlock({ runtime: 'matlab', question: 'taylor' });
  assert.match(unsupported, /状态：invalid-plot-contract/u);
  assert.doesNotMatch(unsupported, /function result =/u);
});

test('runtime selection keeps common scientific and interaction gates without foreign helper requirements', () => {
  for (const runtime of ['matlab', 'octave']) {
    const instructions = matlabPlottingInstructions({ runtime });
    for (const term of ['requireScientificContract=true', 'shape', 'dimensionOrder', 'observationDimension',
      'TimeZone', 'sourceUnit', 'targetUnit', 'formula', 'missing/invalid/suspect', 'uncertainty',
      'requirePublicationContract=true', 'ObservationID', 'event.Target/DataIndex', '清理',
      'mode="dual"', 'inspectMatlabPlotQuality', 'MATLAB_REQUEST_INVALID', 'needs-input']) {
      assert.ok(instructions.includes(term), `${runtime} dropped gate: ${term}`);
    }
  }
  const octave = matlabPlottingInstructions({ runtime: 'octave' });
  assert.match(octave, /GNU Octave 是本规范的权威运行时/u);
  assert.doesNotMatch(octave, /MATLAB 是本规范的权威运行时|interactive_timeseries_native_template\.m|oi_font_available|oi_plot_time_series\b/u);
  assert.match(octave, /interaction、interactive、examples 和 tests/u);
  assert.match(octave, /交互与静态导出保持双路径/u);
  assert.match(octave, /静态结果不依赖点击、hover 或桌面回调/u);
});

test('builds deterministic default injection context without side effects', () => {
  const options = Object.freeze({});
  const first = matlabPlottingInstructions(options);
  const second = matlabPlottingInstructions(options);

  assert.equal(first, second);
  assert.match(first, /仓库根目录：\./u);
  assert.match(first, /优先模板目录：\.\/codex-runtime\/matlab/u);
  assert.match(first, /绘图输出目录：generated/u);
  assert.match(first, /manifest 路径：generated\/figures\.json/u);
  assert.match(first, /报告引用前缀：generated/u);
  assert.match(first, /MATLAB 智能选图与脚本生成路由/u);
  assert.match(first, /time\+depth 二维场→hovmoller/u);
  assert.equal(Object.keys(options).length, 0);
});

test('MATLAB injection reuses the single router instruction builder without a copied block', () => {
  const routingBlock = matlabPlotRoutingInstructionBlock();
  for (const instructions of [MATLAB_PLOTTING_INSTRUCTIONS, matlabPlottingInstructions(),
    ...['R2021a', 'R2024b', 'R2026a'].map((matlabRelease) =>
      matlabPlottingInstructions({ runtime: 'matlab', matlabRelease }))]) {
    assert.equal(instructions.split(routingBlock).length - 1, 1);
  }
  assert.ok(!matlabPlottingInstructions({ runtime: 'octave' }).includes(routingBlock));
  const consumerSource = readFileSync(new URL('./matlab-plotting-instructions.mjs', import.meta.url), 'utf8');
  assert.match(consumerSource, /import \{ matlabPlotRoutingInstructionBlock, resolveMatlabPlotRequest \} from '\.\/matlab-plot-router\.mjs'/u);
  assert.doesNotMatch(consumerSource, /MATLAB_ROUTING_INSTRUCTIONS|【MATLAB 智能选图与脚本生成路由】/u);
});

test('keeps rendered geometry and native array evidence distinct from visual approval', () => {
  for (const instructions of [MATLAB_PLOTTING_INSTRUCTIONS, matlabPlottingInstructions()]) {
    assert.match(instructions, /layout\.Text 无公开 Units\/Extent\/Position/u);
    assert.match(instructions, /不能用零矩形当成完整几何/u);
    assert.match(instructions, /仅 drawnow 可能保留占位文字 Extent/u);
    assert.match(instructions, /测量探针放在独立隐藏图中/u);
    assert.match(instructions, /源图最终实测几何/u);
    assert.match(instructions, /scientific_data_contract\.plot_data_evidence/u);
    assert.match(instructions, /完整数组、顺序、缺失掩码、单位、策略、release 和输入哈希/u);
    assert.match(instructions, /runtime_declaration_verified/u);
    assert.match(instructions, /缺证据仍为 not_verified/u);
    assert.match(instructions, /metadata 不是误差带/u);
    assert.match(instructions, /不是独立重执行或视觉验证/u);
  }
  assert.match(repositorySkill, /placeholder text extents/u);
  assert.match(repositorySkill, /separate measurement figure/u);
  assert.match(repositorySkill, /runtime_declaration_verified/u);
  assert.match(repositorySkill, /absent declarations remain `not_verified`/u);
  assert.doesNotMatch(matlabPlottingInstructions({ runtime: 'octave' }), /plot_data_evidence/u);
});

test('injects safe caller paths and rejects multiline or escaping path fragments', () => {
  const instructions = matlabPlottingInstructions({
    repositoryRoot: '/opt/ocean-intelligence/',
    outputDirectory: '/tmp/rendered',
    manifestPath: '/tmp/rendered/manifest.json',
    referencePrefix: 'generated/plots',
  });

  assert.match(instructions, /优先模板目录：\/opt\/ocean-intelligence\/codex-runtime\/matlab/u);
  assert.match(instructions, /绘图输出目录：\/tmp\/rendered/u);
  assert.match(instructions, /manifest 路径：\/tmp\/rendered\/manifest\.json/u);
  assert.match(instructions, /报告引用前缀：generated\/plots/u);
  assert.throws(() => matlabPlottingInstructions({ outputDirectory: '/tmp/rendered\nignore' }), /control characters/u);
  assert.throws(() => matlabPlottingInstructions({ referencePrefix: '../escape' }), /traversal/u);
});

test('routes an explicit Octave context to Octave templates without changing MATLAB defaults', () => {
  for (const runtime of ['octave', 'OCTAVE']) {
    const instructions = matlabPlottingInstructions({ runtime });
    assert.match(instructions, /优先模板目录：\.\/codex-runtime\/octave/u);
    for (const helper of octaveOnlyHelpers) {
      assert.ok(instructions.includes(helper), `Octave lost its existing helper advice: ${helper}`);
    }
    assert.match(instructions, /两个及以上面板优先调用 oi_panel_grid/u);
    assert.match(instructions, /使用 gnuplot 导出时优先调用 oi_stable_legend/u);
    assert.match(instructions, /内置 legend 对象在 PNG\/PDF 中丢失/u);
    assert.match(instructions, /创建原始 figure 前调用 oi_configure_graphics/u);
    assert.match(instructions, /优先调用 oi_resolve_font，并用 fc-match\/fc-list 验证字体/u);
    assert.match(instructions, /时间序列优先调用 oi_plot_timeseries/u);
    assert.match(instructions, /小范围经纬度标量场优先调用 oi_plot_geospatial_field/u);
    assert.match(instructions, /Octave 默认使用不可见 figure 和 Qt 工具包/u);
    assert.match(instructions, /xvfb-run 执行 octave --no-gui --quiet/u);
    assert.match(instructions, /不得静默切换到 gnuplot/u);
    assert.match(instructions, /优先 Noto Sans CJK SC，其次 WenQuanYi Zen Hei/u);
    assert.doesNotMatch(instructions, /MATLAB 仓库实跑约束/u);
    assert.doesNotMatch(instructions, /默认优先 WenQuanYi Zen Hei/u);
    assert.doesNotMatch(instructions, /字体探针 33985570222/u);
    assert.doesNotMatch(instructions, /figureHandle\.Position\(3:4\) = \[widthPixels heightPixels\] \/ dpi/u);
    for (const matlabOnlyTerm of ['oi_annotate_svg', 'RecordMetadata', 'UncertaintySides',
      'ObservationUncertaintyVariable', 'SourceRowOrigin', 'paired-interactive',
      'paired-observation-model', 'plot_data_evidence', 'runtime_declaration_verified',
      'legend.title', 'matlab.graphics.illustration.legend.Text', 'unmeasured_text_objects',
      '--rendered-audit', 'pdf_font_embedding', '3/4', '4/4', '34001173593',
      'test_comparison_record_metadata', 'test_comparison_native_evidence',
      '36/36', 'JVMRequired', 'RootObjects', 'test_native_pdf_fixture_canvas',
      'parseOceanEvidenceTime', 'Astra']) {
      assert.ok(!instructions.includes(matlabOnlyTerm), `MATLAB-only evidence leaked into Octave: ${matlabOnlyTerm}`);
    }
    assert.deepEqual(repositoryExportTable(instructions), []);
  }
});

test('sets final inches before plot construction without weakening clipping gates', () => {
  for (const instructions of [MATLAB_PLOTTING_INSTRUCTIONS, matlabPlottingInstructions()]) {
    assert.match(instructions, /输入是屏幕 pixels，不是最终输出的物理尺寸/u);
    assert.match(instructions, /绘图前、创建 axes\/tiledlayout 前设置 figureHandle\.Units = "inches"/u);
    assert.match(instructions, /figureHandle\.Position\(3:4\) = \[widthPixels heightPixels\] \/ dpi/u);
    assert.match(instructions, /1200 x 675 输出像素在 300 DPI 下是 4 x 2\.25 inches/u);
    assert.match(instructions, /OuterPosition\/外框约束和真实页边距，或 tiledlayout 的 Padding\/TileSpacing/u);
    assert.match(instructions, /不得放宽裁切\/遮挡门禁、忽略对象或改写 manifest/u);
  }
  assert.match(repositorySkill, /final inches before creating axes/u);
  assert.match(repositorySkill, /figureHandle\.Position\(3:4\) = \[widthPixels heightPixels\] \/ dpi;/u);
  assert.match(repositorySkill, /Fix the layout rather than relaxing clipping\/overlap gates/u);
});

test('distinguishes general API availability from the repository exact export policy', () => {
  const expectedTable = [
    ['R2019b-R2024b', 'print -dpng', 'print -dpdf', 'print -dsvg'],
    ['R2025a+', 'exact exportgraphics', 'exact exportgraphics', 'exact exportgraphics'],
  ];
  assert.deepEqual(repositoryExportTable(repositorySkill), expectedTable);
  assert.deepEqual(repositoryExportTable(MATLAB_PLOTTING_INSTRUCTIONS), expectedTable);
  for (const matlabRelease of ['R2019b', 'R2020a', 'R2021a', 'R2024b', 'R2025a', 'R2026a']) {
    const instructions = matlabPlottingInstructions({ runtime: 'matlab', matlabRelease });
    assert.deepEqual(repositoryExportTable(instructions), expectedTable, matlabRelease);
    assert.match(instructions, matlabRelease === 'R2019b'
      ? /exportgraphics: 明确降级/u
      : /exportgraphics: 原生 \(R2020a\+\)/u);
    assert.ok(instructions.indexOf('【MATLAB 仓库实跑约束】') > instructions.indexOf('【MATLAB release 能力矩阵】'));
    assert.match(instructions, /通用 exportgraphics 自 R2020a 可用/u);
    assert.match(instructions, /oi_export_figure \+ oi_write_manifest 的严格固定尺寸路径/u);
    assert.match(instructions, /失败必须保留错误并停止，不得静默 print 重试/u);
    assert.match(instructions, /逐图、逐格式记录实际 export_api，并与 runtime 一致/u);
  }
  assert.match(repositorySkill, /General `exportgraphics` is available from R2020a/u);
  assert.match(repositorySkill, /never silently retry with `print`/u);
  assert.match(repositorySkill, /actual per-figure, per-format `export_api` consistently with runtime evidence/u);
  assert.match(repositorySkill, /`export_size_units`/u);
});

test('injects verified native sizing without treating it as full visual or CI approval', () => {
  for (const instructions of [MATLAB_PLOTTING_INSTRUCTIONS, matlabPlottingInstructions(),
    ...['R2021a', 'R2024b', 'R2026a'].map((matlabRelease) =>
      matlabPlottingInstructions({ runtime: 'matlab', matlabRelease }))]) {
    const repositoryBlock = instructions.slice(instructions.indexOf('【MATLAB 仓库实跑约束】'));
    assert.match(repositoryBlock, /R2025a\+ 的 exact exportgraphics 按格式指定尺寸/u);
    assert.match(repositoryBlock, /PNG 使用 Units="inches"、Width=widthPixels\/dpi、Height=heightPixels\/dpi、Resolution=dpi 和 PreserveAspectRatio="off"/u);
    assert.match(repositoryBlock, /PDF\/SVG 使用相同物理尺寸的 Units="inches"、Width=widthPixels\/dpi、Height=heightPixels\/dpi 和 PreserveAspectRatio="on"/u);
    assert.match(repositoryBlock, /两类均保留 Padding="figure"/u);
    assert.match(repositoryBlock, /绘图前的 figure\/layout 仍保持最终 inches/u);
    assert.match(repositoryBlock, /不能把原生 PNG 的尺寸参数误作屏幕画布单位/u);
    assert.match(repositoryBlock, /runtime\.export_size_units 按实际路径记录：原生 PNG、print PNG、PDF 及请求的 SVG 均为 inches/u);
    assert.match(repositoryBlock, /包含 R2026a PNG inches\/off 的三版全量原生尺寸回归/u);
    assert.match(repositoryBlock, /三幅 unit-circle 的局部像素宽高差不超过 2 个边缘像素/u);
    assert.match(repositoryBlock, /不是全图视觉保证/u);
    assert.match(repositoryBlock, /pixels\/off 实图字体缩小、刻度变多，不采用该路径/u);
    assert.match(repositoryBlock, /不做导出后 resize，不通过重采样、裁切或填边掩盖尺寸错误/u);
    assert.doesNotMatch(repositoryBlock, /本次 PNG inches\/off 策略尚待跨版本全量 CI 验证/u);
    assert.match(repositoryBlock, /每次新图必须重新检查真实 PNG 像素\/DPI、字体、刻度、裁切、PDF 页尺寸及 SVG 几何，未验证项保持 unverified/u);
    assert.doesNotMatch(instructions, /PNG 使用 Units="?pixels|两类均保留 Padding="figure" 和 PreserveAspectRatio="on"/u);
  }
  assert.doesNotMatch(matlabPlottingInstructions({ runtime: 'octave' }), /runtime\.export_size_units|本次 PNG inches\/off 策略/u);
});

test('scopes SVG processing and distinguishes passing stages from failed CI and canvas diagnostics', () => {
  for (const repositoryBlock of repositoryInstructionBlocks()) {
    assert.match(repositoryBlock, /oi_annotate_svg 只对受支持的 SVG 子集/u);
    assert.match(repositoryBlock, /保留内部原生 viewBox 和绘图坐标/u);
    assert.match(repositoryBlock, /XML 后处理，不是未经处理的纯原生 SVG/u);
    assert.match(repositoryBlock, /有限的三版 MATLAB Java DOM 验证/u);
    assert.match(repositoryBlock, /不授权未知或不支持的 SVG，必须拒绝/u);
    assert.match(repositoryBlock, /不得泛化覆盖或降低尺寸门禁/u);
    assert.match(repositoryBlock, /不代表本次会话已执行、已部署或既有会话热更新/u);
    const current = repositoryBlock.split('### 当前结果\n')[1];
    assert.ok(current);
    assert.match(current, /CI 34001173593（远端 7d51e714）/u);
    assert.match(current, /R2021a\/R2024b\/R2026a 主阶段各 20\/20，合计 60\/60/u);
    assert.match(current, /evaluator-runtime 三版 passed/u);
    assert.match(current, /evaluator-result\.json 原始评分为 90、状态仍为 runtime_pending/u);
    assert.match(current, /整体 CI 为 completed\/failure，视觉未验证/u);
    assert.match(current, /oi_apply_axes 对 Subtitle 显式应用 theme\.FontSize/u);
    assert.match(current, /comparison-statistics-layout 的字幕扰动\/restyle 字号断言已原生通过，断言不放宽/u);
    assert.match(current, /R2021a 四 case 为 build_native_pdf_fixture_case:JVMRequired/u);
    assert.match(current, /R2024b 四 case 为 test_native_pdf_fixture_canvas:RootObjects/u);
    assert.match(current, /scribeOverlay 的空 AnnotationPane/u);
    assert.match(current, /MATLAB:class:GetProhibited，不能当作完整测量/u);
    assert.match(current, /两版 canvas_pdf\.api_invoked=false/u);
    assert.match(current, /R2026a 的 not_applicable 不是 pass/u);
    assert.match(current, /captured 快照也不证明几何不变或恢复成功/u);
    assert.match(current, /不计入原三 candidate stage、评分或正式报告产物/u);
    assert.match(current, /不依赖 JVM 的 snapshot SHA/u);
    assert.match(current, /只排除严格空 AnnotationPane，非空仍拒绝/u);
    assert.match(current, /尚未 native 执行，不能声称已修复 GetProhibited、canvas PDF、恢复或视觉问题/u);
    assert.match(repositoryBlock, /OI_ColorAccessibilityRole="uncertainty"/u);
    assert.match(repositoryBlock, /不改变数据、掩码或审计算法/u);
    assert.match(repositoryBlock, /不能用角色标记豁免任意数据线/u);
    assert.doesNotMatch(current, /唯一主阶段失败|诊断尚未 MATLAB 执行|原始评分均为 (?:0|100)/u);
  }
});

test('documents observation-only uncertainty as an explicit native API without inventing model inputs', () => {
  for (const repositoryBlock of repositoryInstructionBlocks()) {
    assert.match(repositoryBlock, /oi_plot_comparison 必须显式 opt-in/u);
    for (const term of ['UncertaintySides="observation"', 'ObservationUncertainty',
      'ObservationUncertaintyVariable', 'UncertaintyType', '"standard-uncertainty"',
      '与 QuantityUnit 相同的 UncertaintyUnit', 'result.Uncertainty',
      'provided/not_provided', 'GraphicsMask']) {
      assert.ok(repositoryBlock.includes(term), `Missing observation uncertainty contract: ${term}`);
    }
    assert.match(repositoryBlock, /完全省略 ModelUncertainty\/ModelUncertaintyVariable，不能补零或复制/u);
    assert.match(repositoryBlock, /ModelQC 仅可来自真实输入，未提供保持 not_provided，不得造值/u);
    assert.match(repositoryBlock, /缺观测不确定度保留有限且 QC 接受的散点和统计/u);
    assert.match(repositoryBlock, /只是不画该点的水平区间/u);
    assert.match(repositoryBlock, /默认 UncertaintySides="both" 的双侧契约不变/u);
    assert.match(repositoryBlock, /仅在实际创建的不确定度 Line 写入 OI_ColorAccessibilityRole="uncertainty"/u);
    assert.match(repositoryBlock, /不能用角色标记豁免任意数据线/u);
  }
  const comparisonAsset = readFileSync(new URL('oi_plot_comparison.m', matlabAssetDirectory), 'utf8');
  assert.match(comparisonAsset, /oi_get_option\(options,"UncertaintySides","both"\)/u);
  assert.match(comparisonAsset, /"ObservationUncertaintyVariable"/u);
  assert.match(comparisonAsset, /~isfield\(options,"ModelUncertainty"\) && ~isfield\(options,"ModelUncertaintyVariable"\)/u);
  assert.match(comparisonAsset, /uncertaintyUnit == quantityUnit/u);
});

test('keeps comparison record metadata strict, row-aligned and optional', () => {
  for (const repositoryBlock of repositoryInstructionBlocks()) {
    assert.match(repositoryBlock, /RecordMetadata 仅适用于 numeric row-aligned 输入，不适用于 table\/timetable 配对/u);
    assert.match(repositoryBlock, /scalar struct，且只能包含 ID、Time、Depth、DepthUnit、DepthDirection/u);
    assert.match(repositoryBlock, /ID 是每输入行一个、唯一非空的 string 向量/u);
    assert.match(repositoryBlock, /Time 是逐行对齐、非 NaT 的 UTC datetime 向量/u);
    assert.match(repositoryBlock, /Depth 是逐行对齐、实数有限非负的 numeric 向量/u);
    assert.match(repositoryBlock, /DepthUnit="m"、DepthDirection="positive_down"/u);
    assert.match(repositoryBlock, /SampleLabels 必须与全部 ID 一致/u);
    assert.match(repositoryBlock, /匹配的 string 或 cellstr 向量均合法/u);
    assert.match(repositoryBlock, /不能同时使用 SampleLabelVariable/u);
    assert.match(repositoryBlock, /RecordMetadata\.ID 仍必须是 string 向量/u);
    assert.match(repositoryBlock, /result\.RecordData 保留全部原始行、观测\/模型值、时间、深度和身份/u);
    assert.match(repositoryBlock, /result\.QC 保留实际提供的 flags 或 not_provided/u);
    assert.match(repositoryBlock, /Scatter\/水平 Line 的 UserData 绑定选中 RecordID、SourceRow 和 SourceRowOrigin="call_entry_order"/u);
    assert.match(repositoryBlock, /省略 RecordMetadata 保持原 numeric\/tabular 调用兼容，不造记录身份，也不生成 RecordData/u);
  }
  const comparisonAsset = readFileSync(new URL('oi_plot_comparison.m', matlabAssetDirectory), 'utf8');
  assert.match(comparisonAsset, /requiredFields = \{'ID', 'Time', 'Depth', 'DepthUnit', 'DepthDirection'\}/u);
  assert.match(comparisonAsset, /numel\(fieldnames\(metadata\)\) == numel\(requiredFields\)/u);
  assert.match(comparisonAsset, /"SourceRowOrigin","call_entry_order"/u);
  assert.match(comparisonAsset, /if ~isempty\(recordData\)\s+result\.RecordData = recordData;/u);
  assert.match(comparisonAsset, /isstring\(labelInput\) \|\| iscellstr\(labelInput\)/u);
  assert.match(comparisonAsset, /isequal\(explicitLabels\(:\),sampleLabels\)/u);
  assert.match(comparisonAsset, /isstring\(recordIDs\) && isvector\(recordIDs\)/u);
});

test('separates archived proof and current declarations from the completed synthetic native adversarial suite', () => {
  for (const repositoryBlock of repositoryInstructionBlocks()) {
    assert.match(repositoryBlock, /旧 v2 归档覆盖为 3\/4 图/u);
    assert.match(repositoryBlock, /paired-interactive v2 核对完整值\/QC\/不确定度\/errorbar 数组/u);
    assert.match(repositoryBlock, /比较散点仍为 not_verified，不得据新证据升级旧包或向其他图外推/u);
    assert.match(repositoryBlock, /当前三版 report-evidence\.json 的 runtime_evidence\.figures 四图的 plot_data_evidence\.status 均为 runtime_declaration_verified，即 4\/4 合成输入绑定/u);
    assert.match(repositoryBlock, /paired-observation-model v3（schema_version=3）/u);
    assert.match(repositoryBlock, /run_matlab_gate 接入观测侧不确定度与 RecordMetadata/u);
    assert.match(repositoryBlock, /读取原生 Scatter 坐标、水平 Line 端点、归属和 UserData 身份/u);
    assert.match(repositoryBlock, /完整 12 条合成记录、11 对散点、未绘值、QC\/不确定度掩码、统计、release 和输入哈希/u);
    assert.match(repositoryBlock, /模型 QC\/不确定度明确为 not_provided/u);
    assert.match(repositoryBlock, /4\/4 声明绑定与 test_comparison_native_evidence 的 4 个正例、36\/36 个 reader 负例分别计证，不能互相推导/u);
    assert.match(repositoryBlock, /消费者 mutation tests 又是另一层/u);
    assert.match(repositoryBlock, /native-reader-test-results\.json、实际日志终标记、恢复断言、六件导出及输入哈希/u);
    assert.match(repositoryBlock, /不能把 setter 失败当 reader 拒绝/u);
    assert.match(repositoryBlock, /已验证的合成套件记录 original_artifacts_unchanged=true/u);
    assert.match(repositoryBlock, /仍为 visual_verified=false、desktop_interaction_verified=false/u);
    assert.doesNotMatch(repositoryBlock, /最近已确认原生证据覆盖为 3\/4|v3 是当前代码候选|尚未执行 v3 读取/u);
    assert.match(repositoryBlock, /无 v3 的旧包保持兼容且比较图未验证/u);
    assert.match(repositoryBlock, /畸形或不匹配声明必须失败，不得绕过校验/u);
    assert.match(repositoryBlock, /不是独立重执行或视觉验证，也不是桌面交互验证/u);
    assert.match(repositoryBlock, /synthetic_benchmark\/合成数据/u);
    assert.match(repositoryBlock, /不能将其描述为真实海况、实测趋势或海区机制证据/u);
  }
});

test('uses supported legend title typography and declares missing geometry instead of zero bounds', () => {
  for (const repositoryBlock of repositoryInstructionBlocks()) {
    assert.match(repositoryBlock, /Legend\.Title 的实际类型是 matlab\.graphics\.illustration\.legend\.Text/u);
    assert.match(repositoryBlock, /FontSize 固定使用 points，不得设置不支持的 FontUnits/u);
    assert.match(repositoryBlock, /旧版所测 PDF 图例标题仍有字体和越框问题/u);
    assert.match(repositoryBlock, /可见且非空的标题若无公开 Extent\/Position，必须加入 unmeasured_text_objects/u);
    assert.match(repositoryBlock, /role="legend\.title"/u);
    assert.match(repositoryBlock, /class="matlab\.graphics\.illustration\.legend\.Text"/u);
    assert.match(repositoryBlock, /bounds_audit_complete=false/u);
    assert.match(repositoryBlock, /不能补零矩形或忽略对象/u);
    assert.match(repositoryBlock, /未测量覆盖声明，不是视觉或裁切修复/u);
  }
});

test('binds explicit rendered audit declarations and never hides known older PDF failures', () => {
  for (const repositoryBlock of repositoryInstructionBlocks()) {
    assert.match(repositoryBlock, /显式 --rendered-audit 文件/u);
    assert.match(repositoryBlock, /审计文件 bytes\/SHA-256、manifest\/产物绑定、检查条件与状态一致性/u);
    assert.match(repositoryBlock, /不自动发现文件/u);
    assert.match(repositoryBlock, /先执行 rendered-artifact 检查，再把该文件显式传给报告/u);
    assert.match(repositoryBlock, /不传选项保持 not_verified/u);
    assert.match(repositoryBlock, /显式指定的文件缺失、畸形或不一致必须拒绝/u);
    assert.match(repositoryBlock, /不独立重跑或认证检查工具/u);
    assert.match(repositoryBlock, /这些声明不是可信视觉审计/u);
    assert.match(repositoryBlock, /pdf_font_embedding=failed（含未嵌入 Courier）必须显示/u);
    assert.match(repositoryBlock, /不能被未验证的文本或视觉项掩盖/u);
    assert.match(repositoryBlock, /报告构建成功、文本可提取都不等于字形可读或视觉通过/u);
    assert.match(repositoryBlock, /R2026a 外部产物检查 12\/12 通过/u);
    assert.match(repositoryBlock, /R2021a\/R2024b 各 4 件 PDF 的 pdf_font_embedding=failed/u);
    assert.match(repositoryBlock, /外检通过不等于整体 CI 通过或可信视觉审查/u);
    assert.match(repositorySkill, /historical R2024b DISPLAY diagnostic rejected an unsupported SVG `font` element/u);
    assert.match(repositorySkill, /do not conflate that diagnostic with evaluator artifacts/u);
  }
});

test('repository documents distinguish current primary-stage success from incomplete canvas and visual evidence', () => {
  for (const [name, document] of [['SKILL', repositorySkill], ['README', repositoryReadme],
    ['evals README', evaluationReadme]]) {
    for (const term of ['34001173593', '7d51e714', '20/20', '60/60', '90', 'runtime_pending',
      'completed/failure', 'SampleLabels', 'cellstr',
      'test_comparison_native_evidence', 'test_comparison_uncertainty', '3/4', '4/4',
      'schema_version=3', 'runtime_evidence.figures', 'runtime_declaration_verified',
      'not_provided', '12/12', 'pdf_font_embedding', 'oi_annotate_svg:UnsupportedNormalization']) {
      assert.ok(document.includes(term), `${name} missing current evidence boundary: ${term}`);
    }
    assert.doesNotMatch(document, /still awaits round-18 licensed CI|仍待第18轮 CI|successful end-to-end evidence is still absent/u);
  }
  for (const document of [repositorySkill, repositoryReadme, evaluationReadme]) {
    for (const term of ['comparison-statistics-layout', 'oi_apply_axes', 'theme.FontSize',
      '36/36', 'native-reader-test-results.json', 'COMPARISON_NATIVE_READER_TEST_NEGATIVES=36',
      'COMPARISON_NATIVE_READER_TEST=passed_synthetic_native_mutations_only',
      'scatter-nan-size', 'run_matlab_gate:ComparisonProofHandles', 'original_artifacts_unchanged=true',
      'visual_verified=false', 'desktop_interaction_verified=false', '5/36',
      'test_native_pdf_fixture_canvas', 'build_native_pdf_fixture_case:JVMRequired',
      'test_native_pdf_fixture_canvas:RootObjects', 'MATLAB:class:GetProhibited',
      'canvas_pdf.api_invoked=false', 'not_applicable', 'scribeOverlay', 'AnnotationPane',
      'geometry_before_pdf', 'geometry_after_pdf', 'geometry_after_png', 'captured', '0pt/3pt']) {
      assert.ok(document.includes(term), `Missing native or candidate boundary: ${term}`);
    }
    assert.doesNotMatch(document, /native mutation test was not reached|原生篡改测试尚未进入/u);
  }
  assert.match(repositorySkill, /earlier archived reports retain 3\/4 native-proof coverage/u);
  for (const document of [repositorySkill, evaluationReadme]) {
    assert.match(document, /four positive cases and 36\/36 reader-negative cases per release/u);
    assert.match(document, /(?:assertion now passed natively, without relaxing|assertion passed natively without weakening)/u);
    assert.match(document, /has not run natively/u);
    assert.match(document, /strictly empty AnnotationPane objects,\s+rejecting nonempty ones/u);
    assert.match(document, /original\s+three-candidate native PDF probe stage, score, or promoted report artifacts/u);
    assert.match(document, /not (?:a trusted visual audit or )?overall CI (?:pass|or visual approval)/u);
  }
  assert.match(repositoryReadme, /每版完成 4 个正例及 36\/36 个 reader 负例/u);
  assert.match(repositoryReadme, /字幕扰动\/restyle 字号断言已原生通过，断言未放宽/u);
  assert.match(repositoryReadme, /候选尚未 native 执行/u);
  assert.match(repositoryReadme, /严格空 AnnotationPane（非空拒绝）/u);
  assert.match(repositoryReadme, /`not_applicable`，不是 pass/u);
  assert.match(repositoryReadme, /均不计入原三 candidate 的 native PDF probe stage、评分或正式报告产物/u);
  assert.match(repositoryReadme, /整体 CI 失败，视觉未验证/u);
});

test('keeps active report contracts in structured guidance and delegates historical diagnostics to repository documents', () => {
  for (const repositoryBlock of repositoryInstructionBlocks()) {
    assert.deepEqual([...repositoryBlock.matchAll(/^### (.+)$/gmu)].map((match) => match[1]),
      ['导出策略', '字体与测量', '科学证据', '当前结果']);
    for (const path of ['codex-runtime/matlab/SKILL.md', 'codex-runtime/matlab/README.md',
      'codex-runtime/matlab/evals/README.md']) {
      assert.ok(repositoryBlock.includes(path), `Missing maintained document reference: ${path}`);
    }
    assert.match(repositoryBlock, /报告端采用 parseOceanEvidenceTime 共享严格 UTC coverage 端点解析/u);
    assert.match(repositoryBlock, /data-uncertainty-status\/data-uncertainty-method 必须与 manifest 科学上下文精确一致/u);
    assert.match(repositoryBlock, /非空 data-uncertainty 自然说明仍需人审，不能用子串命中认证语义/u);
    assert.match(repositoryBlock, /源码合同不代表真实海区报告已验证，也不扩展为每条原始 point 时间认证/u);
    assert.match(repositoryBlock, /不代表本次会话已执行、已部署或既有会话热更新/u);
    for (const historicalDetail of ['33985570222', '33988300354', '33995525791', '34000171748',
      '第15/16轮', '第18/19/20轮', '5/36', 'Astra', '8011', '8012']) {
      assert.ok(!repositoryBlock.includes(historicalDetail), `Historical or deployment detail leaked into default guidance: ${historicalDetail}`);
    }
  }
  for (const document of [repositorySkill, repositoryReadme]) {
    for (const term of ['parseOceanEvidenceTime', 'data-uncertainty-status', 'data-uncertainty-method', 'Astra']) {
      assert.ok(document.includes(term), `Missing source or diagnostic boundary: ${term}`);
    }
  }
  assert.match(repositorySkill, /source contracts do not establish validation of a real ocean-region report/u);
  assert.match(repositorySkill, /Two real Astra diagnostic turns completed in round 19 at low effort with read-only diagnostic commands/u);
  assert.doesNotMatch(repositorySkill, /in read-only mode/u);
  assert.match(repositorySkill, /not MATLAB execution, desktop-interaction coverage or proof that existing sessions were refreshed/u);
  assert.match(repositoryReadme, /源码合同不代表真实海区报告已验证/u);
  assert.match(repositoryReadme, /两次真实 diagnostic turn 已完成，均为 low effort、只读诊断/u);
  assert.match(evaluationReadme, /## Current Evidence/u);
  assert.match(evaluationReadme, /## Evidence History/u);
  assert.match(evaluationReadme, /Font probe 33985570222/u);
  assert.match(evaluationReadme, /33988300354 did not\s+repair/u);
  assert.match(evaluationReadme, /comparisons shared a Cairo backend/u);
  assert.match(evaluationReadme, /Production port 8011 has not reloaded/u);
  assert.match(evaluationReadme, /isolated port 8012/u);
  assert.match(evaluationReadme, /completed two turns using separate/u);
  assert.match(evaluationReadme, /generated source passed R2021a syntax checks but has not run in MATLAB yet/u);
  assert.match(evaluationReadme, /model-selected 10x8\.5-inch page or descriptive labels/u);
  assert.match(evaluationReadme, /Generation completion does not prove\s+native exports/u);
});

test('repository entry separates verified sizing and SVG contracts from pending visual validation', () => {
  assert.match(repositoryReadme, /先读本目录的 `SKILL\.md` 与本文/u);
  assert.match(repositoryReadme, /用 `which` 核对同名函数来源/u);
  assert.match(repositoryReadme, /不代表本目录已被 Codex 自动发现为技能/u);
  for (const document of [repositorySkill, repositoryReadme]) {
    for (const term of ['Units="inches"', 'Width=widthPixels/dpi', 'Height=heightPixels/dpi',
      'Resolution=dpi', 'PreserveAspectRatio="off"', 'PreserveAspectRatio="on"',
      'Padding="figure"', 'export_size_units', '2/6', '6/6', '3/3', 'pixels/off', 'inches/off']) {
      assert.ok(document.includes(term), `Missing repository export guidance: ${term}`);
    }
    assert.doesNotMatch(document, /Units="pixels"/u);
  }
  assert.match(repositorySkill, /full native regression runs passed the dimension checks/u);
  assert.match(repositorySkill, /This is not full-figure visual approval/u);
  assert.match(repositorySkill, /passed the namespace-aware DOM contracts on all three releases/u);
  assert.match(repositorySkill, /overall CI still failed on postprocessing gates/u);
  assert.match(repositorySkill, /shrank fonts and increased tick counts/u);
  assert.match(repositoryReadme, /三版全量原生回归的尺寸检查已通过/u);
  assert.match(repositoryReadme, /这不是全图视觉保证/u);
  assert.match(repositoryReadme, /DOM 检查已在三版通过/u);
  assert.match(repositoryReadme, /后处理和整体CI仍失败/u);
  assert.match(repositoryReadme, /不放宽既有门禁/u);
});

test('requires exact installed fonts without claiming PDF embedding or CJK readability', () => {
  const instructions = matlabPlottingInstructions();
  assert.match(instructions, /listfonts 或 fc-list 枚举结果的精确字体族名匹配/u);
  assert.match(instructions, /不得用 fc-match fallback 返回了替代字体就认定请求字体已安装/u);
  assert.match(instructions, /字体候选匹配不等于 PDF 字体嵌入，也不等于 CJK 字形可读/u);
  assert.match(instructions, /PNG\/PDF\/SVG 必须分别核验实际产物，未核验项保持 unverified/u);
  assert.match(repositorySkill, /exact, case-insensitive matching against `listfonts` or `fc-list` enumeration/u);
  assert.match(repositorySkill, /`fc-match` fallback does not prove the requested font is installed/u);
  assert.match(repositorySkill, /neither PDF font embedding nor readable CJK glyphs/u);
});

test('scopes the WenQuanYi preference to the tested native vector font evidence', () => {
  for (const instructions of [MATLAB_PLOTTING_INSTRUCTIONS, matlabPlottingInstructions()]) {
    assert.match(instructions, /用户未指定 FontName 且精确安装检查通过时，默认优先 WenQuanYi Zen Hei/u);
    assert.match(instructions, /保持主题、导出器和交互字体一致；不覆盖用户显式字体选择/u);
    assert.match(instructions, /有限的原生 vector PDF 字体探针是内容裁剪而非精确页/u);
    assert.match(instructions, /不能声称已解决旧版嵌入或精确页合同，也不能据此更换严格导出策略/u);
    assert.match(instructions, /整图布局、最终尺寸、粗体、中文旋转轴及 PNG\/SVG 仍须分别验证/u);
    assert.match(instructions, /Noto\/Droid 不是等效已验证回退/u);
    assert.match(instructions, /后端字形失败不等于字体未安装/u);
  }
  assert.match(repositorySkill, /without an explicit user `FontName`, prefer `WenQuanYi Zen Hei` after exact installation checks/u);
  assert.match(repositorySkill, /Font probe 33985570222/u);
  assert.match(repositorySkill, /content-cropped, not exact-page exports/u);
  assert.match(repositorySkill, /R2021a\/R2024b `print` PDFs still lacked embedded fonts/u);
  assert.match(repositorySkill, /does not authorize changing the strict export strategy/u);
  assert.match(repositorySkill, /Validate whole-figure layout, final size, bold text, rotated Chinese labels, and PNG\/SVG independently/u);
});

test('keeps tiledlayout title coverage unresolved until every requested artifact is checked', () => {
  const instructions = matlabPlottingInstructions();
  assert.match(instructions, /tiledlayout 标题也必须在每个请求格式中核验文本、字形、占位和裁切/u);
  assert.match(instructions, /必须记录未测覆盖，不能用零矩形当成完整几何/u);
  assert.match(instructions, /不得仅凭现有 bounds 门禁通过认定标题完整/u);
  assert.match(repositorySkill, /`tiledlayout` titles in every requested format/u);
  assert.match(repositorySkill, /geometry coverage gap is still under diagnosis, not a confirmed fix/u);
  assert.match(repositorySkill, /Passing the current bounds gate alone does not prove/u);
});

test('binds ocean reports to runtime input bytes and keeps synthetic conclusions explicit', () => {
  const instructions = matlabPlottingInstructions();
  assert.match(instructions, /实际参与该次 MATLAB 运行的输入快照/u);
  assert.match(instructions, /相对路径、bytes、SHA-256 与运行记录一致，fixture 包核对 runtime\.input_fixtures/u);
  assert.match(instructions, /同名\/同 shape 源文件不能替代运行输入/u);
  assert.match(instructions, /缺少运行时哈希标记 unverified，哈希不一致必须拒绝/u);
  assert.match(instructions, /合成 fixture 必须明确标注 synthetic_benchmark\/合成数据/u);
  assert.match(instructions, /不能将其描述为真实海况、实测趋势或海区机制证据/u);
  assert.match(repositorySkill, /actual input snapshots consumed by that MATLAB run/u);
  assert.match(repositorySkill, /relative paths, bytes, and SHA-256 against runtime records/u);
  assert.match(repositorySkill, /Missing runtime hashes leave the binding `unverified`; mismatched hashes must be rejected/u);
  assert.match(repositorySkill, /synthetic_benchmark/u);
  assert.match(repositorySkill, /not evidence of real ocean conditions, observed trends, or regional mechanisms/u);
});

test('injects a ready plot request through task route, plot route and generator', () => {
  const instructions = matlabPlottingInstructions({
    repositoryRoot: '/opt/ocean-intelligence',
    runtime: 'matlab',
    matlabRelease: 'R2026a',
    plotRequest: {
      question: 'trend',
      coordinates: ['time'],
      dimensions: [24],
      dataType: 'datetime',
      timeZone: 'UTC',
      missing: false,
      qcStatus: 'absent',
      units: { value: 'degC' },
      quantities: { value: 'Sea water temperature' },
      title: 'Hourly sea water temperature',
      source: 'quality-controlled buoy observations',
    },
  });
  assert.match(instructions, /本次 MATLAB 选图解析结果/u);
  assert.match(instructions, /状态：ready/u);
  assert.match(instructions, /图型：time-series/u);
  assert.match(instructions, /function result = make_ocean_figure/u);
  assert.match(instructions, /oi_write_manifest/u);
  assert.match(instructions, /出版尺寸：4 in × 2\.25 in，300 DPI/u);
  assert.match(instructions, /产物级验收：not-run-by-router/u);
  assert.match(instructions, /不得据此声称字形、裁剪、灰度或色觉检查通过/u);
  const geometryAdviceIndex = instructions.indexOf('figureHandle.Position(3:4) = [widthPixels heightPixels] / dpi');
  assert.ok(geometryAdviceIndex >= 0);
  assert.ok(geometryAdviceIndex < instructions.indexOf('function result = make_ocean_figure'));
});

test('injects unresolved and runtime-routed states without orphan code generation', () => {
  const incomplete = matlabPlotRequestResolutionBlock({
    runtime: 'matlab',
    question: 'trend',
    coordinates: ['time'],
    dimensions: [24],
  });
  assert.match(incomplete, /状态：needs-input/u);
  assert.match(incomplete, /未决项：/u);
  assert.match(incomplete, /禁止生成/u);
  assert.doesNotMatch(incomplete, /function result =/u);

  const octave = matlabPlotRequestResolutionBlock({ runtime: 'octave', question: 'trend' });
  assert.match(octave, /状态：routed-to-octave/u);
  assert.doesNotMatch(octave, /function result =/u);
});

test('instruction injection is closed-world and cannot change MATLAB authority from plotRequest', () => {
  assert.throws(() => matlabPlottingInstructions({ runtme: 'octave' }), /Unknown MATLAB plotting instruction options/u);
  assert.throws(
    () => matlabPlottingInstructions({ runtime: 'matlab', plotRequest: { runtime: 'octave', question: 'trend' } }),
    /must not override instruction runtime fields/u,
  );
  assert.throws(() => matlabPlottingInstructions({ runtime: 'matlab', manifestPath: '../figures.json' }), /traversal/u);
  assert.throws(() => matlabPlottingInstructions({ runtime: 'MATLAB/Octave' }), /must be "matlab" or "octave"/u);
});

function repositoryInstructionBlocks() {
  return [MATLAB_PLOTTING_INSTRUCTIONS, matlabPlottingInstructions(),
    ...['R2021a', 'R2024b', 'R2026a'].map((matlabRelease) =>
      matlabPlottingInstructions({ runtime: 'matlab', matlabRelease }))]
    .map((instructions) => {
      const start = instructions.indexOf('【MATLAB 仓库实跑约束】');
      assert.ok(start >= 0);
      return instructions.slice(start).split('【本次可注入路径上下文】')[0];
    });
}

function repositoryExportTable(instructions) {
  return instructions.split('\n')
    .filter((line) => /^\| R\d/u.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}
