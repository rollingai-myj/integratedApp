/**
 * 模块 5：货盘选品业务接口
 *
 * 全部业务路由从 session.currentStoreId 取门店，不再接受 :storeId 路径段。
 * 详见 docs/planning/unified-api-spec.md § 0。
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireStore } from '../middleware/require-store.js';
import {
  listShelfConfigs,
  createShelfConfig,
  updateShelfConfig,
  deleteShelfConfigs,
  replaceAllShelfConfigs,
  getShelfRuntime,
  updateShelfRuntime,
  deleteShelfRuntime,
  listShelfPhotoHistory,
  addShelfPhotoHistory,
  updateCurrentShelfPhotos,
} from '../services/shelves.service.js';
import {
  listScenes,
  listSceneAdjustmentCounts,
  applyAdjustment,
  listSceneHistory,
  listVirtualShelfHistory,
  recordVirtualShelf,
} from '../services/scenes.service.js';
import {
  listQuestions,
  saveQuestions,
  listAnswers,
  saveAnswers,
} from '../services/surveys.service.js';
import {
  listCorrections,
  submitCorrection,
} from '../services/corrections.service.js';

export const shelvesRouter = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ---- 货架配置 ------------------------------------------------------------

const upsertConfigSchema = z.object({
  shelfCode: z.string().min(1),
  positionCode: z.number().int(),
  groupName: z.string().nullable().optional(),
  widthCm: z.number().nullable().optional(),
  layerCount: z.number().int().nullable().optional(),
  supportedCategories: z.array(z.string()).optional(),
  displayOrder: z.number().int().optional(),
  notes: z.string().nullable().optional(),
  attributes: z.record(z.unknown()).optional(),
});

shelvesRouter.get(
  '/shelves/config',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const configs = await listShelfConfigs(req.user!.currentStoreId!);
    res.json({ configs });
  }),
);

shelvesRouter.post(
  '/shelves/config',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = upsertConfigSchema.parse(req.body);
    const config = await createShelfConfig(req.user!.currentStoreId!, body);
    res.status(201).json({ config });
  }),
);

shelvesRouter.put(
  '/shelves/config/:shelfId',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = upsertConfigSchema.partial().parse(req.body);
    const config = await updateShelfConfig(
      req.user!.currentStoreId!,
      req.params.shelfId!,
      body,
    );
    res.json({ config });
  }),
);

const deleteSchema = z.object({ shelfCodes: z.array(z.string().min(1)).min(1) });

shelvesRouter.delete(
  '/shelves/config',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = deleteSchema.parse(req.body);
    const result = await deleteShelfConfigs(
      req.user!.currentStoreId!,
      body.shelfCodes,
    );
    res.json(result);
  }),
);

const replaceAllSchema = z.object({ configs: z.array(upsertConfigSchema) });

shelvesRouter.put(
  '/shelves/config:replace-all',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = replaceAllSchema.parse(req.body);
    const result = await replaceAllShelfConfigs(
      req.user!.currentStoreId!,
      body.configs,
    );
    res.json(result);
  }),
);

// ---- 场景定义（全局，不需要门店） --------------------------------------

shelvesRouter.get(
  '/scenes',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const scenes = await listScenes();
    res.json({ scenes });
  }),
);

// ---- 场景调改 ------------------------------------------------------------

shelvesRouter.get(
  '/scenes/adjustments-count',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const counts = await listSceneAdjustmentCounts(req.user!.currentStoreId!);
    res.json({ counts });
  }),
);

const applySchema = z.object({
  summaryText: z.string().optional(),
  aiSessionId: z.string().optional(),
  items: z
    .array(
      z.object({
        action: z.enum(['add', 'remove', 'replace']),
        skuCode: z.string().min(1),
        productName: z.string().nullable().optional(),
        reasonCode: z.string().optional(),
        reasonText: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

shelvesRouter.post(
  '/scenes/:sceneId/apply',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = applySchema.parse(req.body);
    const positionCode = Number(req.params.sceneId);
    if (!Number.isFinite(positionCode)) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'sceneId 必须是数字');
    }
    const result = await applyAdjustment(
      req.user!.currentStoreId!,
      { ...body, positionCode },
      req.user!.id,
      req.user!.name,
    );
    res.status(201).json(result);
  }),
);

shelvesRouter.get(
  '/scenes/:sceneId/history',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const positionCode = Number(req.params.sceneId);
    const limit = Number(req.query.limit) || 50;
    const records = await listSceneHistory(
      req.user!.currentStoreId!,
      positionCode,
      limit,
    );
    res.json({ records });
  }),
);

shelvesRouter.get(
  '/scenes/:sceneId/virtual-shelf-history',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const positionCode = Number(req.params.sceneId);
    const limit = Number(req.query.limit) || 20;
    const records = await listVirtualShelfHistory(
      req.user!.currentStoreId!,
      positionCode,
      limit,
    );
    res.json({ records });
  }),
);

const recordVirtualSchema = z.object({
  shelfId: z.string().uuid().optional(),
  imageUrl: z.string().min(1),
  rawOutput: z.record(z.unknown()).optional(),
  aiModel: z.string().optional(),
  aiSessionId: z.string().optional(),
});

shelvesRouter.post(
  '/scenes/:sceneId/virtual-shelf',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = recordVirtualSchema.parse(req.body);
    const positionCode = Number(req.params.sceneId);
    const record = await recordVirtualShelf(
      req.user!.currentStoreId!,
      { ...body, positionCode },
      req.user!.id,
    );
    res.status(201).json(record);
  }),
);

// ---- 货架运行时 ----------------------------------------------------------

shelvesRouter.get(
  '/shelves/state',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const shelfCode =
      typeof req.query.shelfCode === 'string' ? req.query.shelfCode : undefined;
    const states = await getShelfRuntime(req.user!.currentStoreId!, shelfCode);
    res.json({ states });
  }),
);

const updateRuntimeSchema = z.object({
  status: z
    .enum(['empty', 'photo_uploaded', 'detected', 'reviewing', 'confirmed'])
    .optional(),
  currentSkus: z.array(z.unknown()).optional(),
  lastDetectResult: z.record(z.unknown()).optional(),
  virtualStatus: z
    .enum(['idle', 'pending', 'running', 'succeeded', 'failed'])
    .optional(),
  virtualLastImageUrl: z.string().nullable().optional(),
  virtualLastOutput: z.record(z.unknown()).optional(),
});

shelvesRouter.put(
  '/shelves/state/:shelfId',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = updateRuntimeSchema.parse(req.body);
    const state = await updateShelfRuntime(
      req.user!.currentStoreId!,
      req.params.shelfId!, // shelf_code
      body,
      req.user!.id,
    );
    res.json({ state });
  }),
);

shelvesRouter.delete(
  '/shelves/state',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const shelfCode =
      typeof req.query.shelfCode === 'string' ? req.query.shelfCode : undefined;
    const result = await deleteShelfRuntime(req.user!.currentStoreId!, shelfCode);
    res.json(result);
  }),
);

shelvesRouter.get(
  '/shelves/photos/:shelfId',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || 20;
    const history = await listShelfPhotoHistory(
      req.user!.currentStoreId!,
      req.params.shelfId!, // shelf_code
      limit,
    );
    res.json({ history });
  }),
);

const addPhotosSchema = z.object({
  imageUrls: z.array(z.string()).min(1).max(3),
  detectSummary: z.record(z.unknown()).optional(),
});

shelvesRouter.post(
  '/shelves/photos/:shelfId',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = addPhotosSchema.parse(req.body);
    const result = await addShelfPhotoHistory(
      req.user!.currentStoreId!,
      req.params.shelfId!, // shelf_code
      body.imageUrls,
      body.detectSummary ?? {},
      req.user!.id,
    );
    res.status(201).json(result);
  }),
);

const updateCurrentPhotosSchema = z.object({
  urls: z.array(z.string().nullable().optional()).length(3),
});

shelvesRouter.put(
  '/shelves/photos/:shelfId/current',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = updateCurrentPhotosSchema.parse(req.body);
    await updateCurrentShelfPhotos(
      req.user!.currentStoreId!,
      req.params.shelfId!,
      body.urls,
      req.user!.id,
    );
    res.status(204).end();
  }),
);

// ---- 调研问卷 ------------------------------------------------------------

shelvesRouter.get(
  '/surveys/:shelfId/questions',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const questions = await listQuestions(
      req.user!.currentStoreId!,
      req.params.shelfId!,
    );
    res.json({ questions });
  }),
);

const saveQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        questionNo: z.number().int().min(1),
        questionText: z.string().min(1),
        questionKind: z.string().optional(),
        options: z.array(z.unknown()).optional(),
        source: z.string().optional(),
      }),
    )
    .min(1),
  replace: z.boolean().optional(),
});

shelvesRouter.put(
  '/surveys/:shelfId/questions',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = saveQuestionsSchema.parse(req.body);
    const result = await saveQuestions(
      req.user!.currentStoreId!,
      req.params.shelfId!,
      body,
      req.user!.id,
    );
    res.json(result);
  }),
);

shelvesRouter.get(
  '/surveys/:shelfId/answers',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const answers = await listAnswers(
      req.user!.currentStoreId!,
      req.params.shelfId!,
    );
    res.json({ answers });
  }),
);

const saveAnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        answerValue: z.unknown(),
      }),
    )
    .min(1),
});

shelvesRouter.put(
  '/surveys/:shelfId/answers',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = saveAnswersSchema.parse(req.body);
    const result = await saveAnswers(
      req.user!.currentStoreId!,
      req.params.shelfId!,
      body,
      req.user!.id,
    );
    res.json(result);
  }),
);

// ---- 勘误反馈 ------------------------------------------------------------

shelvesRouter.get(
  '/shelves/errata',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const onlyPending = req.query.pending === '1' || req.query.pending === 'true';
    const scopeRaw = typeof req.query.scope === 'string' ? req.query.scope : undefined;
    const scope = scopeRaw === 'detection' || scopeRaw === 'decision' ? scopeRaw : undefined;
    const skuCode = typeof req.query.skuCode === 'string' ? req.query.skuCode : undefined;
    const corrections = await listCorrections(req.user!.currentStoreId!, {
      onlyPending,
      scope,
      skuCode,
    });
    res.json({ corrections });
  }),
);

// V026 后 correctionKind 扩展到 4 个值；scope 必传，决定 kind 合法集合。
const submitCorrectionSchema = z.object({
  shelfCode: z.string().optional(),
  skuCode: z.string().min(1),
  correctionScope: z.enum(['detection', 'decision']).optional(),
  correctionKind: z.enum(['missed', 'false_positive', 'remove', 'add']),
  reasonCode: z.string().optional(),
  reasonText: z.string().optional(),
  evidenceImageUrl: z.string().optional(),
});

shelvesRouter.post(
  '/shelves/errata',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const body = submitCorrectionSchema.parse(req.body);
    const result = await submitCorrection(
      req.user!.currentStoreId!,
      body,
      req.user!.id,
    );
    res.status(201).json(result);
  }),
);
