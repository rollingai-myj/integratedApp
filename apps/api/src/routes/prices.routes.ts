/**
 * 价盘路由（3 个端点）
 *
 *   GET  /prices/curve          价格 / 销量曲线（snapshot + change 合并）
 *   GET  /prices/changes        本店调价历史
 *   POST /prices/changes        调价（**只写流水，不动快照**）
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireStore } from '../middleware/require-store.js';
import {
  getPriceCurve,
  submitPriceChange,
  listPriceChanges,
} from '../services/prices.service.js';
import { writeAuditEvent } from '../services/audit.service.js';

export const pricesRouter = Router();

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

// ---- 价格曲线 ------------------------------------------------------------

pricesRouter.get(
  '/prices/curve',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    // 兼容：?skuCode=A 单个；?skuCode=A,B,C 逗号；?skuCodes=A,B 别名
    const raw =
      (typeof req.query.skuCode === 'string' ? req.query.skuCode : undefined) ??
      (typeof req.query.skuCodes === 'string' ? req.query.skuCodes : undefined);
    const skuCodes = raw
      ? raw.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const daysBack = Number(req.query.daysBack) || undefined;
    const curves = await getPriceCurve({
      storeId: req.user!.currentStoreId!,
      skuCodes,
      daysBack,
    });
    res.json({ curves });
  }),
);

// ---- 调价历史 + 调价 -----------------------------------------------------

pricesRouter.get(
  '/prices/changes',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const skuCode = typeof req.query.skuCode === 'string' ? req.query.skuCode : undefined;
    const limit = Number(req.query.limit) || undefined;
    const changes = await listPriceChanges({
      storeId: req.user!.currentStoreId!,
      skuCode, limit,
    });
    res.json({ changes });
  }),
);

const submitSchema = z.object({
  skuCode: z.string().min(1),
  newPrice: z.number().nonnegative(),
  oldPrice: z.number().nonnegative().optional(),
  source: z.enum(['manual', 'rule_engine']).optional(),
  effectiveDate: z.string().optional(),
  note: z.string().optional(),
});

pricesRouter.post(
  '/prices/changes',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = submitSchema.parse(req.body);
    const record = await submitPriceChange(
      req.user!.currentStoreId!,
      body,
      req.user!.id,
      req.user!.name,
    );
    void writeAuditEvent({
      eventKind: 'price_change',
      actorUserId: req.user!.id,
      targetStoreId: req.user!.currentStoreId!,
      payload: {
        skuCode: body.skuCode,
        oldPrice: record.oldPrice, newPrice: body.newPrice,
        source: body.source ?? 'manual',
      },
    }).catch(() => {});
    res.status(201).json({ record });
  }),
);
