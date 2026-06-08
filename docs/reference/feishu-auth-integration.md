# 飞书授权登录通用接入方案

本文档面向研发团队，描述一套可复用的飞书授权登录方案。它适用于：

- 飞书客户端内免登
- 普通浏览器扫码登录
- 普通浏览器顶层跳转授权
- 自有后端会话体系
- Docker 或传统部署环境

核心原则只有一条：

> 前端只负责获取 `code`，后端只负责把 `code` 兑换成用户身份并签发本地 session。

本文档不依赖任何具体业务系统，可直接作为其他项目的接入模板。

## 1. 设计目标

- 统一飞书客户端和普通浏览器的登录行为
- 统一一个回调地址
- 统一一条后端兑换链路
- 不在前端保存飞书 access token
- 后端生成自有 session，而不是把飞书 token 暴露给前端
- 便于多环境部署和故障排查

## 2. 角色划分

### 前端

职责：

- 判断是否在飞书环境
- 发起登录动作
- 获取飞书授权 `code`
- 跳转或回跳到统一回调页
- 读取本地 session 状态

不负责：

- 换 token
- 解析飞书用户身份
- 创建业务账号

### 回调页

职责：

- 接收 `code`
- 调后端兑换接口
- 成功后关闭窗口、通知父窗口或跳转业务页

不负责：

- 业务权限判断
- 用户资料展示
- 登录之外的页面逻辑

### 后端

职责：

- 接收授权 `code`
- 调飞书接口兑换 `access_token`
- 调飞书接口获取用户信息
- 将飞书用户映射到本地用户
- 签发本地 session cookie

不负责：

- 前端的登录交互细节
- 浏览器窗口管理

## 3. 推荐调用链路

### 3.1 飞书客户端内

1. 用户点击“使用飞书登录”
2. 前端检测到飞书环境
3. 前端调用飞书 H5 JS SDK 获取 `code`
4. 前端跳转到统一回调页
5. 回调页把 `code` 发给后端
6. 后端兑换 token、获取用户信息、签发 session
7. 前端刷新本地登录态

### 3.2 普通浏览器内

1. 用户点击“使用飞书登录”
2. 前端打开飞书授权页或扫码页
3. 用户完成扫码/授权
4. 飞书跳回统一回调页
5. 回调页把 `code` 发给后端
6. 后端兑换 token、获取用户信息、签发 session
7. 前端刷新本地登录态

### 3.3 统一原则

无论是客户端内还是浏览器内，最终都只产生一个结果：

- 一个 `code`
- 一个统一回调页
- 一次后端兑换
- 一个本地 session

## 4. 推荐模块拆分

### 4.1 `feishu-auth`

建议封装为一个纯前端通用模块，负责：

- `isFeishuClient()`
- `buildAuthorizeUrl(appId, redirectUri, state)`
- `buildCallbackUrl(code)`
- `normalizeCallbackUrl()`

这个模块只处理 URL 生成和环境判断，不做业务登录。

### 4.2 `feishu-sso`

建议封装飞书客户端内 H5 SDK 登录逻辑，负责：

- 加载飞书 H5 SDK
- `tt.config(...)`
- `tt.requestAccess(...)` 或 `tt.requestAuthCode(...)`
- 返回 `code`

这个模块的目标只有一个：拿到一个可用于后端兑换的 `code`。

### 4.3 `auth-callback`

建议独立成一个页面路由，例如：

- `/auth/callback`
- `/auth/feishu/callback`

职责：

- 读取 query 参数中的 `code`
- 调后端交换接口
- 成功后关闭窗口或跳转

### 4.4 `auth-context`

建议统一成一个认证上下文：

- 启动时调用 `GET /api/auth/me`
- 登录成功后刷新 session
- 登出时调用 `POST /api/auth/logout`

## 5. 接口设计建议

下面是推荐接口，不绑定任何具体业务系统。

### 5.1 `GET /api/auth/me`

作用：获取当前登录态。

返回示例：

```json
{
  "user": {
    "id": "uuid",
    "name": "张三",
    "avatar_url": "https://...",
    "email": "user@example.com",
    "feishu_open_id": "ou_xxx",
    "feishu_union_id": "on_xxx",
    "feishu_user_id": "u_xxx"
  },
  "roles": ["admin"]
}
```

未登录时：

```json
{
  "user": null,
  "roles": []
}
```

### 5.2 `POST /api/auth/logout`

作用：清理本地 session cookie。

返回示例：

```json
{ "success": true }
```

### 5.3 `GET /api/auth/feishu/jsapi-config?url=...`

作用：为飞书 H5 JS SDK 生成签名参数。

请求参数：

- `url`: 当前页面的规范化 URL

建议传值：

- `origin + pathname`
- 不带 query
- 不带 hash

返回示例：

```json
{
  "appId": "cli_xxx",
  "timestamp": "1715000000",
  "nonceStr": "random-hex",
  "signature": "sha256-signature"
}
```

### 5.4 `POST /api/auth/feishu/exchange`

作用：统一的授权码兑换接口。

