/**
 * 模块 7：活动海报（业务接口）
 *
 * 生成 / 入队 / 历史等"以当前店身份执行"的接口，全部从 session.currentStoreId
 * 取门店，不接受客户端传 storeId。GET /posters 改用 scope 表达跨店 / 本店 / 全部。
 * 详见 docs/planning/unified-api-spec.md § 0 / § 8。
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireStore } from '../middleware/require-store.js';
import {
  generatePosterSync,
  enqueueBatch,
  claimAndProcess,
  listActiveJobs,
  cancelBatch,
  resetStuckJob,
  retryFailedJob,
  listPosters,
} from '../services/posters.service.js';

export const postersRouter = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const generateInputSchema = z.object({
  template: z.enum(['vibrant', 'premium', 'minimal', 'custom']),
  mode: z.enum(['photo_compose', 'official_bg_only', 'multi_product']),
  copyText: z.string().min(1),
  sourcePhotoUrl: z.string().optional(),
  productImageUrl: z.string().optional(),
  officialImageUrls: z.array(z.string()).optional(),
  customStyleDescription: z.string().optional(),
  skuCode: z.string().optional(),
  categoryName: z.string().optional(),
});

// ---- PO-C1 单张同步生成 --------------------------------------------------

postersRouter.post(
  '/posters/generate',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = generateInputSchema.parse(req.body);
    const record = await generatePosterSync(
      body,
      req.user!.id,
      req.user!.currentStoreId!,
    );
    res.status(201).json({ poster: record });
  }),
);

// ---- PO-D1 批量入队 ------------------------------------------------------

const enqueueSchema = z.object({
  jobs: z.array(generateInputSchema).min(1).max(10),
});

postersRouter.post(
  '/posters/queue/enqueue',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = enqueueSchema.parse(req.body);
    const result = await enqueueBatch(
      body.jobs,
      req.user!.id,
      req.user!.currentStoreId!,
    );
    res.status(201).json(result);
  }),
);

// ---- PO-D2 认领并处理 ----------------------------------------------------

const processSchema = z.object({ jobId: z.string().uuid().optional() });

postersRouter.post(
  '/posters/queue/process',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = processSchema.parse(req.body);
    const result = await claimAndProcess(body.jobId ?? null, req.user!.id);
    res.json(result);
  }),
);

// ---- PO-D3 列出活跃任务 --------------------------------------------------

postersRouter.get(
  '/posters/queue/active',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jobs = await listActiveJobs(req.user!.id);
    res.json({ jobs });
  }),
);

// ---- PO-D4 移除整批 -----------------------------------------------------

postersRouter.delete(
  '/posters/queue/batch/:batchId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await cancelBatch(req.params.batchId!, req.user!.id);
    res.json(result);
  }),
);

// ---- PO-D5 重置卡死 -----------------------------------------------------

postersRouter.post(
  '/posters/queue/task/:taskId/reset',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await resetStuckJob(req.params.taskId!, req.user!.id);
    res.json(result);
  }),
);

// ---- PO-D6 失败重生成 ---------------------------------------------------

const retrySchema = z.object({
  template: z.enum(['vibrant', 'premium', 'minimal', 'custom']).optional(),
  copyText: z.string().optional(),
  sourcePhotoUrl: z.string().optional(),
  customStyleDescription: z.string().optional(),
});

postersRouter.post(
  '/posters/queue/task/:taskId/retry',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = retrySchema.parse(req.body);
    const result = await retryFailedJob(req.params.taskId!, body, req.user!.id);
    res.status(201).json(result);
  }),
);

// ---- 历史海报 ------------------------------------------------------------

// scope=mine     默认；当前用户跨店生成的全部海报
// scope=current  当前用户 + 当前 session 门店
// scope=all      仅超管；全部海报（可加 ?storeId= 过滤超管后台用）
postersRouter.get(
  '/posters',
  requireAuth,
  asyncHandler(async (req, res) => {
    const scope = typeof req.query.scope === 'string' ? req.query.scope : 'mine';
    const isSuperAdmin = req.user!.roles.includes('super_admin');
    if (scope === 'all' && !isSuperAdmin) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, '仅超管可查全部海报');
    }
    const limit = Number(req.query.limit) || undefined;

    let userId: string | undefined;
    let storeId: string | undefined;
    if (scope === 'all') {
      // 超管后台：可选 ?storeId= 过滤；不强制 currentStoreId
      storeId =
        typeof req.query.storeId === 'string' ? req.query.storeId : undefined;
    } else if (scope === 'current') {
      // 当前用户 + 当前 session 门店
      if (!req.user!.currentStoreId) {
        throw new AppError(
          409,
          ErrorCodes.NO_STORE_SELECTED,
          '请先选择门店再查本店海报',
        );
      }
      userId = req.user!.id;
      storeId = req.user!.currentStoreId;
    } else {
      // scope=mine：当前用户跨店历史
      userId = req.user!.id;
    }

    const posters = await listPosters({ userId, storeId, limit });
    res.json({ posters });
  }),
);
