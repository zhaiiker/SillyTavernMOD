# SillyTavernchat (STC-MOD) 修改文档

> 本文件记录了在官方 SillyTavern 1.16.0 代码基础上进行的所有修改，
> 以便后续官方版本升级时快速定位和维护这些修改点。
>
> **最后更新**：基于当前实际代码状态同步。

## 架构概述

所有二次开发功能以 **Sidecar Module**（外挂模块）方式实现，集中在 `src/stc-mod/` 目录中。
对官方核心代码的修改仍集中在 **1 个文件**（`src/server-main.js`）：包含 **5 个 STC-MOD 钩子点**，以及 **1 处静态资源缓存策略调整**。

## 核心文件修改

### `src/server-main.js`

| 钩子编号 | 实际行号（参考） | 位置描述 | 修改内容 | 目的 |
|---------|----------------|---------|---------|------|
| **A** | ~63 | 文件顶部 `import` 语句之后、`Routers` 注释之前 | 添加 `stcMod` 动态导入 | 加载外挂模块（失败时静默跳过，不影响官方功能） |
| **B** | ~190 | `csrfSync({...})` 的 `skipCsrfProtection` 回调内 | 添加 `stcMod.shouldSkipCsrf(req)` 调用 | 为自定义路由提供 CSRF 豁免 |
| **C** | ~217 | **`app.get('/', ...)` 之前**（静态文件托管开始前） | 调用 `stcMod.setupPublicRoutes(app)` | 注册自定义页面路由（欢迎页/登录页/注册页等）；**必须在官方 `/` 和 `/login` 路由之前，否则欢迎页被官方路由截断** |
| **D** | ~254 | `app.use('/api/users', usersPublicRouter)` 之后 | 调用 `stcMod.setupPublicApi(app)` | 注册无需认证的公开 API 路由 |
| **E** | ~290 | `setupPrivateEndpoints(app)` 调用之后 | 调用 `stcMod.setupPrivateRoutes(app)` | 注册需要认证的私有 API 路由 |
| **F** | ~248 | `app.use(express.static(path.join(serverDirectory, 'public'), ...))` | 为前端静态资源添加缓存头 | 降低重复加载 JS/CSS/字体/图片的成本，改善 VPS 在中国网络环境下登录后主界面加载速度 |

> ⚠ **升级注意**：钩子 C 的位置至关重要——必须插入在 `app.get('/', ...)` **之前**，而非仅在 `app.get('/login', ...)` 之前。若顺序错误，未登录用户访问 `/` 时会被官方路由直接跳转到 `/login`，欢迎页永远不会显示。

### `src/endpoints/secrets.js`

新增 **STC-MOD API 密钥保险箱**适配层：在用户启用保险箱后，将 `secrets.json` 中的 API key `value` 字段以 AES-256-GCM 加密落盘；解锁后服务端仅在内存中短期持有派生密钥（TTL 可配置）。

设计约束（最低侵入）：
- **不改**各模型后端：仍通过官方 `readSecret()` 获取密钥；保险箱逻辑只接入 `secrets.js` 的读写层。
- 只加密用户 API key，不加密官方内部字段（例如 `csrfSecret`），避免破坏登录与 CSRF 流程。
- 前端提示与弹窗当前为 **简体中文硬编码**（为避免修改官方语言包文件）。

### `public/scripts/secrets.js`

配合服务端保险箱接口，在前端新增以下逻辑：
- 维护前端的 `secret_vault_state`（是否启用、是否解锁）。
- 拦截 `writeSecret()`：保存新 API key 时，如保险箱未启用则引导设置密码；如已锁定则引导输入密码。
- 新增 `maybeOfferVaultMigration()`：当检测到用户有明文 key 且未启用保险箱时，主动弹出迁移提示。
- 在 `initSecrets()` 初始化阶段，读取状态并提示用户当前是否处于锁定状态。

所有新增的前端提示/弹窗为简体中文硬编码，避免了对上游 `public/locales/*.json` 多语言文件的修改。

### 具体代码差异

