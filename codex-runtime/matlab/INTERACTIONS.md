# MATLAB 交互图件规范

## 双路径边界

- 桌面探索使用 `Interactive=true`。无 MATLAB desktop、`matlab -batch` 或 CI 中必须自动降级为不可见传统 `figure`，关闭数据光标和 brush，并走审计导出路径。固定尺寸 PNG/PDF/SVG 在 R2025a+ 使用精确尺寸 `exportgraphics`，旧版显式使用 `print`；不得把失败后的静默切换写成成功。
- 运行时请求必须把 `taskType="interactive"` 传入 MATLAB 路由；该路径实际调用 `interactive_timeseries_native_template.m` 并额外传入逐点元数据。普通 `create`/`export` 时间序列保持非交互生成路径，避免路由声明与实际调用不一致。
- 路由必须把出版契约解析出的 `selectedFontName` 传给交互模板，避免模板先因 CJK 候选不一致失败、随后又被通用排版代码覆盖。未显式声明布局 padding 时，交互路由沿用模板的 `loose` 外边距；显式出版契约可覆盖并由运行时边界检查负责拒绝裁剪风险。
- `UseUIFigure=true` 只在桌面路径生效。`ExportMode="auto"` 对 `uifigure` 使用 `exportapp` 捕获完整 UI，对传统 figure/layout 使用 `exportgraphics` 保留科学图层与矢量 PDF。
- 显式 `ExportMode="app"` 不允许静默降级；缺少 desktop、`uifigure` 或目标 release 不支持 `exportapp` 时立即失败。
- `UseUIFigure=true` 与显式 `ExportMode="graphics"` 不兼容：仓库的 `oi_export_figure` 只接收传统 figure。需要出版图时使用 `UseUIFigure=false`，需要完整 UI 时使用 `ExportMode="app"`，不得运行到导出阶段才以无效句柄失败。
- `ExportTarget="interface"` 表示 `exportapp` 的完整界面快照目标，不等同于出版图；`ExportTarget="plot"` 表示传统 figure 的可复现出版导出目标。`ExportPerformed` 只在本次调用实际写出文件时为真，`PublicationExport` 还要求目标为 `plot`；两条路径必须分别检查，不能用界面快照替代字体嵌入、裁剪和矢量内容验证。
- `interaction.headless.verified` 只表示本次实际执行的是无界面静态路径；桌面交互成功时必须保持 `false`，不能把静态能力声明当作运行证据。
- 调用方必须同时检查 `ManifestAvailable`、`ManifestReason` 和 `ExportAPI`。传统 figure 的 PNG/PDF 及可选 SVG 由审计 helper 返回 manifest entry；`exportapp` 只生成界面 PNG/PDF，固定返回 `ManifestAvailable=false`，不得伪造发布 manifest 或把界面快照登记为出版图。

## DataTip 与样本身份

- 优先使用图元局部 `DataTipTemplate`/`dataTipTextRow`，逐点绑定时间、物理量、稳定 `ObservationID`、站位和 QC；所有行必须与绘图数据同长度、同顺序。
- 过滤、排序或掩膜后必须验证 `ObservationID` 非缺失且唯一。图元 `UserData` 保存 ID 和源行映射，brush 选择通过 `BrushData` 映射为稳定 ID，不从 marker 颜色或显示序号推断身份。
- 若调用方需要追溯过滤前记录，必须在任何筛选或排序前写入唯一正整数 `SourceRow`。模板保留该列并返回 `GetSelectedObservationIdentity()`；未提供时生成的 `SourceRow` 只代表函数入口顺序，不能冒充原始数据行。
- `DataTipTemplate`、自定义 `UpdateFcn` 和 brush 都必须使用同一份图元 `UserData`，并在读取前复核 `ObservationID`、`SourceRow` 与图元点数一致。自定义提示从元数据读取时间、数值、单位和源行，避免图元属性被单独改写后静默错配。
- 自定义 `datacursormode.UpdateFcn` 仅限传统 figure 的显式降级，必须检查 `event.Target`、`event.DataIndex`、句柄和索引范围；不得访问 `gca`、`gcf`、base workspace、网络或磁盘。
- 回调必须同时检查 `DataIndex` 对 `XData`、`YData` 和每个必需元数据字段都有效；可选不确定度字段不完整、ID 缺失或事件已失效时返回固定的无害提示，不得抛出二次错误。

