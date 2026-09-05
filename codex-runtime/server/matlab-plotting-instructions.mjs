import { matlabCapabilityInstructionBlock } from './matlab-release-capabilities.mjs';
import { matlabPlotRoutingInstructionBlock, resolveMatlabPlotRequest } from './matlab-plot-router.mjs';
import {
  assertMatlabRequestJson,
  isMatlabJsonObject,
  matlabTaskRoutingInstructionBlock,
} from './matlab-task-routing-contract.mjs';

const RUNTIME_PLOTTING_GUIDANCE = {
  matlab: {
    authority: 'MATLAB',
    repository: String.raw`
- 先检查注入的 MATLAB 模板根目录下 README.md、SKILL.md、assets 和 tests。assets 中可复用 oi_ocean_theme、oi_figure、oi_apply_axes、oi_apply_color_scale、oi_font_available、oi_export_figure、oi_write_manifest、oi_text_bounds 和 oi_color_accessibility_audit；核对实际 .m 文件及输入/输出契约后最小适配，不重复实现主题、字体、画布、导出或 manifest。
- MATLAB 仓库现有 9 个绘图 helper：oi_plot_time_series、oi_plot_profile、oi_plot_section、oi_plot_hovmoller、oi_plot_comparison、oi_plot_vector_field、oi_plot_ts_diagram、oi_plot_spectrum、oi_plot_direction_rose。资产存在只代表可按其契约调用，不代表当前路由生成器已接线或产物已验证。
- 多系列图显式保留图形句柄和标签，使用 MATLAB 原生 legend(axesHandle, seriesHandles, labels)，图例顺序必须与数据系列和交互提示一致，不引入其他运行时的图例修补 helper。
- 两个及以上面板优先采用 MATLAB 原生 tiledlayout/nexttile，声明 Padding、TileSpacing、共享标签、图例/色条占位、从左到右且从上到下的阅读顺序及 (a)(b)(c) 标签；不得依赖 subplot 默认挤压，也不得手工复制互相重叠的 Position 数组。目标 release 不支持时才声明 subplot 或显式 axes 布局回退；单图生成器收到多面板请求仍须拒绝，不能只画第一面板。
- MATLAB 时间序列优先检查 oi_plot_time_series(axesHandle, data, options)：data 为 table/timetable，显式声明 ValueVariables、ValueUnits、时区、QC 与不确定度语义；保留观测值 NaN 缺口，输入时间不得 NaT，必须严格递增且唯一；不跨缺测连接不确定性带，采样长间隔通过 GapThreshold 明确分段，返回有效/缺测计数并为原始点保留 marker。当前服务器静态时间序列仍为内联 plot/errorbar 路径，不得把该资产的可调用性描述为已完成生成器接线。
- MATLAB 仓库尚无经纬度场或通用标量场专用 helper；按原生 surface/view(2)、contourf 或满足规则等间隔条件的 imagesc 实现。声明经度约定、坐标顺序、单位、色限和掩膜，未经声明不得自动重排字段列；站点叠加保留名称、经纬度、数值和单位元数据。不得把普通 Cartesian 坐标轴描述成地图投影；投影需求须核对产品、工具箱与 release。
- MATLAB 仓库尚无 Taylor、target、ensemble、reliability 专用绘图 helper。先明确各图的统计量、参考值、配对样本、单位、QC 和不确定度契约，再按实际可用的 plot/scatter/errorbar/patch/polaraxes 等原生 API 实现；3-D 仅在科学问题确需时使用 surf。缺少科学输入或目标 release/产品能力时报告 needs-input、missing-toolbox 或相应不支持状态，不得臆造仓库 helper、模板或强行通过现有路由。
- MATLAB 原生任务保持 timetable/datetime、tiledlayout/nexttile；导出按通用能力与仓库严格尺寸路径分别选策略，只有目标 release、格式或集成约束不支持时才显式降级。误差带按缺测和长时间间隔分段，不能跨空档闭合 patch。PNG/PDF 双格式交付使用 oi_export_figure，从同一最终 figure 导出。
`,
    fonts: String.raw`- 中文文本保持 UTF-8。MATLAB 使用 oi_ocean_theme 与 oi_font_available，按用户显式字体及 fallback 候选顺序精确探测，不用其他运行时的字体/图形初始化 helper。用 oi_figure 创建画布后将实际选中 FontName 写回 theme 和 OI_OceanTheme 缓存，并应用到 axes、标签、图例、色条及交互对象；不得让导出器恢复过时默认字体。安装证据与默认字体适用范围遵循 MATLAB 仓库实跑约束，候选命中不等于字形或嵌入通过。普通中英文标签使用 interpreter='none'，混合公式单独验证；最终尺寸下检查文字清晰度和裁切。`,
    headless: '- MATLAB 使用 -batch 或等价无头模式，并关闭交互窗口；不探测或配置 GNU Octave 图形工具包。',
    interaction: String.raw`
- MATLAB 原生交互任务（taskType="interactive"）必须复用 interactive_timeseries_native_template.m：用 DataTipTemplate 和 dataTipTextRow 绑定逐点 ID、站位、时间与 QC 元数据；普通 create/export 时间序列保持非交互路径。桌面路径才启用显式句柄的 datacursormode(figureHandle, "on") 与 brush(figureHandle, "on")，多面板使用 linkaxes 协同视图。
- 交互与导出必须双路径：Interactive=true 供桌面探索，Interactive=false 供 matlab -batch 无界面导出；静态导出不得依赖点击、hover、桌面状态或回调。
- 回调仅作无法由 DataTipTemplate 表达内容时的显式降级；必须从 event.Target 和 event.DataIndex 取值，校验句柄/索引并提供安全兜底，不得在回调中搜索 gca、gcf 或读取全局状态。使用 uifigure/uiaxes 前核对 MATLAB release。
- brush 选择必须通过图元 BrushData 映射到过滤、排序后仍唯一的 ObservationID，并复制到应用管理状态；关闭图窗时禁用 brush/datacursormode、清空 UpdateFcn 和 appdata。跨面板视图优先 linkaxes；linkdata 只允许调用方长期维护数值、ID、QC 同步映射时显式启用，并在关闭前 linkdata(fig, "off")。
- uifigure 完整界面交付可使用 exportapp，传统 figure/layout 或 matlab -batch 无界面路径按 release 和严格尺寸合同使用 exportgraphics 或明确 print 策略。自动模式可以从无 desktop 的 uifigure 请求降级到不可见传统 figure，但显式要求 exportapp 时不得静默降级；pinned data tip、brush 高亮和 toolbar 不得被当作静态科学标注。
`,
  },
  octave: {
    authority: 'GNU Octave',
    repository: String.raw`
- 先检查注入上下文给出的 Octave 仓库绘图模板目录，优先复用其中 README、oi_resolve_font、oi_configure_graphics、oi_ocean_theme、oi_figure、oi_apply_axes、oi_panel_grid、oi_stable_legend、oi_plot_timeseries、oi_plot_field、oi_plot_geospatial_field、oi_plot_profile、oi_plot_section、oi_plot_comparison、oi_plot_taylor_diagram、oi_plot_target_diagram、oi_plot_ensemble、oi_plot_reliability_diagram、oi_plot_vector_field、oi_plot_hovmoller、oi_plot_ts_diagram、oi_plot_spectrum、oi_plot_direction_rose、oi_export_png、oi_export_figure、oi_write_manifest、interaction、interactive、examples 和 tests；在已有模板上做最小适配，不重复实现主题、字体、画布、逐点提示、导出或 manifest 逻辑。
- 多系列图必须显式传入图形句柄和标签；使用 gnuplot 导出时优先调用 oi_stable_legend，避免内置 legend 对象在 PNG/PDF 中丢失。图例顺序必须与数据系列和交互提示一致。
- 两个及以上面板优先调用 oi_panel_grid，统一外边距、面板间距、从左到右且从上到下的阅读顺序以及 (a)(b)(c) 标签；不得依赖 subplot 默认挤压，也不得手工复制互相重叠的 Position 数组。
- 小范围经纬度标量场优先调用 oi_plot_geospatial_field：必须声明 [-180, 180] 或 [0, 360] 经度约定，自动重排字段列，明确标注为未投影区域经纬度图；站点叠加必须保留名称、经纬度、数值和单位元数据。不得把普通 Cartesian 坐标轴描述成地图投影。
- 时间序列优先调用 oi_plot_timeseries：保留 NaN 空档、不跨缺测连接不确定性带、返回有效/缺测计数，并为每个原始点保留 marker。PNG/PDF 双格式交付优先调用 oi_export_figure，确保两种格式来自同一最终 figure。
`,
    fonts: String.raw`- 中文文本保持 UTF-8。优先调用 oi_resolve_font，并用 fc-match/fc-list 验证字体；创建原始 figure 前调用 oi_configure_graphics，使用 oi_figure 时由其自动完成。优先 Noto Sans CJK SC，其次 WenQuanYi Zen Hei。普通中英文标签使用 interpreter='none'，混合公式时单独验证字形。最终尺寸下检查中文、拉丁字符、图例和色标是否清晰且未裁切。`,
    headless: '- Octave 默认使用不可见 figure 和 Qt 工具包；无显示环境通过 UTF-8 locale 下的 xvfb-run 执行 octave --no-gui --quiet，不得依赖 DISPLAY，也不得静默切换到 gnuplot。Qt 不可用时先报告限制，只有验证输出后才可把 gnuplot 作为明确降级方案。',
    interaction: '- Octave 交互优先核对模板目录的 interaction、interactive、examples 和 tests，验证当前工具包的逐点提示、选择、回调与清理支持。保留稳定 ObservationID、原始行号及对齐 QC；交互与静态导出保持双路径，静态结果不依赖点击、hover 或桌面回调。缺少交互能力时明确报告限制，不将 MATLAB 原生交互模板/API 当作 Octave 已有能力。',
  },
};