#### `src/endpoints/secrets.js` 后端接口注入
在核心逻辑中引入 STC-MOD API 密钥保险箱 (`src/stc-mod/services/privacy-vault.js`) 的方法：
- **`writeSecret` (约第 339 行)**：写入保存 API key 前，拦截检测；若目标 Key 被保险箱保护且状态合规，则对 `value` 进行加密后再落盘，若保险箱被要求开启但未开启，则抛出 `VaultRequiredError` 阻断写入。
- **`readSecret` (约第 286 行)**：读取 API key 时，判断如果内容已被加密，则请求保险箱解密后再返回。若此时保险箱是锁定状态，向前端抛出 `VaultLockedError`。
- **`getSecretState` (约第 262 行)**：如果是已被加密的 Key，在前端界面将明文展示修改为 `*******`（隐藏真实密文的截断部分），并增加 `encrypted: true` 标识。
- **`enableVault` (新增，约第 406 行)**：提供一个新方法给路由层调用，用于第一次激活保险箱功能，并遍历已有的 API key 将其批量加密。
- **`resetVaultAndClearEncryptedKeys` (新增)**：用于重置保险箱，清空内存密钥、删除保险箱记录文件，并清理 `secrets.json` 中所有已加密的 API key 条目（没有密码后再也无法解密）。
- **`/write`, `/view`, `/find` API 路由 (约第 496, 529, 545 行)**：增加对保险箱专属错误码（423 Locked / 428 Precondition Required）的捕获与响应封装 `sendVaultError`。

#### `public/scripts/secrets.js` 前端拦截注入
在前端增加相关的交互和校验代码：
- **API 密钥保险箱模块 (约第 340-534 行)**：新增了整个 `STC-MOD` 代码块，包括 `readSecretVaultStatus`, `askVaultPassphrase`, `enableSecretVault`, `unlockSecretVault`, `ensureSecretVaultReadyForWrite`, `retrySecretWriteAfterVaultAction`, `maybeOfferVaultMigration`。
- **`writeSecret` 拦截 (约第 553-566 行)**：覆盖原有的 `fetch('/api/secrets/write')` 调用前，执行 `ensureSecretVaultReadyForWrite()` 拦截；如果后端返回保险箱相关错误，则通过 `retrySecretWriteAfterVaultAction()` 再次引导用户。
- **`readSecretState` 更新检测 (约第 624 行)**：在成功加载秘密状态后，调用 `maybeOfferVaultMigration()` 检测是否需要提示用户加密旧明文密钥。
- **`initSecrets` 初始化检测 (约第 1341-1344 行)**：在进入界面时通过 `readSecretVaultStatus()` 读取状态，并在已锁定时弹出 toast 提示。

#### `public/scripts/extensions/third-party/stc-admin-panel/index.js` 悬浮用户面板集成

在 STC Admin Panel 扩展的"我的账户"悬浮面板中新增 **API 密钥保险箱** 卡片：
- 展示当前状态徽章（未启用 / 已锁定 / 已解锁）。
- 按当前状态动态渲染操作按钮：`启用保险箱` / `解锁` / `立即锁定`。
- 在保险箱已启用（无论是否解锁）时额外显示"忘记密码 / 重置保险箱"入口，需二次输入 `RESET` 字样才能提交，调用 `POST /api/stc/privacy-vault/reset`。
- 所有与保险箱相关的交互都集中在该面板内，不影响官方 `public/scripts/secrets.js` 中既有的启用 / 解锁 / 写入拦截逻辑。

#### 钩子 A - 模块加载（约第 63 行）

插入位置：`import cacheBuster from './middleware/cacheBuster.js'` 等 import 语句之后，`// Routers` 注释之前。

```javascript
// [STC-MOD] SillyTavernchat sidecar module loader
let stcMod = null;
try {
    // @ts-expect-error STC-MOD sidecar has no type declarations
    stcMod = await import('./stc-mod/index.js');
    console.log('[STC-MOD] SillyTavernchat module loaded.');
} catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') console.error('[STC-MOD] Load error:', e.message);
}
```

#### 钩子 B - CSRF 豁免（约第 188–193 行）

插入位置：`csrfSync({...})` 配置对象的 `skipCsrfProtection` 函数体内，紧接 `proxyBypass` 之后。

