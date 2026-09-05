import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  MATLAB_PLOTTING_INSTRUCTIONS,
  matlabPlotRequestResolutionBlock,
  matlabPlottingInstructions,
} from './matlab-plotting-instructions.mjs';

const repositorySkill = readFileSync(new URL('../matlab/SKILL.md', import.meta.url), 'utf8');

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
  for (const runtime of ['octave', 'OCTAVE']) {
    const instructions = matlabPlottingInstructions({ runtime });
    assert.match(instructions, /优先模板目录：\.\/codex-runtime\/octave/u);
    assert.match(instructions, /Octave 默认使用不可见 figure 和 Qt 工具包/u);
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
  assert.match(instructions, /几何漏项目前仍在诊断，不得声称已修复/u);
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
