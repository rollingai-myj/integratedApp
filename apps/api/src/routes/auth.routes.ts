/**
 * 模块 1：登录与身份  +  模块 2 中的「设备绑定门店」
 *
 * 覆盖统一接口规划文档中的：
 *   - 模块 1：登录、飞书 OAuth 回调、飞书 H5 签名、当前用户、退出登录
 *   - 模块 2：查询/绑定设备已绑定门店（PO-B1 / PO-B2）
 *
 * M0：除 GET /auth/me 返回未登录占位结构外，其它接口全部 501。
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { NotImplementedError } from '../lib/errors.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import type { MeResponse } from '../types/api.js';

export const authRouter = Router();

// 模块 1 ------------------------------------------------------------------

/** 店长登录：飞书优先 + 账号兜底（合并 SK-A1 + PO-A1） */
authRouter.post('/auth/login', (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 飞书 OAuth 回调 */
authRouter.post('/auth/feishu/callback', (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 飞书 H5 SDK 签名（jsapi_ticket 派生） */
authRouter.post('/auth/feishu/h5-sign', (_req, _res, next) => {
  next(new NotImplementedError());
});

/**
 * 查询当前登录用户（M0 已实现为「未登录态」占位）
 *
 * 真正接入会话后，会返回：
 *   { user, currentStore, stores, feishuLinked, modules }
 *
 * M0：恒返回未登录的空体，让前端能在没有 JWT 的情况下正常进入登录页。
 */
authRouter.get(
  '/auth/me',
  optionalAuth,
  (_req: Request, res: Response, _next: NextFunction) => {
    const body: MeResponse = {
      user: null,
      currentStore: null,
      stores: [],
      feishuLinked: false,
      modules: [],
    };
    res.json(body);
  },
);

/** 退出登录 */
authRouter.post('/auth/logout', requireAuth, (_req, _res, next) => {
  next(new NotImplementedError());
});

// 模块 2 中的设备 -----------------------------------------------------------

/** 查询设备已绑定门店（PO-B1） */
authRouter.get('/devices/:deviceId/store', (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 绑定设备到门店（PO-B2） */
authRouter.put(
  '/devices/:deviceId/store',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);