```javascript
skipCsrfProtection: (req) => {
    const proxyBypass = cliArgs.enableCorsProxy ? /^\/proxy\//.test(req.path) : false;
    // [STC-MOD] Custom CSRF exemption
    const stcBypass = stcMod?.shouldSkipCsrf?.(req) ?? false;
    return proxyBypass || stcBypass;
},
```

#### 钩子 C - 公开页面路由（约第 217 行）

⚠ **插入位置：`// Static files` 注释和 `app.get('/', ...)` 之前。**

```javascript
// [STC-MOD] Public routes and page overrides (must be BEFORE official / and /login routes)
if (stcMod?.setupPublicRoutes) await stcMod.setupPublicRoutes(app);

// Static files
// Host index page
app.get('/', cacheBuster.middleware, (request, response) => {
    // ... 官方代码不变 ...
});
```

#### 钩子 D - 公开 API 路由（约第 254 行）

插入位置：`app.use('/api/users', usersPublicRouter)` 之后、`app.use(requireLoginMiddleware)` 之前。

```javascript
// [STC-MOD] Additional public API routes (no auth required)
if (stcMod?.setupPublicApi) await stcMod.setupPublicApi(app);
```

#### 钩子 E - 私有 API 路由（约第 290 行）

插入位置：`setupPrivateEndpoints(app)` 调用之后（已登录区域内）。

```javascript
// [STC-MOD] Private routes (requires authentication)
if (stcMod?.setupPrivateRoutes) await stcMod.setupPrivateRoutes(app);
```

#### 改动 F - 静态资源缓存策略（约第 248 行）

替换位置：官方前端静态文件托管语句 `app.use(express.static(path.join(serverDirectory, 'public'), {}));`。

```javascript
app.use(express.static(path.join(serverDirectory, 'public'), {
    maxAge: '1d',
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        if (/\.(js|css|woff|woff2|ttf|svg|png|jpg|jpeg|gif|ico)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
        }
        if (/\.html$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
        }
    },
}));
```

目的：
- JS、CSS、字体、图标、图片缓存 1 天，减少登录后主界面重复下载大量静态资源。
- HTML 缓存 1 小时并保留协商缓存，避免页面文件长期陈旧。
- 不改变路由顺序，不影响 STC-MOD 页面覆盖、登录鉴权和 API 行为。

## 新增依赖

在 `package.json` 中新增以下依赖（已写入）：

| 包名 | 用途 | 可选 |
|------|------|------|
| `nodemailer` | 邮件服务（注册验证、密码恢复、用户通知） | 是（不安装则邮件功能自动禁用） |
| `yaml` | 读写 config.yaml 配置文件 | 是（官方若已引入则无需重复安装） |

> `node-persist`（node-persist）为官方已有依赖，STC-MOD 在 `user-extend.js` 中直接复用，**无需额外安装**。

## 依赖的官方 `src/users.js` 导出接口

升级时需确认以下接口在新版 `users.js` 中仍然存在且签名未变：

| 导出名称 | 使用文件 | 用途 |
|---------|---------|------|
| `requireAdminMiddleware` | 所有 `private/` 路由 | 鉴权：仅管理员可访问 |
| `requireLoginMiddleware` | `index.js` 注册 | 鉴权：登录用户才可访问私有路由 |
| `getAllUserHandles` | `user-extend.js`、`scheduled-tasks.js` | 获取所有用户 handle 列表 |
| `getUserDirectories` | `user-extend.js` | 获取用户数据目录路径（用于清理数据） |
| `toKey` | `user-extend.js` | 将 handle 转换为 node-persist 存储 key |
| `getPasswordSalt` | `register-helper.js` | 生成密码盐 |
| `getPasswordHash` | `register-helper.js` | 生成密码哈希 |
| `ensurePublicDirectoriesExist` | `register-helper.js` | 确保用户公共目录存在 |
| `shouldRedirectToLogin` | 官方 `server-main.js`（参考） | 判断是否需要跳转登录 |

## 新增目录结构

