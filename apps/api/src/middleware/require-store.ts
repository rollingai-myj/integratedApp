/**
 * requireStore middleware
 *
 * 业务路由命中前确保 session 里有 currentStoreId，否则 409 NO_STORE_SELECTED。
 * 用法：必须挂在 requireAuth 之后。
 *
 *   router.get('/skus', requireAuth, requireStore, asyncHandler(...))
 *
 * 前端拦截到 NO_STORE_SELECTED 后跳门店选择 UI。详见 spec § 0.5。
 */
import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCodes } from '../lib/errors.js';

export function requireStore(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user?.currentStoreId) {
    next(
      new AppError(
        409,
        ErrorCodes.NO_STORE_SELECTED,
        '请先选择门店再操作（POST /portal/active-store）',
      ),
    );
    return;
  }
  next();
}
