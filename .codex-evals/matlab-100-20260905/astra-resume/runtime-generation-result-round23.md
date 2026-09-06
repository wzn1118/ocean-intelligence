# R23 内置 Astra 原线程实跑修订记录

2026-09-06 UTC。延续 R22 的真实模型线程，根据 licensed MATLAB 的实际错误反馈生成修订，不由协调者手修模型源码来制造通过。

## 原版本真实结果

运行 [34002693563](https://github.com/wzn1118/ocean-intelligence/actions/runs/34002693563) 对应远端提交 `0f6779785896bf3b2a7257ac72287d83cffec8ff`，GitHub API 已由主线程核实为 completed/failure。主阶段合计 58/60：R2021a、R2024b 各 19/20，R2026a 为 20/20；原始评分均为 90/100，仍是 runtime_pending。不能用阶段计数代替最终质量门禁。

R2021a/R2024b 在原模型函数第 118 行触发 `astra_comparison_trial:FontUnavailable`。函数尚未返回，不能宣称这两个版本已有模型图的 v3 或导出。R2026a 则真实执行原始 9303 字节函数，完成同图导出前后完整 v3、PNG/PDF/SVG 和 manifest。独立外检三格式 3/3 通过，输出见 `/tmp/matlab-run-34002693563/matlab-full100-R2026a/family-b/astra-comparison-trial/`，检查结果在 `/tmp/astra-round22-R2026a-rendered-audit.json`。

独立视觉复核 `astra-rendered-review-round23.md` 确认三格式标题、轴标签和图例完整，PDF 字体嵌入，11 个点及水平观测 U 可见。但 PNG 统计文字与顶刻度粘连、矢量图间距紧、字号不一致、参考线穿点等问题仍存在。自动外检通过不等于该图完全视觉通过，更不是全量绘图、中文字体、桌面交互或真实海区报告获得 100 分。

## 实际续轮

- 复用原线程 `01a07422-6d4a-7052-8d6a-993e40f9d46a`、原独立 tenant 和 SQLite，以归档提交 `587c382a7155c265abb82137b6e5ce47717b8de0` 的服务代码启动隔离 8012。生产 8011 未重启，未刷新其模块缓存或其他用户线程。
- 01:10:33.537Z 至 01:12:36.483Z，turn `01a07444-6133-7ff1-96cc-5dcf524ddec0` 显式请求 `gpt-6-astra`；01:12:36.509Z 至 01:13:06.618Z，turn `01a07446-418e-78b0-880f-e555e9b5bdfa` 省略 model 续轮。两轮均实际 completed。
- 两轮实际 turn_context 均为 `gpt-6-astra/high/never/danger-full-access`。CLI 0.153.4，provider 日志标识 OpenAI；这些是运行配置证据，不是独立模型架构认证。未把审批事件、创建空线程或父代理模型配置当作实际生成。
- 模型将修订放入独立 `generated/revision23/`，原 R22 源码、说明及 fixture 字节未改。原归档的 164 个源文件再次逐文件核对 Git blob 身份，全部一致。任务禁用 MCP，未获取真实海洋数据，没有本地 MATLAB。
- 两轮结束后停止本次隔离服务，未留下一个实际已完成却被报告为仍活跃的生成进程。本批仓库提示与报告 status 候选尚未加载到该旧快照实例或生产 8011。

## 原样归档

`codex-runtime/matlab/tests/model-generated-round23/` 保存原始修订、中文 prompt 和 provenance。协调者没有编辑模型 `.m` 或 `.md` 内容。

| 文件 | bytes | SHA-256 |
| --- | ---: | --- |
| astra_comparison_trial.m | 9405 | `3faec2ab0fd5d7a2e5fcf43a211f3848f399e6a28eae2618566ba3ec6f4021f0` |
| astra_comparison_trial.md | 12115 | `d79d73b4f66fc9e273158bdf5e165d517991d4ef090a3fa0233acd63c6ab9c0b` |
| generation-prompt.zh.txt | 2054 | `3be8b9c417de16b10afe1e945cc6bd374835c2957d4b1dfa7a2a94a3793c643f` |

函数差异仅为增加既有 `oi_font_available` 依赖、将强制 `listfonts` 枚举断言替换为该 helper，并增加模型自己的说明注释。字体可用性不等于真实字形、嵌入或视觉认证。说明修正输入 purpose 原文并保留旧失败记录。12 条原始记录、11 对配对、QC、单侧 U、未绘制模型值 13.96、10x8.5 英寸和描述性轴标签均保留，未补造模型侧 QC/U。

`revision-scientific-review-round23.md` 独立重算冻结输入，核对57项数值/计数/标识声明全部一致，含good-only敏感性与深度分组。四件原始/修订文件、输入及provenance前后hash不变；该复核不是新的MATLAB执行。

反馈发送时 R2026a 尚在运行，模型说明中的当时 pending 属于历史记录。其后首版 R2026a 成功在 provenance 单独记录，不回填伪造生成时点。修订版 `.m` 已通过 R2021a 语法检查，新的三版本 MATLAB 执行、导出和视觉检查仍待下一轮 CI。

原生 driver 增加固定 `round22` / `round23` 枚举及分别锁定的源文件、说明、prompt/provenance 字节与 hash；默认仍可验收原版。family-B 本轮选择 round23，完整原生数据、同图、样式、导出前后 v3 和负例门槛不变。原版和失败 CI 全部保留，不计作已修复或删除错误证据。

## 本地证据与边界

- 新 activation：`.runtime/matlab-capability-round23/activation.json`，SHA-256 `6cee5925206ebb1cecaa598b67807db58abbafaea3c634e17eb320dd83f87424`。
- 续轮后 rollout：`/root/.codex/sessions/2026/09/06/rollout-2026-09-06T00-33-28-01a07422-6d4a-7052-8d6a-993e40f9d46a.jsonl`，SHA-256 `accdcd48fb5b6c889340d290dea9c705d0943331e8f4eacc558e63a8e6ae95d4`。
- 因同一 rollout 随续轮增长，R22 原记录提前保存在 `.runtime/matlab-capability-round22/rollout-before-revision.jsonl`，仍为原 SHA-256 `3a083ecf004b3554c4533209e9597d4bf17d750bb75f8feb27dcc41ee886f81a`。

完整 rollout、activation、凭证与其他用户数据不上传。这些是可复核的本地哈希记录，不是签名；本次没有真实海区数据、完整模型生成海区 HTML/DOCX 报告或十个侧边栏会话同时活跃的证明。
