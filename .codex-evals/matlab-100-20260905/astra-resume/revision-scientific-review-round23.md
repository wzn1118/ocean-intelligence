# R23 Astra 修订科学复核

审查日期：2026-09-06 UTC。范围仅为归档 R23 源码、说明、provenance 与原冻结 paired fixture 的只读核对；本轮唯一新增文件为本报告。

## 结论

未发现新版说明的科学数值错误或相对 R22 的科学处理回归。12 条原始记录、11 对主统计、10 对 good 敏感性对照、3 个深度组、QC/缺测/标准不确定度和全 12 个模型值的声明均与冻结 JSON 独立重算一致。`pair-012` 的模型值 `13.96 degC` 仍有完整原始数据保留路径，不参与配对残差。

源码差异严格限于两处字体兼容改动：增加 `oi_font_available` 依赖，以该 helper 替换仅接受 `listfonts` 的断言。说明已正确区分 fixture 的用途原文与作者概括，没有把 synthetic 数据、观测侧 U、相关性或缺测解释成真实观测、模型 U、因果或补齐值。

**新版尚未在 MATLAB 运行。** 本次重算、哈希和静态调用链核对不能证明新版构图成功、原生对象身份正确或视觉通过。旧 R22 的 R2026a 后续通过是另一份源码的历史运行结果，不移植为新版证据，也不回写模型生成时的历史说明。

## 原件与输入完整性

直接读取冻结 [paired_observation_model.json](/opt/ocean-intelligence/codex-runtime/matlab/evals/fixtures/paired_observation_model.json:1) 的现有数值；未使用 provenance 公式再生成输入，也未自建替代数据。当前 fixture 与授权隔离快照中的 fixture 逐字节一致。

| 对象 | 实读 bytes | 实算 SHA-256 |
| --- | ---: | --- |
| 冻结 paired fixture | 2771 | `dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b` |
| R22 `astra_comparison_trial.m` | 9303 | `508a8c8430c6d0d28797df1bc4256c1eca24eafe7fb816c8b77f686aa121e665` |
| R22 `astra_comparison_trial.md` | 8241 | `656c2d4025b7a6536fd50a905094fecb83e7cb2c53100c256f8cad1cad4f51e8` |
| R23 `astra_comparison_trial.m` | 9405 | `3faec2ab0fd5d7a2e5fcf43a211f3848f399e6a28eae2618566ba3ec6f4021f0` |
| R23 `astra_comparison_trial.md` | 12115 | `d79d73b4f66fc9e273158bdf5e165d517991d4ef090a3fa0233acd63c6ab9c0b` |

四件归档模型文件均与原授权生成目录中的对应文件逐字节一致；大小及哈希与各自 provenance 声明一致，R23 `revision_of` 的旧版哈希亦一致。授权原件位置为 `/opt/ocean-intelligence/.runtime/matlab-runtime-trial-source-round22/.runtime/codex-users/3530a5e0bf18f17b92006da78994de1d/generated`，R23 位于其 `revision23` 子目录。没有读取其他用户线程或 rollout 内容。

同时记录只读完整性基线，未修改以下 provenance/prompt：

| 对象 | bytes | SHA-256 |
| --- | ---: | --- |
| R22 `generation-provenance.json` | 4394 | `46e13d23b461b8d64299803a809b2f4f9c6187c4cb7d7a59cbd3f21799e0fa58` |
| R22 `generation-prompt.zh.txt` | 1716 | `4dd60bda58a58d90474beb76a692763c8a83f31cdfc6a5afdf35a9c5ee36b13b` |
| R23 `generation-provenance.json` | 5351 | `16c1ef24350afaf6c3078fdfe666d9fa843dad730a6bc128f6991391412ca8a5` |
| R23 `generation-prompt.zh.txt` | 2054 | `3be8b9c417de16b10afe1e945cc6bd374835c2957d4b1dfa7a2a94a3793c643f` |

## 原始行与统计成员

