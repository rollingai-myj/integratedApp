/**
 * 模块 6：价盘管理（业务接口）
 *
 * 全部业务接口从 session.currentStoreId 取门店，不接受客户端传 storeId。
 * 详见 docs/planning/unified-api-spec.md § 0。
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
  diagnoseBatch,
} from '../services/prices.service.js';

export const pricesRouter = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ---- PR-A2 价格曲线 ------------------------------------------------------

pricesRouter.get(
  '/prices/curve',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const skuCsv =
      typeof req.query.skuCodes === 'string' ? req.query.skuCodes : undefined;
    const skuCodes = skuCsv
      ? skuCsv.split(',').map((s) => s.trim()).filter(Boolean)
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

// ---- 历史调价记录 --------------------------------------------------------

pricesRouter.get(
  '/prices/changes',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const skuCode =
      typeof req.query.skuCode === 'string' ? req.query.skuCode : undefined;
    const limit = Number(req.query.limit) || undefined;
    const changes = await listPriceChanges({
      storeId: req.user!.currentStoreId!,
      skuCode,
      limit,
    });
    res.json({ changes });
  }),
);

// ---- PR-A4 调价（决策 D3：同时写流水 + 销售快照） ------------------------

const adjustSchema = z.object({
  skuCode: z.string().min(1),
  newPrice: z.number().nonnegative(),
  oldPrice: z.number().nonnegative().optional(),
  source: z.enum(['manual', 'ai_suggest', 'rule_engine']).optional(),
  aiAdvice: z.record(z.unknown()).optional(),
  aiModel: z.string().optional(),
  effectiveDate: z.string().optional(),
  note: z.string().optional(),
});

pricesRouter.post(
  '/prices/adjust',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = adjustSchema.parse(req.body);
    const record = await submitPriceChange(
      req.user!.currentStoreId!,
      body,
      req.user!.id,
      req.user!.name,
    );
    res.status(201).json({ record });
  }),
);

// ---- PR-B1 批量 AI 诊断 --------------------------------------------------

const diagnoseSchema = z.object({
  skus: z
    .array(
      z.object({
        skuCode: z.string().min(1),
        currentPrice: z.number().nonnegative(),
        wholesalePrice: z.number().nonnegative().optional(),
        salesQty30d: z.number().int().nonnegative().optional(),
        grossMargin30d: z.number().optional(),
        competitorPrices: z
          .array(
            z.object({
              channel: z.string(),
              price: z.number().nonnegative(),
            }),
          )
          .optional(),
      }),
    )
    .min(1)
    .max(50),
});

pricesRouter.post(
  '/prices/diagnose',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = diagnoseSchema.parse(req.body);
    const results = await diagnoseBatch(
      req.user!.currentStoreId!,
      body.skus,
      req.user!.id,
    );
    res.json({ results });
  }),
);
