# Ubuntu 22.04 公网部署手册

本手册对应当前目标实例：Ubuntu 22.04 x64、16 核 CPU、约 15 GiB 可用内存、无独立数据盘，公网地址为
`103.236.89.174`，SSH 使用 `45034` 端口。登录密码不应写入项目、命令历史或环境文件；由于密码已经通过会话传递，上线前应在云平台重置。

2026-08-27 的只读检查显示：根分区约 29 GB（已用约 1.4 GB）、无 Swap、Docker 未安装、实例内部仅 SSH `22` 在监听。公网 `45034` 映射到实例内 `22`；公网 `80` 返回云侧 404，但实例内没有进程监听 `80`，公网 `443` 暂不可达。因此需要在云平台控制台确认 Web 端口的放行或映射，不能只修改 Ubuntu 防火墙。

同日部署时进一步确认：该实例只能稳定访问境内目标，访问 Cloudflare Tunnel 边缘 `198.41.192.0/24`、
`198.41.200.0/24` 的 TCP `443` 与 TCP/UDP `7844` 超时。应用、PostgreSQL 和 cloudflared 容器已经启动，前两者健康，
但 Tunnel 无活动连接，因此公网域名会返回 Cloudflare `530`。需让云厂商为该实例的出站流量放行：

```text
edge.argotunnel.com / region*.v2.argotunnel.com
TCP 443
TCP/UDP 7844
198.41.192.0/24
198.41.200.0/24
```

控制台的 NAT 转发只能自动生成随机外部端口，不能替代 Tunnel 的标准 HTTPS 入口。可临时把内部 `80` 映射到随机外部端口
做无敏感数据的 HTTP 连通性检查；不要在该入口注册真实账户或填写 API 密钥。正式入口仍应为
`https://ocean.hegelsalon.com`。

## 上线前条件

1. 使用独立子域 `ocean.hegelsalon.com`，避免覆盖现有的 `hegelsalon.com` 与 `www` 站点。
2. 默认使用 Cloudflare Tunnel：服务器需能出站访问 TCP/UDP `7844` 或 TCP `443`，无需开放入站 `80/443`。如改用 Caddy 直连，才需要在云平台放行 TCP `80/443`；UDP `443` 可用于 HTTP/3。
3. 确认云厂商允许该实例对公网提供 Web 服务，并按实例实际所在地域和云厂商要求处理备案。
4. 从另一台网络中的设备确认域名已经解析到目标 IP。

## Cloudflare 域名接入

当前 `hegelsalon.com` 和 `www.hegelsalon.com` 已有现存记录，不应把它们改指向本项目。默认方案是新建一个名为
`ocean-intelligence` 的 Cloudflare Tunnel：

```text
Zero Trust > Networks > Tunnels > Create a tunnel
运行环境：Docker
Public hostname：ocean.hegelsalon.com
Service：http://app:8000
```

保存 Public hostname 时 Cloudflare 会创建指向 Tunnel 的 CNAME，不要再给同一主机名创建 A 记录。把 Dashboard 生成的 Tunnel
令牌写入服务器的 `deploy/production.env`；令牌不要写进 Compose、Git 或命令历史。Tunnel 是出站连接，不需要暴露源站 IP
的 Web 端口。API 和账户会话仍为同源请求，不能在 Cloudflare 规则中缓存 `/api/*`、登录或账户设置响应。

如需改用 Caddy 直连，在 Cloudflare DNS 中给 `ocean.hegelsalon.com` 创建指向 `103.236.89.174` 的 A 记录，首次签发证书时
可先设为 DNS only，验收后再启用橙云代理。Cloudflare 的 SSL/TLS 模式应设为 **Full (strict)**，不要使用 Flexible；源站
Caddy 会自动申请并续期证书。

账号密码和用户 API 密钥必须通过 HTTPS 传输。没有域名时可用 HTTP + IP 做不含真实密钥的临时连通性检查，但不能作为正式入口。

## 连接与上传

```bash
ssh -p 45034 root@103.236.89.174
mkdir -p /opt/ocean-intelligence
```

从本地上传时排除依赖、缓存、运行数据和真实环境文件：

```powershell
tar --exclude=.venv --exclude=frontend/node_modules --exclude=frontend/dist --exclude=.runtime --exclude=backend/.cache --exclude=deploy/production.env -czf ocean-intelligence.tar.gz .
scp -P 45034 .\ocean-intelligence.tar.gz root@103.236.89.174:/opt/
```

然后在服务器解压：

```bash
tar -xzf /opt/ocean-intelligence.tar.gz -C /opt/ocean-intelligence
cd /opt/ocean-intelligence
```

