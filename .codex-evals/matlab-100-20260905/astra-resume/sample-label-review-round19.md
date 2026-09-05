# 第19轮 SampleLabels 独立复核

结论：当前 diff 未发现确定性缺陷。合法 row/column cellstr 改为正例正确；现有13个标签负例均应由当前 metadata 分支拒绝，未发现类型或形状规范化导致的再次误判。这是源码审查结论，不是 MATLAB 回归实跑结果。

## 审查快照

- HEAD：`e9ca42d6346ca46420d526023f10da1fc5ac2fc8`；测试文件含主线程未提交 diff。
- `/opt/ocean-intelligence/codex-runtime/matlab/tests/test_comparison_record_metadata.m`
  SHA256：`9bb52af0d4200bf184a478bf2c5b9d40b7808bc98e417c299d6f400bcc03e690`
- `/opt/ocean-intelligence/codex-runtime/matlab/assets/oi_plot_comparison.m`
  SHA256：`4db32bceead30874bb2556f0e00fd9e28a7cd69c15da725ee1646c4ac82f5d78`
- 两文件审查前后 SHA256 一致；本轮仅新增本文，未编辑 helper 或测试，未提交。

## 正例覆盖

- 测试第15行外层是1x2 cell，循环分别取出12x1和1x12 cellstr；不是逐个字符标签调用。
- helper 第83行先验证文本类型，`string(labelInput)` 后先检查 `isvector`，再用 `(:)` 与完整 `RecordID` 比较。两种合法向量的顺序相同，均应接受。
- 两个新正例均完整调用 `run_case`：第109行构造并精确核对全部9个 `RecordData` 字段，包含12条 pre-filter 记录及缺测行仍有的 model=13.96。
- 第163行调用原生检查：枚举真实 Scatter/Line，核对所有散点及每条 U 线的 X/Y、父对象、可见性、`UserData` 的精确字段集合及 ID/SourceRow/SourceRowOrigin；不是仅检查 result 声明。
- QC、配对、缺测、U 掩码和全量原始 U 仍按输入核对。`run_case` 返回完整 `result.Metrics`，第17行以 `isequaln` 与无显式标签的基线比较，包含相关系数及单位；不是仅比较数量。

## 负例逐类核对

| 当前负例 | 应拒绝原因 |
| --- | --- |
| `[]`、混有 `{42}` 的 cell、`char(labels)` | 非允许的文本输入；最后一项是12行 char 矩阵，不是允许的 char row。类型断言在转换前执行。 |
| `""`、`labels(1:11)`、`cell(0,1)` | 空值或数量不匹配完整12个 ID，不能以省略标签处理。 |
| `flipud(labels)`、`wrongLabels`、对应的两个 cellstr | 文本转换不会重排或修正错误 ID，完整顺序比较失败。 |
| 3x4 string、3x4 cellstr | 转换后的矩阵先在 `isvector` 处失败；不会先展平后错误接受。 |
| `SampleLabelVariable=""` | metadata 分支禁止该字段出现，空值也由第80行显式断言拒绝。 |

这些路径的预期标识均为 `oi_plot_comparison:SampleLabels`，与第449/453行及 `must_throw` 的前缀和片段检查匹配。
另保留的 `RecordMetadata.ID=cellstr(...)` 负例属于不同契约：该字段仍严格要求 string，预期 `oi_plot_comparison:RecordMetadata`，不应随 SampleLabels 正例一起放宽。
无 RecordMetadata 时走旧 `resolve_sample_labels` 分支；其较宽松转换规则不能用于否定本轮 metadata 负例。

## 验证与边界

- 实际执行 `mh_lint --matlab 2021a --ignore-config --brief` 检查上述两文件：`2 file(s) analysed, everything seems fine`；测试 diff 空白检查无报错。
- 本机无 MATLAB，未执行新正负例、原生导出、桌面操作或视觉验收。官方 string 页面本轮访问返回502，未取得内容作为依据。
- 两个新增 cellstr 正例为无分组的12记录场景；未增加 cellstr 与分组/重排的组合，也未新增 `StratifiedMetrics` 的跨表示基线对照。
- R2021a 原生 Sample DataTip 行按现有兼容分支不检查，但 Scatter/U Line 的 UserData 身份检查不跳过。