请求体：

```json
{
  "code": "authorization_code"
}
```

成功返回：

```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "name": "张三",
    "avatar_url": "https://...",
    "email": "user@example.com"
  },
  "roles": ["admin"]
}
```

接口行为：

1. `code -> access_token`
2. `access_token -> user_info`
3. 用户映射到本地账号
4. 签发本地 session cookie

### 5.5 可选兼容接口

如果历史系统已经有 `sso`、`qr-login` 等接口，可以保留兼容层，但新系统建议统一只用：

- `POST /api/auth/feishu/exchange`

## 6. 后端实现建议

### 6.1 兑换流程

推荐使用飞书网页登录标准流程：

1. 用 `code` 调 `authen/v1/access_token`
2. 用得到的 `access_token` 调 `authen/v1/user_info`
3. 根据返回的 `union_id`、`open_id` 或 `user_id` 定位本地用户
4. 创建或更新本地用户记录
5. 生成 session cookie

### 6.2 用户唯一键

建议优先级：

1. `union_id`
2. `open_id`
3. `user_id`

原因：

- `union_id` 跨应用更稳定
- `open_id` 适合单应用场景
- `user_id` 可作为兜底

### 6.3 Session 建议

建议使用：

- `httpOnly`
- `sameSite=lax`
- `secure=true` 仅在 HTTPS 下
- 服务端签名或加密

不要把飞书 token 暴露给前端 localStorage。

## 7. 前端实现建议

### 7.1 飞书客户端内

推荐优先使用 H5 JS SDK：

- `tt.requestAccess(...)`
- 或 `tt.requestAuthCode(...)`

拿到 `code` 后，跳转统一回调页。

如果 SDK 不可用或失败：

- 回退到飞书授权页

### 7.2 普通浏览器内

推荐两种方式之一：

#### 方式 A：顶层跳转

打开飞书授权页，授权后回到统一回调页。

优点：

- 简单
- 不依赖 iframe
- 兼容性好

#### 方式 B：popup 窗口

打开新窗口授权，回调页通过 `window.opener` 通知主页面。

优点：

- 保持当前页面不跳转

缺点：

- 可能被浏览器拦截弹窗

### 7.3 回调页

回调页只做以下动作：

- 读 `code`
- 调 exchange
- 成功后关闭窗口或跳转

不要在回调页里塞业务逻辑。

## 8. 飞书控制台配置

接入飞书前，至少要配置：

- App ID
- App Secret
- Web 应用可信域名
- 重定向 URL
- 所需权限范围

重定向 URL 要求：

- 与线上最终地址完全一致
- 协议、域名、路径必须一致
- 最好不要依赖多余 query

示例：

```text
https://your-domain.example.com/auth/callback
```

## 9. 常见问题

### 9.1 “拒绝了我们的连接请求”

常见原因：

- 回调页被 iframe 嵌入
- 页面响应头包含 `X-Frame-Options: DENY`
- redirect URI 和飞书后台配置不一致

建议：

- 回调页使用顶层窗口
- 不要把授权页嵌在 iframe 里

### 9.2 点击登录无响应

常见原因：

- 飞书 SDK 没加载成功
- `requestAccess` / `requestAuthCode` 不可用
- JSAPI 签名的 URL 不规范

建议：

- 检查 `h5sdk.ready`
- 检查 `tt.config`
- 检查签名时使用的 URL 是否与当前页一致

### 9.3 回调成功但仍未登录

常见原因：

- `code` 已过期
- `code` 被重复使用
- `app_secret` 配错
- 后端 session cookie 未写入成功

建议：

- 查看后端交换接口日志
- 检查 cookie 的 `domain`、`path`、`secure`、`sameSite`

## 10. 安全建议

- `code` 只能用一次
- 不要在前端存 access token
- `state` 参数必须随机且可校验
- 回调页必须校验来源和数据结构
- 后端日志中不要完整打印敏感 token

## 11. 复用建议

如果其他系统也需要接飞书，建议直接复用以下骨架：

1. `feishu-auth`：统一 URL 构造
2. `feishu-sso`：飞书客户端内拿码
3. `auth-callback`：统一回调页
4. `auth-exchange`：后端统一兑换接口
5. `auth-me/logout`：本地会话管理

只要保持这五块不变，业务系统可以自由替换：

- 用户表结构
- 权限模型
- 登录后跳转页
- UI 样式

## 12. 最小接入清单

- 配置飞书 App ID / Secret
- 配置可信域名和 redirect URI
- 实现 H5 SDK 拿码
- 实现统一回调页
- 实现后端兑换接口
- 实现本地 session
- 实现 `GET /api/auth/me`
- 实现 `POST /api/auth/logout`

## 13. 结论

飞书接入的关键不是 SDK 选型，而是协议边界要清楚：

- 前端负责拿 `code`
- 回调页负责转交 `code`
- 后端负责换票和建 session
- 统一一个回调入口

这样可以把飞书客户端、普通浏览器、扫码登录、免登登录全部收敛到同一套协议里，便于其他系统直接复用。

