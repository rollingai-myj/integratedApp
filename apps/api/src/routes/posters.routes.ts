/**
 * 模块 7：活动海报（Phase 5 新模型 · 按 OpenAPI 实现）
 *
 * 模型：
 *   任务 (PosterTask)   稳定意图，换商品/换文案 = 新任务
 *   生成 (PosterGeneration)  同任务多次尝试；重新生成 = 新 attempt
 *
 * 所有写操作的 storeId 都从 session.currentStoreId 取，不接受客户端传 storeId。
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
  createTasks,
  listTasks,
  getTask,
  getGenerationWithTaskRef,
  cancelBatch,
  regenerateTask,
  claimAndProcess,
  adoptGeneration,
  recordDownload,
  listGallery,
  todayCount,
  createAsset,
  listAssets,
  deleteAsset,
  listSalesTracking,
} from '../services/posters.service.js';

export const postersRouter = Router();

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

const uuidParam = (name: string) =>
  z
    .string()
    .uuid()
    .transform((s) => s)
    .safeParse;

function requireUuid(value: unknown, name: string): string {
  const r = z.string().uuid().safeParse(value);
  if (!r.success) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `${name} 必须是 UUID`);
  }
  return r.data;
}

// ============================================================================
// 任务 (PosterTask)
// ============================================================================

const taskProductSchema = z.object({
  skuCode: z.string().min(1),
  displayOrder: z.number().int().nonnegative().optional(),
});

/**
 * 上传 OSS 后返回的"反代 URL"形如 `/api/v1/storage/oss-image?key=...`，
 * 不是绝对 URL，z.string().url() 会拒绝。所以这里放宽校验：
 * 接受绝对 URL 或本仓 storage 的内部相对路径。
 */
const imageUrlSchema = z
  .string()
  .min(1)
  .refine(
    (v) =>
      /^https?:\/\//.test(v) ||
      v.startsWith('/api/v1/storage/oss-image?') ||
      v.startsWith('/api/v1/storage/local/'),
    { message: '必须是 http(s) URL 或本仓 storage 反代路径' },
  );

const taskCreateSchema = z.object({
  mode: z.enum(['photo_compose', 'official_bg_only', 'multi_product']),
  template: z.enum(['vibrant', 'premium', 'minimal', 'custom']),
  copyText: z.string().min(1).max(500),
  sourcePhotoUrl: imageUrlSchema.optional(),
  productImageUrl: imageUrlSchema.optional(),
  customStyleDescription: z.string().max(500).optional(),
  skuCode: z.string().optional(),
  products: z.array(taskProductSchema).optional(),
  categoryName: z.string().optional(),
  extras: z.record(z.string(), z.unknown()).optional(),
});

const createTasksSchema = z.object({
  tasks: z.array(taskCreateSchema).min(1).max(20),
});

/** POST /posters/tasks — 创建任务（单个或批量） */
postersRouter.post(
  '/posters/tasks',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = createTasksSchema.parse(req.body);
    const result = await createTasks(
      body,
      req.user!.id,
      req.user!.currentStoreId!,
    );
    res.status(201).json(result);
  }),
);

/** GET /posters/tasks — 任务列表（按 scope） */
const listTasksQuerySchema = z.object({
  scope: z.enum(['mine', 'current', 'all']).optional(),
  status: z.enum(['active', 'done', 'failed']).optional(),
  batchId: z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

postersRouter.get(
  '/posters/tasks',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = listTasksQuerySchema.parse(req.query);
    const scope = q.scope ?? 'mine';
    const isSuperAdmin = req.user!.roles.includes('super_admin');

    if (scope === 'all' && !isSuperAdmin) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, '仅超管可查全部任务');
    }

    let userId: string | undefined;
    let storeId: string | undefined;
    if (scope === 'all') {
      storeId = q.storeId;
    } else if (scope === 'current') {
      if (!req.user!.currentStoreId) {
        throw new AppError(
          409,
          ErrorCodes.NO_STORE_SELECTED,
          '请先选择门店再查本店任务',
        );
      }
      userId = req.user!.id;
      storeId = req.user!.currentStoreId;
    } else {
      userId = req.user!.id;
    }

    const tasks = await listTasks({
      userId,
      storeId,
      status: q.status,
      batchId: q.batchId,
      limit: q.limit,
    });
    res.json({ tasks });
  }),
);

/** GET /posters/tasks/{taskId} — 任务详情（含全部生成记录） */
postersRouter.get(
  '/posters/tasks/:taskId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const taskId = requireUuid(req.params.taskId, 'taskId');
    const result = await getTask(taskId);
    // 越权检查：仅本人 或 超管 或 同店成员
    const isSuperAdmin = req.user!.roles.includes('super_admin');
    if (
      !isSuperAdmin &&
      result.task.userId !== req.user!.id &&
      result.task.storeId !== req.user!.currentStoreId
    ) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, '无权查看该任务');
    }
    res.json(result);
  }),
);

/** DELETE /posters/tasks/batch/{batchId} — 整批取消 */
postersRouter.delete(
  '/posters/tasks/batch/:batchId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const batchId = requireUuid(req.params.batchId, 'batchId');
    const result = await cancelBatch(batchId, req.user!.id);
    res.json(result);
  }),
);

/** POST /posters/tasks/{taskId}/generations — 重新生成 */
postersRouter.post(
  '/posters/tasks/:taskId/generations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const taskId = requireUuid(req.params.taskId, 'taskId');
    const generation = await regenerateTask(taskId, req.user!.id);
    res.status(201).json({ generation });
  }),
);

