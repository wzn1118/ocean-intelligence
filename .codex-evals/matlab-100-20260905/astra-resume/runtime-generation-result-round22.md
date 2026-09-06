# R22 内置 Astra 实际生成验收记录

2026-09-06 UTC。本次完成的是内置服务隔离实例中的两轮真实生成，不是手写代码替代模型、MATLAB 已执行或生产热更新。

## 实际执行

- 从本地提交 `587c382a7155c265abb82137b6e5ce47717b8de0` 的 `codex-runtime` 建立 git archive 快照；对应远端 `7d51e714a23442e7a132d257d1ec94c91c6dd669`。源目录 164 个已跟踪文件在生成后仍与提交字节一致。
- 使用当前容器的 CLI 0.153.4，通过独立 Node 服务 8012、独立 workspace/SQLite/tenant/owner map 执行。没有重启生产 8011，也未中断用户线程；完成后只停止该隔离服务。此次任务禁用 MCP，不取外网海洋数据。
- 从 `00:33:28.169Z` 至 `00:37:54.369Z`，线程 `01a07422-6d4a-7052-8d6a-993e40f9d46a` 完成两个 turn。首轮显式请求 `gpt-6-astra`，续轮省略 model；两轮实际 turn_context 均记录 `gpt-6-astra/high/never/danger-full-access`。provider 标识为 `OpenAI`，它是日志中的配置标识，不是对远端模型架构的独立认证。
- 首轮 `01a07422-6dd8-7e62-aa83-83c5bdad26ac`，续轮 `01a07425-f7cd-7413-86ed-8b10829a185a`。均实际 completed，没有审批事件被当作成功。读取环境时存在 command-v、缺失文件查询和容器 python3 不存在的非零退出，不声称所有工具命令成功。
- 本次加载的是上述提交的内置提示，而不是尚未提交的 R22 提示候选。初始 developer 内容仍含 round20/59-of-60 证据；不能宣称现有生产线程已同步 R22。

## 原始交付与复核

归档在 `codex-runtime/matlab/tests/model-generated-round22/`，保留模型原始 `.m` 和 `.md`，不改错字、布局或统计以制造通过。输入是固定合成评测 JSON，12 行含 11 对有效配对；缺失观测对应的第 12 个模型值 13.96 仍保留。

| 文件 | bytes | SHA-256 |
| --- | ---: | --- |
| astra_comparison_trial.m | 9303 | `508a8c8430c6d0d28797df1bc4256c1eca24eafe7fb816c8b77f686aa121e665` |
| astra_comparison_trial.md | 8241 | `656c2d4025b7a6536fd50a905094fecb83e7cb2c53100c256f8cad1cad4f51e8` |
| paired_observation_model.json | 2771 | `dfdd4a9b3270151e02b8c91970775ed10ebfc862bc8119c3cccb85b99b6f676b` |

独立复核见 `model-generated-report-review-round22.md`：57 个抽取统计标量与原始记录重算相符，包括 11 对主样本、12 个模型值、10 对 good-only、三个深度组、QC、U 和时间。唯一轻微问题是说明把作者用途概括 `synthetic_benchmark` 写成类似输入原值；输入实际 purpose 是评测 fixture、非观测海洋数据集。原件不更改，问题留档。

主线程完成 `mh_lint --brief --input-encoding utf-8 --matlab 2021a` 原源码语法检查。没有本地 MATLAB，不能以 Node 数值复核或语法通过冒充原生句柄、导出、视觉、桌面交互或全量海区报告通过。

## 新原生验收入口

`test_astra_generated_comparison.m` 加入 family-B 既有阶段，在原四正例/36 原生负例之后执行，不新增主阶段分母。驱动绑定原源码、说明、输入、prompt/provenance 和实际 helper/reader 文件，执行原函数，读取同一图窗导出前后的完整 v3 记录、原生 Scatter/水平区间和 1:1 线，再导出 PNG/PDF/SVG、写原生 manifest 并核对 bytes/hash/尺寸。不以 evaluator 自建图替换模型图。

原提示没有要求 8x5 英寸或固定短标签，因此保留模型实际选择的 10x8.5 英寸、3000x2550@300DPI 和 descriptive temperature labels。共享 reader 增加明确的 `astra-temperature-labels` 枚举；默认短标签和原科学检查不变，并另加文本 profile 正负例。不是通过任意自报标签放宽单位校验。

本记录写入时仍未开始此驱动的 licensed MATLAB CI；失败必须保留实际阶段和原件，不提高评分。生成说明中的 `not_run` 属于生成时点记录，后续 CI 另生成原生证据，不回填伪造历史字段。

## 本地证据

- `.runtime/matlab-capability-round22/activation.json`：`e1923eddcee72c54fd27c6d1cf8d3ff697196553d76489ecfa3dc3b108d86cea`。
- `/root/.codex/sessions/2026/09/06/rollout-2026-09-06T00-33-28-01a07422-6d4a-7052-8d6a-993e40f9d46a.jsonl`：`3a083ecf004b3554c4533209e9597d4bf17d750bb75f8feb27dcc41ee886f81a`。
- 初始 developer content 紧凑 UTF-8 JSON：`4685277fc0c28664c5d43daaf87139bc297f31ff86ec332efd784a0d1f3afc0a`；编码方式已存 provenance。

仅发布必要结果和哈希，完整 rollout/activation 留本机，不上传凭证或其他用户内容。上述哈希是本地可复核记录，不是签名、真实海洋数据来源认证或侧边栏十会话存在证明。
