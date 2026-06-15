/**
 * 选品（场景维度）路由 —— 整个选品模块的所有动作都在这里
 *
 * 列表 / overview / 工作台 / 货架 / 调改 / 勘误 / 虚拟陈列历史 / 场景促销文案
 * AI 业务端点：诊断 / 选品方案 / 虚拟陈列（流式 SSE）
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireStore } from '../middleware/require-store.js';
import {
  listScenes, assertSceneExists,
} from '../services/hq.service.js';
import {
  getStoreSceneOverview,
  getSceneRuntime, upsertSceneRuntime, clearSceneRuntime,
  applyAdjustment, listAdjustments,
  listCorrections, submitCorrection,
  listVirtualHistory, recordVirtualHistory,
  type AdjustmentItem,
} from '../services/scene.service.js';
import {
  listSceneShelfGroups, replaceSceneShelfGroups,
} from '../services/store-skus.service.js';
import { ossService } from '../services/oss.service.js';
import { writeAuditEvent } from '../services/audit.service.js';
import {
  buildAlignInputs, buildStrategyInputs, buildVirtualShelfInputs,
  streamToClient,
} from '../services/ai-shelves.service.js';
import { computeBenchmarkForScene } from '../services/benchmark.service.js';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { buildDifyUser } from '../lib/dify-user.js';

export const scenesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 3 },
});

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

function parseScene(req: Request): number {
  const r = z.coerce.number().int().min(0).max(12).safeParse(req.params.scene);
  if (!r.success) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'scene 必须是 0-12 整数');
  }
  return r.data;
}

// ---- 场景列表 + overview -------------------------------------------------

scenesRouter.get(
  '/scenes', requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ scenes: await listScenes() });
  }),
);

scenesRouter.get(
  '/scenes/overview', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scenes = await getStoreSceneOverview(req.user!.currentStoreId!);
    res.json({ scenes });
  }),
);

// ---- 标杆 SKU 实时计算 ----------------------------------------------------

scenesRouter.get(
  '/scenes/:scene/benchmark', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    await assertSceneExists(scene);
    const rows = await computeBenchmarkForScene(req.user!.currentStoreId!, scene);
    res.json({ scene, items: rows });
  }),
);

// ---- 工作台 runtime --------------------------------------------------------

scenesRouter.get(
  '/scenes/:scene/runtime', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    const rt = await getSceneRuntime(req.user!.currentStoreId!, scene);
    res.json(rt ?? { scene, status: 'empty', photos: [], detectionData: {},
      virtualStatus: 'idle', virtualRawOutputs: null, virtualContext: null,
      lastSnapshot: null, envCrowd: null, envCompetitor: null, draft: null,
      updatedAt: null });
  }),
);

const runtimePatchSchema = z.object({
  status: z.enum(['empty', 'photo_uploaded', 'detected', 'reviewing', 'confirmed']).optional(),
  photos: z.array(z.unknown()).optional(),
  detectionData: z.record(z.unknown()).optional(),
  virtualStatus: z.enum(['idle', 'processing', 'completed', 'failed']).optional(),
  virtualRawOutputs: z.unknown().optional(),
  virtualContext: z.unknown().optional(),
  lastSnapshot: z.unknown().optional(),
  envCrowd: z.string().nullable().optional(),
  envCompetitor: z.string().nullable().optional(),
  draft: z.unknown().optional(),
});

scenesRouter.put(
  '/scenes/:scene/runtime', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    await assertSceneExists(scene);
    const patch = runtimePatchSchema.parse(req.body);
    const rt = await upsertSceneRuntime(
      req.user!.currentStoreId!, scene, patch, req.user!.id,
    );
    res.json(rt);
  }),
);

scenesRouter.delete(
  '/scenes/:scene/runtime', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    await clearSceneRuntime(req.user!.currentStoreId!, scene);
    res.status(204).end();
  }),
);

// ---- 调改图上传（OSS）------------------------------------------------------

scenesRouter.post(
  '/scenes/:scene/photos', requireAuth, requireStore,
  upload.array('files', 3),
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    await assertSceneExists(scene);
    const files = (req.files ?? []) as Express.Multer.File[];
    if (files.length === 0) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, '请上传至少一张图片');
    }
    const urls: string[] = [];
    for (const f of files) {
      const out = await ossService.upload({
        buffer: f.buffer,
        filename: f.originalname,
        contentType: f.mimetype,
        purpose: 'shelf-photo',
        storeId: req.user!.currentStoreId!,
      });
      urls.push(out.url);
    }
    // 追加到 runtime.photos —— 跨设备恢复时能看到完整草稿
    const existing = await getSceneRuntime(req.user!.currentStoreId!, scene);
    const existingPhotos = Array.isArray(existing?.photos) ? existing!.photos : [];
    const merged = [...existingPhotos, ...urls.map((url) => ({ url }))];
    await upsertSceneRuntime(
      req.user!.currentStoreId!, scene,
      { photos: merged, status: 'photo_uploaded' },
      req.user!.id,
    );
    void writeAuditEvent({
      eventKind: 'scene_photo_upload',
      actorUserId: req.user!.id,
      targetStoreId: req.user!.currentStoreId!,
      payload: { scene, count: urls.length },
    }).catch(() => {});
    res.status(201).json({ urls });
  }),
);

// ---- 商品识别（detect-service 代理 / mock 兜底）---------------------------

const detectSchema = z.object({
  imageBase64: z.string().min(1),
  filename: z.string().optional(),
});

interface DetectBox {
  x: number;
  y: number;
  w: number;
  h: number;
  skuCode: string;
  confidence: number;
}

/**
 * Mock 框：一大一小两个区域示意框，模拟"AI 一次性把货架上一片商品都框住了"。
 * 真实识别上线后由 detect-service 返回精细化的单品框替换。
 */
