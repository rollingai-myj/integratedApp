/**
 * SK-I1 商品识别 + SK-K1 触发虚拟货架生成（异步）
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { detectService } from '../services/detect.service.js';
import { difyService } from '../services/dify.service.js';
import { recordVirtualShelf } from '../services/scenes.service.js';
import { updateShelfRuntime } from '../services/shelves.service.js';

export const detectRouter = Router();

/**
 * SK-I1 上传图片做商品识别
 *
 * 接受 multipart/form-data 上传，或 JSON { imageUrl } 让后端拉取后送检。
 * 这里实现简化版：要求 JSON body 带 imageBase64（前端转好）。
 */
const detectSchema = z.object({
  imageBase64: z.string().min(1),
  filename: z.string().optional(),
});

detectRouter.post(
  '/detect',
  requireAuth,
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const body = detectSchema.parse(req.body);
        const buf = Buffer.from(body.imageBase64, 'base64');
        if (buf.length === 0) {
          throw new AppError(400, ErrorCodes.BAD_REQUEST, '图片为空');
        }
        const result = await detectService.detect(buf, body.filename ?? 'shelf.jpg');
        res.json(result);
      } catch (err) {
        next(err);
      }
    })();
  },
);

/**
 * SK-K1 触发虚拟货架生成（异步）
 *
 * body：storeId, sceneCode（位置编码）, shelfCode（可选）, currentSkus
 * 流程：
 *   1. 把 runtime 标 virtual_status='running'
 *   2. 调 Dify 虚拟货架工作流
 *   3. 成功 → 落 virtual_shelf_history，runtime 标 succeeded + 写 image_url
 *   4. 失败 → runtime 标 failed
 *
 * 为简化，本接口同步返回（前端 polling 看 runtime 状态）。真实长耗时建议改 job 队列。
 */
const generateSchema = z.object({
  storeId: z.string().uuid(),
  sceneCode: z.number().int(),
  shelfCode: z.string().optional(),
  currentSkus: z.array(z.unknown()).optional(),
});

detectRouter.post(
  '/generate-virtual-shelf',
  requireAuth,
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const body = generateSchema.parse(req.body);

        if (body.shelfCode) {
          await updateShelfRuntime(
            body.storeId,
            body.shelfCode,
            { virtualStatus: 'running' },
            req.user!.id,
          );
        }

        let outputs: Record<string, unknown>;
        try {
          outputs = await difyService.invoke(
            'virtual-shelf',
            {
              store_id: body.storeId,
              scene_code: body.sceneCode,
              current_skus: body.currentSkus ?? [],
            },
            { userId: req.user!.id },
          );
        } catch (err) {
          if (body.shelfCode) {
            await updateShelfRuntime(
              body.storeId,
              body.shelfCode,
              {
                virtualStatus: 'failed',
                virtualLastOutput: {
                  error: (err as Error).message ?? 'unknown',
                },
              },
              req.user!.id,
            ).catch(() => {});
          }
          throw err;
        }

        const imageUrl = typeof outputs.image_url === 'string' ? outputs.image_url : '';
        if (!imageUrl) {
          throw new AppError(502, ErrorCodes.UPSTREAM_ERROR, 'Dify 未返回 image_url');
        }

        const record = await recordVirtualShelf(
          body.storeId,
          {
            positionCode: body.sceneCode,
            imageUrl,
            rawOutput: outputs,
            aiModel: typeof outputs.ai_model === 'string' ? outputs.ai_model : undefined,
            aiSessionId:
              typeof outputs.session_id === 'string' ? outputs.session_id : undefined,
          },
          req.user!.id,
        );

        if (body.shelfCode) {
          await updateShelfRuntime(
            body.storeId,
            body.shelfCode,
            {
              virtualStatus: 'succeeded',
              virtualLastImageUrl: imageUrl,
              virtualLastOutput: outputs,
            },
            req.user!.id,
          );
        }

        res.status(201).json({ record });
      } catch (err) {
        next(err);
      }
    })();
  },
);