function plottingBaseInstructions(runtime) {
  const guidance = RUNTIME_PLOTTING_GUIDANCE[runtime];
  return String.raw`
【${guidance.authority} 专业绘图运行规范】

仅在任务需要生成、修复或复核科学图件时执行本规范。${guidance.authority} 是本规范的权威运行时；绘图脚本、输入数据、导出文件和 manifest 必须可复现；不得用虚构数据、装饰性曲线或未经说明的平滑、插值、裁剪和坐标翻转补足结果。

零、科学数据门禁
- 数据驱动的 create/repair/refine/export/interactive 请求必须设置 requireScientificContract=true，并通过 scientificDataContract 门禁后再选图。契约至少包含原始 shape、dimensionOrder、observationDimension、MATLAB 数据类型、坐标、物理量和单位。
- 时间使用 datetime/timetable，保留 TimeZone 并声明顺序；经纬度声明约定和顺序；depth/pressure/height/elevation 声明类型、正方向和基准。单位换算必须声明 sourceUnit、targetUnit、formula 和变量。
- missing、QC 和 uncertainty 分别声明 present/absent。缺测存在时记录 NaN/NaT/sentinel；QC 存在时记录逐观测对齐变量、flag meanings，并分离 missing/invalid/suspect 掩膜；不确定度存在时记录类型、单位和对齐维。
- 任何语义未决必须返回 needs-input；不得用 squeeze、transpose、sort、fillmissing、插值、坐标翻转或隐式单位换算消除契约错误。运行时响应和 manifest 元数据保留 scientific_data_contract。

零点五、出版质量、可访问性与交互门禁
- 出版、导出、中文、可访问性或交互任务必须设置 requirePublicationContract=true。publicationContract 声明最终介质、厘米/英寸物理尺寸、输出格式与 DPI；tiledlayout 行列、TileSpacing、Padding、阅读顺序、显式句柄，以及图例/色条占位必须在绘图前确定。
- 字体契约声明主字体、CJK fallback、最终尺寸字号/线宽与 Interpreter；中文使用 UTF-8，普通中文标签使用 Interpreter="none"，PNG/PDF/SVG 分别检查真实字形。不得以 listfonts 或源字符串存在代替导出字形证据。
- 色彩契约声明 sequential/diverging/cyclic/categorical 类别、palette 来源、背景、缺测外观、最低 4.5 对比度、灰度与色觉检查，并禁止仅靠颜色编码。共享色条只服务相同变量/单位/变换/CLim 的面板。
- drawnow 后检查标题、刻度、图例、色条、注释和边界的裁剪/遮挡；可访问输出保留阅读顺序和可访问标题/描述。预检仅声明检查必做，只有产物证据和 inspectMatlabPlotQuality 八项标准通过后才能报告成功。
- interactive 任务使用 mode="dual"：桌面路径保留稳定 ObservationID、event.Target/DataIndex 回调与清理；静态路径使用 Visible="off" 的传统 figure，经 matlab -batch 和 exportgraphics/明确 print fallback 导出，不依赖点击、hover、pinned tips、toolbar 或桌面状态。

零点六、版本化运行与导出清单
- R2019a 及更新版本使用 matlab -batch；更旧版本只能使用含 try/catch/exit 且保留失败退出码的 matlab -r 路径。
- PNG、PDF、SVG 必须逐格式读取 release 能力策略；同一请求需要 exportgraphics 与 print 时，在 publicationContract.headless.exportApis 中逐格式声明，禁止静默换格式。
- 运行时响应必须暴露 outputContract。manifest 使用 schema_version=2、相对 JSON 路径、确定性 figure 顺序，只登记新鲜且已核验的产物；PNG 记录尺寸/DPI/字节/哈希，PDF/SVG 另记录文本或字体证据。

零点七、对抗输入门禁
- 请求体必须是普通 JSON object，拒绝数组、Date/Map/类实例和自定义原型对象；runtime/requestedRuntime、taskType/intent、targetRelease/matlabRelease 或 MATLAB-first/Octave-first 信号冲突时立即返回稳定错误状态，不从中文或英文自然语言中猜测覆盖值。
- 请求采用闭世界字段表：未知键、危险原型键、访问器、循环引用、超过 8 层嵌套、256 项数组、128 键对象、16384 字符字符串或 4096 节点总量均须拒绝；不得截断后继续路由。
- runtime、release、task、toolbox、contract 和 output 字段只允许出现在请求顶层；plotInput 与兼容别名 plot 互斥，科学/出版契约别名也互斥。使用嵌套 contract 时，该域元数据必须全部保留在 contract 内；嵌套路由字段、跨层同域字段或顶层/plotInput 重名元数据必须返回 MATLAB_REQUEST_INVALID，禁止展开对象时静默覆盖。
- matlabAvailable、toolboxAvailability、required 字段只接受 JSON boolean；字符串 "false"、数字、null 和缺失证据不得被解释为运行时或工具箱可用。
- 输出格式先统一大小写和扩展名前缀再去重；manifest 路径拒绝 URI、绝对路径、.. 穿越和控制字符。旧版 matlab -r 的 catch 分支必须非零退出，禁止失败后 exit(0)。

一、运行时检测与兼容性
- 在写脚本前先解析权威运行时。MATLAB-first 仅探测 matlab 并记录命令路径、release 与产品；Octave-first 才探测 octave-cli、octave 和 available_graphics_toolkits()。不得仅凭 .m 扩展名切换运行时或声称 MATLAB 兼容。
- 用户指定 MATLAB 或目标 release 时必须使用 MATLAB；MATLAB 不可用只能报告“未执行”，不得静默切换 GNU Octave。仅有 Octave 时，必须明确报告为“Octave 专用验证”，不得声称验证 MATLAB release 能力。
- 可移植脚本优先使用 figure、axes、subplot、plot、scatter、imagesc、pcolor、contour、contourf、quiver、colorbar、legend、set、get、caxis 和 print 等共享 API；避免未经保护的 tiledlayout、exportgraphics、clim、sgtitle、yyaxis、datetime 及工具箱函数。
- 只有行为确有差异时才用 exist('OCTAVE_VERSION', 'builtin') 分支；需兼容 MATLAB 的文件统一使用 end，不使用 endif、endfor 或 endfunction。

二、仓库模板优先
${guidance.repository.trim()}
- 风向、流向和波向玫瑰图优先调用 oi_plot_direction_rose：北向朝上、角度顺时针，必须明确 DirectionConvention 是 from 还是 to，并声明 count、percent 或权重口径；不得混用风来向、流去向和波来向。
- 频谱图优先调用 oi_plot_spectrum，并只接收可追溯的预计算谱密度；必须声明频率、周期和谱密度单位，报告窗函数、去趋势、分段与自由度口径。零频和非正谱值不得混入对数轴，置信区间不得跨缺测点连接。
- T–S 图优先调用 oi_plot_ts_diagram：明确温度类型与盐度口径、按深度着色、保留缺测统计和逐点提示。等密度线只能使用数据源或经过说明的海水状态方程计算结果，再通过 DensityValues 显式传入；不得用装饰性曲线冒充密度诊断。
- 时间–深度图优先调用 oi_plot_hovmoller：横轴明确标注 UTC，纵轴深度向下为正，保留 NaN 缺测并返回有效/缺测数量；禁止把时间或深度方向交给默认设置。
- 温盐、氧气和营养盐断面优先调用 oi_plot_section：纵轴深度向下为正，海底遮罩只能来自真实 bathymetry，填色和线等值级别必须显式给定或可追溯；站位顺序、距离单位、缺测和是否插值必须明确，禁止用填补值伪造海底以下数据。
- 观测—模型或仪器—仪器一致性图优先调用 oi_plot_comparison：必须绘制 1:1 参考线并报告有效样本数、Bias、MAE、RMSE 和相关系数；两个坐标轴必须使用相同范围和单位，默认禁止静默裁点，每个点保留样本标签、两侧数值和残差元数据。
- 矢量场必须报告分量单位、抽样步长、有效/缺测矢量数量，并绘制带单位的参考箭头；缺测 u/v 分量不得被静默当作零值。
- 提示词回归覆盖时间序列、误差带、多面板、海洋断面、经纬度场、频谱、玫瑰图、中文字体、导出失败修复、旧版本兼容以及 MATLAB/Octave 路由；输出代码必须同时满足输入契约、期望特征、禁止行为和验收规则。
- 使用模板前核对函数在当前运行时是否可用；若模板含 Octave 专用 API，不得未经测试直接宣称 MATLAB 兼容。必须偏离模板时，在交付说明中写明原因和替代实现。
${guidance.interaction.trim()}
- 将科学计算与绘图句柄操作分离，显式传递坐标轴句柄，保留原始数据、QC、掩膜与缺测结构；缺测使用 NaN，并使缺测、陆地或剔除值与有效极值视觉上可区分。

三、专业视觉与科学表达
- 每张图回答一个明确且可核验的问题。按数据和问题选择时间序列、剖面、断面、T-S 图、矢量场、地图、频谱或不确定性图，不为丰富版面滥用图型。
- 选图必须调用确定性路由思路：先核对数据类型、原始维度和维度顺序，再根据科学问题与 time/depth/longitude/latitude 坐标组合选择 helper/template；同一输入契约不得因措辞变化随机改图型。
- 白底、克制网格和一致线宽层级；显式设置画布尺寸、字体、字号、线宽、刻度、范围、色标、图例和导出分辨率，不依赖桌面默认值。坐标轴和色标必须同时标注物理量与单位。
- 海洋图遵守坐标约定：正向下深度应把海面置顶并说明单位；时间注明 UTC 或时区；经度采用一致的 [-180, 180] 或 [0, 360] 约定；矢量图给出单位和参考矢量；地图不得暗示未实际应用的投影。
- 连续量使用感知均匀、色盲友好的顺序或发散色表；发散色表只围绕有科学意义的参考值，并在正负变化可比时采用对称范围。除强制遗留约定外不使用 rainbow/jet，颜色不得是唯一编码。
- 色限和等值线依据物理阈值或有说明的稳健统计确定，不得用孤立极值压扁主体，也不得隐瞒裁剪。任何平滑、网格化、距平、插值或异常计算都要在图注或报告中说明方法与参数。
${guidance.fonts}

四、无头运行与导出验证
${guidance.headless}
- 任何运行时都必须让脚本非交互、失败即返回非零状态，不等待人工点击或桌面会话。
- 显式设置屏幕/纸张几何后，从同一最终 figure 导出所需 PNG 与 PDF；审阅图通常 150–200 DPI，出版图通常 300–600 DPI。优先保留 PDF 文本与矢量线条，透明度或字形后端有缺陷时说明限制并提供高分辨率 PNG。
- 进程成功不等于图件正确。逐一验证文件存在、非空、格式和像素尺寸符合预期；可视检查坐标方向、单位、时区、色限、掩膜、图例、中文、裁切，以及 PNG/PDF 的一致性。

五、manifest 与报告引用
- 每次批量绘图必须写出 JSON manifest。优先调用仓库的 oi_write_manifest；若当前运行时不能使用该 helper，则生成同等结构并说明替代方式。
- manifest 至少包含 schema_version、generated_at、generator 和 figures；每个 figure 至少包含稳定 id、title、相对 file、width、height、dpi 与 bytes。条目顺序应确定，file 不写 file:// URI、临时路径或租户绝对路径。
- 只有已成功生成、验证且列入 manifest 的图件才能进入报告。报告正文使用图号和标题引用图件，并紧邻给出数据来源、变量、单位、有效时间/空间范围、处理方法和关键限制，不能只罗列文件名。
- Markdown/HTML 和最终答复使用注入上下文给出的用户可见相对引用前缀；不得暴露宿主绝对路径。最终交付列出脚本、manifest、图件路径，以及实际运行命令、运行时版本、图形工具包、字体和兼容性妥协。
`;
}

