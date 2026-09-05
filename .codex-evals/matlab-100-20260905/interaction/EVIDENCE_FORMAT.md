# MATLAB 交互验收证据格式

## 运行输入

- MATLAB R2019b 或更新版本；Desktop 路径要求真实 desktop，headless 路径使用 `matlab -batch`。
- 输入由 `run_interaction_acceptance.m` 固定生成：6 条 UTC 温度观测，先写入稳定 `ObservationID` 和预变换 `SourceRow`，再过滤 2 条并按时间排序为 4 个显示点。
- 输出目录必须已存在且为空；脚本拒绝覆盖任何同名 PNG、PDF 或 JSON。

## 可复现命令

Desktop（必须在有图形桌面的 MATLAB 进程中）：

```bash
mkdir -p /tmp/matlab-interaction-desktop-fresh
matlab -r "cd('/opt/ocean-intelligence'); addpath('.codex-evals/matlab-100-20260905/interaction'); run_interaction_acceptance('desktop','/tmp/matlab-interaction-desktop-fresh'); exit"
node .codex-evals/matlab-100-20260905/interaction/validate_interaction_evidence.mjs /tmp/matlab-interaction-desktop-fresh/desktop-interaction-evidence.json
```

Headless：

```bash
mkdir -p /tmp/matlab-interaction-headless-fresh
matlab -batch "cd('/opt/ocean-intelligence'); addpath('.codex-evals/matlab-100-20260905/interaction'); run_interaction_acceptance('headless','/tmp/matlab-interaction-headless-fresh')"
node .codex-evals/matlab-100-20260905/interaction/validate_interaction_evidence.mjs /tmp/matlab-interaction-headless-fresh/headless-interaction-evidence.json
```

## JSON 字段

- `schema_version="1.0"`、`scope="interaction"`、`mode`、`status`。
- `generated_at`、`matlab_release`、`matlab_version`、`desktop_available`。
- `checks[]`：检查名和 `passed` 状态；Desktop 与 headless 使用不同的固定检查集合和顺序。
- `artifacts[]`：`kind`、同目录 basename、非零 `bytes`、小写 SHA-256。
- `visual_inspection`：自动脚本固定写 `required=true,status="pending"`。人工检查后可复制证据文件并填写 `passed/failed`、reviewer 和 notes；不得改写自动检查或哈希。
- `error`：失败时记录 MATLAB identifier 和 message，脚本随后重新抛出异常并返回非零。

## 必须失败的条件

- Desktop/headless 模式与 `usejava('desktop')` 不一致。
- 过滤排序后 `ObservationID` 或 `SourceRow` 与图元 `UserData` 不一致。
- DataTip 不返回目标稳定 ID/源行，Brush 不返回精确 ID/源行，或重复读取结果漂移。
- 关闭后 getter/回调抛错，或预期异常留下残余 figure。
- PNG/PDF 缺失、为空、字节数或 SHA-256 不匹配。
- JSON 缺字段、检查集合变化、任一检查非 `passed`、路径不是同目录 basename。

## 人工视觉门禁

分别打开 Desktop 和 headless 的 PNG/PDF，记录字体和单位可读、标题/刻度/marker 未裁剪、主编码一致。Desktop 另需现场操作 DataTip 与 Brush，核对屏幕显示的 `ObservationID`/`SourceRow` 与 JSON 自动检查一致。人工记录缺失时最终状态必须保持 `runtime_pending`。
