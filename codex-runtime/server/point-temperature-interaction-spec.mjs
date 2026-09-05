export const POINT_TEMPERATURE_TOOLTIP_FIELDS = Object.freeze([
  '点位标识或名称',
  '温度值与温度单位',
  '观测或有效时间',
  '经度与纬度',
  'QC 状态或质量标志',
]);

export const POINT_TEMPERATURE_EVIDENCE_ATTRIBUTES = Object.freeze([
  'data-snapshot-id',
  'data-source',
  'data-variable',
  'data-unit',
  'data-time-start',
  'data-time-end',
  'data-timezone',
  'data-spatial-coverage',
  'data-qc-summary',
  'data-uncertainty',
  'data-anomaly-status',
  'data-authoritative-runtime',
  'data-matlab-release',
  'data-runtime-status',
  'data-execution-verified',
  'data-artifact-validation',
  'data-visual-inspection',
]);

export const POINT_TEMPERATURE_INTERACTION_SPEC = String.raw`
【点位温度图交互与交付强制规范】

本规范适用于包含可枚举温度观测点的时间序列、散点图、剖面图、地图、热图及多面板图。可枚举点是能够对应到单条观测记录、站位记录或网格抽样记录的可视数据标记；不得仅依赖静态图注替代逐点信息。

一、逐点 hover 与键盘 focus 提示
- 所有可枚举温度点都必须同时支持鼠标 hover 和键盘 focus，二者显示同一组提示内容；不得只为抽样点、异常点、当前系列或鼠标可达点提供提示。
- 每个数据点必须可被键盘导航或由等价的可聚焦元素触达，并具有可辨识的焦点样式；提示不得仅通过颜色、坐标轴估读或浏览器 title 属性表达。
- 聚合、抽稀或大数据量渲染不得静默删除逐点可访问性。若为性能采用聚合视图，必须提供可切换或可检索的逐记录交互视图，覆盖全部可枚举温度点。

二、提示字段
- 每个 hover/focus 提示必须显示点位标识或名称、温度值与温度单位、观测或有效时间、经度与纬度、QC 状态或质量标志；温度单位必须明确标注。
- 每条记录必须携带非空且全局唯一的稳定 ObservationID；渲染元素必须同时保存连续 data-point-index 和对应 data-observation-id，并与内嵌数据逐点一致，禁止用显示序号、颜色或排序后行号代替身份。
- 时间必须包含时区或明确标注 UTC；经纬度必须标注方向或采用带正负号的十进制度；缺失字段必须显示“缺失/未知”，不得省略字段或伪造值。
- 多系列点还必须标明所属系列；同一位置存在重叠记录时，必须能够逐条访问并区分时间、系列或记录标识。

三、排序、过滤与生命周期
- 过滤或排序只能改变显示顺序，不得重建 ObservationID；需要追溯源记录时，必须在变换前保存 SourceRow 或等价源键，并在 DataTip、Brush/选择结果和自动化证据中同时核对稳定 ID 与源键。
- hover、focus、brush、选择和关闭回调必须绑定到实际点集合或实际图元，不得以注释、说明字符串、全局未绑定处理器或静态标签冒充；重复触发、图窗关闭、句柄删除及异常退出必须安全清理回调和交互模式。
- 无 desktop 或 headless 执行必须自动关闭交互并走确定性静态导出；静态成功不能声明桌面 DataTip、Brush 或回调已验证，桌面成功也不能替代 headless 门禁。

四、多系列图例
- 所有包含两个及以上数据系列的图必须提供图例，图例名称与提示中的系列名称一致，并能区分颜色、线型、点型或面板编码。
- 图例不得被裁切、遮挡或仅依赖颜色区分；静态与交互版本中的系列名称、顺序和编码必须一致。

五、交付格式
- 在交付静态 PNG 和/或 PDF 之外，必须同时交付一个自包含交互 HTML；静态文件不能替代交互 HTML。
- 自包含交互 HTML 必须内嵌运行所需的数据、样式和脚本，离线打开即可使用，不得依赖 CDN、远程接口、本机服务、外部 JavaScript/CSS 文件或绝对文件路径。
- 交互 HTML 必须保留全部逐点 hover/focus 提示、键盘导航、多系列图例和必要的无障碍语义；PNG/PDF 与 HTML 必须使用同一数据快照、单位、时间口径、QC 口径和系列编码。
- 交互 HTML 的 html、body、main 或顶层 section 必须声明 data-snapshot-id、data-source、data-variable、data-unit、data-time-start、data-time-end、data-timezone="UTC"、data-spatial-coverage、data-qc-summary、data-uncertainty 和 data-anomaly-status，且 snapshot id 必须与 PNG/PDF 清单一致。
- 只有真实 MATLAB 验证通过时，才可声明 data-authoritative-runtime="MATLAB"、data-matlab-release、data-runtime-status="passed"、data-execution-verified="true"、data-artifact-validation="passed" 和 data-visual-inspection="passed"；Octave、static-only、runtime_pending 或未审图状态不得伪装成通过。

六、交付前验收
- 枚举渲染数据中的全部温度点，验证每一点均可通过 hover 和 focus 打开提示，并逐项核对点位、温度单位、时间、经纬度和 QC。
- 对过滤和排序后的数据逐点核对 data-point-index、ObservationID 与源键；模拟 brush/选择并确认返回的稳定 ID 不随显示顺序改变。
- 重复触发回调，关闭图窗并制造一次预期异常，确认无残留图窗、回调或交互模式；分别记录 desktop 与 headless 的真实执行状态。
- 对每张多系列图验证图例存在且系列集合完整；对交互 HTML 断网加载，确认无外部资源请求且交互仍可使用。
- 核对交互 HTML 顶层科学上下文、MATLAB release、执行状态、制品校验和视觉检查字段，并与 figures.json、PNG、PDF 的 SHA-256、时间窗、空间范围、变量单位及 snapshot id 逐项一致。
- 任一温度点缺少 hover/focus 提示、任一必填字段缺失、任一多系列图缺少图例，或未交付自包含交互 HTML，均视为绘图交付不合格。
`;

export function pointTemperatureInteractionInstructions() {
  return POINT_TEMPERATURE_INTERACTION_SPEC;
}