const MATLAB_REPOSITORY_EXPORT_INSTRUCTIONS = String.raw`
【MATLAB 仓库实跑约束】

本段仅适用于 MATLAB 仓库审计导出，与前述 MATLAB helper、字体和布局建议共同生效。通用 release 能力矩阵说明 API 是否可用，不代表本仓库固定尺寸与 manifest 验证已通过。

- oi_figure(widthPixels, heightPixels, "off") 的输入是屏幕 pixels，不是最终输出的物理尺寸。绘图前、创建 axes/tiledlayout 前设置 figureHandle.Units = "inches"; figureHandle.Position(3:4) = [widthPixels heightPixels] / dpi; 例如 1200 x 675 输出像素在 300 DPI 下是 4 x 2.25 inches。不得等 oi_export_figure 导出时才缩小画布，否则点制字体与标签占位会改变。
- 在最终 inches 尺寸下，用 axes 的 OuterPosition/外框约束和真实页边距，或 tiledlayout 的 Padding/TileSpacing 为标题、刻度、图例、色条分配空间；不能只固定内框铺满画布。drawnow 后检查布局，导出后再核验；不得放宽裁切/遮挡门禁、忽略对象或改写 manifest 来掩盖失败。
- 通用 exportgraphics 自 R2020a 可用；本仓库 oi_export_figure + oi_write_manifest 的严格固定尺寸路径必须在执行前按下表选择每个请求格式的 API，不得把通用可用性当成 exact sizing 支持：

| Release | PNG | PDF | SVG |
| --- | --- | --- | --- |
| R2019b-R2024b | print -dpng | print -dpdf | print -dsvg |
| R2025a+ | exact exportgraphics | exact exportgraphics | exact exportgraphics |

- 旧版 print 是明确的预选策略，不是失败后的重试。R2025a+ 的 exact exportgraphics 按格式指定尺寸：PNG 使用 Units="pixels"、整数 Width/Height 和 Resolution=dpi；PDF/SVG 使用 Units="inches"、Width=widthPixels/dpi、Height=heightPixels/dpi；两类均保留 Padding="figure" 和 PreserveAspectRatio="on"。绘图前的 figure/layout 仍保持最终 inches，不能把原生 PNG 的尺寸参数误作屏幕画布单位。失败必须保留错误并停止，不得静默 print 重试。逐图、逐格式记录实际 export_api，并与 runtime 一致，不得把预选 API 当成实跑证据。
- runtime.export_size_units 按实际路径记录：原生 PNG 为 pixels，print PNG 为 inches，PDF 及请求的 SVG 为 inches。不做导出后 resize，不通过重采样、裁切或填边掩盖尺寸错误；本次 PNG 单位策略调整尚待 CI 验证，不得声称尺寸偏差已经修复。必须重新检查真实 PNG 像素/DPI、PDF 页尺寸及 SVG 几何，未验证项保持 unverified。
- MATLAB 字体安装证据必须来自 listfonts 或 fc-list 枚举结果的精确字体族名匹配（可忽略大小写），不得用 fc-match fallback 返回了替代字体就认定请求字体已安装。字体候选匹配不等于 PDF 字体嵌入，也不等于 CJK 字形可读；PNG/PDF/SVG 必须分别核验实际产物，未核验项保持 unverified，不得以源码文本或候选字体命中报成功。
- MATLAB 的 CJK+Latin 输出在用户未指定 FontName 且精确安装检查通过时，默认优先 WenQuanYi Zen Hei，保持主题、导出器和交互字体一致；不覆盖用户显式字体选择。字体探针 33985570222 在 R2021a/R2024b/R2026a 的 WenQuanYi Zen Hei + exportgraphics(..., "ContentType", "vector") PDF 中验证了所测中英文/数字可读、精确文本提取和字体嵌入。这是有限探针证据，不是所有字形或后端的保证。
- 该探针的原生 PDF 是内容裁剪而非精确页；R2021a/R2024b 的 print PDF 仍未嵌入，改用 WenQuanYi 默认字体不能声称已解决旧版嵌入或精确页合同，也不能据此更换严格导出策略。整图布局、最终尺寸、粗体、中文旋转轴及 PNG/SVG 仍须分别验证，不得沿用探针结果标记完成。两旧版 Noto 原生标题为 ######，Droid 原生 Latin/数字为方框，不能将它们当成等效已验证回退，也不能把这些后端失败伪报为字体未安装。
- tiledlayout 标题也必须在每个请求格式中核验文本、字形、占位和裁切；已测 layout.Text 无公开 Units/Extent/Position，必须记录未测覆盖，不能用零矩形当成完整几何，也不得仅凭现有 bounds 门禁通过认定标题完整。缺少对应产物证据时保留未验证状态。
- 所测 headless 版本中仅 drawnow 可能保留占位文字 Extent；先实际原生渲染对应状态。测量探针放在独立隐藏图中，保留相同字体、字号、旋转与 interpreter，避免干扰源 axes 的自动布局；间距使用源图最终实测几何。PNG 正常不能证明 PDF/SVG 对齐，33988300354 的重复导出及 PNG 预热未修复 R2026a 矢量文字定位。
- 海区报告的统计和图件必须绑定实际参与该次 MATLAB 运行的输入快照；核对相对路径、bytes、SHA-256 与运行记录一致，fixture 包核对 runtime.input_fixtures。报告时另读同名/同 shape 源文件不能替代运行输入；缺少运行时哈希标记 unverified，哈希不一致必须拒绝，不能刷新证据洗白。
- evaluator 的温度场和盐度剖面通过 scientific_data_contract.plot_data_evidence 记录原生图元值及 helper 返回的 QC/不确定度数组；报告必须逐项核对完整数组、顺序、缺失掩码、单位、策略、release 和输入哈希。仅输入字节绑定且声明匹配时标记 runtime_declaration_verified；缺证据仍为 not_verified，不向其他图外推。metadata 不是误差带，保留 suspect 不是 QC 筛选，声明核对不是独立重执行或视觉验证。
- 合成 fixture 必须明确标注 synthetic_benchmark/合成数据；即使 MATLAB 实跑和哈希绑定通过，也不能将其描述为真实海况、实测趋势或海区机制证据。
`;