```
src/stc-mod/
├── index.js                         # 模块入口（5个导出函数）
├── config.js                        # 配置系统（读写 config.yaml）
├── user-metadata.js                 # 扩展用户数据存储
├── middleware/
│   ├── csrf-exemption.js            # CSRF 豁免规则
│   └── expiration-check.js          # 用户过期检查中间件
├── routes/
│   ├── public/
│   │   ├── register.js              # 用户注册
│   │   ├── register-helper.js       # 注册辅助（调用官方用户创建）
│   │   ├── oauth.js                 # OAuth 第三方登录
│   │   ├── invitation-status.js     # 邀请码状态
│   │   ├── announcements-public.js  # 登录页公告
│   │   ├── email-status.js          # 邮件服务状态
│   │   └── public-config.js         # 公开配置（功能开关）
│   └── private/
│       ├── invitation-codes.js      # 邀请码管理（管理员）
│       ├── user-extend.js           # 用户扩展（续费、存储、签到）
│       ├── announcements.js         # 公告管理（管理员）
│       ├── email-config.js          # 邮件配置（管理员）
│       ├── oauth-config.js          # OAuth 配置（管理员）
│       ├── forum.js                 # 社区论坛
│       ├── public-characters.js     # 公共角色卡库
│       ├── system-load.js           # 系统监控（管理员）
│       ├── user-storage.js          # 存储空间管理（管理员）
│       ├── privacy-vault.js         # API 密钥保险箱（用户）
│       ├── default-config.js        # 默认模板管理（管理员）
│       └── scheduled-tasks.js       # 定时任务（管理员）
├── services/
│   ├── email-service.js             # 邮件服务
│   ├── invitation-codes.js          # 邀请码逻辑
│   ├── system-monitor.js            # 系统监控
│   ├── storage-quota.js             # 存储配额
│   ├── privacy-vault.js             # API 密钥保险箱（用户口令加密）
│   └── default-template.js          # 默认用户模板
└── public/
    ├── login.html                   # 自定义登录页（含 OAuth 按钮）
    ├── register.html                # 注册页
    ├── welcome.html                 # 欢迎页
    ├── forum.html                   # 论坛页
    └── public-characters.html       # 角色卡库页
```

## 数据存储

所有外挂模块数据存储在 `data/stc-mod/` 目录中，**不修改**官方用户数据结构：

| 文件/目录 | 内容 |
|-----------|------|
| `user-metadata.json` | 扩展用户字段（OAuth ID、邮箱、过期时间、存储限额等） |
| `invitation-codes.json` | 邀请码数据 |
| `storage-codes.json` | 存储激活码数据 |
| `announcements/` | 公告数据 |
| `forum_data/` | 论坛帖子和图片 |
| `public_characters/` | 公共角色卡索引和文件 |
| `default-template/` | 新用户默认配置模板 |
| `privacy-vaults/` | API 密钥保险箱元数据（不含明文密钥） |
| `system-monitor-history.json` | 系统监控历史 |

## 配置项

在 `config.yaml` 中添加的配置项（首次启动时自动写入默认值）：

```yaml
enableInvitationCodes: false    # 启用邀请码系统
enableForum: false              # 启用论坛
enablePublicCharacters: false   # 启用公共角色卡库
purchaseLink: ''                # 续费购买链接

oauth:
  github:
    enabled: false
    clientId: ''
    clientSecret: ''
    callbackUrl: ''
  discord:
    enabled: false
    clientId: ''
    clientSecret: ''
    callbackUrl: ''
  linuxdo:
    enabled: false
    clientId: ''
    clientSecret: ''
    callbackUrl: ''

email:
  enabled: false
  smtp:
    host: ''
    port: 587
    secure: false
    user: ''
    password: ''
  from: ''
  fromName: 'SillyTavern'

userStorage:
  enabled: false
  defaultLimitMiB: 500
  dailyCheckInMiB: 0

privacy:
  secretsVault:
    requireForApiKeys: true          # 是否强制保存 API key 前启用保险箱
    unlockTtlMinutes: 1440           # 保险箱解锁后服务端内存密钥保留时间 (24小时)
```

## 部署与性能相关默认配置

为降低中国网络环境下登录后主界面黑屏或长时间等待的概率，默认配置中调整了以下项目：

```yaml
cacheBuster:
  enabled: false

extensions:
  autoUpdate: false
  models:
    autoDownload: false

enableDownloadableTokenizers: false
```

