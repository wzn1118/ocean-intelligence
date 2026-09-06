# R22 Astra 生成报告独立数值复核

复核时间：2026-09-06 UTC。工作区 HEAD：`587c382a7155c265abb82137b6e5ce47717b8de0`。仅新增本文，不修改生成代码、生成说明、provenance、输入或测试，不提交。

## 结论与唯一发现

- **未发现已声明统计错误。** 主 11 对、全部 12 个模型值、good-only 10 对、三个深度组、观测不确定度及 QC/缺测/时间计数均与独立重算一致，显示末位舍入正确。输入及两份生成文件的 bytes/SHA-256 与 provenance 相符，归档与授权原件 byte-exact。
- **P3，来源措辞需区分作者分类与输入原值。** [生成说明第 3 行](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round22/astra_comparison_trial.md:3)写“用途为 `synthetic_benchmark`”，但输入没有这个字段或字面值；实际 [provenance.purpose](/opt/ocean-intelligence/codex-runtime/matlab/evals/fixtures/paired_observation_model.json:11) 为 `Evaluation fixture only; not an observed ocean dataset`。作为作者对用途的概括并无科学方向错误，但不宜表现为 JSON 原值。建议后续另行勘误为“用途为评测 fixture，非观测海洋数据集”，保留本次 byte-exact 原件。
- **未发现把 synthetic 当真实海区、把观测 U 当模型 U/样本标准差/95% CI、把缺测补值、或把相关当因果的误述。** 源码与该固定输入上的说明口径一致。以下原生对象数量、掩膜、布局均为源码预期，不是 MATLAB 执行结果；不评定分数。

## 范围与完整性

读取的归档目录为 `/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round22/`，包括 `.m`、`.md`、`generation-provenance.json`、`generation-prompt.zh.txt`。仅读取用户指定的原件目录：

`/opt/ocean-intelligence/.runtime/matlab-runtime-trial-source-round22/.runtime/codex-users/3530a5e0bf18f17b92006da78994de1d/generated/`

输入比较双方为 `/opt/ocean-intelligence/codex-runtime/matlab/evals/fixtures/paired_observation_model.json` 和 `/opt/ocean-intelligence/.runtime/matlab-runtime-trial-source-round22/codex-runtime/matlab/evals/fixtures/paired_observation_model.json`。未读取其他用户线程、rollout 或会话内容。

| 文件 | 实测 bytes | 实测 SHA-256 | 比对结果 |
| --- | ---: | --- | --- |
| `paired_observation_model.json` | 2771 | `dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b` | 当前输入 = 隔离输入 = provenance；生成说明第 7 行也吻合 |
| `astra_comparison_trial.m` | 9303 | `508a8c8430c6d0d28797df1bc4256c1eca24eafe7fb816c8b77f686aa121e665` | 归档 = 原件 = provenance |
| `astra_comparison_trial.md` | 8241 | `656c2d4025b7a6536fd50a905094fecb83e7cb2c53100c256f8cad1cad4f51e8` | 归档 = 原件 = provenance |

本轮按原始 Buffer 计算 SHA-256，并用 `Buffer.equals` 比较内容，没有文本换行归一化。另确认静态追踪使用的 `oi_plot_comparison.m`（39281 bytes，`e8df5b2a70f6d62c80ad551492e6323f6830fd4e3bbfbe7ee2ba36d6d030e217`）及 `oi_apply_axes.m`（4237 bytes，`41d85cbca83bcc54c43c4764ab842931d0764ff203cd0cd046f370b810cc5739`）均与隔离快照及 provenance 对应条目一致；没有据此声称复核了全部 164 个快照文件。

provenance 记录的 `gpt-6-astra/high/never/danger-full-access`、两轮 `completed` 与用户给定背景一致。本轮只核对授权归档中的记录，未独立认证远端模型身份或重新读取会话证据；这些字段不等于 MATLAB 成功、视觉通过或 100 分。

## 独立计算方法

使用本轮本机 Node.js `v22.14.0`，仅 `fs`、`crypto`、`assert` 和标准数学运算；未运行模型、MATLAB、Octave、网络或海洋 MCP。生成说明自报的 Node.js `v22.16.0` 不是本轮运行环境，不将两者混称。

