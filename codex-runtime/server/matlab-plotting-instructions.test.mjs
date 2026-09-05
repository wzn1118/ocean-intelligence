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

test('injects native PNG inches/off and vector inches/on without claiming full validation', () => {
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
    assert.match(repositoryBlock, /inches\/off 保留物理字体且所测 3\/3 尺寸准确/u);
    assert.match(repositoryBlock, /pixels\/off 实图字体缩小、刻度变多，不采用该路径/u);
    assert.match(repositoryBlock, /不做导出后 resize，不通过重采样、裁切或填边掩盖尺寸错误/u);
    assert.match(repositoryBlock, /本次 PNG inches\/off 策略尚待跨版本全量 CI 验证，不得声称尺寸偏差已经修复或视觉满分/u);
    assert.match(repositoryBlock, /必须重新检查真实 PNG 像素\/DPI、字体、刻度、裁切、PDF 页尺寸及 SVG 几何，未验证项保持 unverified/u);
    assert.doesNotMatch(instructions, /PNG 使用 Units="?pixels|两类均保留 Padding="figure" 和 PreserveAspectRatio="on"/u);
  }
  assert.doesNotMatch(matlabPlottingInstructions({ runtime: 'octave' }), /runtime\.export_size_units|本次 PNG inches\/off 策略/u);
});

test('repository entry separates cross-release sizing evidence from pending SVG and visual validation', () => {
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
  assert.match(repositorySkill, /has not yet run through MATLAB Java DOM on all three releases/u);
  assert.match(repositorySkill, /shrank fonts and increased tick counts/u);
  assert.match(repositoryReadme, /三版全量原生回归的尺寸检查已通过/u);
  assert.match(repositoryReadme, /这不是全图视觉保证/u);
  assert.match(repositoryReadme, /尚未在 MATLAB Java DOM 上完成三版执行/u);
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
    assert.match(instructions, /33985570222 在 R2021a\/R2024b\/R2026a/u);
    assert.match(instructions, /WenQuanYi Zen Hei \+ exportgraphics\(\.\.\., "ContentType", "vector"\)/u);
    assert.match(instructions, /所测中英文\/数字可读、精确文本提取和字体嵌入/u);
    assert.match(instructions, /原生 PDF 是内容裁剪而非精确页/u);
    assert.match(instructions, /R2021a\/R2024b 的 print PDF 仍未嵌入/u);
    assert.match(instructions, /不能声称已解决旧版嵌入或精确页合同，也不能据此更换严格导出策略/u);
    assert.match(instructions, /整图布局、最终尺寸、粗体、中文旋转轴及 PNG\/SVG 仍须分别验证/u);
    assert.match(instructions, /两旧版 Noto 原生标题为 ######，Droid 原生 Latin\/数字为方框/u);
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

function repositoryExportTable(instructions) {
  return instructions.split('\n')
    .filter((line) => /^\| R\d/u.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}
