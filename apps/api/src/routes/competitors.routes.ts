/**
 * 模块 11：竞品采集（Phase 6 · 后端 + Swagger 可操作，前端未来另做）
 *
 * 所有端点都从 session.currentStoreId 取门店；不接受客户端 storeId。
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireStore } from '../middleware/require-store.js';
import { ossService } from '../services/oss.service.js';
import {
  listCompetitors,
  createCompetitor,
  updateCompetitor,
  listCompetitorProducts,
  createCompetitorProduct,
  createCompetitorPrice,
  priceCompare,
} from '../services/competitors.service.js';

export const competitorsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function requireUuid(value: unknown, name: string): string {
  const r = z.string().uuid().safeParse(value);
  if (!r.success) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `${name} 必须是 UUID`);
  }
  return r.data;
}

// ---- 竞对店 CRUD ---------------------------------------------------------

competitorsRouter.get(
  '/competitors',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const competitors = await listCompetitors(req.user!.currentStoreId!);
    res.json({ competitors });
  }),
);

const competitorCreateSchema = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(['online', 'offline']),
  province: z.string().max(64).optional(),
  city: z.string().max(64).optional(),
  address: z.string().max(500).optional(),
  distanceM: z.number().int().nonnegative().optional(),
});

competitorsRouter.post(
  '/competitors',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = competitorCreateSchema.parse(req.body);
    const competitor = await createCompetitor(req.user!.currentStoreId!, body);
    res.status(201).json({ competitor });
  }),
);

const competitorUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  kind: z.enum(['online', 'offline']).optional(),
  province: z.string().max(64).nullable().optional(),
  city: z.string().max(64).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  distanceM: z.number().int().nonnegative().nullable().optional(),
  isActive: z.boolean().optional(),
});

competitorsRouter.put(
  '/competitors/:competitorId',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const competitorId = requireUuid(req.params.competitorId, 'competitorId');
    const body = competitorUpdateSchema.parse(req.body);
    const competitor = await updateCompetitor(
      req.user!.currentStoreId!,
      competitorId,
      body,
    );
    res.json({ competitor });
  }),
);

// ---- 竞品 CRUD -----------------------------------------------------------

competitorsRouter.get(
  '/competitors/:competitorId/products',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const competitorId = requireUuid(req.params.competitorId, 'competitorId');
    const products = await listCompetitorProducts(
      req.user!.currentStoreId!,
      competitorId,
    );
    res.json({ products });
  }),
);

const competitorProductSchema = z.object({
  externalSku: z.string().max(128).optional(),
  productName: z.string().min(1).max(500),
  brand: z.string().max(128).optional(),
  spec: z.string().max(128).optional(),
  mappedProductId: z.string().uuid().optional(),
  productUrl: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
});

competitorsRouter.post(
  '/competitors/:competitorId/products',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const competitorId = requireUuid(req.params.competitorId, 'competitorId');
    const body = competitorProductSchema.parse(req.body);
    const product = await createCompetitorProduct(
      req.user!.currentStoreId!,
      competitorId,
      body,
    );
    res.status(201).json({ product });
  }),
);

// ---- 价格采集（multipart：photo + retailPrice + promoPrice + promoText）

competitorsRouter.post(
  '/competitors/products/:productId/prices',
  requireAuth,
  requireStore,
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    const productId = requireUuid(req.params.productId, 'productId');
    const retailPrice = Number(req.body.retailPrice);
    if (!Number.isFinite(retailPrice) || retailPrice < 0) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'retailPrice 必填且非负');
    }
    const promoPrice = req.body.promoPrice !== undefined ? Number(req.body.promoPrice) : undefined;
    if (promoPrice !== undefined && (!Number.isFinite(promoPrice) || promoPrice < 0)) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'promoPrice 必须非负');
    }
    const promoText = typeof req.body.promoText === 'string' ? req.body.promoText : undefined;
    const snapshotDate = typeof req.body.snapshotDate === 'string' ? req.body.snapshotDate : undefined;

    let photoUrl: string | undefined;
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (file) {
      const upRes = await ossService.upload({
        buffer: file.buffer,
        filename: file.originalname,
        contentType: file.mimetype,
        purpose: 'other',
        storeId: req.user!.currentStoreId!,
      });
      photoUrl = upRes.url;
    }

    const price = await createCompetitorPrice(
      req.user!.currentStoreId!,
      productId,
      {
        retailPrice,
        promoPrice,
        promoText,
        photoUrl,
        snapshotDate,
        source: 'manual',
      },
      req.user!.id,
    );
    res.status(201).json({ price });
  }),
);

// ---- 比价 ----------------------------------------------------------------

competitorsRouter.get(
  '/competitors/price-compare',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const skuCode = typeof req.query.skuCode === 'string' ? req.query.skuCode : undefined;
    const items = await priceCompare({
      storeId: req.user!.currentStoreId!,
      skuCode,
    });
    res.json({ items });
  }),
);
