# 合成观测—模型比较：隔离构图实测

本说明仅针对 `paired_observation_model.json`，其 `synthetic=true`、用途为 `synthetic_benchmark`。这些数值来自确定性合成 fixture，并非真实海区观测、业务模式验证或海况趋势。统计直接读取 JSON 中的数值，不用 provenance 公式重新生成或补齐记录。

## 输入与计数

来源：仓库相对路径 `codex-runtime/matlab/evals/fixtures/paired_observation_model.json`；fixture ID：`paired-observation-model`；schema_version：1。输入共 2771 字节，SHA-256 为 `dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b`。该哈希仅标识本次统计读取的输入，不是 MATLAB 运行输入绑定证据。

记录时段为 2026-08-20 00:00:00 至 18:00:00 UTC，含 00、06、12、18 时四个时刻；每时刻有 10、40、70 m 三层。时间允许重复，因为同一时刻对应不同深度；原始行序保持不变。深度为正向下，垂向基准及经纬度未提供，不补作海面基准或地理位置。温度物理子类型未定义，不推断为位温等其他变量。

| 项目 | 数值与口径 |
| --- | --- |
| 总记录 / 独立稳定 ID | 12 条 / 12 个，`pair-001` 至 `pair-012` |
| 有效配对 | 11 对：两侧温度有限，观测 QC 为 good 或 suspect |
| 配对缺失 | 1 条；并非未匹配记录 |
| 观测温度 / 模型温度 / 观测标准不确定度缺失 | 1 / 0 / 1 个字段值，两个缺失字段均在 `pair-012` |
| 观测 QC | good 10 条，suspect 1 条，missing 1 条 |
| 有限配对因 QC 被排除 | 0 对；suspect 按 preserve 策略保留 |
| 模型 QC / 模型不确定度 | 均未提供；不是全 good，也不是零不确定度 |
| 原生水平不确定度线段 | 按接口预期为 11 条；尚未运行 MATLAB 核验 |

## 配对样本统计

以下采用同一组 11 对样本，包含 `pair-006` 的 suspect 记录。温度及差值单位均为 degC（摄氏度）；标准差采用样本标准差，分母为 n−1。数值由 Node.js v22.16.0 对原始 JSON 实际计算，末位按显示精度四舍五入。

| 变量 | n | 均值 (degC) | 中位数 (degC) | 最小值 (degC) | 最大值 (degC) | 样本标准差 (degC) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 合成观测温度 | 11 | 15.722727 | 15.660000 | 13.720000 | 17.380000 | 1.372269 |
| 配对模型温度 | 11 | 15.810000 | 15.760000 | 13.930000 | 17.390000 | 1.309939 |
| 配对残差，模型减观测 | 11 | 0.087273 | 0.080000 | -0.030000 | 0.210000 | 0.072951 |

令残差 `d_i = model_i - observation_i`，等权计算 `Bias = sum(d)/n`、`MAE = sum(abs(d))/n`、`RMSE = sqrt(sum(d^2)/n)`，Pearson r 按两侧去均值后的协方差与平方和计算。不按不确定度加权，不插值、不平滑、不裁点。

| 配对指标 | 实算值 |
| --- | ---: |
| Bias | 0.087273 degC |
| MAE | 0.092727 degC |
| RMSE | 0.111600 degC |
| Pearson r | 0.999600354，无量纲 |

全部 12 个模型值的均值为 15.655833 degC；这不是配对模型均值。`pair-012` 的模型值 13.96 degC 必须保留，但因观测缺失，不得为它计算配对残差。

只取 good 的 10 对作为 QC 敏感性对照时，Bias 为 0.079000 degC、MAE 为 0.085000 degC、RMSE 为 0.103971 degC、r 为 0.999519148。该对照只用于说明保留 suspect 的影响，不改变构图函数的 11 对口径，也不表示 suspect 已被确认有效。

总体相关系数很高仍不能推出因果或真实预测能力。该合成设计共同包含时间和深度变化；按 10、40、70 m 分组时，有效对数分别为 4、4、3，Bias 分别为 0.025000、0.085000、0.173333 degC。最后一组缺少 18:00 UTC 的观测，跨层比较并非完全相同的有效时间覆盖。这里不作显著性检验，也不把合成结构解释成海洋机制。

## QC 与标准不确定度

`pair-006` 为 06:00 UTC、70 m：观测 14.01 degC，模型 14.18 degC，观测标准不确定度 0.15 degC，QC 为 suspect。原标志保留，参与本次 preserve 口径；不把它改成 good。