## 安装 Docker

```bash
chmod +x deploy/*.sh
UBUNTU_APT_MIRROR=https://mirrors.aliyun.com/ubuntu \
DOCKER_APT_MIRROR=https://mirrors.aliyun.com/docker-ce/linux/ubuntu \
./deploy/bootstrap-ubuntu.sh
```

该实例当前只能稳定访问境内网络，以上命令显式使用阿里云 Ubuntu/Docker 软件源；生产环境模板中的基础镜像使用华为云 SWR
境内同步路径。脚本仍默认使用 Docker 官方源，只有传入变量时才切换软件源；安装后会启用 Docker Engine、Buildx 和 Compose
插件。

## 配置生产环境

```bash
cp deploy/production.env.example deploy/production.env
openssl rand -hex 32
python3 -c "import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
nano deploy/production.env
chmod 600 deploy/production.env
```

把第一条随机值写入 `POSTGRES_PASSWORD`，第二条写入 `ENCRYPTION_KEY`。保留模板中的
`ocean.hegelsalon.com`；使用 Tunnel 时把 Dashboard 生成的值写入 `TUNNEL_TOKEN` 并保持
`DEPLOY_TRANSPORT=tunnel`。数据库密码应保持 URL 安全字符，避免破坏 `DATABASE_URL`。

`ENCRYPTION_KEY` 用于加密用户保存的 API 密钥。部署后不能随意更换；如丢失，已有密钥无法解密，只能由用户重新填写。

## 启动与验收

```bash
./deploy/deploy.sh
docker compose --env-file deploy/production.env -f compose.prod.yaml --profile tunnel ps
docker compose --env-file deploy/production.env -f compose.prod.yaml --profile tunnel logs --tail=100 app cloudflared database
curl -fsS https://ocean.hegelsalon.com/api/health
```

`deploy.sh` 根据 `DEPLOY_TRANSPORT` 只启动 Tunnel 或 Caddy 其中之一。Tunnel 模式下 Cloudflare 终止公网 TLS；直连模式下 Caddy
在域名解析和 80/443 入站正常后自动申请证书。FastAPI 与 PostgreSQL 只在 Docker 私有网络中可见，不应额外映射 `8000`
或 `5432`。

验收至少覆盖：

- 未登录访问业务 API 返回 `401`，`/api/health` 可用；
- 注册、退出、重新登录正常；
- 两个测试账户看不到彼此的 Agent 会话和记忆；
- API 设置页只显示“密钥已配置”，不会回显密钥；
- OpenAI、DeepSeek 或自定义兼容端点从服务器网络可达；
- 页面响应包含 HSTS、CSP、`nosniff` 等安全头。

## 仅用 IP 临时验收

尚无域名时，可在 `deploy/production.env` 暂时设置：

```dotenv
SITE_HOST=103.236.89.174
SITE_ADDRESS=http://103.236.89.174
SITE_ORIGIN=http://103.236.89.174
SESSION_COOKIE_SECURE=false
DEPLOY_TRANSPORT=direct
```

这只用于验证容器、数据库和反向代理是否可运行。此模式不得录入真实密码或 API 密钥；域名可用后立即切回 HTTPS，并把 `SESSION_COOKIE_SECURE` 改回 `true`。

## 备份与恢复

实例没有独立数据盘，Docker 卷与系统盘共用故障域。本机备份只能用于误操作恢复，还需要同步到 OSS、COS、S3 或另一台服务器。

手动备份：

```bash
./deploy/backup-postgres.sh
```

每天 03:17 自动执行并保留 7 天本机副本：

```cron
17 3 * * * /opt/ocean-intelligence/deploy/backup-postgres.sh >> /var/log/ocean-postgres-backup.log 2>&1
```

恢复前先停止应用写入，再把指定备份导入数据库：

```bash
docker compose --env-file deploy/production.env -f compose.prod.yaml stop app
gunzip -c backups/postgres/ocean-YYYYMMDDTHHMMSSZ.sql.gz | \
  docker compose --env-file deploy/production.env -f compose.prod.yaml exec -T database \
  psql -U ocean -d ocean_intelligence
docker compose --env-file deploy/production.env -f compose.prod.yaml start app
```

同时监控根分区和 Docker 占用：

```bash
df -h /
docker system df
```

Compose 已把三个服务的本地日志轮转限制为单文件 20 MB、最多 5 个文件，避免日志吃满 29 GB 系统盘。发布稳定后可定期人工清理过期构建缓存，但应先检查 `docker system df`。

不要用定期 `docker system prune -a` 作为自动任务；它可能删除仍需用于回滚的镜像。
