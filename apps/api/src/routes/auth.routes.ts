/**
 * 模块 1：登录与身份  +  模块 2 中的「设备绑定门店」
 *
 * M1-PR1 已落地：账密兜底登录 + auth/me + logout
 * M1-PR2（本 PR）：飞书 OAuth 完整链路（authorize / exchange / jsapi-config）
 * M1-PR3：portal 接口 + 设备绑定
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth, optionalAuth, extractToken } from '../middleware/auth.js';
import {
  loginWithPassword,
  loginWithFeishu,
  getMeByToken,
  logoutByToken,
} from '../services/auth.service.js';
import { feishuService } from '../services/feishu.service.js';
import {
  COOKIE_NAME,
  sessionCookieOptions,
  clearCookieOptions,
} from '../lib/session.js';
import { config } from '../config/env.js';
import { writeAuditEvent } from '../services/audit.service.js';
import type { LoginResponse } from '../types/api.js';
import type { AuthenticatedUser } from '../types/api.js';

export const authRouter = Router();

/** 登录类审计（约束 #12）：失败不影响主流程 */
function auditAuth(
  req: Request,
  res: Response,
  kind: 'user_login' | 'user_logout' | 'feishu_oauth_success' | 'feishu_oauth_fail',
  user: Pick<AuthenticatedUser, 'id' | 'name' | 'roles'> | null,
  payload: Record<string, unknown> = {},
): void {
  void writeAuditEvent({
    eventKind: kind,
    actorUserId: user?.id ?? null,
    actorRole: user?.roles?.[0] ?? null,
    actorDisplayName: user?.name ?? null,
    summary:
      kind === 'user_login' ? '账密登录'
      : kind === 'user_logout' ? '退出登录'
      : kind === 'feishu_oauth_success' ? '飞书登录成功'
      : '飞书登录失败',
    payload,
    ipAddress: extractClientIp(req),
    userAgent: req.get('user-agent') ?? null,
    requestId: (res.locals.requestId as string | undefined) ?? null,
  }).catch(() => { /* 审计失败静默 */ });
}

// 模块 1 ------------------------------------------------------------------

// -- 账密兜底登录 -----------------------------------------------------------

const loginSchema = z.object({
  account: z.string().min(1, '账号不能为空'),
  password: z.string().min(1, '密码不能为空'),
});

/**
 * 店长登录（账密兜底通路）
 *
 * 飞书登录是主路径；本路由是 D2 决策的"分阶段切换"中的兜底通路，
 * 让老账号在飞书还没全量上线前能登入。匹配 users.legacy_account。
 */
authRouter.post('/auth/login', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(
          400,
          ErrorCodes.VALIDATION_ERROR,
          parsed.error.issues[0]?.message ?? '请求体不合法',
          parsed.error.issues,
        );
      }
      const ip = extractClientIp(req);
      const result = await loginWithPassword({
        account: parsed.data.account,
        password: parsed.data.password,
        userAgent: req.get('user-agent') ?? null,
        ip,
      });

      const maxAge = config.SESSION_TTL_SECONDS * 1000;
      res.cookie(COOKIE_NAME, result.token, sessionCookieOptions(maxAge));

      auditAuth(req, res, 'user_login', result.user, { method: 'legacy_password' });

      const body: LoginResponse = {
        user: result.user,
        expiresAt: result.expiresAt.toISOString(),
      };
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  })();
});

// -- 飞书 OAuth 三件套 ------------------------------------------------------

const authorizeQuerySchema = z.object({
  redirect_uri: z.string().url().optional(),
});

/**
 * GET /auth/feishu/authorize
 *
 * 返回前端要打开的飞书授权 URL。前端打开后，飞书引导用户授权，
 * 然后回跳到 redirect_uri 并带上 ?code= 和 ?state=
 *
 * state 我们随机生成、存 cookie（5 分钟过期），回调时校验。
 */
authRouter.get(
  '/auth/feishu/authorize',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = authorizeQuerySchema.parse(req.query);
      const state = randomBytes(16).toString('hex');
      // state cookie：不在主 session 上挂，独立短期 cookie
      res.cookie('feishu_oauth_state', state, {
        httpOnly: true,
        secure: config.COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
        maxAge: 5 * 60 * 1000,
      });
      const url = feishuService.buildAuthorizeUrl(state, q.redirect_uri);
      res.json({ authorizeUrl: url, state });
    } catch (err) {
      next(err);
    }
  },
);

const exchangeSchema = z.object({
  code: z.string().min(1, 'code 不能为空'),
  state: z.string().min(1).optional(),
  client: z.enum(['feishu_h5', 'feishu_pc', 'browser']).default('browser'),
});