`pair-012` 为 18:00 UTC、70 m：观测和观测标准不确定度均为 JSON null，模型为 13.96 degC，QC 为 missing。函数逐行将声明的 null 转为 NaN；原始 JSON 文本仍保存在 figure 的 `ASTRA_FixtureJSON` appdata 中。

11 个非缺失观测标准不确定度介于 0.10–0.15 degC，均值 0.120909 degC。输入语义 `standard_uncertainty` 显式映射到 helper 的 `standard-uncertainty`，没有数值或单位换算。水平线段端点为 `[观测−u, 观测+u]`，纵坐标固定为对应模型温度。它不是 95% 置信区间，不是观测样本标准差，也不是模型误差或双方合成不确定度；未提供模型不确定度，无法计算双方合成误差界限。若另有有限配对缺少观测 u，helper 保留该散点与统计，仅不绘制该水平线段。

## 函数接口与构图约定

`[figureHandle, result] = astra_comparison_trial(fixturePath)` 读取传入文件的全部记录。调用方先将本仓库 `assets` 和此函数所在目录加入 MATLAB path；函数自身不硬编码工作区路径，不改 path 或全局配置。

函数直接调用 `oi_plot_comparison`，采用 numeric row-aligned 输入，并提供严格的 `RecordMetadata`：逐行 string ID、UTC datetime、深度、m 和 positive_down。`result` 直接返回 helper 的结果，未另造统计或执行状态；其中 `RecordData` 保留全部原始行、未绘制数值、时间、深度与身份，`QC` 和 `Uncertainty` 保留逐行标志、数值及提供状态。原生 Scatter 与水平 Line 的 `UserData` 由 helper 绑定 `RecordID`、`SourceRow` 及 `call_entry_order`。

单个传统 figure 初始不可见，构图前设为 10 × 8.5 inches，坐标轴使用外框约束保留边距。标题保持原文 `Synthetic observation-model comparison with stable identities`，坐标、统计和图例沿用英文与 degC；样本为圆点，1:1 参考为虚线，两轴由 helper 设置为相同范围与等比例。外置图例另说明水平标准不确定度和模型侧未提供。字体复用 `oi_figure` 缓存的项目主题并检查 `listfonts` 精确枚举；实际字体与字形仍须在 MATLAB 验证。

机器可读 `scientific_data_contract` 与 `requireScientificContract=true` 保存于 figure appdata：包含原始 shape、维序、观测维、MATLAB 类型、坐标、单位、缺测掩膜、QC 和不确定度语义。数值非法时拒绝，不通过整理维度或填值解决。正常返回后 figure 由调用方负责关闭；构图异常会删除本次 figure 并重新抛出原异常。

按本次隔离实测的专用交付要求，函数仅构图，未采用服务器自动生成并导出图件的路径；没有 PNG/PDF、交互 HTML、manifest 或测试 reader 调用。未启用桌面交互模式。R2021a 的 helper DataTip 有版本降级，完整元数据保留不等于逐点交互已经验证。

## 本次验证范围

本机 PATH 中 `command -v matlab` 无结果，常见 MATLAB 安装目录也未发现可执行文件，因此本机可用 MATLAB 状态为 `runtime-unavailable`，错误码为 `MATLAB_RUNTIME_UNAVAILABLE`，`execution_verified=false`。未启动 MATLAB，没有实际 release、工具箱许可证、渲染器或字体执行证据；未使用 Octave、网络或海洋 MCP。

实际检查包括：只读输入解析与 SHA-256、记录及缺测/QC 计数、上述数值计算、函数签名和 helper 参数对照、逐行保留策略、禁止写文件/导出/reader 操作的源码检查。Node.js 不能验证 MATLAB 语法、图形对象行为或三版兼容性；本机也没有 MATLAB `checkcode` 可供执行。

目标为 R2021a/R2024b/R2026a，源码采用这些版本具备的 MATLAB API，依赖项目 helper 和 MATLAB 基础产品，无额外工具箱要求。后续需在实际三版 MATLAB 中调用本函数，核验返回 figure、11 个散点、11 条原生水平线段、完整 12 行元数据、等轴范围、标题/统计/图例及裁切。原生执行、视觉质量和桌面交互均待验，未评定分数。

实际生成文件：`generated/astra_comparison_trial.m` 和 `generated/astra_comparison_trial.md`。