const DETECT_MOCK_BOXES: DetectBox[] = [
  // 大框：覆盖货架主体的中上部，一片商品集合
  { x: 0.10, y: 0.16, w: 0.62, h: 0.42, skuCode: 'MOCK_GROUP_MAIN', confidence: 0.88 },
  // 小框：右下角一小簇商品
  { x: 0.66, y: 0.54, w: 0.26, h: 0.28, skuCode: 'MOCK_GROUP_SIDE', confidence: 0.76 },
];

scenesRouter.post(
  '/scenes/:scene/detect', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    await assertSceneExists(scene);
    const body = detectSchema.parse(req.body);
    const buf = Buffer.from(body.imageBase64, 'base64');
    if (buf.length === 0) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, '图片为空');
    }
    if (req.query.error === 'upstream_down') {
      throw new AppError(
        502, ErrorCodes.UPSTREAM_ERROR,
        '商品识别服务暂不可用（mock 降级演示）',
      );
    }

    const upstream = config.DETECT_SERVICE_URL?.trim();
    const goMock = async () => {
      const elapsedMs = 800 + Math.floor((buf.length % 500));
      await new Promise((r) => setTimeout(r, Math.min(elapsedMs, 1200)));
      res.json({ boxes: DETECT_MOCK_BOXES, elapsedMs });
    };

    if (!upstream) {
      logger.info({ scene, bytes: buf.length, mode: 'mock-default' }, 'detect');
      await goMock();
      return;
    }

    const t0 = Date.now();
    let upstreamRes: globalThis.Response;
    try {
      upstreamRes = await fetch(`${upstream.replace(/\/$/, '')}/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      logger.warn(
        { scene, upstream, err: (err as Error).message },
        'detect-service unreachable, fallback to mock',
      );
      await goMock();
      return;
    }
    if (!upstreamRes.ok) {
      logger.warn(
        { scene, upstream, status: upstreamRes.status },
        'detect-service non-2xx, fallback to mock',
      );
      await goMock();
      return;
    }
    const data = await upstreamRes.json() as { boxes: DetectBox[]; elapsedMs: number };
    logger.info(
      { scene, bytes: buf.length, mode: 'upstream', boxes: data.boxes?.length, ms: Date.now() - t0 },
      'detect',
    );
    res.json(data);
  }),
);

// ---- 货架组 ---------------------------------------------------------------

scenesRouter.get(
  '/scenes/:scene/shelves', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    res.json({ groups: await listSceneShelfGroups(req.user!.currentStoreId!, scene) });
  }),
);

const shelvesReplaceSchema = z.object({
  groups: z.array(z.object({
    shelfType: z.string().optional(),
    widthCm: z.number().nullable().optional(),
    layerCount: z.number().int().nullable().optional(),
    categories: z.array(z.string()).optional(),
    notes: z.string().optional(),
  })),
});

scenesRouter.put(
  '/scenes/:scene/shelves', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    await assertSceneExists(scene);
    const body = shelvesReplaceSchema.parse(req.body);
    const groups = await replaceSceneShelfGroups(
      req.user!.currentStoreId!, scene, body.groups,
    );
    void writeAuditEvent({
      eventKind: 'scene_config_change',
      actorUserId: req.user!.id,
      targetStoreId: req.user!.currentStoreId!,
      payload: { scene, groupCount: groups.length },
    }).catch(() => {});
    res.json({ groups });
  }),
);

// ---- 调改：应用 + 历史 ---------------------------------------------------

const adjustmentItemSchema = z.object({
  action: z.enum(['add', 'remove']),
  skuCode: z.string(),
  productName: z.string().optional(),
  reasonCode: z.string().optional(),
  reasonText: z.string().optional(),
});

const adjustmentSchema = z.object({
  summaryText: z.string().optional(),
  aiSessionId: z.string().optional(),
  items: z.array(adjustmentItemSchema).min(1),
});

scenesRouter.post(
  '/scenes/:scene/adjustments', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    await assertSceneExists(scene);
    const body = adjustmentSchema.parse(req.body);
    const adjustment = await applyAdjustment({
      storeId: req.user!.currentStoreId!,
      scene,
      summaryText: body.summaryText,
      aiSessionId: body.aiSessionId,
      items: body.items as AdjustmentItem[],
      userId: req.user!.id,
      userDisplayName: req.user!.name,
    });
    void writeAuditEvent({
      eventKind: 'scene_assortment_apply',
      actorUserId: req.user!.id,
      targetStoreId: req.user!.currentStoreId!,
      summary: adjustment.summaryText ?? '',
      payload: { scene, addedCount: adjustment.addedCount, removedCount: adjustment.removedCount },
    }).catch(() => {});
    res.status(201).json(adjustment);
  }),
);

scenesRouter.get(
  '/scenes/:scene/adjustments', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit);
    res.json({
      adjustments: await listAdjustments(req.user!.currentStoreId!, scene, limit),
    });
  }),
);

// ---- 勘误 ----------------------------------------------------------------

scenesRouter.get(
  '/scenes/:scene/corrections', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    const scope = req.query.scope as 'detection' | 'decision' | undefined;
    res.json({
      corrections: await listCorrections({
        storeId: req.user!.currentStoreId!, scene, scope,
      }),
    });
  }),
);

const correctionSchema = z.object({
  skuCode: z.string(),
  kind: z.enum(['missed', 'false_positive', 'remove', 'add']),
  scope: z.enum(['detection', 'decision']),
  reasonCode: z.string(),
  reasonText: z.string().optional(),
  evidenceImageUrl: z.string().url().optional(),
});

scenesRouter.post(
  '/scenes/:scene/corrections', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    await assertSceneExists(scene);
    const body = correctionSchema.parse(req.body);
    const corr = await submitCorrection({
      storeId: req.user!.currentStoreId!,
      scene,
      ...body,
      userId: req.user!.id,
    });
    void writeAuditEvent({
      eventKind: 'sku_correction_submit',
      actorUserId: req.user!.id,
      targetStoreId: req.user!.currentStoreId!,
      payload: { scene, kind: body.kind, scope: body.scope },
    }).catch(() => {});
    res.status(201).json(corr);
  }),
);

// ---- 虚拟陈列历史 --------------------------------------------------------

scenesRouter.get(
  '/scenes/:scene/virtual-history', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    const limit = z.coerce.number().int().min(1).max(50).default(20).parse(req.query.limit);
    res.json({
      history: await listVirtualHistory(req.user!.currentStoreId!, scene, limit),
    });
  }),
);

const recordVirtualSchema = z.object({
  imageUrl: z.string().url(),
  rawOutput: z.unknown().optional(),
  aiSessionId: z.string().optional(),
});

scenesRouter.post(
  '/scenes/:scene/virtual-history', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    await assertSceneExists(scene);
    const body = recordVirtualSchema.parse(req.body);
    const r = await recordVirtualHistory({
      storeId: req.user!.currentStoreId!,
      scene,
      imageUrl: body.imageUrl,
      rawOutput: body.rawOutput,
      aiSessionId: body.aiSessionId,
      userId: req.user!.id,
    });
    res.status(201).json(r);
  }),
);

// ---- AI 业务端点（流式 SSE）--------------------------------------------

// photoUrl 可以是 OSS 完整 https URL，也可以是 dev 的本地相对路径（前端补 origin 后给 Dify）
// 即使本机路径 Dify 拉不到图，也照常调 Dify（让台上有运行记录）；
// 工作流会跑 fallback 分支或返回空 outputs，前端 extractDiagnosis 兜底显示"AI 未返回内容"
const diagnoseSchema = z.object({ photoUrl: z.string().min(1) });

scenesRouter.post(
  '/scenes/:scene/ai/diagnose', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    await assertSceneExists(scene);
    const body = diagnoseSchema.parse(req.body);
    const inputs = await buildAlignInputs(
      { storeId: req.user!.currentStoreId!, scene, userId: req.user!.id },
      body.photoUrl,
    );
    void writeAuditEvent({
      eventKind: 'scene_ai_diagnose',
      actorUserId: req.user!.id, isAiCall: true, aiWorkflow: 'align',
      targetStoreId: req.user!.currentStoreId!,
      payload: { scene },
    }).catch(() => {});
    await streamToClient('align', inputs, buildDifyUser(req.user!), res);
  }),
);

scenesRouter.post(
  '/scenes/:scene/ai/strategy', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    await assertSceneExists(scene);
    const inputs = await buildStrategyInputs({
      storeId: req.user!.currentStoreId!, scene, userId: req.user!.id,
    });
    void writeAuditEvent({
      eventKind: 'scene_ai_strategy',
      actorUserId: req.user!.id, isAiCall: true, aiWorkflow: 'selection',
      targetStoreId: req.user!.currentStoreId!,
      payload: { scene },
    }).catch(() => {});
    await streamToClient('selection', inputs, buildDifyUser(req.user!), res);
  }),
);

scenesRouter.post(
  '/scenes/:scene/ai/virtual-shelf', requireAuth, requireStore,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    await assertSceneExists(scene);
    const inputs = await buildVirtualShelfInputs({
      storeId: req.user!.currentStoreId!, scene,
    });
    void writeAuditEvent({
      eventKind: 'scene_virtual_generate',
      actorUserId: req.user!.id, isAiCall: true, aiWorkflow: 'virtual_shelf',
      targetStoreId: req.user!.currentStoreId!,
      payload: { scene },
    }).catch(() => {});
    await streamToClient('virtual-shelf', inputs, buildDifyUser(req.user!), res);
  }),
);