## 离线 HTML 逐点记录

- HTML 与 MATLAB table 使用不同机器字段约定。单一、无歧义的 `application/json` 点模型中，每条记录提供 `observation_id`、`temperature`、`unit`、`time`、`longitude`、`latitude`、`qc`；原 `ObservationID`、`Time`、`TemperatureUnit` 等字段可原样保留，但不能仅靠这些 PascalCase 名称满足 HTML 校验。其他物理量、单位、逐项 QC 和来源元数据也须保留，别名不改变原值或语义。
- 每个实际点元素的 `data-observation-id` 与模型记录一致；`data-point-index` 是该 JSON 数组的零基索引。原始一基 `source_row`、`source_file_row` 独立保存，不能兼作点索引。过滤、排序后仍保留显式排列，重新核验点、原记录与数组索引的对应关系。
- 点元素保留同条记录的 `data-temperature`、`data-unit`、`data-time`、`data-longitude`、`data-latitude`、`data-qc`，可键盘聚焦，实际绑定 `pointerenter` 与 `focus`，具有 `:hover`、`:focus-visible` 样式和真实详情输出。静态工具只能证明有限绑定与声明，不能证明 handler 展示内容正确。浏览器须实测桌面与手机的鼠标、键盘、触摸、密集重叠点、提示裁切、焦点与指针冲突。
- `data-anomaly-status` 仅使用 `present`、`absent`、`unknown`、`not-evaluated`，未评估不能写成 `not_assessed`。缺失的原生执行、导出和视觉证据仍为 pending/unverified；HTML 字段及浏览器交互通过都不能给 MATLAB release、执行、图件和视觉字段补签。

## 科学语义

- `Time` 必须是逐行对齐、无 `NaT`、带时区且严格递增的 `datetime`；声明 `TimeZone` 时必须与数据一致。时间轴固定为正向，只有坐标相容的面板才能按 x 轴联动；单个有效观测也是合法输入。
- 物理量名称、单位、站位、QC 和 ID 去除首尾空白后不得为空。若 table 的 `VariableUnits` 已声明，必须与调用参数一致；模板不进行隐式单位换算。
- `NaN` 保留为缺口。QC 逐点原样展示并汇总，不把 suspect/rejected 自动当作缺测或过滤；brush 始终返回原始稳定 ID。
- 交互不确定度支持非负对称幅度，或成对的置信区间上下界。两者都必须逐点对齐、与值使用同一单位，并写入误差棒、`DataTipTemplate` 和 `UserData`；置信区间还必须给出 `ConfidenceLevel` 且包围完整观测。

## Brush、linked axes 与 linkdata

- 传统 figure 使用显式 figure 句柄创建 brush 模式，通过 `ActionPostCallback` 把瞬时 `BrushData` 复制为应用管理的稳定 ID 集合。`uifigure` 从 R2023a 起按 axes 启用 `brush(ax, "on")`/`datacursormode(ax, "on")`，读取选择时再从各图元 `BrushData` 汇总稳定 ID。关闭窗口时禁用 brush/data cursor、清除回调和 appdata，避免悬挂生命周期。
- brush 汇总必须拒绝长度不一致、非 0/1 状态、缺失、空白或重复的图元 ID 元数据。关闭路径必须容忍 mode 句柄已被用户删除，并在仍有效时同时清空 `ActionPostCallback`/`UpdateFcn` 后再删除 figure。
- 同时间轴面板优先 `linkaxes(axesHandles, "x")`；它只同步视图，不改变科学数据。
- `linkdata` 仅用于调用方长期持有且同时维护数值数组、稳定 ID 和 QC 映射的工作区。模板默认不启用 `linkdata`，因为函数局部变量在返回后失去可刷新生命周期，且 linked-data 编辑可能使逐点元数据错位。
- 若应用另行启用 `linkdata`，必须记录所有 `XDataSource`/`YDataSource`/ID source，禁止数据长度或顺序单独变化，并在关闭或数据源失效前执行 `linkdata(fig, "off")`。

