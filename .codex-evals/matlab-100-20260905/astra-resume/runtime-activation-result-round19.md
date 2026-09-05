# 第19轮：内置 Astra 实际验收与 CA 修复

## 验收范围

这是 Ocean Intelligence 产品内置服务的独立诊断，不是桌面代理模型自报，也不是 MATLAB 渲染测试。使用专用诊断租户，保留原用户线程；不宣称新增了十个用户侧边栏会话。

- 容器：`ocean-intelligence-codex-runtime-1`。首次仅重启于2026-09-05 23:02:31 UTC，健康接口200、ready=true；此前常驻进程仍缓存17:44的模块。
- 验收线程：`01a073d0-59a8-7470-aef6-cbd0c7e4124b`。后续重试复用同一线程，不创建替代线程或删除失败记录。
- 只检查仓库技能/helper的SHA-256及RecordMetadata、OI_ColorAccessibilityRole标记，不读取真实海洋数据，不改业务文件，不运行MATLAB/Octave。

## 首次失败与环境修复

首次turn `01a073d0-5a74-7ac3-8eee-062dd074fefd` 在23:03:49启动，记录请求模型gpt-6-astra，但没有完成回复或命令。通过该租户events接口观察到七次 `responseStreamDisconnected`，HTTP状态为空，信息为 `Connection failed: error sending request`，均声明willRetry。四分钟诊断上限到达后主动请求中断，23:07:52落盘turn_aborted；不能把这次配置记录算作模型成功。

容器缺少系统CA证书包和`/etc/ssl/certs/ca-certificates.crt`。同一容器Node HTTPS HEAD能够返回200，只能证明该客户端的连接，不证明原生Codex客户端可用。未关闭TLS验证、修改provider地址、全局模型配置或凭据。

执行apt-get安装`ca-certificates 20250419~deb12u1`及依赖`openssl 3.0.20-1~deb12u2`，生成224449字节系统证书包、增加150项证书。随后仅重启运行服务，当前StartedAt为23:16:19 UTC、宿主PID为3225358。补齐CA并重启后，同一线程成功回复；这里保留两步操作的事实，不把先前Node HEAD作为原生TLS验收。

`deploy/Dockerfile.codex-runtime`增加ca-certificates，并在现有wiring测试中检查该依赖。该文件原有用户修改保留；本轮仅单独暂存这一行，不将用户的CLI安装或版本变更一并提交。当前容器已安装证书，不等于已重建生产镜像。

## 两轮实际结果

| Turn | 请求模型 | 实际turn_context.model | 结果 |
| --- | --- | --- | --- |
| `01a073dc-185d-7fc1-a052-6d04ce3033bf` | 显式gpt-6-astra | gpt-6-astra | 23:16:39至23:16:54完成，两条只读命令exitCode=0 |
| `01a073dc-588d-7ad1-862b-54df4de9a09d` | 未传model | gpt-6-astra | 23:16:55至23:17:01完成，正确区分源码检查与渲染/视觉验收 |

两轮effort=low，approval_policy=never，sandbox_policy.type=danger-full-access；没有要求用户审批。第二轮未指定model，实际执行记录继续为gpt-6-astra，验证了该线程本次续轮继承，不外推所有历史线程或未来配置。

首轮实际执行sha256sum和rg，API返回commandExecution completed/exitCode=0。模型返回的两个SHA与独立读取一致：

| 文件 | 当时SHA-256 |
| --- | --- |
| `codex-runtime/matlab/SKILL.md` | `53d5623f408890bd1a299e3c4142f7e2c1999aa42a90c5192aaf2d4604107822` |
| `codex-runtime/matlab/assets/oi_plot_comparison.m` | `4db32bceead30874bb2556f0e00fd9e28a7cd69c15da725ee1646c4ac82f5d78` |
| `codex-runtime/server/matlab-plotting-instructions.mjs` | `7e7ed475faaff59f2b678fa9b58188a3fb0984c2cb7db491aad70536203b1880` |

初始产品developer消息实际含33996694221、第17轮54/60和0分、RecordMetadata、v3及U语义标记。对JSON解析后的content数组使用JSON.stringify再SHA-256，结果为`4ce529707b3f26a91189a770bdb5a467a28f7fbc00b9689b956a99fa72ae34f8`。这是本线程提示注入证据，不只是在磁盘搜索字符串。后续源码仍由其他代理更新，因此不把此时的文件哈希承诺为未来状态。

## 本地证据与边界

- 首次失败记录：`/opt/ocean-intelligence/.runtime/matlab-capability-round19/activation.json`，SHA=`52c0bda34734ec2b8e7b6b1d4d03b5a74e07a213414a17e9c1a305ba07613b50`，未覆盖。
- 证书修复后记录：`/opt/ocean-intelligence/.runtime/matlab-capability-round19-after-ca/activation.json`，SHA=`863df8ec2a09121a6d20f01c46be770151372cda0c793667293266fb207aa858`。
- 原生rollout：`/root/.codex/sessions/2026/09/05/rollout-2026-09-05T23-03-49-01a073d0-59a8-7470-aef6-cbd0c7e4124b.jsonl`，23:18采样SHA=`3d55d75ace8f14c933020c07181a06a3d340bf20d83b9e112f9988f9dd908dbf`。保留本地，不将整段会话上传仓库；再次续跑时其哈希会自然变化。
- 临时诊断脚本`/tmp/matlab-runtime-activation-round19.mjs`支持指定输出目录和原thread ID；日志事件名仍为thread_created，但第二次实际GET/resume同一ID，表中未计为新线程。
- 原事件缓存随服务重启重置；七次网络错误是重启前接口实读记录，不宣称该缓存现在仍可重放。
- 当前工作区以bind mount提供源码，运行服务会加载当时的完整工作区，不能将它等同于仅一个git提交。未覆盖用户dirty文件，也未证明所有既有线程基础提示已刷新。
- 本次证明了内置连接、提示注入、Astra两轮执行、模型继承、只读helper访问和无需审批设置。未证明真实海区数据分析、MATLAB本机可执行、绘图、PDF字体、完整报告或视觉100分。
