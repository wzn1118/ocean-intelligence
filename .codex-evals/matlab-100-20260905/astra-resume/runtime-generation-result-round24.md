# 第二十四轮真实 Astra Argo 候选

## 实际结果

原线程 `01a0747b-ae57-74e2-a5d1-1e23a7176d7d` 已真实恢复。原生成轮在六个文件产生后被协调器九分钟试跑限时中断，仍是 **incomplete**。后续只读复核轮 completed，不给旧生成轮补签，也不把试跑超时归类为 MATLAB 失败。候选尚未执行 MATLAB，完整报告 `complete=false`。

| 回合 | 实际 turn id | 时段 UTC | 结果 |
| --- | --- | --- | --- |
| 原生成 | `01a0747b-ae88-7eb2-845f-76d14aba3fe5` | 02:10:57 至 02:19:58 | 8次实际工具调用，六个文件产生，限时 interrupted |
| 原线程只读复核 | `01a07489-b34c-7e10-8d01-55a38eb5059f` | 02:26:16 至 02:28:07 | 3次实际工具调用，completed，六文件字节不变 |

两个实际 turn_context 均为 `gpt-6-astra/high/never/danger-full-access`，CLI `0.153.4`、provider id `OpenAI`。这是运行配置记录，不是远端模型架构的独立认证。工具记录为 rollout 中的 `custom_tool_call`，不能只统计 `function_call` 而误报零调用。

## 环境与恢复

使用本地提交 `3fdbdf559f396a5f07056304fa67f46755b007e2` 的183文件只读快照。网络为现有 private bridge，系统 CA bundle 只读挂载到标准路径，保留 TLS 校验。此前两次真实网络失败留存；Node HEAD 成功不等于原生 CLI 传输成功。补齐 CA 后才观察到模型工具调用和实际文件。

恢复时验证原 rollout、六份原件及线程归属，复制已停止自有容器的 SQLite 和原 rollout 到新的隔离输出。通过真实 thread/resume API 恢复同一 ID，没有伪造线程数据库行或新建替代线程。完整旧 rollout 的848664字节仍是新 rollout 的原样前缀。

新旧容器均只使用独立 output/home/SQLite、只读源快照和认证挂载；MCP为0。仅停止删除自有容器，生产容器身份和启动时间、快照183源文件均未改变。此流程不是生产服务热更新、桌面侧边栏会话创建或定时自动化。

## 原件绑定

| 文件 | bytes | SHA-256 |
| --- | ---: | --- |
| `astra_argo_trial.m` | 22579 | `aaed9d3606d52f43bdefbfe220a6a187e311a4c78109f1191ca3b2c2ad548df0` |
| `astra-argo-round24.md` | 9819 | `b2baec1748545efa399c2458a368c378de678be740679baabcedfafdf4c12099` |
| `astra-argo-round24.html` | 14193 | `1ba3be4da1d0fe7a33386ab7e6a0c9a192c0a2c5607051cec4d81da7059b5722` |
| `astra-argo-round24-points.html` | 1664512 | `c7bd461ec48afeb15e2769a0540d1954c7cc213b9f009ec5e29114db69489bfb` |
| `astra-argo-round24-figures.json` | 12832 | `d4de30b147bedfc08e99eefbc615c4319e801cac6e1a0a5a8ec0b5fa66f6c397` |
| `astra-argo-round24-build.mjs` | 38137 | `54828522c5f4cb407f4f45f7b9a0df4664c145ffa077625feca460f6f5507906` |

原输入58061字节，SHA-256 `33959a0d9296cf3d0739375d0d551550d493dddbe3aa8cc3606b67ac7df0b7fa`。一平台、三次离散剖面，原顺序067/066/065分别595/596/594层。压力是decibar，不是米制深度；上游真实性未独立认证，无不确定度则保留未提供。

源码、Markdown、原始输入及两份原提示已逐字节归档到 `codex-runtime/matlab/tests/model-generated-round24/`；其他四份候选产物仍在本地 `.runtime/matlab-capability-round24-r24c/workspace/.runtime/codex-users/61f8903b86177271dd36cf69806b1ba0/generated/`。不发布认证、provider配置、SQLite或完整私有rollout。归档源码的R2021a MISS_HIT语法检查通过，不等于原生执行。

## 未通过范围

- 实际 illustrated_report 服务绑定同一 report id 和 `generated/astra-argo-round24-figures.json`，前后 status 均 `complete=false`。原归档服务拒绝合法函数basename的前缀归属；后续仓库固定函数目录修复未倒灌到原试跑。
- 原 manifest `figures=[]`，没有原生PNG/PDF/SVG，时间先于后来写入的源码/报告。待验草案不应当作已完成证据使用。
- 原交互HTML虽然有1785点和1785条JSON，但 PascalCase 身份/时间/单位字段、1基DOM点索引与当前机器合同不兼容；缺失规范点属性和可静态确认的绑定，`not_assessed` 也不属于异常状态枚举。不得放宽校验或补造原生通过字段来消除失败。
- 原生DataTip未暴露全部时间、位置和QC。返回记录及图元映射源码保留了字段，不表示原生对象或实际提示已读回验收。
- 三版原生执行、同图导出前后数据、字体、实际图件与视觉仍待后续独立CI。T-S候选不是 comparison-v3 fixture，不能借用旧合成比较图7/9物理通过或原评分90来补签。

## 本地复核证据

- 原归档：`.runtime/matlab-capability-round24-r24c/`；恢复复核：`.runtime/matlab-capability-round24-r24d/`。
- 原rollout SHA-256：`6dd19381a923ab54df99946f226b7f4cf034013b6ef433a9797893ab4bd157ea`。
- 新rollout1345018字节，SHA-256：`e3c164e0fd9338e4aa50904a0d00bc414e91398c9b9f8412f523703c1df5d076`。
- 新activation SHA-256：`4eecc0afd7ff3a17b48bfbfd2eae8fd23e72e84a3c3b369828261436d84b3634`。
- 详细生成来源、两回合边界、归档文件及运行记录哈希见 bundle 内 `generation-provenance.json`。这些是协调器观测记录，不是签名或科学来源认证。
