/**
 * 模块 8：促销批次管理（超管）
 *
 * 覆盖统一接口规划文档：
 *   - PO-E1 上传促销 Excel 并激活
 *   - PO-E2 列出所有上传过的促销批次
 *   - PO-E3 查询当前生效的全部促销
 *   - PO-E4 按个人偏好推荐促销
 *   - PO-E5 删除某个批次
 *   - PO-E6 切换激活的批次
 *
 * 注：除 PO-E3 / PO-E4（店长可读）外，写操作都需要 super_admin。
 */
import { Router } from 'express';
import { NotImplementedError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';

export const promotionsRouter = Router();

/** PO-E1 上传一份促销 Excel 并激活（超管） */
promotionsRouter.post(
  '/promotions/batches:upload',
  requireAuth,
  requireRole('super_admin'),
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** PO-E2 列出所有上传过的促销批次 */
promotionsRouter.get(
  '/promotions/batches',
  requireAuth,
  requireRole('super_admin'),
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** PO-E3 查询当前生效的全部促销（店长选品时用） */
promotionsRouter.get(
  '/promotions/active',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** PO-E4 按个人偏好推荐促销 */
promotionsRouter.get(
  '/promotions/recommend',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** PO-E5 删除某个批次（超管） */
promotionsRouter.delete(
  '/promotions/batches/:batchId',
  requireAuth,
  requireRole('super_admin'),
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** PO-E6 切换激活的批次（超管） */
promotionsRouter.post(
  '/promotions/batches/:batchId/activate',
  requireAuth,
  requireRole('super_admin'),
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);