以下数值全部来自 fixture 的 `records`，温度、残差及 U 单位为 degC，深度单位为 m、正向下。时间均为 2026-08-20 UTC。`null` 在重算中明确视为缺测，绝不经 JavaScript 数值转换当成零。

| 源行 / ID | 时间 | 深度 | 观测 | 模型 | 观测 U | 观测 QC | 配对残差，模型减观测 |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |
| 1 / pair-001 | 00:00 | 10 | 17.02 | 17.10 | 0.10 | good | 0.08 |
| 2 / pair-002 | 00:00 | 40 | 15.37 | 15.51 | 0.12 | good | 0.14 |
| 3 / pair-003 | 00:00 | 70 | 13.72 | 13.93 | 0.15 | good | 0.21 |
| 4 / pair-004 | 06:00 | 10 | 17.31 | 17.35 | 0.10 | good | 0.04 |
| 5 / pair-005 | 06:00 | 40 | 15.66 | 15.76 | 0.12 | good | 0.10 |
| 6 / pair-006 | 06:00 | 70 | 14.01 | 14.18 | 0.15 | suspect | 0.17 |
| 7 / pair-007 | 12:00 | 10 | 17.38 | 17.39 | 0.10 | good | 0.01 |
| 8 / pair-008 | 12:00 | 40 | 15.73 | 15.80 | 0.12 | good | 0.07 |
| 9 / pair-009 | 12:00 | 70 | 14.08 | 14.22 | 0.15 | good | 0.14 |
| 10 / pair-010 | 18:00 | 10 | 17.16 | 17.13 | 0.10 | good | -0.03 |
| 11 / pair-011 | 18:00 | 40 | 15.51 | 15.54 | 0.12 | good | 0.03 |
| 12 / pair-012 | 18:00 | 70 | null | 13.96 | null | missing | 不计算 |

总计 12 条、12 个非空唯一 ID、12 个唯一时间-深度组合。主配对集合为 `pair-001` 至 `pair-011`，有限两侧温度且 QC 为 good/suspect；good-only 另排除 `pair-006`。原始 QC 为 good 10、suspect 1、missing 1，有限配对因 QC 排除数为 0。观测/模型/观测 U 缺测分别为 1/0/1，两个 null 同属 `pair-012`，不是两条缺失记录，也不是未匹配记录。

| UTC 时刻 | 原始行数 | 主配对数 | good-only 配对数 |
| --- | ---: | ---: | ---: |
| 00:00 | 3 | 3 | 3 |
| 06:00 | 3 | 3 | 2 |
| 12:00 | 3 | 3 | 3 |
| 18:00 | 3 | 2 | 2 |

共 4 个时刻，起止相差 18 小时；源行时间非递减，同刻不同深度合法重复。说明的 UTC、正向下、未提供地理位置/垂向基准/温度物理子类型均与输入相符。

## 数值声明独立对照

方法：只读 Node.js v22.14.0 程序直接计算冻结 JSON；报告作者记录的 v22.16.0 是原生成环境，不是本次审查环境。样本标准差分母为 `n-1`；残差为 `model-observation`；Bias、MAE、RMSE 均等权，Pearson r 由中心化两列计算。另以摄氏度百分之一整数复核残差的和、绝对值和、平方和，避免浮点尾数造成显示歧义。

下表为独立重算后按报告精度显示的结果，逐项与新版说明第 45 至 47 行相等；R22/R23 的全部 Markdown 表格行亦逐字相同。

| 11 对的变量 | 均值 | 中位数 | 最小值 | 最大值 | 样本标准差 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 合成观测温度 | 15.722727 | 15.660000 | 13.720000 | 17.380000 | 1.372269 |
| 配对模型温度 | 15.810000 | 15.760000 | 13.930000 | 17.390000 | 1.309939 |
| 配对残差 | 0.087273 | 0.080000 | -0.030000 | 0.210000 | 0.072951 |

