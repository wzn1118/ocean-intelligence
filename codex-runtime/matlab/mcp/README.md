# MATLAB 执行 MCP

本目录提供标准 stdio MCP 服务，通过当前操作者的 GitHub 登录提交真正的 MATLAB 代码。执行环境是本仓库 `matlab-execute.yml` 工作流中的 MathWorks MATLAB，不是 Octave、Python 或路由预检。本机不因此安装 MATLAB，每次请求使用独立远程 batch 环境，不保留上次请求的工作区，也不提供 MATLAB Desktop 窗口。

## 工具

| 工具 | 输入 | 结果 |
| --- | --- | --- |
| `matlab_execute` | `code`、可选 `release`、可选 `input_json` | 提交工作流，返回请求标识；此时原生执行仍 pending |
| `matlab_status` | `request_id`、可选 `run_id` | 查询与原请求绑定的实际运行状态 |
| `matlab_artifacts` | `request_id`、可选 `run_id` | 下载、核验执行回执和文件，返回本地结果路径 |

支持目标版本 `R2021a`、`R2024b`、`R2026a`，默认 `R2026a`。代码上限 32768 UTF-8 字节，JSON 输入上限 16384 字节。工具不安装任意额外 toolbox；需要其他产品时须显式配置并验证许可证，不能仅凭 MATLAB 可启动就声称所有 toolbox 可用。

代码通过 `getenv('MATLAB_OUTPUT_DIR')` 获取结果目录；可选 JSON 输入保存为该目录的 `input.json`。`getenv('MATLAB_PROJECT_ROOT')` 指向当次 checkout，可读取仓库中已提交的脚本和输入快照。导出的图、JSON、MAT 文件等应放在结果目录内，不能只保存在 MATLAB 内存中。

## 安装与连接

当前实现要求 Linux/POSIX、Node.js 20+、Python 3、GitHub CLI `gh`，以及有权触发目标仓库工作流和读取产物的 GitHub 登录。工作流必须先提交到目标仓库。服务默认使用 `wzn1118/ocean-intelligence` 的 `main`；可通过进程环境 `MATLAB_MCP_REPO`、`MATLAB_MCP_REF` 配置，不接受模型临时覆盖仓库或本地下载路径。

```bash
npm ci --prefix codex-runtime/matlab/mcp --ignore-scripts
node codex-runtime/matlab/mcp/client.mjs list
```

Codex 的 stdio MCP 配置示例，路径须对应实际安装位置：

```toml
[mcp_servers.matlab]
command = "node"
args = ["/opt/ocean-intelligence/codex-runtime/matlab/mcp/server.mjs"]
enabled = true
tool_timeout_sec = 180
```

已有会话的工具清单不保证热更新。无需等待工具清单刷新，也可使用同一个标准 MCP 客户端进行真实 `tools/call`，而不是跳过 MCP 直接伪造执行结果：

```bash
node codex-runtime/matlab/mcp/client.mjs matlab_execute < request.json
node codex-runtime/matlab/mcp/client.mjs matlab_status < request-id.json
node codex-runtime/matlab/mcp/client.mjs matlab_artifacts < request-id.json
```

`request.json` 的形式为 `{"code":"disp(version); disp(sum([1 2 3]));","release":"R2026a"}`；后两步使用第一次真实返回的 `{"request_id":"..."}`，不能手工编造标识。示例源码 `argo_execution_example.m` 读取已归档的 1785 层 Argo 数据，核对统计均值，并导出温度、盐度和 T-S 原生图。

## 安全与验收

- 默认仓库公开。代码、输入、日志和图件会发送到 GitHub；不要提交密钥、个人隐私、内部数据或其他无权公开的内容。远程运行可能消耗 Actions 配额。
- GitHub 凭据只由本机 `gh` 使用，不作为 workflow 输入、不复制到 MATLAB runner、不写入结果。checkout 不持久保存凭据，工作流 token 仅有代码只读权限。
- 任意 MATLAB 代码在远程临时 runner 中执行；脚本可能访问网络。该工具不是对不可信代码的科学审计，也不应被公开成匿名执行服务。
- 提交成功、工作流结束、原生执行成功、文件完整和图件视觉正确是不同状态。必须检查绑定原请求的 `execution.json`、日志、源码 SHA、release、run/attempt/commit 与产物哈希；失败运行也应保留诊断，不能记为通过。
- 下载只写入服务管理的独立目录，不接受用户提供的任意路径、不覆盖历史产物。大文件、路径穿越、链接及不匹配的回执必须拒绝。
- 工具安装和协议单测不等于已经执行 MATLAB。发布时需通过真实 `matlab_execute -> matlab_status -> matlab_artifacts` 调用链，打开实际图件并核对数值。

## 验证

```bash
npm test --prefix codex-runtime/matlab/mcp
python3 -m unittest discover -s codex-runtime/matlab/mcp -p 'test_*.py'
mh_lint --brief --input-encoding utf-8 --matlab 2021a codex-runtime/matlab/mcp
```

本执行服务与产品 `/api/codex/mcp` 海洋数据接口独立。给当前 Codex 配置此服务不等于重启或部署线上海洋 MCP，也不会把原有 Python 统计工具改成 MATLAB。
