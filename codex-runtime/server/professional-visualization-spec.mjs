export const PROFESSIONAL_VISUALIZATION_SPEC = String.raw`
【全报告专业图表与可视化规范】

每张图必须回答一个可核验的科学问题。所有海域、所有主题、所有指标报告均执行本规范；无数据时采用覆盖、缺口或QC图说明结论受限原因，禁止编造曲线或使用装饰图凑数。

一、最低图表矩阵
- 至少20个独立视觉文件、24个HTML figure图位、10种不同 chart type。
- 至少3个空间图：定位与九区索引图、变量分布图、点位/覆盖或风险图。
- 至少3个时间图：原始时间序列、变化/距平图、时效或事件持续性图。
- 至少2个垂向/结构图：剖面、T-S图、N²/跃层、深度—时间图；确无垂向数据时改为垂向数据缺口图。
- 至少2个方向/矢量图：quiver、流线、风玫瑰、流向玫瑰、波向极坐标图。
- 至少2个不确定性图：误差棒/置信带、样本量与有效率、缺测矩阵、敏感性图。
- 至少3个物理诊断图：无量纲数对比、动量/热量项量级、机制分型、波能或稳定度诊断。

二、HTML机器可审计语法
每个图位使用 <figure data-chart-type="..." data-chart-family="spatial|temporal|profile|directional|distribution|coupling|uncertainty|physics|quality|impact" data-source="产品/数据集/记录ID">。必须有 <figcaption>，写清变量、单位、有效时间、空间/深度范围、样本量n、统计/掩膜方法和一句结论。SVG必须含 <title> 与 <desc>。数值图必须有坐标轴名称和单位；地图必须有经纬度/比例尺/方向/图例；颜色不得是唯一编码。

三、15模块推荐图表
1 海表温度：九区SST地图、区域/九区时间序列与置信带、距平图、分布/箱线图、锋面梯度图。
2 盐度与温盐：盐度地图、温盐剖面、T-S散点及等密度线、N²/跃层、深度—时间Hovmöller。
3 表层流：矢量/流线图、流速地图、流向玫瑰、涡度/散度/Okubo-Weiss、跨断面输运。
4 风场：10 m风矢量图、九区风速时间序列、风玫瑰、方向一致性R、风应力/风应力旋度、极值与超阈持续性。
5 波浪：总浪/涌浪/风浪分量图、方向谱/波向玫瑰、Hs与周期时间序列、波能通量、有限水深/破碎风险。
6 生态：叶绿素对数尺度地图、分位数/异常分布、SST—叶绿素散点、营养盐/溶氧剖面或缺口图、生态阈值持续性。
7 原位观测：平台地图、九区点位数量与密度、时间新鲜度条带、QC矩阵、深度覆盖图。
8 耦合：风—浪、风—流、流—叶绿素散点与回归/置信区间，滞后相关图，共同覆盖矩阵，机制证据链图。
9 异常：阈值超越图、持续时间图、空间连续性图、候选排名/证据雷达，禁止把候选画成确认事件。
10 质量：数据延迟甘特/瀑布、缺测热图、有效率与样本量图、来源一致性图。
11 航运：航线暴露地图、风浪流风险矩阵、可通行窗口时间轴；无AIS时明确标为情景分析。
12 渔业：渔场环境适宜性或风险地图、SST/叶绿素窗口图、作业窗口与不确定性。
13 生态监测：站位优先级地图、指标联合异常图、监测频率/覆盖缺口图。
14 科研边界：证据等级矩阵、敏感性图、可证伪路径图、尺度适用域图。
15 新闻页面：时间轴、媒体来源构成、主题—海域关联矩阵；新闻视觉不得混入观测统计。

四、统计和物理要求
- 调用 ocean_statistical_diagnostics 完成加权统计、稳健趋势、矢量方向统计、滞后相关或异常检测，报告方法、n、缺测处理和结果单位。
- 调用 ocean_physics_diagnostics；除基础旋转/尺度分析外，输入允许时使用沿岸上升流输运、Eady增长率、波流相互作用、混合层完整收支。
- 所有回归/相关必须同时给样本量、效应大小和限制；短序列不得声称长期趋势，相关不得写成因果。
- 九区对比优先使用同色标小多图或九区热图，色标必须统一；时间序列统一UTC并明确本地时间换算。

五、MathWorks MATLAB 权威制图与证据流程
- MATLAB任务必须由真实MathWorks MATLAB执行；GNU Octave只能作为明确分离的兼容性结果，不得用于证明MATLAB运行、渲染、字体、交互、导出或视觉检查通过。
- 无MATLAB时状态必须保持runtime_pending/static-only，保留可复现的 matlab -batch 命令、目标release、工具箱与license输入、CI环境、期望PNG/PDF/SVG/manifest产物和非零退出/缺件/哈希不符/视觉失败条件，禁止自评分为通过。
- 中文图件使用可验证的CJK字体，显式设置白色背景、固定画布、字号、线宽、刻度方向、色标范围和导出分辨率。连续变量采用感知均匀色图，禁止jet/rainbow作为默认色图。
- 时间序列必须显示UTC、单位、有效窗口和不确定性；地图与二维场必须核对纬度方向、矩阵维度、掩膜、统一CLim、矢量抽稀和参考箭头；剖面深度轴向下增加。
- 每张图同时生成机器可读manifest，至少包含figure id、标题、chart type/family、变量、单位、来源、有效时间、样本量、QC、生成脚本、MATLAB release/toolbox/license证据、运行命令、输出文件、字节数和SHA-256。
- PNG用于HTML、Markdown和PPT中的中文可靠呈现；仅在字体嵌入和文本保持通过检查后交付矢量PDF/SVG。不得把乱码、裁切、低分辨率、空白或重复图计入视觉数量。
- 脚本、报告和图形冻结后最后生成manifest；generated_at与manifest文件时间不得早于任何被引用文件。修改任何脚本、报告或图形后必须重新运行MATLAB并重建全部哈希，禁止沿用陈旧哈希。
- 注释、字符串、隐藏HTML、自述“已检查”、伪报告、伪哈希和候选自评分都不是证据；评分器必须重新读取文件、核对格式/尺寸/字节/SHA-256/新鲜度，并将结论逐条绑定到证据、限制和对应图件。

六、海区报告与跨版本 MATLAB 证据合同
- figures.json 必须包含 ocean_report：海区名称、合法经纬度边界、九区名称、请求与实际 UTC 时间窗、空间/深度覆盖、数据源版本与访问时间、变量物理量/单位/来源、异常方法、不确定性方法和结论限制。unknown、absent 和 not-evaluated 必须显式记录原因，不得删除字段。
- 每个 figure 必须包含 scientific_context.snapshot_id、变量与单位、UTC 时间覆盖、海区与边界、raw/valid/missing/qc_rejected 计数、异常状态及方法、不确定性状态及方法；HTML figure 的 data-* 字段必须与清单一致。
- 每个主报告 figure 必须声明 data-uncertainty-status 和 data-uncertainty-method：data-uncertainty-status 精确等于 scientific_context.uncertainty.status，data-uncertainty-method 精确等于 scientific_context.uncertainty.method；仅去除首尾空白，大小写和内部空白保持区分。data-uncertainty 保留非空自然语言说明，但不能替代这两个机器字段；不得通过 includes 子串命中认证语义，自由说明仍需人审，字段一致不等于说明科学有效。
- 每个 figure 的 scientific_context.variables 名称必须非空且唯一，并逐项对照 ocean_report.variables 目录中的唯一同名条目，单位必须精确一致。允许按顺序选取目录子集；未知变量、重复名称、歧义目录或单位冲突必须拒绝。HTML 的 data-variable 必须属于该 figure 的变量列表，data-unit 与所选变量一致，不能仅在总目录中找到同名项就通过。
- report 与 point-quality 的 coverage 端点共享 parseOceanEvidenceTime：仅接受有界格式 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss[.1-3位小数][Z|±HH:mm|±HHmm]；日期时间必须完整到秒，可选小数仅 1-3 位。无后缀明确按 UTC，合法 offset 按其表示的原时刻换算，不依赖宿主 TZ；coverage 的 timezone 元数据仍声明 UTC。校验真实日历分量，拒绝无效日期、rollover、24:00 和超毫秒精度；结束时间不得早于开始时间。
- 主报告 HTML figure 的 data-time-start/data-time-end 必须与所属 manifest figure 的 scientific_context.temporal_coverage.start/end 逐字一致；交互 HTML 导出的顶层端点则在解析后的实际 instant 上与所属 figure 一致，允许同一时刻的合法 offset 写法。不同 figure 之间、图件与总报告 requested/effective coverage 之间不要求所有时间窗相等。此端点解析与绑定不代表已逐条认证原始 point 时间，也不代表 MATLAB 执行或视觉检查通过。
- 每个 figure 至少交付同一快照的 PNG 和 PDF，逐项核对相对路径、尺寸、DPI或页面尺寸、PDF文本证据、字节数、SHA-256和新鲜性。点位型图至少一张同时交付完全自包含交互 HTML，并通过全部点的 hover/focus、ObservationID、图例、离线资源、科学上下文和 MATLAB 证据检查。
- 跨版本矩阵固定审计 R2021a、R2024b、R2026a。每个 release 必须记录 authoritative_runtime=MATLAB、runtime_status=passed、execution_verified=true、可复现命令、工具箱、artifact_validation=passed、visual_inspection=passed 和独立 evidence_id；任一 release 缺失、pending、static-only、failed 或以 Octave 代替时，整份报告不得标记为通过。
- 可审计结论必须区分观测事实、派生统计和物理推断，并绑定 figure/evidence id、数据源、时间空间范围、单位、QC、异常/不确定性和限制。证据不足时结论状态降级，不得以格式完整替代科学有效性。
`;