只解析输入 `records`，不使用 fixture 的生成公式、helper 的计算结果或评测 builder 作为数值来源。`null` 显式排除，未经 JavaScript 数值强制转换成零。先确认所有有限温度/U 均为百分位数，再以百分位整数求和、平方和及协方差分子；随后另用原始浮点数、去均值算法独立复算并从 `.md` 抽取声明值进行断言。**57 个抽取标量对照全部通过**，这是一次性数值核对数量，不是 CI 测试通过数；逐行记录、时间和语义另按下文核对。

- 主样本：`finite(observation) & finite(model) & qc in {good,suspect}`。
- good-only 对照：主样本再限制 `qc == good`。
- `d = model - observation`；Bias 为 `sum(d)/n`，MAE 为 `sum(abs(d))/n`，RMSE 为 `sqrt(sum(d^2)/n)`。
- 样本标准差分母为 `n-1`；Pearson r 为去均值交叉乘积和除以两侧平方和乘积的平方根。
- U 的均值/范围只统计原始有限 `uncertainty_degC`；没有按 U 加权、填值、重新生成或改行序。

## 原始行与配对依据

下表全部日期为 `2026-08-20`，时间为 UTC；温度、残差和 U 均为 `degC`，深度为 `m, positive_down`。源行从 1 开始，JSON 行号对应[输入记录](/opt/ocean-intelligence/codex-runtime/matlab/evals/fixtures/paired_observation_model.json:14)。`null` 保持原始缺失语义，不表示零。

| 源行 / JSON 行 | ID | UTC | 深度 | observation | model | obs U | QC | model-observation | 主配对 / 水平段预期 |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | --- |
| 1 / 14 | pair-001 | 00:00 | 10 | 17.02 | 17.10 | 0.10 | good | 0.08 | 是 / 是 |
| 2 / 15 | pair-002 | 00:00 | 40 | 15.37 | 15.51 | 0.12 | good | 0.14 | 是 / 是 |
| 3 / 16 | pair-003 | 00:00 | 70 | 13.72 | 13.93 | 0.15 | good | 0.21 | 是 / 是 |
| 4 / 17 | pair-004 | 06:00 | 10 | 17.31 | 17.35 | 0.10 | good | 0.04 | 是 / 是 |
| 5 / 18 | pair-005 | 06:00 | 40 | 15.66 | 15.76 | 0.12 | good | 0.10 | 是 / 是 |
| 6 / 19 | pair-006 | 06:00 | 70 | 14.01 | 14.18 | 0.15 | suspect | 0.17 | 是 / 是 |
| 7 / 20 | pair-007 | 12:00 | 10 | 17.38 | 17.39 | 0.10 | good | 0.01 | 是 / 是 |
| 8 / 21 | pair-008 | 12:00 | 40 | 15.73 | 15.80 | 0.12 | good | 0.07 | 是 / 是 |
| 9 / 22 | pair-009 | 12:00 | 70 | 14.08 | 14.22 | 0.15 | good | 0.14 | 是 / 是 |
| 10 / 23 | pair-010 | 18:00 | 10 | 17.16 | 17.13 | 0.10 | good | -0.03 | 是 / 是 |
| 11 / 24 | pair-011 | 18:00 | 40 | 15.51 | 15.54 | 0.12 | good | 0.03 | 是 / 是 |
| 12 / 25 | pair-012 | 18:00 | 70 | null | 13.96 | null | missing | 不计算 | 否 / 否 |

主样本为 `pair-001` 至 `pair-011`；good-only 再去掉 `pair-006`。`pair-012` 是已按源行配对但观测缺失，不是未匹配记录；其模型值仍进入“全部 12 个模型值”统计。

## 主 11 对统计

对应[生成说明统计表](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round22/astra_comparison_trial.md:24)。下列每项均按报告显示精度吻合，额外小数只是本轮复核展示，不增加测量精度。

