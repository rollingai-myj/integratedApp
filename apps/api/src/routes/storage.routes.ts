/**
 * 模块 10：文件存储与图片代理
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { ossService, type UploadPurpose } from '../services/oss.service.js';
import { query } from '../db/index.js';

export const storageRouter = Router();

const uploadSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  contentBase64: z.string().min(1),
  purpose: z.enum([
    'shelf-photo',
    'poster-source',
    'poster-output',
    'avatar',
    'other',
  ]),
  storeId: z.string().uuid().optional(),
  shelfId: z.string().uuid().optional(),
});

storageRouter.post(
  '/storage/upload',
  requireAuth,
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const body = uploadSchema.parse(req.body);
        const buffer = Buffer.from(body.contentBase64, 'base64');
        if (buffer.length === 0) {
          throw new AppError(400, ErrorCodes.BAD_REQUEST, '文件为空');
        }
        const result = await ossService.upload({
          buffer,
          filename: body.filename,
          contentType: body.contentType,
          purpose: body.purpose as UploadPurpose,
          storeId: body.storeId,
          shelfId: body.shelfId,
        });
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    })();
  },
);

/** 本地 dev fallback 文件读取（与 OSS 真上传配齐后可去掉） */
storageRouter.get(
  '/storage/local/:key',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = decodeURIComponent(req.params.key!);
      const { stream, contentType } = ossService.readLocal(key);
      res.setHeader('Content-Type', contentType);
      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  },
);

/** SK-L2 跨域图片代理 */
storageRouter.get(
  '/storage/proxy',
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const url = typeof req.query.url === 'string' ? req.query.url : '';
        if (!url) {
          throw new AppError(400, ErrorCodes.BAD_REQUEST, '缺少 url 参数');
        }
        const { body, contentType } = await ossService.proxyImage(url);
        res.setHeader('Content-Type', contentType);
        res.send(Buffer.from(body));
      } catch (err) {
        next(err);
      }
    })();
  },
);

/** 决策 D8：按 SKU 拿商品官方图（优先 dim_product.official_image_url，否则按命名约定） */
storageRouter.get(
  '/storage/sku-image/:sku',
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const sku = req.params.sku!;
        const r = await query<{ official_image_url: string | null }>(
          `SELECT official_image_url FROM dim_product WHERE sku_code = $1 AND deleted_at IS NULL LIMIT 1`,
          [sku],
        );
        const stored = r.rows[0]?.official_image_url;
        const url = stored || ossService.buildSkuImageUrl(sku);
        res.redirect(302, url);
      } catch (err) {
        next(err);
      }
    })();
  },
);
