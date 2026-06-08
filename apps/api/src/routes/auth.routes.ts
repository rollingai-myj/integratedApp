/**
 * 模块 1：登录与身份  +  模块 2 中的「设备绑定门店」
 *
 * 覆盖统一接口规划文档中的：
 *   - 模块 1：登录、飞书 OAuth 回调、飞书 H5 签名、当前用户、退出登录
 *   - 模块 2：查询/绑定设备已绑定门店（PO-B1 / PO-B2）
 *
 * M1-PR1：账密兜底登录 + auth/me + logout 已真实实现
 * 飞书相关接口仍为 501，留给 M1-PR2
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { NotImplementedError, AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth, optionalAuth, extractToken } from '../middleware/auth.js';
import {
  loginWithPassword,
  getMeByToken,
  logoutByToken,
} from '../services/auth.service.js';
import {
  COOKIE_NAME,
  sessionCookieOptions,
  clearCookieOptions,
} from '../lib/session.js';
import { config } from '../config/env.js';
import type { LoginResponse } from '../types/api.js';

export const authRouter = Router();

// 模块 1 ------------------------------------------------------------------

const loginSchema = z.object({
  account: z.string().min(1, '账号不能为空'),
  password: z.string().min(1, '密码不能为空'),
});

/**
 * 店长登录（账密兜底通路）
 *
 * 飞书登录在 M1-PR2 接入；本路由是 D2 决策的"分阶段切换"中的兜底通路，
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
      const ip =
        (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
        req.socket.remoteAddress ||
        null;
      const result = await loginWithPassword({
        account: parsed.data.account,
        password: parsed.data.password,
        userAgent: req.get('user-agent') ?? null,
        ip,
      });

      const maxAge = config.SESSION_TTL_SECONDS * 1000;
      res.cookie(COOKIE_NAME, result.token, sessionCookieOptions(maxAge));

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

/** 飞书 OAuth 回调 */
authRouter.post('/auth/feishu/callback', (_req, _res, next) => {
  next(new NotImplementedError('M1-PR2 实现飞书 OAuth 回调'));
});

/** 飞书 H5 SDK 签名（jsapi_ticket 派生） */
authRouter.post('/auth/feishu/h5-sign', (_req, _res, next) => {
  next(new NotImplementedError('M1-PR2 实现飞书 H5 签名'));
});

/**
 * 查询当前登录用户
 *
 * 未登录 / 会话失效 / 用户停用都返回相同的"空体"——前端据此跳转登录页。
 * 登录后返回完整身份、可见门店、当前激活门店、可访问模块、飞书是否绑定。
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
        res.clearCookie(COOKIE_NAME, clearCookieOptions());
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    })();
  },
);

// 模块 2 中的设备 -----------------------------------------------------------

/** 查询设备已绑定门店（PO-B1） */
authRouter.get('/devices/:deviceId/store', (_req, _res, next) => {
  next(new NotImplementedError('M1-PR3 实现设备绑定门店查询'));
});

/** 绑定设备到门店（PO-B2） */
authRouter.put(
  '/devices/:deviceId/store',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError('M1-PR3 实现设备绑定门店写入'));
  },
);
