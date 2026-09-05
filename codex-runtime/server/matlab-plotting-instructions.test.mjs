import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MATLAB_PLOTTING_INSTRUCTIONS,
  matlabPlotRequestResolutionBlock,
  matlabPlottingInstructions,
} from './matlab-plotting-instructions.mjs';

test('exports the complete Chinese Octave and MATLAB plotting contract', () => {
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /运行时检测与兼容性/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /MATLAB 是本规范的权威运行时/u);
  const injected = matlabPlottingInstructions();
  assert.match(injected, /MATLAB release 能力矩阵/u);
  assert.match(injected, /禁止以 Octave 执行/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /MATLAB-first 仅探测 matlab/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /Octave-first 才探测 octave-cli、octave/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /仓库模板优先/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_ocean_theme/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_timeseries/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_export_figure/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_field/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_profile/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_vector_field/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_geospatial_field/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_section/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_comparison/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_taylor_diagram/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_target_diagram/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_ensemble/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_reliability_diagram/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_hovmoller/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_ts_diagram/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_spectrum/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_plot_direction_rose/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_panel_grid/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_stable_legend/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_resolve_font/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /oi_configure_graphics/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /MATLAB listfonts/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /内置 legend 对象在 PNG\/PDF 中丢失/u);
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
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /xvfb-run/u);
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
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /listfonts 按声明候选链选择 CJK 字体/u);
  assert.match(MATLAB_PLOTTING_INSTRUCTIONS, /静态 fallback 必须记录 interaction_verified=false/u);
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
  const instructions = matlabPlottingInstructions({ runtime: 'octave' });
  assert.match(instructions, /优先模板目录：\.\/codex-runtime\/octave/u);
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
