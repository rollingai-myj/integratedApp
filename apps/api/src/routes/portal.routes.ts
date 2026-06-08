/**
 * 模块 2：门户与门店上下文（不含设备相关，那两个放在 auth.routes.ts）
 *
 * 覆盖统一接口规划文档中：
 *   - 模块 2.1 当前用户可访问的模块列表（新增）
 *   - 模块 2.2 当前用户可访问的门店列表（SK-B1 升级）
 *   - 模块 2.3 切换当前激活的门店（新增）
 */
import { Router } from 'express';
import { NotImplementedError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';

export const portalRouter = Router();

/** 当前用户可访问的模块列表（门户四卡） */
portalRouter.get('/portal/modules', requireAuth, (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 当前用户可访问的门店列表 */
portalRouter.get('/portal/stores', requireAuth, (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 切换当前激活的门店（一人多店时） */
portalRouter.post(
  '/portal/active-store',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);