| 对象 | 指标 | 报告值 | 独立重算 |
| --- | --- | ---: | ---: |
| observation | n | 11 | 11 |
| observation | 均值 | 15.722727 | 15.722727272727 |
| observation | 中位数 | 15.660000 | 15.66 |
| observation | 最小值 | 13.720000 | 13.72 |
| observation | 最大值 | 17.380000 | 17.38 |
| observation | 样本标准差 | 1.372269 | 1.372268857834 |
| 配对 model | n | 11 | 11 |
| 配对 model | 均值 | 15.810000 | 15.81 |
| 配对 model | 中位数 | 15.760000 | 15.76 |
| 配对 model | 最小值 | 13.930000 | 13.93 |
| 配对 model | 最大值 | 17.390000 | 17.39 |
| 配对 model | 样本标准差 | 1.309939 | 1.309938929874 |
| 残差 | n | 11 | 11 |
| 残差 | 均值 / Bias | 0.087273 | 0.087272727273 |
| 残差 | 中位数 | 0.080000 | 0.08 |
| 残差 | 最小值 | -0.030000 | -0.03 |
| 残差 | 最大值 | 0.210000 | 0.21 |
| 残差 | 样本标准差 | 0.072951 | 0.072950792880 |
| 主配对 | MAE | 0.092727 | 0.092727272727 |
| 主配对 | RMSE | 0.111600 | 0.111599934832 |
| 主配对 | Pearson r，无量纲 | 0.999600354 | 0.999600353934470 |

可追溯中间量：观测和 `172.95`，配对模型和 `173.91`，残差和 `0.96`，绝对残差和 `1.02`（均为 degC），残差平方和 `0.137 degC^2`。因此 `RMSE = sqrt(0.137/11)`，而非残差样本标准差；二者没有混用。

## 全模型、good-only 与深度组

[全部模型均值声明](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round22/astra_comparison_trial.md:41)：`n=12`，和为 `173.91 + 13.96 = 187.87 degC`，均值 `15.655833333333 degC`，报告 `15.655833` 正确，与配对模型均值 `15.81` 明确区分。补充复核值（原报告未声明）：中位数 `15.65`，范围 `[13.93,17.39]`，样本标准差 `1.358364379641 degC`。

[good-only 对照](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round22/astra_comparison_trial.md:43)准确使用 10 对，没有把该对照当作图的主口径：

| 指标 | 报告值 | 独立重算 |
| --- | ---: | ---: |
| n | 10 | 10 |
| Bias，degC | 0.079000 | 0.079 |
| MAE，degC | 0.085000 | 0.085 |
| RMSE，degC | 0.103971 | 0.103971149845 |
| Pearson r | 0.999519148 | 0.999519147619198 |

对应残差和 `0.79`、绝对残差和 `0.85 degC`、残差平方和 `0.1081 degC^2`，分别从主样本减去 suspect 的 `0.17`、`0.17`、`0.0289`。这只是敏感性对照，不认证 suspect 为 good。

[三个深度组声明](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round22/astra_comparison_trial.md:45)均吻合：

| 深度 m | 原始行 / 主配对 / good 对 | 主配对 ID 后缀 | 残差和 degC | 报告 Bias | 重算 Bias degC | 有限观测时间 UTC |
| ---: | --- | --- | ---: | ---: | ---: | --- |
| 10 | 4 / 4 / 4 | 001,004,007,010 | 0.10 | 0.025000 | 0.025 | 00,06,12,18 |
| 40 | 4 / 4 / 4 | 002,005,008,011 | 0.34 | 0.085000 | 0.085 | 00,06,12,18 |
| 70 | 4 / 3 / 2 | 003,006,009 | 0.52 | 0.173333 | 0.173333333333 | 00,06,12 |

报告正确指出 70 m 的最后时刻观测缺失，不能称三个深度具有相同有效时间覆盖。三个组是说明文件独立做的补充统计；函数未传 `ConfounderValues`，故 helper 原生散点默认一个 `All pairs` 组，不应期待 `result.StratifiedMetrics` 自动返回这三个深度组。原说明没有声称图按深度分组。

## U、QC、缺测与时间

