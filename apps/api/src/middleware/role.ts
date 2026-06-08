/**
 * 角色 / 权限中间件
 *
 * 必须配合 requireAuth 使用。requireAuth 已注入 req.user.roles 后，
 * 这里只做"包含该角色"的判定。
 *
 * 用法：
 *   router.get('/admin/xxx', requireAuth, requireRole('super_admin'), handler)
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { AppError, ErrorCodes } from '../lib/errors.js';

export type Role = 'super_admin' | 'shop_owner' | string;

export function requireRole(...allowed: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      next(
        new AppError(
          401,
          ErrorCodes.UNAUTHENTICATED,
          'Authentication required',
        ),
      );
      return;
    }
    const ok = user.roles.some((r) => allowed.includes(r));
    if (!ok) {
      next(
        new AppError(
          403,
          ErrorCodes.FORBIDDEN,
          `Required role: ${allowed.join(' | ')}`,
        ),
      );
      return;
    }
    next();
  };
}