| 统计集合 | n | Bias | MAE | RMSE | Pearson r |
| --- | ---: | ---: | ---: | ---: | ---: |
| 主配对，保留 suspect | 11 | 0.087273 | 0.092727 | 0.111600 | 0.999600354 |
| good-only 敏感性对照 | 10 | 0.079000 | 0.085000 | 0.103971 | 0.999519148 |

主配对观测和为 `172.95`，模型和为 `173.91`，残差和为 `0.96`，绝对残差和为 `1.02`，平方残差和为 `0.137 degC^2`。因此未舍入的 Bias=`0.96/11`，MAE=`1.02/11`，RMSE=`sqrt(0.137/11)`。good-only 的对应残差和/绝对值和/平方和为 `0.79/0.85/0.1081`。

全部 12 个模型值之和为 `187.87 = 173.91 + 13.96`，均值 `187.87/12 = 15.655833333333334`，对应报告 `15.655833`。这与 11 对模型均值 `15.810000` 不同，报告正确区分，未为第 12 行制造残差。

| 深度分组 | 主配对 n | 独立重算 Bias | 报告 Bias |
| --- | ---: | ---: | ---: |
| 10 m | 4 | 0.025 | 0.025000 |
| 40 m | 4 | 0.085 | 0.085000 |
| 70 m | 3 | 0.1733333333333333 | 0.173333 |

11 个有限观测 U 为四个 `0.10`、四个 `0.12`、三个 `0.15`，和 `1.33`，范围 `0.10` 至 `0.15`，均值 `1.33/11 = 0.12090909090909091`，报告 `0.120909` 正确。70 m 的有效覆盖缺 18:00，报告没有把各层解释成相同时间覆盖。

本轮自动核对提取到的 57 项报告标量声明全部一致，其中含数值、计数及输入标识检查；这是只读声明核对数量，不是 57 项原生测试、CI stage 或评分。依据为新版 [统计与科学说明](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round23/astra_comparison_trial.md:41)。

## 源码与科学语义

R22/R23 全文件 diff 仅有两个 hunk。以内存中的这两处精确替换重建新版后，与实际新版字节一致：

1. [新版第 13 行](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round23/astra_comparison_trial.m:13) 的既有 helpers 列表增加 `oi_font_available`。
2. [新版第 118 行](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round23/astra_comparison_trial.m:118) 的字体断言改为 `assert(oi_font_available(theme.FontName), ...)`，同时更新该处解释及错误消息；没有其他科学或构图处理变化。

当前 `oi_font_available`、`oi_figure`、`oi_ocean_theme`、`oi_plot_comparison` 与授权生成快照中的对应 helper 逐字节相同。本轮未声称重新验证 provenance 声明的全部 164 个快照文件。[主题选择](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_ocean_theme.m:34) 已使用同一可用性策略；[字体 helper](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_font_available.m:23) 在枚举失败时允许 Unix fontconfig 精确族名检查。改动修正判据不一致，但 helper 返回 true 不代表字形、嵌入或布局已验证，现有失败摘要也不能唯一确定原环境具体由哪项差异触发。

科学保留路径：

- [逐行读取](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round23/astra_comparison_trial.m:60) 仍处理全部 12 条记录；仅声明的观测/U null 转 NaN，模型第 12 行仍为 `13.96`。UTC、深度、QC、唯一 ID 校验及原始行序没有变化。
- [Metadata 与 helper 调用](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round23/astra_comparison_trial.m:85) 仍传递完整 ID/Time/Depth/DepthUnit/DepthDirection；观测 QC 保留 good/suspect，`UncertaintySides='observation'`，`standard_uncertainty` 显式映射为独立的 `standard-uncertainty`，不改变数值/单位，不冒充 SD、SE 或置信区间。
- [helper 配对规则](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_comparison.m:46) 在观测单侧模式下按 finite pairs 与 QC 选散点/统计，不因 U 缺失额外删除有限配对；GraphicsMask 再要求有限观测 U。该 fixture 的这些有效 mask 均为前 11 行 true、第 12 行 false，但不把本样本的巧合推广为所有输入的相同规则。
- [完整 RecordData](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_comparison.m:228) 从未过滤的原始列保存 ID、时间、深度、SourceRow 与 Observation/Model；第 12 行模型值因此具有静态保留路径。Scatter/Line 的选取和 UserData 仍由原 helper 实现，不能用这一源码检查代替真实返回对象与句柄读回。
- [QC 未提供状态](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_comparison.m:243) 与 [U 未提供状态](/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_comparison.m:392) 未变化。模型 QC/U 没有被复制或补零；水平区间仍为观测值加减 U、纵坐标为配对模型值，不产生模型侧垂直区间。
- 10 x 8.5 inches、原始标题、描述性轴标签、字体主题、raw JSON appdata、科学 contract、异常删除 figure 和直接返回 helper result 均保持原样。11 个散点和 11 条水平线仍只是源码/fixture 的预期，此次没有原生计数证据。