[观测 U 声明](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round22/astra_comparison_trial.md:53)：有限值 11 个，由 `0.10 x 4`、`0.12 x 4`、`0.15 x 3` 构成，和 `1.33 degC`，范围 `[0.10,0.15] degC`，均值 `1.33/11 = 0.120909090909 degC`，报告 `0.120909` 正确。另 1 个 `null` 在 `pair-012`。没有模型 U 数组，不能把该侧状态换成 12 个零。

水平段按每行 `X=[observation-u,observation+u]`、`Y=[model,model]` 计算。11 行均具有正 U，因此本输入没有退化零长段；例如 `pair-003` 为 `X=[13.57,13.87], Y=[13.93,13.93]`，`pair-006` 为 `X=[13.86,14.16], Y=[14.18,14.18]`，`pair-007` 为 `X=[17.28,17.48], Y=[17.39,17.39]`。这些是输入算出的预期端点，未当作读取到的原生 Line 数据。垂直 U 段预期为 0，`pair-012` 无散点/线段但保留模型值。

| 计数项 | 独立结果 | 与说明关系 |
| --- | --- | --- |
| 原始记录 / 唯一非空 ID | 12 / 12，pair-001 至 pair-012 | 吻合 |
| 观测 / 模型 / 观测 U 缺失字段数 | 1 / 0 / 1 | 两个 null 在同一记录，不是两条缺失配对 |
| 有限主配对 / 配对缺失 / 未匹配两侧 | 11 / 1 / 0,0 | 行对齐，不作时间 join |
| 观测 QC good / suspect / missing | 10 / 1 / 1 | 原始标志保留 |
| 有限配对因 QC 被排除 | 0 | missing 行本就不是有限配对，不能再计为 QC rejected |
| 模型 QC / 模型 U | 均未提供 | 不推断全 good 或零 U |
| 有限 U / 主配对缺 U / 预期水平段 | 11 / 0 / 11 | 对本输入三者一致，不等于通用必须同 mask |
| 唯一时间 / 深度 / 时间-深度组合 | 4 / 3 / 12 | 同时刻三层，ID 和组合均不重复 |

时间均合法、显式 `Z` 且源序非递减；最早 `2026-08-20T00:00:00Z`，最晚 `2026-08-20T18:00:00Z`，跨度 18 小时。相邻独立时刻间隔 6 小时。重复 timestamp 是跨深度记录，不表示重复采样 ID。

| UTC 时刻 | 原始记录 | 主配对 / 有限 U | good / suspect / missing QC | obs / model / U 缺失数 |
| --- | ---: | --- | --- | --- |
| 00:00 | 3 | 3 / 3 | 3 / 0 / 0 | 0 / 0 / 0 |
| 06:00 | 3 | 3 / 3 | 2 / 1 / 0 | 0 / 0 / 0 |
| 12:00 | 3 | 3 / 3 | 3 / 0 / 0 | 0 / 0 / 0 |
| 18:00 | 3 | 2 / 2 | 2 / 0 / 1 | 1 / 0 / 1 |

## 源码与说明一致性

此处仅追踪已读取的函数和 helper，不声称 MATLAB 解析、图形构建或回调执行已通过，也不替代 Laplace 负责的 native driver/reader 文本 label 兼容检查。

