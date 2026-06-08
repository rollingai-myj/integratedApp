/**
 * 模块 6：价盘管理（业务接口）
 *
 * 覆盖统一接口规划文档：
 *   - GET  /prices/curve            查询价格曲线（PR-A2）
 *   - GET  /prices/changes/:storeId 历史调价记录（新增辅助）
 *   - POST /prices/adjust           提交一次调价（PR-A4，决策 D3 两层写入）
 *   - POST /prices/diagnose         批量价盘 AI 诊断（PR-B1，走统一 AI 网关）
 *
 * 注：商品列表（含价格）和竞品价已合并到 master.routes.ts（按规划文档"已并入模块 4"）。
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
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
  asyncHandler(async (req, res) => {
    const storeId =
      typeof req.query.storeId === 'string' ? req.query.storeId : undefined;
    if (!storeId) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'storeId 必填');
    }
    const skuCsv =
      typeof req.query.skuCodes === 'string' ? req.query.skuCodes : undefined;
    const skuCodes = skuCsv
      ? skuCsv.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const daysBack = Number(req.query.daysBack) || undefined;
    const curves = await getPriceCurve({ storeId, skuCodes, daysBack });
    res.json({ curves });
  }),
);

// ---- 历史调价记录 --------------------------------------------------------

pricesRouter.get(
  '/prices/changes/:storeId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const skuCode =
      typeof req.query.skuCode === 'string' ? req.query.skuCode : undefined;
    const limit = Number(req.query.limit) || undefined;
    const changes = await listPriceChanges({
      storeId: req.params.storeId!,
      skuCode,
      limit,
    });
    res.json({ changes });
  }),
);

// ---- PR-A4 调价（决策 D3：同时写流水 + 销售快照） ------------------------

const adjustSchema = z.object({
  storeId: z.string().uuid(),
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
  asyncHandler(async (req, res) => {
    const body = adjustSchema.parse(req.body);
    const record = await submitPriceChange(
      body.storeId,
      {
        skuCode: body.skuCode,
        newPrice: body.newPrice,
        oldPrice: body.oldPrice,
        source: body.source,
        aiAdvice: body.aiAdvice,
        aiModel: body.aiModel,
        effectiveDate: body.effectiveDate,
        note: body.note,
      },
      req.user!.id,
      req.user!.name,
    );
    res.status(201).json({ record });
  }),
);

// ---- PR-B1 批量 AI 诊断 --------------------------------------------------

const diagnoseSchema = z.object({
  storeId: z.string().uuid(),
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
  asyncHandler(async (req, res) => {
    const body = diagnoseSchema.parse(req.body);
    const results = await diagnoseBatch(body.storeId, body.skus, req.user!.id);
    res.json({ results });
  }),
);
