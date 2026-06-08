/**
 * 模块 8：促销批次管理
 *
 * 写操作（上传 / 删除 / 切换激活）需要 super_admin；
 * 读操作（active / recommend）店长可读。
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import {
  uploadPromotion,
  listBatches,
  listActivePromotions,
  recommendForUser,
  deleteBatch,
  activateBatch,
} from '../services/promotions.service.js';

export const promotionsRouter = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ---- PO-E1 上传 ---------------------------------------------------------

const uploadSchema = z.object({
  fileName: z.string().min(1),
  sourceFileUrl: z.string().optional(),
  notes: z.string().optional(),
  activate: z.boolean().optional(),
  rows: z
    .array(
      z.object({
        rowIndex: z.number().int().min(1),
        skuCode: z.string().min(1),
        productName: z.string().min(1),
        unit: z.string().optional(),
        categoryName: z.string().optional(),
        originalPrice: z.number().nonnegative().optional(),
        bestLabel: z.string().optional(),
        bestRequiredQty: z.number().int().optional(),
        bestTotalPrice: z.number().nonnegative().optional(),
        bestEffectiveUnitPrice: z.number().nonnegative().optional(),
        bestSavingPercent: z.number().optional(),
        allOptions: z.array(z.unknown()).optional(),
        validFrom: z.string().optional(),
        validTo: z.string().optional(),
        validDates: z.array(z.string()).optional(),
        mixGroupCode: z.string().optional(),
        displayText: z.string().optional(),
      }),
    )
    .min(1)
    .max(20000),
});

promotionsRouter.post(
  '/promotions/batches:upload',
  requireAuth,
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const body = uploadSchema.parse(req.body);
    const result = await uploadPromotion(body, req.user!.id);
    res.status(201).json(result);
  }),
);

// ---- PO-E2 列出批次（超管） ---------------------------------------------

promotionsRouter.get(
  '/promotions/batches',
  requireAuth,
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || undefined;
    const batches = await listBatches(limit);
    res.json({ batches });
  }),
);

// ---- PO-E3 当前生效促销（店长可读） -------------------------------------

promotionsRouter.get(
  '/promotions/active',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const result = await listActivePromotions();
    res.json(result);
  }),
);

// ---- PO-E4 个性化推荐 ---------------------------------------------------

promotionsRouter.get(
  '/promotions/recommend',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await recommendForUser(req.user!.id);
    res.json(result);
  }),
);

// ---- PO-E5 删除批次 -----------------------------------------------------

promotionsRouter.delete(
  '/promotions/batches/:batchId',
  requireAuth,
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const result = await deleteBatch(req.params.batchId!);
    if (!result.deleted) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, '批次不存在');
    }
    res.json(result);
  }),
);

// ---- PO-E6 切换激活 -----------------------------------------------------

promotionsRouter.post(
  '/promotions/batches/:batchId/activate',
  requireAuth,
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const upload = await activateBatch(req.params.batchId!);
    res.json({ upload });
  }),
);