/**
 * POST /auth/feishu/exchange
 *
 * 前端拿到 code（无论来自 H5 SDK 还是浏览器扫码回跳）后调本接口；
 * 后端完成 code → user_token → 通讯录 → upsert → session 全链路。
 *
 * 安全：
 *   - state 必须匹配 cookie 里的 feishu_oauth_state（浏览器路径强制；H5 SDK 路径可豁免）
 *   - code 一次性使用；飞书会自动拒绝重复
 */
authRouter.post(
  '/auth/feishu/exchange',
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const parsed = exchangeSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(
            400,
            ErrorCodes.VALIDATION_ERROR,
            parsed.error.issues[0]?.message ?? '请求体不合法',
            parsed.error.issues,
          );
        }
        const { code, state, client } = parsed.data;

        // 浏览器扫码登录路径必须带 state；H5 SDK 内拿码可豁免
        if (client === 'browser') {
          const cookies = (req as Request & { cookies?: Record<string, string> })
            .cookies ?? {};
          const expectedState = cookies.feishu_oauth_state;
          if (!state || !expectedState || state !== expectedState) {
            throw new AppError(
              400,
              ErrorCodes.BAD_REQUEST,
              'state 校验失败，请重新发起授权',
            );
          }
          res.clearCookie('feishu_oauth_state', { path: '/' });
        }

        let result;
        try {
          result = await loginWithFeishu({
            code,
            clientType: client,
            userAgent: req.get('user-agent') ?? null,
            ip: extractClientIp(req),
          });
        } catch (err) {
          auditAuth(req, res, 'feishu_oauth_fail', null, {
            client,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }

        const maxAge = config.SESSION_TTL_SECONDS * 1000;
        res.cookie(COOKIE_NAME, result.token, sessionCookieOptions(maxAge));

        auditAuth(req, res, 'feishu_oauth_success', result.user, { client });

        const body: LoginResponse = {
          user: result.user,
          expiresAt: result.expiresAt.toISOString(),
          notice: result.notice,
        };
        res.status(200).json(body);
      } catch (err) {
        next(err);
      }
    })();
  },
);

const jsapiQuerySchema = z.object({
  url: z.string().url('url 必须是合法 URL'),
});

/**
 * GET /auth/feishu/jsapi-config?url=...
 *
 * 在飞书 H5 客户端内调 tt.config 时需要的签名参数。
 * 前端传当前页 URL（normalize 过：origin + pathname，不带 query/hash）。
 */
authRouter.get(
  '/auth/feishu/jsapi-config',
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const { url } = jsapiQuerySchema.parse(req.query);
        const sig = await feishuService.signH5Url(url);
        res.json(sig);
      } catch (err) {
        next(err);
      }
    })();
  },
);

/**
 * 兼容路径：旧的"回调"接口
 *
 * 在新流程里推荐前端直接调 /auth/feishu/exchange。本路径保留是
 * 因为统一接口规划文档 v2.1 里有这条；以及方便未来 GET 形式的服务端回跳。
 * 实现上转给 exchange。
 */
authRouter.post('/auth/feishu/callback', (_req, _res, next) => {
  next(
    new AppError(
      410,
      ErrorCodes.NOT_IMPLEMENTED,
      '请改用 POST /auth/feishu/exchange',
    ),
  );
});

/** 飞书 H5 SDK 签名（兼容旧路径） */
authRouter.post('/auth/feishu/h5-sign', (_req, _res, next) => {
  next(
    new AppError(
      410,
      ErrorCodes.NOT_IMPLEMENTED,
      '请改用 GET /auth/feishu/jsapi-config',
    ),
  );
});

// -- auth/me 和 logout -----------------------------------------------------

/**
 * 查询当前登录用户
 *
 * 未登录 / 会话失效 / 用户停用都返回相同的"空体"——前端据此跳转登录页。
 * 登录后返回完整身份、可见门店、当前激活门店、可访问模块、飞书是否绑定、
 * 以及可能的 notice（如飞书账号没匹配到门店）。
 */
authRouter.get(
  '/auth/me',
  optionalAuth,
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const token = extractToken(req);
        const body = await getMeByToken(token);
        res.json(body);
      } catch (err) {
        next(err);
      }
    })();
  },
);

/** 退出登录 */
authRouter.post(
  '/auth/logout',
  requireAuth,
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        await logoutByToken(req.sessionToken ?? null);
        auditAuth(req, res, 'user_logout', req.user ?? null);
        res.clearCookie(COOKIE_NAME, clearCookieOptions());
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    })();
  },
);

// -- helpers ---------------------------------------------------------------

function extractClientIp(req: Request): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? null;
}