新版 [用途说明](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round23/astra_comparison_trial.md:3) 正确引用 `provenance.purpose` 原文 `Evaluation fixture only; not an observed ocean dataset`，明确 `synthetic_benchmark` 只是首版作者概括，不是输入字面值。这修正了 R22 的用途归属问题。说明也明确高相关不等于因果或真实预测能力、suspect 不被改成 good、缺测不插值、U 不参与加权；没有发现科学含义夸大。

## 生成与执行时间线

按归档 [provenance](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round23/generation-provenance.json:21)，两个实际修订 turn 均为 `completed`：

| Turn ID | UTC 起止 | requested_model |
| --- | --- | --- |
| `01a07444-6133-7ff1-96cc-5dcf524ddec0` | 01:10:33.537 至 01:12:36.483 | `gpt-6-astra` |
| `01a07446-418e-78b0-880f-e555e9b5bdfa` | 01:12:36.509 至 01:13:06.618 | `null` |

两个 turn context 记录的模型标识为 `gpt-6-astra`，effort 为 `high`，approval 为 `never`，sandbox 为 `danger-full-access`；第二次 requested_model 为空并不意味着 provenance 声明模型发生改变。这里只核对归档记录，不读取 rollout，也不将 CLI/provider 标识当作远端模型架构的独立认证。生成完成不等于原生通过或 100 分。

必须分开保留三种时间状态：

1. 原模型写修订说明时，收到的旧 R22 CI `34002693563` 反馈是 R2021a/R2024b 字体断言失败、R2026a 仍运行。新版说明第 7、92 行的“旧 R26 尚无结论”记录的是该历史反馈，不在本轮回写历史产物。
2. 主协调后来确认、[provenance 后续字段](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round23/generation-provenance.json:119) 记录：旧 R22 的 R2026a 已通过 synthetic native v3 与 PNG/PDF/SVG 导出，外部 artifact inspection 为 3/3；这仍不是完整视觉或总体 CI 通过。本审查未重新下载或独立执行该 native run。
3. [新版状态](/opt/ocean-intelligence/codex-runtime/matlab/tests/model-generated-round23/generation-provenance.json:106) 为 MATLAB `not_run`，visual/desktop false、real_ocean_observations false、score null。主协调已有 R2021a 模式 mh_lint 单文件通过记录；本轮未重复 lint，未将其描述为 MATLAB 语法执行或桌面验证。

后续可执行的验证对象必须是本报告锁定 SHA 的 R23 `.m`：真实 MATLAB 构图返回后读取完整 12 行 RecordData 和未绘制的 `13.96`，核对 11 对统计、11 个散点及 11 条真实水平 U 线，再单独检查目标版本的字体、标题、统计、图例与裁切。旧版结果不能替代这一步。

本轮无可用本地 MATLAB；实际操作仅为只读文件/差异/哈希/Node 重算，以及新增本审查文档。未执行模型、MATLAB、Octave、网络下载或桌面交互，未修改模型原件、provenance、checker、生产代码、现有报告或用户其他改动，未提交。
