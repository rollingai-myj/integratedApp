
# 统一门户 SSO 认证系统 — 架构说明文档

版本：v1.0.0  
更新日期：2026-06-07  
适用场景：同一根域名下多个独立 Web 应用，基于飞书 OAuth 2.0 实现单点登录

---

## 目录

1. [背景与目标](#1-背景与目标)
2. [系统概览](#2-系统概览)
3. [技术选型说明](#3-技术选型说明)
4. [认证核心原理](#4-认证核心原理)
5. [系统模块详解](#5-系统模块详解)
6. [完整认证流程](#6-完整认证流程)
7. [接口设计](#7-接口设计)
8. [数据结构设计](#8-数据结构设计)
9. [安全策略](#9-安全策略)
10. [部署架构](#10-部署架构)
11. [开发接入指南](#11-开发接入指南)
12. [常见问题与注意事项](#12-常见问题与注意事项)

---

## 1. 背景与目标

### 1.1 背景

企业内部存在三个独立开发、独立部署的 Web 应用，分别服务于不同的业务场景。三个应用均部署在同一根域名下的二级子域，用户群体重叠度高，需要使用飞书账号体系作为统一身份认证来源。

当前痛点如下：

- 用户在三个应用之间切换需要反复登录，体验割裂
- 各应用各自维护一套飞书 OAuth 对接逻辑，代码重复、维护成本高
- 没有统一的入口，用户需要记忆三个不同的访问地址
- 各应用的会话生命周期不一致，难以统一管理

### 1.2 目标

- 用户在门户完成一次飞书登录后，访问任意子应用无需再次登录
- 建立统一的门户网站，作为所有子应用的聚合入口
- 退出登录一次，所有子应用的会话同步失效
- 飞书 OAuth 对接逻辑收敛到门户，子应用只负责验证 session

---

## 2. 系统概览

### 2.1 域名规划

| 应用     | 域名                 | 职责                         |
| -------- | -------------------- | ---------------------------- |
| 门户网站 | `portal.example.com` | 统一入口、飞书登录、会话颁发 |
| 子应用 1 | `app1.example.com`   | 业务应用                     |
| 子应用 2 | `app2.example.com`   | 业务应用                     |
| 子应用 3 | `app3.example.com`   | 业务应用                     |
| 根域名   | `.example.com`       | Cookie 共享域                |

### 2.2 基础设施依赖

| 组件             | 用途                            | 备注                           |
| ---------------- | ------------------------------- | ------------------------------ |
| Redis            | 存储 session 数据，所有应用共享 | 必须是同一个实例               |
| HTTPS 证书       | 支持 Secure Cookie              | 通配符证书覆盖 `*.example.com` |
| 飞书开放平台应用 | OAuth 2.0 授权                  | 一个飞书应用即可               |

### 2.3 整体架构图

```
                          ┌──────────────────────────────────────┐
                          │          portal.example.com           │
                          │                                      │
                          │  ┌──────────┐    ┌────────────────┐  │
                          │  │ 飞书登录  │    │   快捷入口卡片  │  │
                          │  │  入口    │    │  App1 App2 App3│  │
                          │  └────┬─────┘    └───────┬────────┘  │
                          │       │                  │           │
                          └───────┼──────────────────┼───────────┘
                                  │                  │
                    ┌─────────────┘                  │ 跳转（携带共享 Cookie）
                    │                                │
                    ▼                    ┌───────────┼───────────┐
               飞书 OAuth               ▼           ▼           ▼
          open.feishu.cn        app1.example  app2.example  app3.example
                    │                    │           │           │
                    │ 授权码 code         └───────────┼───────────┘
                    ▼                               │
          portal/auth/callback                      │ 读取 Cookie
                    │                               ▼
                    │ 写 Session             ┌──────────────┐
                    ▼                        │    Redis     │
              ┌──────────┐  ◀─── 查询 ────  │  Session 池  │
              │  Redis   │                   └──────────────┘
              └──────────┘
                    │
                    │ 设置 Cookie
                    │ Domain=.example.com
                    ▼
            用户浏览器 Cookie
        （所有子域均可自动携带）
```

---

## 3. 技术选型说明

### 3.1 为何使用共享 Cookie 而非 Token 传参

浏览器对同一根域名下的子域名，支持通过 Cookie 的 `Domain` 属性实现自动共享。将 Cookie 的 `domain` 设置为 `.example.com`（注意前缀有点），则所有子域在每次 HTTP 请求时均会自动携带该 Cookie，无需前端做任何额外处理。

相比通过 URL 参数传递 token 的方案，共享 Cookie 的优势在于对业务代码完全透明，用户直接输入子应用地址时同样生效，不存在 token 泄露在浏览器历史记录中的风险。

### 3.2 为何使用 Redis 存储 Session 而非 JWT

JWT 方案将用户信息加密编码在 token 本身中，无需服务端存储，但存在一个关键缺陷：**无法主动使 token 失效**。一旦用户被飞书移除权限、账号被禁用，或用户主动退出，JWT 在过期前仍然有效。

使用 Redis 集中存储 session 则可以：

- 任何时刻主动删除 session 使其立即失效
- 统一管理所有登录用户的会话状态
- 支持踢出指定用户的所有 session（如安全事件处理）
- 方便统计当前在线用户数

### 3.3 为何门户承担回调而非独立 auth 服务

门户网站本身就是所有子应用的入口，用户流量天然经过此处。将飞书回调集中在门户可以减少一个服务的部署和维护成本，且门户本身也需要鉴权，职责边界清晰。若后续规模扩大、需要支持更多 OAuth 提供商，再将认证逻辑拆分为独立的 `auth.example.com` 服务亦不复杂。

---

## 4. 认证核心原理

### 4.1 Cookie 跨子域共享机制

HTTP Cookie 规范规定，当 Cookie 的 `Domain` 属性设置为 `.example.com` 时，以下域名的请求均会自动携带该 Cookie：

- `portal.example.com`
- `app1.example.com`
- `app2.example.com`
- `app3.example.com`
- 其他任意 `*.example.com` 子域

这是整套方案的基础，也是必须保证所有应用部署在同一根域名下的原因。

### 4.2 Session 验证模型

Cookie 中只存储一个不可猜测的随机 session token（UUID v4），本身不含任何用户信息。真实的用户数据存储在 Redis 中，以 session token 为 key 进行索引。

每次请求的验证流程为：

```
请求携带 Cookie(sso_token=<uuid>)
        │
        ▼
Redis.get("session:<uuid>")
        │
        ├── 存在且未过期 ──▶ 解析用户信息，注入请求上下文，放行
        │
        └── 不存在/已过期 ──▶ 清除 Cookie，重定向门户登录
```

这种设计保证了即使 Cookie 被截获，攻击者也只拿到一个无意义的随机字符串，且服务端可随时通过删除 Redis key 使其失效。

### 4.3 飞书 OAuth 2.0 授权码流程

系统使用飞书 OAuth 2.0 的授权码（Authorization Code）模式，具体步骤如下：

1. 前端将用户重定向至飞书授权页，携带 `app_id`、`redirect_uri`、`state` 参数
2. 用户在飞书完成身份确认（扫码或账密）
3. 飞书将用户重定向回 `redirect_uri`，附带一次性授权码 `code` 和原样返回的 `state`
4. 服务端用 `code` 换取 `access_token`（此步骤在服务端完成，`app_secret` 不暴露给前端）
5. 用 `access_token` 调用飞书用户信息接口获取用户数据
6. 服务端创建 session，写入 Redis，向浏览器写共享 Cookie

---

## 5. 系统模块详解

### 5.1 门户网站（portal.example.com）

门户承担三项职责：

**认证入口**：提供飞书登录的发起点，处理飞书 OAuth 回调，颁发 session Cookie。所有飞书相关的密钥（`app_id`、`app_secret`）只在门户服务端存在，不在子应用中出现。

**应用导航**：登录后展示用户有权限访问的应用列表，提供快捷入口卡片。可在此层面实现应用级别的访问控制（即某些用户只能看到部分应用的入口）。

**会话管理**：提供退出登录接口，统一清理 Redis session 和共享 Cookie。

### 5.2 子应用（app1/2/3.example.com）

子应用的职责被最大程度简化：

**无需关心飞书 OAuth**：子应用不持有任何飞书凭证，不处理任何 OAuth 流程。

**只做 Session 验证**：每个受保护路由挂载统一的鉴权中间件，从 Cookie 取 token，去 Redis 查 session，有则放行，无则重定向门户。

**保留重定向上下文**：未登录用户直接访问子应用某个页面时，需将当前 URL 作为 `redirectTo` 参数带到门户登录页，登录完成后能准确跳回用户的原始目标页。

### 5.3 Redis Session 存储

所有应用共享同一个 Redis 实例。Session 数据的 key 格式统一为 `session:<uuid>`，TTL 默认 7200 秒（2小时）。

用户每次通过鉴权中间件时可选择性地滑动续期，也可配置固定过期不续期，依据业务安全要求决定。

---

## 6. 完整认证流程

### 6.1 场景一：用户首次从门户登录

```
1. 用户访问 portal.example.com
2. 门户检测无有效 Cookie，展示"飞书登录"按钮
3. 用户点击登录
4. 门户生成随机 state，存入临时 Cookie（防 CSRF）
5. 将用户重定向至飞书授权页
   └─ GET https://open.feishu.cn/open-apis/authen/v1/authorize
         ?app_id=xxx
         &redirect_uri=https://portal.example.com/auth/callback
         &state=<random-uuid>
6. 用户在飞书完成身份验证
7. 飞书重定向回 portal.example.com/auth/callback?code=xxx&state=xxx
8. 门户验证 state 一致（防 CSRF）
9. 服务端用 code 换取飞书 access_token（POST，含 app_secret）
10. 用 access_token 调飞书用户信息接口
11. 生成 session token（UUID v4）
12. 将用户信息写入 Redis，Key=session:<token>，TTL=7200s
13. 向浏览器写 Cookie：
    Set-Cookie: sso_token=<token>; Domain=.example.com; HttpOnly; Secure; SameSite=Lax; Max-Age=7200
14. 重定向至门户首页
15. 门户验证 Cookie 有效，展示快捷入口卡片
```

### 6.2 场景二：从门户点击快捷入口进入子应用

```
1. 用户在门户点击 "App1" 快捷入口
2. 浏览器跳转至 https://app1.example.com
3. 浏览器自动携带 Cookie（sso_token），因为 Domain=.example.com 匹配
4. app1 鉴权中间件读取 Cookie 中的 sso_token
5. 去共享 Redis 查询 session:<token>
6. session 存在且有效，解析用户信息注入请求上下文
7. 正常返回页面内容 ✅
```

### 6.3 场景三：用户直接访问子应用 URL（未登录）

```
1. 用户在浏览器地址栏直接输入 https://app2.example.com/some/page
2. 无有效 Cookie（或 session 已过期）
3. app2 鉴权中间件检测到未授权
4. 构造重定向 URL：
   https://portal.example.com/login?redirectTo=https://app2.example.com/some/page
5. 用户在门户完成飞书登录，Session 写入 Redis，共享 Cookie 写入浏览器
6. 门户读取 redirectTo 参数，重定向至 https://app2.example.com/some/page
7. app2 再次收到请求，Cookie 有效，正常放行 ✅
```

### 6.4 场景四：用户退出登录

```
1. 用户在任意应用（通常为门户）点击退出登录
2. 请求发送至 portal.example.com/logout（统一退出接口）
3. 从 Cookie 取 sso_token
4. Redis 删除 session:<token>（立即失效，所有子应用同步感知）
5. 清除浏览器 Cookie：
   Set-Cookie: sso_token=; Domain=.example.com; Max-Age=0
6. 重定向至门户登录页
7. 用户此后访问任意子应用均会跳转登录页 ✅
```

### 6.5 场景五：Session 过期自动续期（可选）

```
用户持续使用 App1 期间，每次请求通过鉴权中间件时：
        │
        ▼
检查 Redis TTL 剩余时间
        │
        ├── TTL > 1800s（剩余超过 30 分钟）──▶ 不做操作，正常放行
        │
        └── TTL ≤ 1800s（剩余不足 30 分钟）──▶ 重置 TTL 为 7200s（滑动续期）
```

---

## 7. 接口设计

### 7.1 门户认证接口

#### GET /login

发起飞书 OAuth 授权流程。

| 参数         | 位置  | 必填 | 说明                                     |
| ------------ | ----- | ---- | ---------------------------------------- |
| `redirectTo` | Query | 否   | 登录完成后的目标跳转地址，默认为门户首页 |

处理逻辑：
- 生成随机 state，存入临时 Cookie `oauth_state`（TTL 5 分钟）
- 将 `redirectTo` 存入临时 Cookie `oauth_redirect`（TTL 5 分钟）
- 302 重定向至飞书授权页

响应：`302 Redirect → 飞书授权页`

---

#### GET /auth/callback

飞书 OAuth 授权回调，仅供飞书服务器调用，用户不直接访问。

| 参数    | 位置  | 必填 | 说明                             |
| ------- | ----- | ---- | -------------------------------- |
| `code`  | Query | 是   | 飞书颁发的一次性授权码           |
| `state` | Query | 是   | 原样返回的 state，用于 CSRF 校验 |

处理逻辑：
- 校验 `state` 与临时 Cookie 中的 `oauth_state` 是否一致
- 用 `code` 换取飞书 `access_token`
- 调用飞书用户信息接口
- 创建 session 写入 Redis
- 写共享 Cookie `sso_token`，`Domain=.example.com`
- 清除临时 Cookie
- 302 重定向至 `oauth_redirect` 中保存的地址

响应：`302 Redirect → 目标业务页面`

---

#### POST /logout

统一退出登录。

处理逻辑：
- 从 Cookie 读取 `sso_token`
- 删除 Redis 中对应的 session
- 清除浏览器共享 Cookie
- 重定向至登录页

响应：`302 Redirect → /login`

---

#### GET /goto

门户快捷入口跳转中转（可选，用于续期 session）。

| 参数  | 位置  | 必填 | 说明                                    |
| ----- | ----- | ---- | --------------------------------------- |
| `app` | Query | 是   | 目标应用标识，如 `app1`、`app2`、`app3` |

处理逻辑：
- 鉴权中间件验证 session 有效
- 刷新 Redis TTL（滑动续期）
- 302 重定向至目标子应用

响应：`302 Redirect → 目标子应用`

---

#### GET /api/session

（可选）供子应用前端 Ajax 调用，验证当前 session 状态并返回用户信息，用于前后端分离架构下的客户端鉴权。

响应示例：

```json
{
  "valid": true,
  "user": {
    "userId": "ou_xxxxxxxx",
    "name": "张三",
    "email": "zhangsan@example.com",
    "avatar": "https://..."
  }
}
```

---

### 7.2 子应用鉴权中间件规范

子应用不对外暴露认证相关接口，鉴权逻辑以中间件形式挂载在路由层。所有需要登录才能访问的路由均挂载此中间件。

中间件行为规范：

- 从请求 Cookie 中读取 `sso_token`
- 去共享 Redis 查询 `session:<token>`
- 查询成功：将用户对象挂载至 `req.user`，调用 `next()`
- 查询失败或 Cookie 不存在：清除 Cookie，构造带 `redirectTo` 参数的门户登录 URL，执行 302 重定向
- 不应在子应用中处理任何 OAuth 相关逻辑

---

## 8. 数据结构设计

### 8.1 Redis Session 结构

```
Key:   session:<uuid-v4>
Type:  String（JSON 序列化）
TTL:   7200 秒（默认，可滑动续期）

Value 结构：
{
  "userId":              "ou_xxxxxxxxxxxxxxxx",   // 飞书 open_id，唯一标识用户
  "unionId":             "on_xxxxxxxxxxxxxxxx",   // 飞书 union_id，跨应用唯一标识
  "name":                "张三",
  "email":               "zhangsan@example.com",
  "avatar":              "https://sf3-cn.feishucdn.com/...",
  "feishuAccessToken":   "u-xxxxxxxx",            // 飞书 access_token，调用飞书 API 使用
  "feishuRefreshToken":  "ur-xxxxxxxx",           // 用于续期飞书 access_token
  "feishuTokenExpireAt": 1717776000000,           // 飞书 token 到期时间戳（ms）
  "loginAt":             1717769000000,           // 本次登录时间戳（ms）
  "loginIp":             "1.2.3.4"               // 登录时的客户端 IP（可选，用于安全审计）
}
```

### 8.2 Cookie 结构

```
Name:     sso_token
Value:    <uuid-v4>（纯随机，不含任何业务信息）
Domain:   .example.com
Path:     /
HttpOnly: true
Secure:   true
SameSite: Lax
Max-Age:  7200
```

### 8.3 临时 OAuth 状态 Cookie

以下两个 Cookie 仅在 OAuth 流程期间存在，回调处理完成后立即清除。

```
Name:     oauth_state
Value:    <uuid-v4>（CSRF 防护）
Domain:   portal.example.com（不扩散到子域）
HttpOnly: true
Secure:   true
Max-Age:  300

Name:     oauth_redirect
Value:    <目标 URL>（登录完成后的跳转地址）
Domain:   portal.example.com
HttpOnly: true
Secure:   true
Max-Age:  300
```

---

## 9. 安全策略

### 9.1 CSRF 防护

飞书 OAuth 回调使用 `state` 参数防止 CSRF 攻击。流程如下：

登录发起时生成随机 UUID 作为 state，通过 `HttpOnly Cookie` 存储在客户端（而非 Session 或 URL），飞书回调时校验请求中的 `state` Query 参数与 Cookie 中存储的值是否完全一致。不一致时直接返回 400，拒绝处理。

使用 Cookie 存储 state 而非 URL 参数，是因为 URL 参数在中间人劫持场景下更易被篡改。

### 9.2 Cookie 安全属性

| 属性       | 值           | 作用                                                                                   |
| ---------- | ------------ | -------------------------------------------------------------------------------------- |
| `HttpOnly` | true         | JavaScript 无法通过 `document.cookie` 读取，防御 XSS 攻击窃取 Cookie                   |
| `Secure`   | true         | Cookie 仅在 HTTPS 连接下传输，防止明文传输被窃听                                       |
| `SameSite` | Lax          | 允许同站请求和安全的跨站顶级导航（GET 跳转）携带 Cookie，阻止跨站 POST 请求携带 Cookie |
| `Domain`   | .example.com | 限定在自有域名范围内共享，不会发送到第三方域名                                         |

> **注意**：`SameSite` 不能设置为 `Strict`。因为飞书 OAuth 回调是从 `open.feishu.cn` 跳转回门户，属于跨站导航，`Strict` 模式下临时 OAuth Cookie 不会被携带，导致 state 校验失败。

### 9.3 Session Token 安全

- Session token 使用 `crypto.randomUUID()` 生成，基于密码学安全的随机数，不可预测
- Token 本身不含任何用户信息，仅作为 Redis 的查询 key
- 不同用户、不同登录会话使用不同的 token，互不干扰
- 服务端可随时通过删除 Redis key 主动使指定 session 失效

### 9.4 飞书 App Secret 保护

- `app_id` 和 `app_secret` 仅存在于门户服务端的环境变量中
- 三个子应用均不持有任何飞书凭证
- 授权码换 token 的步骤（包含 `app_secret`）在服务端完成，不经过浏览器
- 定期在飞书开放平台轮换 `app_secret`

### 9.5 开放重定向防护

`redirectTo` 参数存在被篡改为恶意外站 URL 的风险（Open Redirect）。需要在门户回调处理时校验目标地址：

```javascript
function isSafeRedirectUrl(url) {
  try {
    const parsed = new URL(url);
    const allowedHosts = [
      'portal.example.com',
      'app1.example.com',
      'app2.example.com',
      'app3.example.com',
    ];
    return allowedHosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}

// 使用
const redirectTo = isSafeRedirectUrl(req.cookies.oauth_redirect)
  ? req.cookies.oauth_redirect
  : 'https://portal.example.com';
```

---

## 10. 部署架构

### 10.1 生产环境部署

```
                        互联网用户
                            │
                            ▼
                    ┌───────────────┐
                    │  负载均衡 /   │
                    │  反向代理     │
                    │  (Nginx)      │
                    └───────┬───────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │   portal     │  │    app1      │  │    app2/3    │
  │  服务集群    │  │  服务集群    │  │  服务集群    │
  └──────────────┘  └──────────────┘  └──────────────┘
          │                 │                 │
          └─────────────────┼─────────────────┘
                            │
                    ┌───────▼───────┐
                    │  Redis 集群   │
                    │（共享 Session）│
                    └───────────────┘
```

### 10.2 环境变量规范

**门户服务（portal）必须配置：**

```bash
# 飞书应用凭证（仅门户持有）
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Redis 连接（所有应用共用同一配置）
REDIS_HOST=redis.internal.example.com
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
REDIS_DB=0

# 门户自身配置
PORTAL_BASE_URL=https://portal.example.com
COOKIE_DOMAIN=.example.com
SESSION_TTL=7200
NODE_ENV=production
```

**子应用（app1/2/3）必须配置：**

```bash
# Redis 连接（与门户相同的实例）
REDIS_HOST=redis.internal.example.com
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
REDIS_DB=0

# 门户地址（用于重定向）
PORTAL_BASE_URL=https://portal.example.com
COOKIE_DOMAIN=.example.com
NODE_ENV=production

# 不需要任何飞书相关配置 ✅
```

### 10.3 Nginx 配置参考

```nginx
# 通配符域名统一入口
server {
    listen 443 ssl;
    server_name portal.example.com;

    ssl_certificate     /etc/ssl/example.com.crt;  # 通配符证书
    ssl_certificate_key /etc/ssl/example.com.key;

    location / {
        proxy_pass http://portal_upstream;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# 子应用配置类似，替换 server_name 和 proxy_pass 即可
```

---

## 11. 开发接入指南

### 11.1 飞书开放平台配置

1. 进入飞书开放平台控制台，创建一个企业自建应用
2. 在「安全设置」→「重定向 URL」中，**只添加一条**回调地址：

   ```
   https://portal.example.com/auth/callback
   ```

3. 在「权限管理」中申请以下权限：
   - `contact:user.base:readonly`（获取用户基本信息）
   - `contact:user.email:readonly`（获取用户邮箱，可选）

4. 记录 `App ID` 和 `App Secret`，填入门户服务环境变量

### 11.2 子应用接入步骤

**步骤一：安装 Redis 客户端并配置连接**

确保与门户使用相同的 Redis 实例和 DB 编号。

**步骤二：引入统一鉴权中间件**

```javascript
// middleware/auth.js
const redis = require('./redisClient'); // 复用 Redis 连接

async function authMiddleware(req, res, next) {
  const sessionToken = req.cookies?.sso_token;

  if (!sessionToken) {
    return redirectToLogin(req, res);
  }

  const raw = await redis.get(`session:${sessionToken}`);

  if (!raw) {
    res.clearCookie('sso_token', { domain: '.example.com' });
    return redirectToLogin(req, res);
  }

  // 可选：滑动续期
  const ttl = await redis.ttl(`session:${sessionToken}`);
  if (ttl < 1800) {
    await redis.expire(`session:${sessionToken}`, 7200);
  }

  req.user = JSON.parse(raw);
  next();
}

function redirectToLogin(req, res) {
  const redirectTo = encodeURIComponent(
    `${req.protocol}://${req.hostname}${req.originalUrl}`
  );
  res.redirect(
    `${process.env.PORTAL_BASE_URL}/login?redirectTo=${redirectTo}`
  );
}

module.exports = authMiddleware;
```

**步骤三：在路由上挂载中间件**

```javascript
const authMiddleware = require('./middleware/auth');

// 挂载到所有需要登录的路由
app.use('/dashboard', authMiddleware);
app.use('/api', authMiddleware);

// 或者针对特定路由
app.get('/profile', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});
```

**步骤四：确保 Cookie 解析中间件已挂载**

```javascript
const cookieParser = require('cookie-parser');
app.use(cookieParser());
```

**步骤五：验证接入**

启动应用，直接访问受保护路由，应能看到跳转至门户登录页的行为。在门户完成飞书登录后，应自动跳回原路由并正常展示内容。

---

## 12. 常见问题与注意事项

### Cookie 相关

**问：本地开发时 Cookie 不生效**

本地开发通常使用 `http://localhost`，Secure Cookie 只在 HTTPS 下传输，因此本地调试时需临时去掉 Cookie 配置中的 `secure: true`。同时本地无法模拟子域共享，建议使用 hosts 文件将 `portal.local`、`app1.local` 等映射到 `127.0.0.1`，并修改 `domain` 为 `.local`。

**问：子应用收不到 Cookie**

检查以下几点：门户写 Cookie 时 `domain` 是否为 `.example.com`（注意有前导点）；子应用是否部署在同一根域名下；HTTPS 证书是否为通配符证书且覆盖所有子域；浏览器是否因 SameSite 或 Secure 属性拦截了 Cookie（打开 DevTools → Application → Cookies 查看）。

### 飞书 OAuth 相关

**问：飞书提示"回调地址不在白名单"**

飞书要求回调地址精确匹配（包括路径和参数格式），检查飞书开放平台中配置的回调地址与代码中 `redirect_uri` 的值是否完全一致，包括协议（http/https）、端口、路径。

**问：state 校验失败**

通常原因是临时 Cookie `oauth_state` 未被正确携带。检查临时 Cookie 的 `SameSite` 设置，飞书回调是跨站请求，`Strict` 模式会导致 Cookie 丢失，需使用 `Lax`。

### Session 相关

**问：如何强制下线某个用户**

直接从 Redis 中删除该用户所有的 session key。可在 Redis 中维护一个用户到 session 列表的映射（`user_sessions:<userId>` 存储该用户所有的 session token），便于批量删除。

**问：飞书 access_token 过期后如何处理**

飞书 `access_token` 有效期通常为 2 小时，可通过 `refresh_token` 续期。建议在后台启动一个定时任务，定期扫描 Redis 中即将过期的 feishuAccessToken 并使用 refresh_token 换取新 token 写回，对业务请求无感知。

**问：多标签页同时使用是否有问题**

同一浏览器下的多个标签页共享 Cookie，使用同一个 session token，Redis 中的 session 也是同一条记录。多标签页并发请求不会产生冲突，但如果一个标签页执行退出登录，其他标签页的下次请求会因 session 被删除而跳转登录页。