export const MATLAB_PLOTTING_INSTRUCTIONS = [
  plottingBaseInstructions('matlab').trim(),
  '',
  matlabTaskRoutingInstructionBlock(),
  '',
  matlabCapabilityInstructionBlock(),
  '',
  matlabPlotRoutingInstructionBlock(),
  '',
  MATLAB_REPOSITORY_EXPORT_INSTRUCTIONS.trim(),
].join('\n');

export function matlabPlottingInstructions(options = {}) {
  validateInstructionOptions(options);
  const repositoryRoot = cleanContextPath(options.repositoryRoot, '.', 'repositoryRoot', true);
  const outputDirectory = cleanContextPath(options.outputDirectory, 'generated', 'outputDirectory', true);
  const manifestPath = cleanContextPath(options.manifestPath, joinPath(outputDirectory, 'figures.json'), 'manifestPath', true);
  const referencePrefix = cleanContextPath(options.referencePrefix, 'generated', 'referencePrefix', false);
  const runtime = cleanContextValue(options.runtime, 'matlab').toLowerCase();
  if (!['matlab', 'octave'].includes(runtime)) throw new Error('runtime must be "matlab" or "octave" for plotting instructions.');
  const templateDirectory = joinPath(repositoryRoot, runtime === 'octave' ? 'codex-runtime/octave' : 'codex-runtime/matlab');
  const capabilityBlock = runtime === 'octave'
    ? '【运行时路由】当前上下文显式指定 Octave；停止 MATLAB release 能力解析并转交 Octave 绘图契约。'
    : matlabCapabilityInstructionBlock({
        targetRelease: options.matlabRelease || options.targetRelease || 'R2026a',
        runtime,
        requested: options.requestedCapabilities || [],
      });
  const plotRequestBlock = options.plotRequest
    ? matlabPlotRequestResolutionBlock({
        ...options.plotRequest,
        runtime,
        targetRelease: options.plotRequest.targetRelease || options.matlabRelease || options.targetRelease || 'R2026a',
        outputDirectory: options.plotRequest.outputDirectory || outputDirectory,
        assetDirectory: options.plotRequest.assetDirectory || joinPath(templateDirectory, 'assets'),
      })
    : '';

  return [
    plottingBaseInstructions(runtime).trim(),
    '',
    matlabTaskRoutingInstructionBlock(),
    '',
    capabilityBlock,
    ...(runtime === 'matlab' ? ['', matlabPlotRoutingInstructionBlock(), '', MATLAB_REPOSITORY_EXPORT_INSTRUCTIONS.trim()] : []),
    ...(plotRequestBlock ? ['', plotRequestBlock] : []),
    '',
    '【本次可注入路径上下文】',
    `- 仓库根目录：${repositoryRoot}`,
    `- 优先模板目录：${templateDirectory}`,
    `- 绘图输出目录：${outputDirectory}`,
    `- manifest 路径：${manifestPath}`,
    `- 报告引用前缀：${referencePrefix}`,
    '- 路径上下文仅用于定位与引用；仍须先检查文件和运行时是否真实存在，不得把注入值当作已验证事实。',
  ].join('\n');
}