| 说明事项 | 静态依据与结论 |
| --- | --- |
| 只读给定输入，不重建合成数值 | [函数第 19 行](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round22/astra_comparison_trial.m:19)使用 `fileread/jsondecode`；第 60 行逐源行取字段。未使用 provenance formula；观测、模型、U 均由记录读取。 |
| synthetic 与单位不变 | [函数第 26 行](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round22/astra_comparison_trial.m:26)要求 synthetic=true；第 36 行严格要求 UTC、positive_down、degC、standard_uncertainty、preserve。没有位温推断、单位换算或地理位置补值。 |
| null/QC/U 保留，非有限无穷值不当普通数值 | [函数第 65 行](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round22/astra_comparison_trial.m:65)逐行转换；第 75 行要求 missing QC 与观测缺失一致，有限 U 不能伴缺失观测；第 145 行将解码的缺失形式变为 NaN。固定输入中两个 null 均符合这一分支。 |
| 主配对包含 suspect，缺 U 不额外删有限配对 | [函数第 123 行](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round22/astra_comparison_trial.m:123)显式传 good/suspect 和 observation-only U；[helper 第 46 行](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_comparison.m:46)先建立有限/QC mask，仅 both 模式额外限制配对，观测单侧仅限制 GraphicsMask。 |
| 观测 U 类型独立，模型侧未提供 | [函数第 129 行](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round22/astra_comparison_trial.m:129)映射为 `standard-uncertainty`，不传 ModelQC、ModelUncertainty 或 ConfidenceLevel；[helper 第 391 行](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_comparison.m:391)初始化模型侧 `not_provided`，单侧路径不补模型值；第 536 行起的水平段函数不会在此模式创建垂直段。 |
| 12 行 metadata 和真实源序身份 | [函数第 78 行](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round22/astra_comparison_trial.m:78)UTC 解析并往返/非递减校验，不排序或压缩重复时间；第 85 行传 ID/Time/Depth/DepthUnit/DepthDirection，SampleLabels=ID。[helper 第 228 行](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_comparison.m:228)保留完整 observation/model，生成 1..12 SourceRow 与 call_entry_order；第 531、565 行按绘图 mask 绑定 Scatter/Line.UserData。 |
| result 不伪造验证结果 | [函数第 135 行](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round22/astra_comparison_trial.m:135)直接返回 helper 结果；[helper 第 168 行](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_comparison.m:168)返回 masks、metrics、完整 QC/U 和 RecordData。说明中的均值/中位数/样本 SD、good-only、全模型与深度组统计不是该 result 的新增字段。 |
| 单个传统不可见 figure、页面与标题 | [函数第 111 行](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round22/astra_comparison_trial.m:111)创建 off figure，设 10 x 8.5 inches 后创建 axes，使用明确 OuterPosition/PositionConstraint；title 直接取 fixture.title。helper 设相同 limits、equal aspect、圆点及 1:1 虚线；[helper 第 149 行](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_comparison.m:149)的 legend title 明示水平观测 U 和模型 U 未提供。尚未验证实际尺寸、布局或裁切。 |
| 原文和科学声明仅存 appdata，无导出副作用 | [函数第 132 行](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round22/astra_comparison_trial.m:132)存 fixtureText 和 scientific_data_contract，不写文件、manifest 或执行状态；第 137 行异常删除本次 figure 并 rethrow。正常成功返回由调用方关闭；无 path 或全局配置写入语句。 |

对本固定输入，源码预期为一个 Scatter 对象含 11 个点、11 个原生水平 Line；不是 11 个 Scatter 对象。12 行 `FinitePairMask/PairedMask/QCAcceptedMask/GraphicsMask` 在本例都为前 11 行 true、末行 false；`MissingCount=1, QCRejectedCount=0, ValidCount=11`。完整 `RecordData.Model(12)=13.96`，模型 QC/U 返回仅未提供状态。上述是后续原生执行应核验的预期，不是本轮生成的 native proof。

## 科学表述与执行边界

报告明确 synthetic、非业务验证、不补地理位置/垂向基准、不推断温度子类型；按原值计算残差，没有把它们称作已知真实模型误差界限。观测标准不确定度被严格区分于样本标准差、标准误、95% CI 和双方合成不确定度。suspect 被保留而未改 good，missing 未插值，最后一条模型值未被误丢进配对残差。关于极高总体 r，报告明确不推因果、真实预测能力或显著性，并揭示时间/深度结构和不等覆盖。因此未发现相应科学误述。

本轮 `command -v matlab` 无输出、退出码 1；没有运行 MATLAB，也未重复主线程已完成的 mh_lint。provenance 的 lint passed 是既有记录，不是本轮独立原生执行。`requireScientificContract` 和 JSON appdata 是代码声明，不是执行输入哈希绑定或对象读回证据。原说明亦明确该边界，没有把静态代码或生成轮次 completed 当作执行完成。

最小后续动作仍为用已归档原函数和同 SHA 输入执行既定三版 native driver/reader，核实上述真实对象、完整 12 行和布局；本轮不另写 driver、不改 label 兼容实现、不覆盖原件、不生成伪 MATLAB 证据，也不把数值正确提升为视觉/交互通过或 100 分。