// ============================================================================
// Generation 操作
// ============================================================================

/** GET /posters/generations/:generationId — 反查 generation + 所属 task（shim 用）*/
postersRouter.get(
  '/posters/generations/:generationId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const generationId = requireUuid(req.params.generationId, 'generationId');
    const ref = await getGenerationWithTaskRef(generationId);
    if (!ref) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, '生成记录不存在');
    }
    const isSuperAdmin = req.user!.roles.includes('super_admin');
    if (
      !isSuperAdmin &&
      ref.userId !== req.user!.id &&
      ref.storeId !== req.user!.currentStoreId
    ) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, '无权查看该生成');
    }
    res.json({
      generation: ref.generation,
      taskId: ref.taskId,
      batchId: ref.batchId,
    });
  }),
);

/** POST /posters/generations:claim — worker 认领并执行
 *
 * 可选 body.generationId：精确认领某一条（仅 status=queued 才生效；sync-shim 用）；
 * 不传 = worker 模式认领下一条 queued。
 */
const claimSchema = z.object({
  generationId: z.string().uuid().optional(),
});

postersRouter.post(
  '/posters/generations:claim',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = claimSchema.parse(req.body ?? {});
    const result = await claimAndProcess(req.user!.id, body.generationId);
    if (!result.generation) {
      res.status(204).end();
      return;
    }
    res.json(result);
  }),
);

/** POST /posters/generations/{generationId}/adopt — 采用 */
postersRouter.post(
  '/posters/generations/:generationId/adopt',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const generationId = requireUuid(req.params.generationId, 'generationId');
    const result = await adoptGeneration(
      generationId,
      req.user!.id,
      req.user!.currentStoreId!,
    );
    res.json(result);
  }),
);

/** POST /posters/generations/{generationId}/download — 下载（计数 +1） */
postersRouter.post(
  '/posters/generations/:generationId/download',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const generationId = requireUuid(req.params.generationId, 'generationId');
    const result = await recordDownload(
      generationId,
      req.user!.id,
      req.user!.currentStoreId!,
    );
    res.json(result);
  }),
);

// ============================================================================
// 成品库 / 今日额度
// ============================================================================

const galleryQuerySchema = z.object({
  scope: z.enum(['mine', 'current', 'all']).optional(),
  adopted: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  storeId: z.string().uuid().optional(),
});

postersRouter.get(
  '/posters/gallery',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = galleryQuerySchema.parse(req.query);
    const scope = q.scope ?? 'mine';
    const isSuperAdmin = req.user!.roles.includes('super_admin');

    if (scope === 'all' && !isSuperAdmin) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, '仅超管可查全部成品');
    }

    let userId: string | undefined;
    let storeId: string | undefined;
    if (scope === 'all') {
      storeId = q.storeId;
    } else if (scope === 'current') {
      if (!req.user!.currentStoreId) {
        throw new AppError(
          409,
          ErrorCodes.NO_STORE_SELECTED,
          '请先选择门店再查本店成品',
        );
      }
      userId = req.user!.id;
      storeId = req.user!.currentStoreId;
    } else {
      userId = req.user!.id;
    }

    const generations = await listGallery({
      userId,
      storeId,
      adopted: q.adopted,
      limit: q.limit,
    });
    res.json({ generations });
  }),
);

postersRouter.get(
  '/posters/today-count',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const result = await todayCount(req.user!.currentStoreId!);
    res.json(result);
  }),
);

// ============================================================================
// 素材库（按店隔离）
// ============================================================================

const assetKindSchema = z.enum(['background', 'product_photo']);

/** POST /posters/assets — multipart 上传 */
postersRouter.post(
  '/posters/assets',
  requireAuth,
  requireStore,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const kindParsed = assetKindSchema.safeParse(req.body.kind);
    if (!kindParsed.success) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'kind 必须是 background / product_photo');
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, '缺少上传文件');
    }
    const upRes = await ossService.upload({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype,
      purpose: 'poster-source',
      storeId: req.user!.currentStoreId!,
    });
    const asset = await createAsset({
      storeId: req.user!.currentStoreId!,
      kind: kindParsed.data,
      imageUrl: upRes.url,
      uploadedBy: req.user!.id,
    });
    res.status(201).json({ asset });
  }),
);

postersRouter.get(
  '/posters/assets',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const kindRaw = req.query.kind;
    let kind: 'background' | 'product_photo' | undefined;
    if (kindRaw !== undefined) {
      const r = assetKindSchema.safeParse(kindRaw);
      if (!r.success) {
        throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'kind 必须是 background / product_photo');
      }
      kind = r.data;
    }
    const assets = await listAssets(req.user!.currentStoreId!, kind);
    res.json({ assets });
  }),
);

postersRouter.delete(
  '/posters/assets/:assetId',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const assetId = requireUuid(req.params.assetId, 'assetId');
    await deleteAsset(assetId, req.user!.currentStoreId!);
    res.status(204).end();
  }),
);

// ============================================================================
// 销量追踪
// ============================================================================

postersRouter.get(
  '/posters/sales-tracking',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const days = req.query.days ? Number(req.query.days) : undefined;
    const items = await listSalesTracking({
      storeId: req.user!.currentStoreId!,
      days: Number.isFinite(days) ? (days as number) : undefined,
    });
    res.json({ items });
  }),
);
