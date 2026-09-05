# 第四批 R2024b 报告输入绑定独立核验

核验时间：2026-09-05T19:12:38Z。结论：本包输入字节绑定、报告统计及限定声明核验通过；未发现本次核验范围内的具体不一致，不代表整套 CI 或生产验收通过。

## 范围与方法

- 产物根目录 B：`/tmp/matlab-run-33985570222/matlab-full100-R2024b/evaluator-runtime`。
- 源 fixture 目录 S：`/opt/ocean-intelligence/codex-runtime/matlab/evals/fixtures`。
- 独立使用 Python 标准库读取原始字节、解析 JSON、复算 SHA-256，以 40 位 Decimal 从快照数值复算统计；未调用报告生成器生成或覆盖报告，未重跑 MATLAB。
- 检查记录 ID、路径、源文件名、bytes/hash、逐字节内容、逐图选择范围、坐标、单位、缺测、QC、不确定度和引用；12 个导出文件另核对签名/尺寸/页数及清单、证据、报告表格中的 bytes/hash。
- 本轮只新增此文档；代码、源 fixture、旧产物、score/audit、freeze、其他代理文件均未修改，未提交。

## 已验证

1. `matlab-runtime.json.input_fixtures` 恰有三个不同的固定 ID，路径均为 `fixture-inputs/<source_file>`，无越界或符号链接。每份快照与 S 下同名原文件逐字节一致；runtime、report-evidence 的输入记录、fixture 摘要和 E1-E3 引用的 bytes/hash 均一致。三个主图分别绑定对应输入，交互图绑定温度输入第三行 50 m。
2. `runtime_fixture_binding.status=verified` 有上述字节核验支撑。报告第 13 行已使用新绑定声明；未残留“没有输入哈希”的旧包结论。E1-E3 为包内相对路径，四图 PNG/PDF/SVG 引用均可解析。
3. evidence 内的 report、runtime、manifest bytes/hash 与原件一致；`ocean-report.log` 对报告和 evidence 的 bytes/hash 也一致。runtime 为 `R2024b`，manifest 及每图为 `2024b`，规范化后一致。manifest 时间 `2026-09-05T18:58:21.072Z` 与 evidence 对应时间解析后一致，报告生成时间为 `2026-09-05T18:58:25Z`。
4. 12 个导出文件的 bytes/hash 与 manifest、evidence、报告第 67-78 行一致。PNG/SVG 为 2400 x 1500 px；PDF 为 576 x 360 pt、各 1 页；SVG viewBox 为 576 x 360。尺寸核验不等于科学图像内容或可读性验收。

## 科学统计

独立复算与 evidence 数值绝对差小于 `1e-12`，Markdown 三位小数统计及四位小数相关系数与复算一致。下表 QC 顺序为 good/suspect/missing。

| 输入或选择 | 原始/有效/缺测 | QC | 有效值均值 | 输入标准不确定度均值 |
|---|---:|---:|---:|---:|
| 温度 depth x time = 4 x 6 | 24/23/1 | 22/1/1 | 15.643217391304347 degC | 0.10478260869565217 degC |
| 盐度 depth x time = 6 x 3 | 18/17/1 | 16/1/1 | 33.34176470588235 g kg-1 | 0.01752941176470588 g kg-1 |
| 观测-模式同记录完整配对 | 12/11/1 | 10/1/1 | 观测 15.72272727272727、模式 15.81 degC | 观测侧 0.12090909090909091 degC |
| 温度第三行 50 m 交互序列 | 6/5/1 | 4/1/1 | 14.6288 degC | 0.11 degC |

