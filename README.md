# SillyTavern + SillyTavernchat (STC-MOD)

[![Publish to Docker Hub](https://github.com/McDtot/SillyTavernMOD/actions/workflows/dockerhub-publish.yml/badge.svg?branch=release)](https://github.com/McDtot/SillyTavernMOD/actions/workflows/dockerhub-publish.yml)
[![Docker Hub](https://img.shields.io/docker/pulls/mcdlol/sillytavernmod?logo=docker&label=Docker%20Hub)](https://hub.docker.com/r/mcdlol/sillytavernmod)

LLM Frontend for Power Users  
本仓库基于 **SillyTavern 1.18.0 官方版本**，在其上通过「外挂模块 / Sidecar Module」方式集成了
`SillyTavernchat (STC-MOD)` 的一系列管理与运营功能，同时尽量保持对上游的 **低侵入、易升级**。

---

## 目录

- [项目概览](#项目概览)
- [运行与基础使用](#运行与基础使用)
- [使用 Docker 部署（本项目镜像）](#使用-docker-部署本项目镜像)
- [反向代理部署（nginx / OpenResty / Cloudflare）](#反向代理部署nginx--openresty--cloudflare)
- [STC-MOD 功能概览](#stc-mod-功能概览)
- [升级与二次开发注意事项](#升级与二次开发注意事项)
- [修改记录 (MODIFICATIONS)](#修改记录-modifications)
- [上游资源与协议](#上游资源与协议)

---

## 项目概览

- 官方前端：保留原生 SillyTavern 体验（聊天、角色管理、扩展系统等）。
- Sidecar 模块：新增在 `src/stc-mod/` 目录下，所有二开逻辑集中于此：
  - 管理后台（STC 管理面板，作为 SillyTavern 扩展加载）。
  - 注册 / 欢迎 / 登录 / 公共角色卡库 / 论坛等页面的外挂实现。
  - 账户有效期、储存空间配额、签到扩容、邀请码注册与续期等后台逻辑。
- 对官方核心代码的修改仅限极少数钩子（主要在 `src/server-main.js`），具体见
  [MODIFICATIONS.md](MODIFICATIONS.md)。

本仓库既可当作「开箱即用的 SillyTavern + 站点运营套件」，也可作为后续跟进官方版本时的二开基线。

---

## 运行与基础使用

> 以下步骤以仓库地址 `https://github.com/McDtot/SillyTavernMOD` 为例，假设当前工作目录为项目根目录。
>
> 说明：当前仓库已合并为**唯一维护分支**，今后安装、更新与二次开发都默认基于当前默认分支进行，无需再手动切换历史功能分支。

### 1. 环境准备

- **Node.js**：建议使用 20.x 或 22.x LTS（不要使用过新的 24.x，以免某些依赖尚未兼容）。  
- **Git**：用于克隆仓库。  
- **操作系统**：Windows / Linux / macOS 均可，云服务器推荐 Linux。  

### 2. 获取代码并安装依赖

```bash
git clone https://github.com/McDtot/SillyTavernMOD.git
cd SillyTavernMOD

npm install

sh start.sh 或 npm run start
```

### 3. 初始化配置（启用默认 Basic Auth）

首次运行前，请先在项目根目录创建 `config.yaml`（如不存在，可从 `default/config.yaml` 复制一份）：

```bash
cp default/config.yaml ./config.yaml    # 若文件已存在可跳过
```

然后编辑根目录下的 `config.yaml`，确认以下内容存在且缩进正确：

```yaml
basicAuthMode: true

basicAuthUser:
  username: "admin"
  password: "123456"
```

- `basicAuthMode: true`：默认开启 HTTP Basic Auth 保护，防止云服务器直接暴露在公网。
- 默认访问账号：**admin / 123456**（仅用于进入站点大门，进入 ST 直接点击登录就可以进入，然后需要给默认管理员设置密码）。
- 在登录页面用户名输入 `default-user` **直接点击登录**不需要如密码就可以进入后台，然后需要给默认管理员设置密码。
### 4. 启动服务

本地或服务器前台启动（调试阶段推荐）：

```bash
node server.js --host 0.0.0.0 --port 8000
```

或使用 npm 脚本（等价于上方命令的默认参数）：

```bash
npm run start
```

默认访问地址：

- SillyTavern 主站（带欢迎页 / 登录页）：`http://127.0.0.1:8000/`
- 公共角色卡库（若在配置中启用）：`http://127.0.0.1:8000/public-characters`
- 社区论坛（若在配置中启用）：`http://127.0.0.1:8000/forum`

> 云服务器上请将 `127.0.0.1` 换成你的公网 IP 或域名，例如：`http://your-ip:8000/`。

---

## 使用 Docker 部署（本项目镜像）

本仓库已在 Docker Hub 提供公开的预构建镜像：[`mcdlol/sillytavernmod`](https://hub.docker.com/r/mcdlol/sillytavernmod)。
该镜像由本仓库的 GitHub Actions 自动构建，并非 SillyTavern 官方镜像；目前支持 `linux/amd64` 和 `linux/arm64`。
普通用户推荐使用 `mcdlol/sillytavernmod:latest`，需要固定版本或回退时可使用 `release-<短 SHA>` 标签。

适合不想本地装 Node/npm、只想一条命令跑起来的用户。

容器内应用目录为 **`/home/node/app`**，持久化时请把 **配置、用户数据、插件、第三方扩展** 分别挂到对应路径（见下表）。**不要**把宿主机某个目录错误地挂到 `config`（例如把名为 `data` 的文件夹挂到 `.../config`），否则配置与用户数据会混在一起。

| 宿主机目录（示例） | 容器内路径 | 用途 |
|-------------------|------------|------|
| `.../config` | `/home/node/app/config` | `config.yaml` 等 |
| `.../data` | `/home/node/app/data` | 用户聊天、角色卡、上传等数据 |
| `.../plugins` | `/home/node/app/plugins` | 服务端插件（可选） |
| `.../extensions` | `/home/node/app/public/scripts/extensions/third-party` | 第三方前端扩展（可选；空目录时首次启动会写入 `stc-admin-panel`） |

**不建议**将宿主机目录挂载到整个 **`/home/node/app/public`**：会覆盖镜像里已通过构建打包好的前端静态资源，容易导致页面空白或版本不一致。除非你在宿主机自行维护一份与镜像版本一致的完整 `public` 目录，否则请只按上表挂载。

### 方式一：直接使用 `docker run`（当前目录、相对路径）

在准备存放数据的目录下执行（首次运行前可先 `mkdir -p config data plugins extensions`）：

```bash
docker run -d \
  --name sillytavernmod \
  --restart unless-stopped \
  -p 8000:8000 \
  -v ./config:/home/node/app/config \
  -v ./data:/home/node/app/data \
  -v ./plugins:/home/node/app/plugins \
  -v ./extensions:/home/node/app/public/scripts/extensions/third-party \
  mcdlol/sillytavernmod:latest
```

### 方式一（变体）：Linux 服务器、绝对路径（推荐生产）

在宿主机先创建目录（示例使用 `/root/sillytavern`，可按需改为其他路径）：

```bash
mkdir -p /root/sillytavern/{config,data,plugins,extensions}
```

再启动容器：

```bash
docker run -d \
  --name sillytavern \
  --restart unless-stopped \
  -p 8000:8000 \
  -v /root/sillytavern/config:/home/node/app/config \
  -v /root/sillytavern/data:/home/node/app/data \
  -v /root/sillytavern/plugins:/home/node/app/plugins \
  -v /root/sillytavern/extensions:/home/node/app/public/scripts/extensions/third-party \
  mcdlol/sillytavernmod:latest
```

说明：

- `--restart unless-stopped`：宿主机或 Docker 重启后容器会自动拉起（除非曾被手动 `stop`）。
- `--name`：容器名可自定（上例分别为 `sillytavernmod` 与 `sillytavern`）。
- `-p 8000:8000`：宿主机与容器端口映射，可按需改为例如 `-p 127.0.0.1:8000:8000` 仅本机访问。
- `config` / `data` / `plugins` / `extensions` 四个挂载点：分别对应配置、用户数据、服务端插件、第三方前端扩展；**`data` 必须挂到 `.../data`，`config` 必须挂到 `.../config`**，二者不可对调。
- 将 `extensions` 挂载到 `public/scripts/extensions/third-party` 时，若宿主机目录为空，**首次启动**会从镜像内恢复 **STC 管理面板**（`stc-admin-panel`）；若你自行放入其它扩展，请尽量保留其中的 `stc-admin-panel` 目录，或依赖上述自动恢复逻辑。

启动完成后，浏览器访问：

- `http://服务器IP:8000/`（或 `http://127.0.0.1:8000/` 若仅本机映射）

> 容器启动脚本会在缺少 `config/config.yaml` 时，自动从 `default/config.yaml` 拷贝一份，并执行 `npm run postinstall` 补全缺省字段；  
> **首次登录 / Basic Auth 流程** 与上面「运行与基础使用」章节完全一致。

### 方式二：使用 `docker-compose`

1. 克隆本仓库并进入 `docker` 目录：

```bash
git clone https://github.com/McDtot/SillyTavernMOD.git
cd SillyTavernMOD/docker
```

2. 确认 `docker-compose.yml` 中镜像名为：

```yaml
image: mcdlol/sillytavernmod:latest
```

3. 一键启动：

```bash
docker compose pull
docker compose up -d --no-build
```

4. 更新到最新镜像时：

```bash
cd SillyTavernMOD/docker
docker compose pull
docker compose up -d --no-build --force-recreate
```

### 方式三：纯 `docker` 用户的更新（无 compose）

如果一开始用的是 [方式一](#方式一直接使用-docker-run当前目录相对路径) 的 `docker run`（没有 compose 文件），
也可以用下面几条命令把容器升到 Docker Hub 上的最新镜像：

```bash
# 1. 拉取 Docker Hub 上的最新镜像
docker pull mcdlol/sillytavernmod:latest

# 2. 停止并删除旧容器（挂载的 config/data/plugins/extensions 不会被删除）
docker stop sillytavernmod && docker rm sillytavernmod

# 3. 用之前完全相同的 `docker run ...` 命令重新启动（见方式一）
#    比如：
docker run -d \
  --name sillytavernmod \
  --restart unless-stopped \
  -p 8000:8000 \
  -v ./config:/home/node/app/config \
  -v ./data:/home/node/app/data \
  -v ./plugins:/home/node/app/plugins \
  -v ./extensions:/home/node/app/public/scripts/extensions/third-party \
  mcdlol/sillytavernmod:latest
```

> 仓库的默认分支（`release`）每次有新提交时，GitHub Actions 会自动构建 `linux/amd64` + `linux/arm64`
> 多架构镜像并推送到 Docker Hub：
>
> - `mcdlol/sillytavernmod:latest` — 最新版（推荐普通用户使用）
> - `mcdlol/sillytavernmod:release-<短 SHA>` — 便于回退到某一次具体构建
>
> 普通用户无需自己 `git pull` / 重新构建，只要 `docker pull ... :latest` 然后重启容器即可拿到更新。

### Docker 部署后：首次登录与关闭 Basic Auth

1. **通过 Basic Auth 进入站点**
   - 浏览器访问 `http://服务器IP:8000/`。  
   - 在弹出的浏览器登录框中输入：  
     - 用户名：`admin`  
     - 密码：`123456`  
   - 在登录页面用户名输入 `default-user` **直接点击登录**不需要如密码就可以进入后台，然后需要给默认管理员设置密码。

2. **为本地管理员设置密码**
   - 进入 SillyTavern 后，使用默认本地账号（例如 `default-user (admin)`）登录。  
   - 在官方「账户 / 用户管理」管理面板的「用户管理」中，为所有管理员账号设置**强密码**。  

3. **关闭 Basic Auth（可选，但不建议在公网完全裸奔）**
   - 确认所有管理员账户已设置密码后，可在根目录 `config.yaml` 中将：  

     ```yaml
     basicAuthMode: false
     ```

     保存退出，并重启服务。此后访问站点将不再弹出浏览器级别的用户名/密码框，只保留 SillyTavern 自身的登录校验。

> 若以后希望再次启用 Basic Auth，只需将 `basicAuthMode` 改回 `true` 即可。

---

## 反向代理部署（nginx / OpenResty / Cloudflare）

生产环境常见拓扑为：**浏览器 → 反代（HTTPS）→ SillyTavern 容器（HTTP 8000）**。  
本地直连 `127.0.0.1:8000` 通常无问题；经反代后若出现 **登录后跳回欢迎页、API 密钥无法保存、保险箱已解锁仍写不进去** 等现象，多半是 **会话 Cookie / CSRF** 在反代链路上不一致，而非业务逻辑本身损坏。

### 必须手动配置 `trust proxy`

> **从本版本起，反代信任改为手动显式配置，不再自动探测。**  
> 旧版本的「环境变量自动探测」在 Node/Express 中实际无效（`HTTP_X_FORWARDED_*`、`CF_RAY` 等并不会出现在 `process.env` 里）；而运行时按请求头探测又可被直连容器伪造 `X-Forwarded-*` 头攻击，从而伪造来源 IP。因此现在统一要求在 `config.yaml` 中明确声明部署拓扑。

在 **`config/config.yaml`** 中按你的实际拓扑设置：

```yaml
deployment:
  # false       不信任任何反代（默认；本地 HTTP 直连用）
  # 1           单层反代（nginx / OpenResty / Caddy 直连源站）
  # 2           双层反代（例如 Cloudflare + 自建 nginx）
  # 'cloudflare' 仅信任 Cloudflare IP 段，并用 CF-Connecting-IP 取真实访客 IP（CF 橙云推荐）
  # true        信任全部跳数（不推荐，易被伪造）
  trustProxy: 1
```

常见选择：

| 部署拓扑 | 建议值 |
|----------|--------|
| 仅本机 / 内网 HTTP 直连 | `false`（默认） |
| 单层 nginx / OpenResty / Caddy → 源站 | `1` |
| Cloudflare 橙云 → 自建 nginx → 源站 | `2` 或 `'cloudflare'` |
| Cloudflare 橙云直连源站（无自建反代） | `'cloudflare'` |

修改后重启容器/进程，启动日志应出现其一：

```text
[STC-MOD] Express trust proxy enabled (config): 1
[STC-MOD] Express trust proxy enabled (cloudflare): trusting Cloudflare IP ranges + CF-Connecting-IP
```

> 设为 `false`（或留空）时不打印该日志，且会话 Cookie 保持非 Secure，适用于本地 HTTP；经反代 HTTPS 部署务必设置为非 `false` 值，否则登录会话可能异常。

### 推荐配置清单

| 项 | 建议 |
|----|------|
| 反代层数 | 尽量 **单 upstream** 指向一个 SillyTavern 实例；多副本需 sticky session |
| 转发头 | 必须正确传递 `Host`、**`X-Forwarded-Proto: https`**（HTTPS 站点） |
| HTTPS Cookie | 设置 `trustProxy` 为非 `false` 后自动联动 `secure: 'auto'`，反代 HTTPS 时带 Secure flag；本地 HTTP（`false`）保持非 Secure |
| CSRF | **不要**长期依赖 `disableCsrfProtection: true` 作为生产方案 |
| API 密钥保险箱 | 解锁密钥仅保存在 **进程内存**；容器重启后需重新解锁 |

### OpenResty / nginx 示例

以下片段假设 upstream 为 `127.0.0.1:8000`（Docker 映射端口），公网域名为 `ai.example.com`：

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # WebSocket（若使用相关扩展）
    proxy_set_header Upgrade           $http_upgrade;
    proxy_set_header Connection        $connection_upgrade;

    proxy_read_timeout 86400;
}
```
最小可用示例（HTTP，仅本机/内网测试）
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;

        proxy_read_timeout 86400;
    }
}

```
完整生产示例（HTTPS，推荐）
```nginx
# WebSocket 升级映射（放在 http {} 块内，全局只需一次）
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# HTTP 自动跳转 HTTPS
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # ===== 证书（替换为你的实际路径）=====
    ssl_certificate     /etc/nginx/ssl/your-domain.com.crt;
    ssl_certificate_key /etc/nginx/ssl/your-domain.com.key;

    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # 上传体积上限（导入角色卡/图片时按需调大）
    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;

        # ===== 关键转发头（STC-MOD 自动反代探测依赖这些）=====
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # ===== WebSocket（流式输出 / 部分扩展需要）=====
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;

        # ===== 长连接超时（避免长回复被截断）=====
        proxy_read_timeout  86400;
        proxy_send_timeout  86400;

        # ===== 不缓存动态内容 =====
        proxy_buffering off;
    }
}


```
**注意：**

1. 必须保证 `X-Forwarded-Proto` 与 `Host` 被正确转发，并在 `config.yaml` 中
   **手动设置 `deployment.trustProxy`**（单层 nginx 设 `1`）。STC-MOD 据此启用
   `trust proxy` 并联动 Secure Cookie（详见
   [MODIFICATIONS.md - 反代 trust proxy](MODIFICATIONS.md#反代-trust-proxy)）。
2. 测试配置并重载：

   \`\`\`bash
   nginx -t && nginx -s reload
   \`\`\`

3. 若仍出现“登录后跳回欢迎页 / API 密钥保存失败”，多为转发头缺失、SSL 模式问题，
   或 `config.yaml` 未设置 `deployment.trustProxy`。请确认该项已按拓扑正确配置。


**请勿**对 `/api/*` 或 HTML 做 aggressive 缓存；Cloudflare 上应对动态 API 使用 **Bypass cache**（见下文 Cloudflare 专章）。

### Cloudflare 部署专项配置

若使用 **Cloudflare 橙云代理**（DNS Proxied），需额外配置：

#### 1. SSL/TLS 模式（必须）

Dashboard → **SSL/TLS** → Overview → 选择 **Full (strict)**

- ❌ **Flexible**（CF → 源站 HTTP，会导致无限重定向）
- ✅ **Full (strict)**（CF → 源站 HTTPS，需源站有效证书；或 nginx 自签 + `ssl_verify off`）

> **真实访客 IP（Cloudflare）**：经 CF 后，`X-Forwarded-For` 可能是 CF 边缘 IP 而非访客真实 IP，
> 且 CF 的真实访客 IP 在 `CF-Connecting-IP` 头。若你需要准确的限流 / 审计 IP，
> 建议在 `config.yaml` 设 `deployment.trustProxy: 'cloudflare'`：该模式仅信任
> [Cloudflare 公布的 IP 段](https://www.cloudflare.com/ips/)，并使用 `CF-Connecting-IP` 取真实 IP。

#### ⚠ 安全：不要直接暴露源站端口

本版本默认已关闭 `whitelistMode`（反代后所有请求源 IP 都是反代 IP，白名单失去意义）。
但这意味着一旦有人绕过 CF / nginx **直连容器端口**，就能无限制访问。因此务必：

- Docker 端口映射绑定到本机环回：`-p 127.0.0.1:8000:8000`（而非 `-p 8000:8000`）；
- 由反代（nginx / CF）作为唯一公网入口；
- 若使用 Cloudflare，可配合防火墙仅放行 [CF IP 段](https://www.cloudflare.com/ips/) 访问 443，
  防止攻击者绕过 CF 直连源站。

#### 2. 缓存规则（强烈推荐）

**问题**：Cloudflare 默认会缓存 HTML / API，导致登录后看到旧页面、API key 读写失败。

**解决**：Dashboard → **Caching** → Cache Rules → Create rule

**规则 1：绕过 API 缓存**
- **If**：`URI Path` → `matches regex` → `^/api/.*`
- **Then**：Cache eligibility → **Bypass cache**

**规则 2：绕过 HTML 缓存**
- **If**：`URI Path` → `ends with` → `.html`
- **Then**：Cache eligibility → **Bypass cache**

或直接设置：
- **If**：`Hostname` → `equals` → `your-domain.com`
- **Then**：**Bypass cache** for everything（简单但会增加源站负载）

#### 3. Always Use HTTPS（推荐）

Dashboard → **SSL/TLS** → Edge Certificates → **Always Use HTTPS**：`On`

#### 4. 排查缓存问题

若看到「登录后刷新又回到欢迎页」：
1. CF Dashboard → **Caching** → **Purge Cache** → Purge Everything
2. 确认上述 Cache Rules 已生效
3. 浏览器开发者工具 → Network → 看 Response Headers 中 `cf-cache-status` 应为 `BYPASS` 或 `DYNAMIC`

### API 密钥保险箱与 `requireForApiKeys`

默认配置中 `privacy.secretsVault.requireForApiKeys: true` 表示：**保存 API key 前必须启用并解锁保险箱**，写入链为：

```text
启用/解锁保险箱 → POST /api/stc/privacy-vault/*
→ POST /api/secrets/write → 加密写入 data/{用户}/secrets.json
```

在反代与会话不稳定时，该链路比「仅浏览页面」更容易失败。排查步骤：

1. 浏览器 **开发者工具 → Network**，保存 API key 时查看：
   - `POST /api/stc/privacy-vault/enable` 或 `unlock` 的状态码
   - `POST /api/secrets/write` 的状态码（**403** 多为 CSRF/会话；**423** 为保险箱未解锁）
2. 若 `secrets.json` 仍为 `{}`，说明 **write 从未成功**；按上文启用 `trustProxy` 并检查反代头。
3. **临时缓解**（不推荐长期使用）：`privacy.secretsVault.requireForApiKeys: false`，允许未启用保险箱时明文保存（仍建议启用保险箱加密）。

自本版本起，保存失败时 **`stc-admin-panel` 扩展** 的全局 `fetch` 拦截会弹出具体 HTTP 状态与反代提示（不修改官方 `secrets.js`），便于与静默失败区分。需确保扩展已加载（Docker 首次启动会自动 seed `stc-admin-panel`）。

### 不建议的做法

- 为「修反代」而扩大 STC 路由的 CSRF 豁免范围（会降低安全性）。
- 多实例负载均衡 **且** 无 sticky session **且** 强制 `requireForApiKeys: true`（解锁状态不跨进程共享）。
- 将 `disableCsrfProtection: true` 当作正式部署配置。

更多实现细节见 [MODIFICATIONS.md](MODIFICATIONS.md) 中「部署 / trust proxy / 保险箱」相关说明。

---

### 6. 使用 PM2 后台守护（生产环境推荐）

在服务器上建议使用 [PM2](https://pm2.keymetrics.io/) 管理进程，避免 SSH 断开导致服务退出：

```bash
npm install -g pm2

pm2 start server.js --name sillytavern -- \
  --host 0.0.0.0 --port 8000

pm2 save
pm2 startup   # 按提示执行生成的命令，设置开机自启
```

查看运行日志：

```bash
pm2 logs sillytavern
```

### 7. STC 管理面板入口

- 使用管理员账号登录 SillyTavern 后，在聊天界面右下角可以看到 STC 的紫色悬浮按钮。  
- 点击即可打开 STC 管理面板，内含：系统监控、邀请码管理、公告管理、邮件配置、OAuth 配置、默认模板、用户空间、用户管理（含多选与批量删除）、定时任务等功能。

---

## STC-MOD 功能概览

STC-MOD 的主要能力包括（非完整列表）：

- 自定义欢迎页 / 登录 / 注册页（玻璃拟态风格，含激活码与邮箱校验等）。
- 基于邀请码的注册与续期系统（支持多种时长，对接购买链接）。
- 账户有效期与空间配额控制（到期/超限限制登录或写入，并在前端明确提示）。
- 用户「签到扩容」与个人空间使用情况展示。
- API 密钥保险箱：用户可设置独立保险箱密码，将 API key 加密落盘（防止服务器文件系统直接读取明文）。当前提示与弹窗为简体中文硬编码。
- 公共角色卡分享与导入（与二开版 SillyTavernchat 功能等价）。
- 社区论坛（发帖、评论、图片上传等）。
- STC 管理面板（系统监控、用户管理多选与批量删除、定时任务、不活跃用户清理等）。

所有后端路由均通过 `src/stc-mod/index.js` 注册，前端管理与入口则通过
`public/scripts/extensions/third-party/stc-admin-panel/` 扩展注入。

---

## 升级与二次开发注意事项

> 当前仓库已合并为**单一维护分支**，所有二次开发、功能迭代与 Bug 修复均在此分支上进行，不再维护其他功能分支。

为了在跟进上游 SillyTavern 版本时减少冲突，本项目遵循以下原则：

- 尽可能 **不修改** 官方源文件；确需修改时：
  - 仅插入一个「调用钩子函数」或最小逻辑。
  - 所有改动都在 [MODIFICATIONS.md](MODIFICATIONS.md) 中记录行号、目的与注意事项。
- 所有自定义逻辑（路由、服务、配置解析、前端 UI）集中在：
  - 后端：`src/stc-mod/` 目录（`routes/`、`services/`、`user-metadata.js` 等）。
  - 前端：`src/stc-mod/public/` 与 `public/scripts/extensions/third-party/stc-admin-panel/`。

升级官方 SillyTavern 版本时，建议流程：

1. **先从上游合并官方更新**，保证仓库处于干净状态。
2. 打开 [MODIFICATIONS.md](MODIFICATIONS.md)，按钩子编号逐条核对：
   - 对应文件是否仍存在。
   - Hook 附近逻辑是否有破坏性变动。
3. 若官方结构发生变化，优先调整 `src/stc-mod/` 内部实现，而不是继续扩散对官方代码的修改范围。

---

## 修改记录 (MODIFICATIONS)

本仓库相对于官方 SillyTavern 的所有 **核心文件改动** 与 **新增 Sidecar 结构说明**，已完整记录在：

- [`MODIFICATIONS.md`](MODIFICATIONS.md)

若你准备：

- 升级到新的官方版本；
- 调整 / 扩展 STC-MOD 功能；
- 或排查「为何官方行为与文档不一致」的问题，

请务必先阅读该文件。

---

## 上游资源与协议

**Upstream Resources**

- GitHub: <https://github.com/SillyTavern/SillyTavern>
- Docs: <https://docs.sillytavern.app/>
- Discord: <https://discord.gg/sillytavern>
- Reddit: <https://reddit.com/r/SillyTavernAI>

**License**

本项目沿用上游 SillyTavern 许可协议：

- AGPL-3.0