说明：
- `cacheBuster.enabled: false`：避免启动或首次加载时强制清理浏览器端 JS/CSS 缓存。
- `extensions.autoUpdate: false`：避免登录后主界面初始化阶段自动访问 GitHub 更新第三方扩展。
- `extensions.models.autoDownload: false`：避免自动从 HuggingFace 下载 transformers 模型。
- `enableDownloadableTokenizers: false`：避免缺失 tokenizer 时自动访问 GitHub 下载，改为使用本地 fallback。

> 运行中的 VPS 如果已经生成根目录 `config.yaml`，升级默认配置不会自动覆盖该文件。需要手动确认运行配置中的上述开关也为 `false`。

## API 路由汇总

### 公开 API（无需认证）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/stc/public-config/public-pages` | 获取功能开关状态 |
| GET | `/api/stc/invitation-codes/status` | 邀请码系统状态 |
| GET | `/api/stc/announcements/login/current` | 登录页公告 |
| GET | `/api/stc/email/status` | 邮件服务状态 |
| POST | `/api/stc/users/register` | 用户注册 |
| POST | `/api/stc/users/send-verification` | 发送邮箱验证码 |
| POST | `/api/stc/users/renew-expired` | 过期用户续费 |
| GET | `/api/stc/oauth/:provider` | 发起 OAuth 登录 |
| GET | `/api/stc/oauth/:provider/callback` | OAuth 回调 |
| POST | `/api/stc/oauth/complete-registration` | 完成 OAuth 注册（带邀请码） |

### 私有 API（需认证）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/stc/users/me-ext` | 获取当前用户扩展信息 |
| POST | `/api/stc/users/renew` | 续费（使用邀请码） |
| POST | `/api/stc/users/heartbeat` | 心跳（更新在线时间） |
| GET | `/api/stc/users/storage` | 获取存储信息 |
| POST | `/api/stc/users/check-in` | 每日签到 |
| POST | `/api/stc/users/use-storage-code` | 使用存储激活码 |
| GET | `/api/stc/announcements/current` | 获取当前公告 |