- 配对误差按 model - observation：bias `0.08727272727272727`、MAE `0.09272727272727273`、RMSE `0.11159993483217387` degC，Pearson r `0.9996003539344700`；误差不超过观测侧标准不确定度为 `8/11`。双方均值使用相同 11 条完整记录；保留 suspect `pair-006`，排除观测缺测 `pair-012`，模式侧无缺测。没有虚构模式不确定度或联合置信区间。
- 网格数值、不确定度和 QC 的缺测位置一致：温度零基索引 `[2,2]`，即 50 m / 2026-08-01T08:00:00Z；盐度 `[4,1]`，即 80 m / 2026-08-12T06:00:00Z。交互缺测为 `temp-050m-003`，零基时次索引 2。不插补、不填零，suspect 未被筛掉。
- 时间/坐标逐项匹配源数据：温度 08-01 00:00 至 20:00、深度 `[0,25,50,75]` m；盐度 08-10 06:00 至 08-14 06:00、深度 `[0,20,40,60,80,100]` m；配对 08-20 00:00 至 18:00、深度 `[10,40,70]` m。年份均为 2026、时间均为 UTC、深度正向下。网格垂向参考为 synthetic sea surface，配对参考未提供；无命名海区及经纬度。
- 报告第 18、45-46、82-86、91-96 行忠实区分：有限单元/完整配对等权、输入不确定度描述统计、合成而非实测、来源元数据存在而非图上已筛选/呈现。四图的 QC `plot_filtering` 和不确定度 `plot_display` 均为 `not_verified`。

## 原件指纹

下表前四项相对 B；日志相对 B 的父目录。三份输入表中的 bytes/SHA-256 同时适用于 `B/fixture-inputs/<source_file>` 与 `S/<source_file>`，本次已逐字节比较，不仅比较 JSON 语义。

| 原件 | bytes | SHA-256 |
|---|---:|---|
| report.md | 9759 | `0d40df943f2dca1a2186044131629070c74cf27fecf9c3f2b4785cac2b4bed9c` |
| report-evidence.json | 38230 | `ef1e6df4c23be2cbb9cc21187e6fc5cbce622d7427104cbb4aac7bd3042238fc` |
| matlab-runtime.json | 1259 | `be439f048413a557902b1a0b2108fdea6911a923bc26369b2c05eeeb1a38948f` |
| figures.json | 45623 | `8dacac199bba7b74a283bb7083fac23f78e16a9f84fda172fbc009cdc686fc10` |
| ocean-report.log | 491 | `7fef8b80037714d03b06948f3185b932a8da1b4c2b1893debeb8027c1edfaa27` |

| 固定 ID | source_file | bytes | SHA-256 |
|---|---|---:|---|
| crossed-time-depth-temperature | crossed_time_depth_temperature.json | 2323 | `ca8ff03c0fc54351bcd7055546c5f2a84ccdb3b4d88882a660820ac779307a21` |
| paired-observation-model | paired_observation_model.json | 2771 | `dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b` |
| repeat-cast-salinity-profiles | repeat_cast_salinity_profiles.json | 2113 | `8c30bc832e0c958ea0795466e18a382ff6452998d57e9d4322d2775678135943` |

## 未验证边界与交接

- 输入与输出文件完整性已核验，但未独立重新执行 MATLAB，也未证明所有图像像素都忠实呈现了已绑定的输入。字节哈希不是运行过程真实性的签名认证。
- 报告第 85 行的前三图未传 QC/不确定度数组，与只读查阅的 `7c6c436` 版 gate 调用相符；交互调用传入了相关字段，不能由此提升为质量筛选或视觉验收。保留当前报告的 `not_verified` 状态，不建议仅凭输入绑定改为 applied/rendered。
- DataTip、Brush、headless 成功来自 runtime 原件断言，本轮只验证转录一致性；桌面验证、人工视觉、中文字体、PDF 字体嵌入未在本轮检查。source 中的说明公式没有重新生成核对，不将输入标准不确定度均值解释为估计量误差。
- 结论仅覆盖本批 R2024b evaluator/report。该包其他 CI 阶段仍有失败，不能据此声明全套通过；R2021a、R2026a 本批没有完整报告链，未扩大验证结论。
- 独立复核前后，B 下 19 个文件及 S 下三份 fixture 共 22 个原件 SHA-256 不变；本轮无代码修复请求、无评分更新，可交主线程第五批 CI。
