// apps/api/src/routes/promotions.routes.ts
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import {
  uploadPromotion, listBatches, listActivePromotions, recommendForUser,
  setBatchVoided, deleteBatch,
} from '../services/promotions.service.js';

export const promotionsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res, next)).catch(next);
}

promotionsRouter.post(
  '/promotions/batches:upload',
  requireAuth,
  requireRole('super_admin'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError(400, ErrorCodes.BAD_REQUEST, '缺少 file 字段');
    const result = await uploadPromotion(
      {
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname,
        sourceFileUrl: typeof req.body.sourceFileUrl === 'string' ? req.body.sourceFileUrl : undefined,
        notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
      },
      req.user!.id,
    );
    res.status(201).json(result);
  }),
);

promotionsRouter.get(
  '/promotions/batches',
  requireAuth, requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || undefined;
    res.json({ batches: await listBatches(limit) });
  }),
);

promotionsRouter.get(
  '/promotions/active',
  requireAuth,
  asyncHandler(async (_req, res) => res.json(await listActivePromotions())),
);

promotionsRouter.get(
  '/promotions/recommend',
  requireAuth,
  asyncHandler(async (req, res) => res.json(await recommendForUser(req.user!.id))),
);

promotionsRouter.post(
  '/promotions/batches/:batchId/void',
  requireAuth, requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    res.json({ batch: await setBatchVoided(req.params.batchId!, true) });
  }),
);

promotionsRouter.post(
  '/promotions/batches/:batchId/unvoid',
  requireAuth, requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    res.json({ batch: await setBatchVoided(req.params.batchId!, false) });
  }),
);

promotionsRouter.delete(
  '/promotions/batches/:batchId',
  requireAuth, requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const r = await deleteBatch(req.params.batchId!);
    if (!r.deleted) throw new AppError(404, ErrorCodes.NOT_FOUND, '批次不存在');
    res.json(r);
  }),
);