export function matlabPlotRequestResolutionBlock(plotRequest = {}) {
  const resolution = resolveMatlabPlotRequest(plotRequest);
  const lines = [
    '【本次 MATLAB 选图解析结果】',
    `- 状态：${resolution.status}`,
    `- 权威运行时：${resolution.taskRoute?.authoritativeRuntime || 'matlab'}`,
  ];
  if (resolution.plotRoute) {
    lines.push(`- 图型：${resolution.plotRoute.plotType}`);
    lines.push(`- helper：${resolution.plotRoute.helper}`);
    lines.push(`- template：${resolution.plotRoute.template}`);
    lines.push(`- 选择理由：${resolution.plotRoute.rationale}`);
    const publication = resolution.plotRoute.publicationPolicy;
    lines.push(`- 出版尺寸：${publication.target.width} ${publication.target.units} × ${publication.target.height} ${publication.target.units}，${publication.target.dpi} DPI`);
    lines.push(`- 字体策略：${publication.typography.fontCandidates.join(' → ') || '运行时主题候选链'}；最小正文 ${publication.typography.baseSizePt} pt`);
    lines.push(`- 可访问性：${resolution.plotRoute.accessibilityPolicy.redundantEncoding}`);
    lines.push(`- 产物级验收：${resolution.plotRoute.accessibilityPolicy.artifactVerificationStatus}；不得据此声称字形、裁剪、灰度或色觉检查通过`);
    if (resolution.plotRoute.interactive) {
      lines.push(`- 交互环境：${resolution.plotRoute.interactionPolicy.environment}；静态降级=${resolution.plotRoute.interactionPolicy.staticFallback}`);
    }
  }
  if (!resolution.ready) {
    const unresolved = resolution.plotRoute?.unresolvedRequirements || [];
    if (unresolved.length) lines.push(`- 未决项：${unresolved.join('；')}`);
    if (resolution.error?.reason) lines.push(`- 拒绝原因：${resolution.error.reason}`);
    lines.push('- 非 ready 状态禁止生成、执行或声称验证 MATLAB 脚本。');
    return lines.join('\n');
  }
  lines.push('- 已按完整数据契约生成确定性 MATLAB 源码：');
  lines.push('```matlab');
  lines.push(resolution.script.trimEnd());
  lines.push('```');
  return lines.join('\n');
}

