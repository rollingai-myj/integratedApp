/**
 * HQ 总部主数据路由
 *   GET  /hq/categories            四层品类树（场景 → 大 → 中 → 小）
 *   GET  /hq/products              商品档案搜索
 *   GET  /hq/products/:skuCode/official-image   官方图（302 → OSS）
 *   GET  /hq/products/:skuCode/barcode          条码图（302 → OSS）
 *   GET  /hq/benchmark-skus        基准 SKU 名单
 *   PUT  /hq/stores/:storeId       新增 / 更新门店档案（仅超管）
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import {
  getCategoryTree, listProducts, listBenchmarkSkus,
  resolveProductImageUrl, resolveBarcodeUrl, upsertStore,
} from '../services/hq.service.js';
import { writeAuditEvent } from '../services/audit.service.js';

export const hqRouter = Router();

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

hqRouter.get(
  '/hq/categories', requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ tree: await getCategoryTree() });
  }),
);

const productsQuerySchema = z.object({
  q: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  scene: z.coerce.number().int().min(0).max(12).optional(),
  skuCodes: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

hqRouter.get(
  '/hq/products', requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = productsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '参数错误', parsed.error.issues);
    }
    const { skuCodes, ...rest } = parsed.data;
    const products = await listProducts({
      ...rest,
      skuCodes: skuCodes ? skuCodes.split(',').filter(Boolean) : undefined,
    });
    res.json({ products });
  }),
);

hqRouter.get(
  '/hq/products/:skuCode/official-image',
  (req, res) => {
    const skuCode = String(req.params.skuCode);
    const w = Number(req.query.w);
    const url = resolveProductImageUrl(skuCode);
    // OSS 原生图片处理：缩放到指定宽度（device px × 2），转 webp 质量 80
    const final = Number.isFinite(w) && w > 0 && /aliyuncs\.com/.test(url)
      ? `${url}${url.includes('?') ? '&' : '?'}x-oss-process=image/resize,w_${Math.round(w)}/format,webp/quality,q_80`
      : url;
    res.redirect(302, final);
  },
);

hqRouter.get(
  '/hq/products/:skuCode/barcode',
  asyncHandler(async (req, res) => {
    const url = resolveBarcodeUrl(String(req.params.skuCode));
    res.redirect(302, url);
  }),
);

const benchmarkSchema = z.object({
  segment: z.enum(['core', 'innovation']).optional(),
});
hqRouter.get(
  '/hq/benchmark-skus', requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = benchmarkSchema.parse(req.query);
    res.json({ benchmarks: await listBenchmarkSkus({ segment: parsed.segment }) });
  }),
);

const upsertStoreSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1),
  province: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  openedAt: z.string().optional(),
  isProjectStore: z.boolean().optional(),
  storeAreaSqm: z.number().nonnegative().optional(),
  poiCategory: z.string().optional(),
});

hqRouter.put(
  '/hq/stores/:storeId',
  requireAuth, requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const idParse = z.string().uuid().safeParse(req.params.storeId);
    if (!idParse.success) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'storeId 必须是 UUID');
    }
    const body = upsertStoreSchema.parse(req.body);
    const result = await upsertStore(idParse.data, body);
    void writeAuditEvent({
      eventKind: 'store_update',
      actorUserId: req.user!.id,
      actorRole: req.user!.roles[0] ?? null,
      actorDisplayName: req.user!.name,
      targetStoreId: idParse.data,
      targetStoreLabel: body.code,
      summary: `维护门店档案：${body.code} / ${body.name}`,
      payload: { code: body.code, name: body.name },
    }).catch(() => {});
    res.json(result);
  }),
);
