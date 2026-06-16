/**
 * 门店经营路由（本店视角，业务接口不带 storeId 由 session 注入）
 *   GET  /store/skus          本店在售 SKU（最新快照）
 *   POST /store/skus:import   导入销售快照（仅超管）
 *   GET  /store/shelves       本店全部场景的货架组（整店视角）
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import { requireStore } from '../middleware/require-store.js';
import {
  listStoreSkus, listAllShelfGroups, importStoreSnapshots,
} from '../services/store-skus.service.js';
import { writeAuditEvent } from '../services/audit.service.js';

export const storeRouter = Router();

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

const skusQuerySchema = z.object({
  scene: z.coerce.number().int().min(0).max(12).optional(),
  q: z.string().optional(),
});

storeRouter.get(
  '/store/skus', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const parsed = skusQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '参数错误');
    }
    const skus = await listStoreSkus({
      storeId: req.user!.currentStoreId!,
      ...parsed.data,
    });
    res.json({ skus });
  }),
);

storeRouter.get(
  '/store/shelves', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    res.json({ shelves: await listAllShelfGroups(req.user!.currentStoreId!) });
  }),
);

const importSchema = z.object({
  snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'snapshotDate 需为 YYYY-MM-DD'),
  rows: z.array(z.object({
    skuCode: z.string(),
    /** 本期实际售价（V027 起 snapshot 唯一价格列；批发价已迁回 hq_products，建议价不入快照） */
    retailPrice: z.number().optional(),
    salesQty30d: z.number().int().optional(),
    salesAmount30d: z.number().optional(),
    salesQty90d: z.number().int().optional(),
    salesAmount90d: z.number().optional(),
    grossMargin30d: z.number().optional(),
    stockQty: z.number().int().optional(),
  })).min(1),
});

storeRouter.post(
  '/store/skus:import',
  requireAuth, requireRole('super_admin'), requireStore,
  asyncHandler(async (req, res) => {
    const parsed = importSchema.parse(req.body);
    const rows = parsed.rows.map((r) => ({ ...r, snapshotDate: parsed.snapshotDate }));
    const result = await importStoreSnapshots(
      req.user!.currentStoreId!,
      rows,
      req.user!.id,
    );
    void writeAuditEvent({
      eventKind: 'sku_import',
      actorUserId: req.user!.id,
      actorRole: req.user!.roles[0] ?? null,
      actorDisplayName: req.user!.name,
      targetStoreId: req.user!.currentStoreId!,
      summary: `导入快照 ${parsed.snapshotDate}（+${result.inserted} 改 ${result.updated} 跳 ${result.skipped}）`,
      payload: { snapshotDate: parsed.snapshotDate, ...result },
    }).catch(() => {});
    res.status(201).json(result);
  }),
);