## 静态交付

- pinned data tip、brush 高亮和 toolbar 状态不是静态交付内容。报告需要展示选择时，应从显式稳定 ID 生成普通 annotation/text/table，再验证 PNG/PDF。
- PNG/PDF 必须来自同一最终图或 UI 状态；传统 figure 可额外请求 SVG。导出后检查文件存在、格式签名、尺寸、字节数和 SHA-256，并记录实际 `exportgraphics`、`print` 或 `exportapp` API；没有实际 MATLAB 时只能报告静态契约通过，不能声称渲染或交互已验证。
- 构造阶段可用 `onCleanup` 关闭半成品 figure，但成功返回前必须显式把 figure 所有权转交调用方；直接 `clear` 一个仍会关闭 figure 的 cleanup 对象不构成所有权转移。

## 实机验收与证据

- 自动化脚本位于 `.codex-evals/matlab-100-20260905/interaction/run_interaction_acceptance.m`。它使用自生成、先过滤再排序且携带预变换 `SourceRow` 的数据，验证 DataTip、Brush、稳定 ID/源行映射、重复回调、关闭后安全调用、预期异常后的 figure 清理，以及 PNG/PDF 静态导出。
- Desktop 必须从带桌面的 MATLAB 进程执行，而不是 `matlab -batch`：`matlab -r "addpath('.codex-evals/matlab-100-20260905/interaction'); run_interaction_acceptance('desktop','<fresh-output-dir>'); exit"`。脚本要求 `usejava('desktop')==true`，否则失败。
- headless 门禁使用全新目录执行：`matlab -batch "addpath('.codex-evals/matlab-100-20260905/interaction'); run_interaction_acceptance('headless','<fresh-output-dir>')"`。脚本要求 `usejava('desktop')==false`、`HeadlessFallbackUsed==true`、交互关闭且 PNG/PDF 非空。
- 每次运行必须生成 `<mode>-interaction-evidence.json`、`<mode>-interaction.png` 和 `<mode>-interaction.pdf`，再执行 `node .codex-evals/matlab-100-20260905/interaction/validate_interaction_evidence.mjs <evidence.json>`。证据缺字段、模式不符、任一自动检查失败、产物为空、SHA-256 不匹配或运行状态不是 `passed` 都必须使校验失败。
- 自动证据不等同于视觉证据。验收人员仍须分别打开 PNG/PDF，检查字体、裁剪、标记、线型、DataTip 可读性和 brush 对应点，并按 `EVIDENCE_FORMAT.md` 写人工审核记录；没有该记录时保持 `runtime_pending`。

## 出版质量与可访问性

- 交互模板通过 `listfonts` 或 Unix fontconfig 字体族枚举的精确匹配确认字体候选。可用 `FontName` 显式指定字体，但只要标题、物理量、站位、QC 或 ID 含 CJK 字符，该字体也必须属于配置的 CJK 候选。无候选统一以 `CJKFontUnavailable` 失败，不静默退回 `Helvetica` 或删改中文；`fc-match` 的替代结果不构成请求字体已安装的证据。
- 候选匹配不等于字体嵌入或字形正确。输出固定记录 `FontName`、`CJKTextPresent` 和 `FontRenderingVerified=false`；只有实际检查各格式字体和字形后，外部验证流程才能提升验证状态。33985570222 的字体探针支持文泉驿在三个版本的原生矢量 PDF 中呈现中英文，不能据此代签完整图件、旧版精确纸张或桌面交互。
- 标题、坐标轴和标签统一使用同一字体、`Interpreter="none"`、高对比文字色和浅色背景。主/次序列同时使用颜色与线型/marker 区分，不让颜色成为唯一编码；误差棒保持独立深灰形状编码且不抢占数据提示。
- `tiledlayout` 使用紧凑面板间距与宽松外边距，降低中文标题、长单位和刻度在导出边界被裁剪的风险。仍须在最终 PNG/PDF 上检查文字范围、标记边缘和页面裁剪，代码属性本身不构成视觉验证。