function cleanContextValue(value, fallback) {
  const normalized = String(value ?? '').replace(/[\r\n\t]+/gu, ' ').trim();
  return normalized || fallback;
}

function cleanContextPath(value, fallback, label, allowAbsolute) {
  const normalized = cleanContextValue(value, fallback);
  if (/[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(String(value ?? ''))) {
    throw new Error(`${label} must not contain control characters.`);
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(normalized) && !/^[A-Za-z]:[\\/]/u.test(normalized)) {
    throw new Error(`${label} must be a filesystem path, not a URI.`);
  }
  if (!allowAbsolute && /^(?:[A-Za-z]:[\\/]|[\\/])/u.test(normalized)) {
    throw new Error(`${label} must be relative.`);
  }
  if (normalized.split(/[\\/]+/u).some((segment) => segment === '..')) {
    throw new Error(`${label} must not contain parent-directory traversal.`);
  }
  return normalized;
}

function validateInstructionOptions(options) {
  assertMatlabRequestJson(options, 'MATLAB plotting instruction options');
  if (!isMatlabJsonObject(options)) throw new Error('MATLAB plotting instruction options must be a JSON object.');
  const allowed = new Set([
    'repositoryRoot', 'outputDirectory', 'manifestPath', 'referencePrefix', 'runtime',
    'matlabRelease', 'targetRelease', 'requestedCapabilities', 'plotRequest',
  ]);
  const unknown = Object.keys(options).filter((name) => !allowed.has(name));
  if (unknown.length) throw new Error(`Unknown MATLAB plotting instruction options: ${unknown.sort().join(', ')}.`);
  if (options.plotRequest !== undefined && !isMatlabJsonObject(options.plotRequest)) {
    throw new Error('plotRequest must be a JSON object.');
  }
  const nestedRuntimeFields = ['runtime', 'requestedRuntime', 'matlabFirst', 'requiresMatlabNative', 'octaveFirst', 'requiresOctaveRender']
    .filter((name) => Object.hasOwn(options.plotRequest || {}, name));
  if (nestedRuntimeFields.length) {
    throw new Error(`plotRequest must not override instruction runtime fields: ${nestedRuntimeFields.join(', ')}.`);
  }
}

function joinPath(base, child) {
  const normalizedBase = String(base || '').replace(/\/+$/gu, '');
  const normalizedChild = String(child || '').replace(/^\/+|\/+$/gu, '');
  if (!normalizedBase || normalizedBase === '.') return normalizedBase === '.' ? `./${normalizedChild}` : normalizedChild;
  return `${normalizedBase}/${normalizedChild}`;
}