### 管理员 API

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/stc/invitation-codes/create` | 创建邀请码 |
| GET | `/api/stc/invitation-codes/list` | 列出所有邀请码 |
| POST | `/api/stc/invitation-codes/delete` | 删除邀请码 |
| GET/POST | `/api/stc/email-config/config` | 获取/设置邮件配置 |
| POST | `/api/stc/email-config/test` | 测试邮件发送 |
| GET/POST | `/api/stc/oauth-config/config` | 获取/设置 OAuth 配置 |
| GET | `/api/stc/system-load/current` | 当前系统负载 |
| GET | `/api/stc/system-load/history` | 系统负载历史 |
| GET/POST | `/api/stc/user-storage/config` | 存储配额配置 |
| POST | `/api/stc/user-storage/create-code` | 创建存储激活码 |
| POST | `/api/stc/user-storage/delete-code` | 删除存储激活码 |
| GET | `/api/stc/users/all-meta` | 所有用户扩展元数据 |
| GET | `/api/stc/users/expiration-list` | 用户过期列表 |
| POST | `/api/stc/users/delete-inactive` | 彻底删除长期未登录用户（账号+数据目录+元数据），支持 `dryRun` 预览、`minStorageMB` 存储过滤、`sendEmailNotice` 通知 |
| POST | `/api/stc/users/warn-inactive` | 向未登录用户发送提醒邮件（不删除），支持 `minStorageMB` 存储过滤 |
| GET | `/api/stc/announcements/list` | 所有公告列表 |
| POST | `/api/stc/announcements/create` | 创建公告 |
| PUT | `/api/stc/announcements/:id` | 更新公告 |
| POST | `/api/stc/announcements/delete` | 删除公告 |
| GET | `/api/stc/scheduled-tasks/storage-analysis` | 用户存储分析（按用户统计聊天/角色卡/备份等） |
| POST | `/api/stc/scheduled-tasks/clean-backups` | 立即清理备份文件（指定用户或全部） |
| GET/POST | `/api/stc/scheduled-tasks/config` | 获取/保存定时清理配置 |
| GET/POST | `/api/stc/default-config/template` | 获取/保存新用户默认配置模板 |
| POST | `/api/stc/privacy-vault/status` | 当前用户 API 密钥保险箱状态 |
| POST | `/api/stc/privacy-vault/enable` | 启用保险箱并加密已有 API key |
| POST | `/api/stc/privacy-vault/unlock` | 解锁保险箱以使用已加密 API key |
| POST | `/api/stc/privacy-vault/lock` | 立即锁定保险箱 |
| POST | `/api/stc/privacy-vault/reset` | 重置保险箱（忘记密码时使用；需 `{confirm:"RESET"}`，会清空已加密密钥） |
| POST | `/api/stc/wechat/qr/start` | 发起微信 Bot QR 扫码绑定（返回二维码 base64） |
| POST | `/api/stc/wechat/qr/status` | 轮询 QR 扫码状态（pending/scanned/confirmed/expired） |
| GET | `/api/stc/wechat/status` | 当前用户微信 Bot 绑定状态 |
| POST | `/api/stc/wechat/unbind` | 解绑微信 Bot（需 `{confirm:"UNBIND"}`） |
| GET | `/api/stc/wechat/chars` | 列出用户可用角色卡（给微信默认卡下拉用） |
| POST | `/api/stc/wechat/set-character` | 设置微信默认角色卡 |
| POST | `/api/stc/wechat/test-send` | 向指定联系人发送测试消息 |
| GET | `/api/stc/wechat/logs` | 获取消息统计摘要 |
| GET | `/api/stc/wechat/admin/pool` | 管理员：查看 worker 池状态 |

## 微信 Bot 桥接（WeChat iLink Bridge）

### 概述

基于腾讯 iLink Bot 协议（`ilinkai.weixin.qq.com`）实现的微信个人号 AI Bot 桥接。用户在"我的账户"面板里扫码绑定一个微信小号后，该小号会被 AI 接管：其他人发消息给这个小号时，SillyTavern 会使用用户选中的角色卡 + LLM 配置生成回复并自动发回。

### 架构

```
src/stc-mod/services/im-wechat/
├── protocol/                      # iLink HTTP/JSON 协议层
│   ├── types.js                   # 常量、JSDoc 类型定义
│   ├── client.js                  # HTTP 封装（三元组鉴权）
│   ├── qr.js                      # QR 码登录
│   ├── long-poller.js             # getupdates 长轮询（35s hold + 断线重连）
│   └── sender.js                  # sendmessage / sendtyping
├── workers/                       # Worker 管理
│   ├── pool.js                    # 启动/停止/挂起 workers，最大并发控制
│   └── runner.js                  # Worker 状态类型 & 辅助函数
└── bridge/                        # 业务逻辑（协议无关）
    ├── processor.js               # 消息处理主管线
    ├── command-parser.js           # /help /chars /use /new /who /undo
    ├── headless-generate.js        # 服务端无头 LLM 生成
    ├── render-sanitizer.js         # HTML/自定义标签清洗（纯文本输出）
    ├── message-chunker.js          # 长消息分片（4000 字）
    ├── sessions.js                 # 会话状态管理
    ├── bindings.js                 # 用户绑定 CRUD
    └── rate-limiter.js             # 滑动窗口限流
```

### 配置项（config.yaml）

```yaml
wechat:
  enabled: false                    # 全站开关
  baseUrl: https://ilinkai.weixin.qq.com
  botType: 3
  maxConcurrentWorkers: 50
  longPollTimeoutMs: 40000
  perContactRateLimit:
    windowSec: 60
    maxMessages: 20
  typing:
    enabled: true
    intervalMs: 3000
  renderSanitizer:
    stripUnknownCustomTags: true
    imageDomainWhitelist: []
  contentModeration:
    keywordBlocklistFile: ''
