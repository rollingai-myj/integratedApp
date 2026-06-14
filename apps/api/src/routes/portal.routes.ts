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
  startUsageSession,
  heartbeatUsageSession,
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

// -- 使用会话（应用外壳计时） ------------------------------------------------

const usageStartSchema = z.object({
  deviceId: z.string().max(128).optional(),
});

/** 开始使用会话：挂当前登录会话；返回 { id } 供心跳使用 */
portalRouter.post(
  '/portal/usage:start',
  requireAuth,
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const parsed = usageStartSchema.safeParse(req.body ?? {});
        const deviceId = parsed.success ? parsed.data.deviceId ?? null : null;
        const result = await startUsageSession(req.sessionId!, deviceId);
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    })();
  },
);

/** 使用会话心跳（前端每 30s 一次） */
portalRouter.post(
  '/portal/usage/:usageId/heartbeat',
  requireAuth,
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const usageId = z.string().uuid().safeParse(req.params.usageId);
        if (!usageId.success) {
          throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'usageId 必须是 UUID');
        }
        const ok = await heartbeatUsageSession(usageId.data, req.sessionId!);
        if (!ok) {
          throw new AppError(404, ErrorCodes.NOT_FOUND, '使用会话不存在或已结束');
        }
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    })();
  },
);
