/**
 * 模块 2：门户与门店上下文（不含设备相关，那两个放在 auth.routes.ts）
 *
 * 覆盖统一接口规划文档：
 *   - GET  /portal/modules       —— 当前用户可访问的模块列表（门户四卡）
 *   - GET  /portal/stores        —— 当前用户可访问的门店列表
 *   - POST /portal/active-store  —— 切换当前激活的门店
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import {
  listModulesForRoles,
  listStoresForUser,
  switchActiveStore,
} from '../services/portal.service.js';

export const portalRouter = Router();

/** 当前用户可访问的模块列表（门户四卡） */
portalRouter.get('/portal/modules', requireAuth, (req: Request, res: Response) => {
  const roles = req.user?.roles ?? [];
  res.json(listModulesForRoles(roles));
});

/** 当前用户可访问的门店列表 */
portalRouter.get('/portal/stores', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const userId = req.user!.id;
      const isSuperAdmin = req.user!.roles.includes('super_admin');
      const body = await listStoresForUser(userId, isSuperAdmin);
      res.json(body);
    } catch (err) {
      next(err);
    }
  })();
});

const switchSchema = z.object({
  storeId: z.string().uuid('storeId 必须是 UUID'),
});

/** 切换当前激活的门店（一人多店时） */
portalRouter.post(
  '/portal/active-store',
  requireAuth,
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const parsed = switchSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(
            400,
            ErrorCodes.VALIDATION_ERROR,
            parsed.error.issues[0]?.message ?? '请求体不合法',
            parsed.error.issues,
          );
        }
        const userId = req.user!.id;
        const isSuperAdmin = req.user!.roles.includes('super_admin');
        const result = await switchActiveStore(
          userId,
          req.sessionToken!,
          parsed.data.storeId,
          isSuperAdmin,
        );
        res.json(result);
      } catch (err) {
        next(err);
      }
    })();
  },
);