```

### 数据存储

| 文件 | 内容 |
|------|------|
| `data/stc-mod/wechat-bindings.json` | 用户 → bot 绑定（botToken、botBaseUrl、状态、统计） |
| `data/stc-mod/wechat-sessions.json` | 联系人会话状态（角色卡、chatPath、contextToken） |
| `data/<handle>/chats/<char>/wechat__<hash>.jsonl` | 微信对话历史（独立于网页端 chat） |

### 带前端角色卡的处理

微信端的 LLM 输出经过 `render-sanitizer.js` 清洗后只发送**纯文本**：
- 剥除所有 HTML 标签（`<iframe>`、`<script>`、`<style>`、自定义标签等）
- `<b>`/`<strong>` → `**粗体**`，`<i>`/`<em>` → `*斜体*`
- 去除 Markdown 图片 `![](url)`
- 规范化换行（3+ 连续换行压成 2 个）
- 超长消息按段落边界分片（≤4000 字/片）

### 微信指令

| 指令 | 效果 |
|------|------|
| `/help` | 显示帮助 |
| `/chars` | 列出可用角色卡 |
| `/use <名称>` | 切换角色卡（模糊匹配） |
| `/new` | 清空上下文 |
| `/who` | 查看当前角色 |
| `/undo` | 撤销上一轮对话 |

### V1 已知限制

- 仅支持文本消息（语音取 ASR 文字、图片/文件/视频仅提示"不支持"）
- Prompt 组装为最小子集（不含 World Info、Author's Note、Vector Memory、Group Chat）
- 每个 STC 账号只能绑定一个微信小号
- 微信会话与网页端完全隔离（独立 chat 文件）
- 全站需管理员开启 `wechat.enabled: true` 才可使用

## 升级指南

当官方 SillyTavern 发布新版本时：

### 必须操作

1. **拉取官方更新**：正常合并/覆盖官方代码
2. **重新插入 5 个 STC-MOD 钩子**（在新版 `src/server-main.js` 中）：
   - 在文件中搜索 `[STC-MOD]` 注释，若已存在则无需修改
   - 若被覆盖，按上方「具体代码差异」章节逐一插回
   - **特别注意钩子 C**：必须插在 `app.get('/', ...)` 之前，不能只放在 `/login` 之前

3. **恢复静态资源缓存策略**：
   - 检查 `app.use(express.static(path.join(serverDirectory, 'public'), ...))`
   - 若被上游覆盖为空配置 `{}`，按「改动 F - 静态资源缓存策略」恢复缓存头配置

4. **同步部署默认配置**：
   - 确认 `cacheBuster.enabled: false`
   - 确认 `extensions.autoUpdate: false`
   - 确认 `extensions.models.autoDownload: false`
   - 确认 `enableDownloadableTokenizers: false`

5. **保留目录**（升级时不要删除）：
   - `src/stc-mod/` — 全部外挂模块代码
   - `public/scripts/extensions/third-party/stc-admin-panel/` — 管理面板前端扩展
   - `data/stc-mod/` — 所有运行时数据（用户元数据、公告、邀请码等）

### 需要验证的兼容性

| 检查项 | 说明 |
|--------|------|
| `src/users.js` 导出接口 | 见上方「依赖的官方导出接口」表格，逐一确认签名未变 |
| `node-persist` API | `storage.removeItem(key)` 接口是否变更 |
| `cookie-session` 中的 `req.session.handle` | STC-MOD 用此字段判断登录态 |
| `req.user.profile.handle` | 私有路由用此获取当前用户 handle |
| `csrfSync` 配置结构 | `skipCsrfProtection` 回调参数是否变更 |
| `express.static` 调用位置 | 静态资源缓存策略应仍位于 `webpackMiddleware` 之后、公开 API 路由之前 |

### 快速验证步骤

```bash
# 启动后观察控制台，应出现：
# [STC-MOD] SillyTavernchat module loaded.
# [STC-MOD] Public routes registered.
# [STC-MOD] Public API routes registered.
# [STC-MOD] Private API routes registered.

# 若出现 [STC-MOD] Load error: ... 则说明模块加载失败，需排查
```

访问测试：
- `GET /` → 未登录应显示欢迎页（`welcome.html`），已登录应显示主界面
- `GET /login` → 应显示自定义登录页（含 OAuth 按钮）
- `GET /register` → 应显示注册页
- `GET /api/stc/public-config/public-pages` → 应返回 JSON（无需登录）

## 延迟功能

以下功能因侵入性过高暂缓实现，将在后续版本中考虑：

- **聊天文件分段存储优化**：需要深度修改核心数据读写逻辑，与非侵入式架构冲突
