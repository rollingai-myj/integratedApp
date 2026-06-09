/**
 * 模块 3 + 模块 4：门店主数据 + 商品/销售主数据
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireStore } from '../middleware/require-store.js';
import {
  listStores,
  upsertStore,
  getEnvironmentInsight,
  upsertEnvironmentInsight,
  listCategories,
  listProducts,
  listStoreSkus,
  importStoreSkus,
  queryCompetitors,
  listBenchmarkSkus,
  listPromoSkus,
  listPromoText,
} from '../services/master.service.js';

export const masterRouter = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ---- 模块 3 ---------------------------------------------------------------

masterRouter.get(
  '/master/stores',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = typeof req.query.id === 'string' ? req.query.id : undefined;
    const stores = await listStores({
      userId: req.user!.id,
      isSuperAdmin: req.user!.roles.includes('super_admin'),
      id,
    });
    res.json({ stores, total: stores.length });
  }),
);

const upsertStoreSchema = z.object({
  storeCode: z.string().min(1),
  storeName: z.string().min(1),
  ownership: z.enum(['direct', 'franchise']).optional(),
  province: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  district: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  openedAt: z.string().nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

masterRouter.put(
  '/master/stores/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user!.roles.includes('super_admin')) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, '仅超管可改门店主数据');
    }
    const body = upsertStoreSchema.parse(req.body);
    const store = await upsertStore(req.params.id!, body);
    res.json({ store });
  }),
);

masterRouter.get(
  '/master/environment/:storeId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const insight = await getEnvironmentInsight(req.params.storeId!);
    res.json({ insight });
  }),
);

const insightQuestionSchema = z.object({
  id: z.number(),
  direction: z.string(),
  context: z.string(),
  question: z.string(),
  options: z.array(z.string()),
});

const upsertInsightSchema = z.object({
  // 基础字段
  city: z.string().nullable().optional(),
  mainDemographic: z.string().nullable().optional(),
  consumptionLevel: z.string().nullable().optional(),
  competitorCount: z.number().int().nullable().optional(),
  populationDensity: z.string().nullable().optional(),
  // V025 加：原 skuSelection repo 扩展字段
  category: z.string().nullable().optional(),
  crowdSourceAnalysis: z.string().nullable().optional(),
  competitorAnalysis: z.string().nullable().optional(),
  topCompetitors: z.array(z.string()).optional(),
  questions: z.array(insightQuestionSchema).optional(),
  reportMarkdown: z.string().nullable().optional(),
  // 兜底
  insightData: z.record(z.unknown()).optional(),
  source: z.string().nullable().optional(),
});

masterRouter.put(
  '/master/environment/:storeId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = upsertInsightSchema.parse(req.body);
    const insight = await upsertEnvironmentInsight(
      req.params.storeId!,
      body,
      req.user!.id,
    );
    res.json({ insight });
  }),
);

// ---- 模块 4 ---------------------------------------------------------------

masterRouter.get(
  '/master/categories',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const categories = await listCategories();
    res.json({ categories });
  }),
);

masterRouter.get(
  '/master/products',
  requireAuth,
  asyncHandler(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const categoryId =
      typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined;
    const limit = Number(req.query.limit) || undefined;
    const products = await listProducts({ search, categoryId, limit });
    res.json({ products });
  }),
);

masterRouter.get(
  '/skus',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const categoryPath =
      typeof req.query.categoryPath === 'string' ? req.query.categoryPath : undefined;
    const skus = await listStoreSkus({
      storeId: req.user!.currentStoreId!,
      search,
      categoryPath,
    });
    res.json({ skus, total: skus.length });
  }),
);

const skuImportSchema = z.object({
  rows: z.array(
    z.object({
      skuCode: z.string().min(1),
      productName: z.string().optional(),
      brand: z.string().optional(),
      spec: z.string().optional(),
      unit: z.string().optional(),
      categoryPath: z.string().optional(),
      wholesalePrice: z.number().optional(),
      retailPrice: z.number().optional(),
      originalPrice: z.number().optional(),
      salesQty30d: z.number().int().optional(),
      salesAmount30d: z.number().optional(),
      salesQty90d: z.number().int().optional(),
      salesAmount90d: z.number().optional(),
      grossMargin30d: z.number().optional(),
      stockQty: z.number().int().optional(),
      lastDeliveryAt: z.string().optional(),
      snapshotDate: z.string().optional(),
    }),
  ),
});

masterRouter.post(
  '/skus:import',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    if (!req.user!.roles.includes('super_admin')) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, '仅超管可批量导入');
    }
    const body = skuImportSchema.parse(req.body);
    const result = await importStoreSkus(req.user!.currentStoreId!, body.rows);
    res.json(result);
  }),
);

masterRouter.get(
  '/master/competitors',
  requireAuth,
  asyncHandler(async (req, res) => {
    const byCategoryPath =
      typeof req.query.categoryPath === 'string'
        ? req.query.categoryPath
        : undefined;
    const skuCsv =
      typeof req.query.skuCodes === 'string' ? req.query.skuCodes : undefined;
    const bySkuCodes = skuCsv
      ? skuCsv.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const competitors = await queryCompetitors({ byCategoryPath, bySkuCodes });
    res.json({ competitors });
  }),
);

masterRouter.get(
  '/master/baseline-skus',
  requireAuth,
  asyncHandler(async (req, res) => {
    const segment =
      req.query.segment === 'core' || req.query.segment === 'innovation'
        ? req.query.segment
        : undefined;
    const skus = await listBenchmarkSkus({ segment });
    res.json({ skus });
  }),
);

masterRouter.get(
  '/master/promotion-skus',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const skus = await listPromoSkus();
    res.json({ skus });
  }),
);

masterRouter.get(
  '/master/promotions-text',
  requireAuth,
  asyncHandler(async (req, res) => {
    const categoryPath =
      typeof req.query.categoryPath === 'string' ? req.query.categoryPath : undefined;
    const skuCsv =
      typeof req.query.skuCodes === 'string' ? req.query.skuCodes : undefined;
    const skuCodes = skuCsv
      ? skuCsv.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const promotions = await listPromoText({ categoryPath, skuCodes });
    res.json({ promotions });
  }),
);
