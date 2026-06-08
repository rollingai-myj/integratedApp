/**
 * 模块 11：AI 网关（Dify 统一入口）
 *
 * SK-J1：店长 / 价盘 / 选品 都通过这里走 Dify，前端不持有 API key。
 *
 * workflow 取值见 services/dify.service.ts：
 *   selection | align | insight | questions | virtual-shelf | price-diagnose
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { difyService, type DifyWorkflow } from '../services/dify.service.js';

export const aiRouter = Router();

const ALLOWED: DifyWorkflow[] = [
  'selection',
  'align',
  'insight',
  'questions',
  'virtual-shelf',
  'price-diagnose',
];

const invokeSchema = z.object({
  inputs: z.record(z.unknown()),
  responseMode: z.enum(['blocking', 'streaming']).optional(),
});

aiRouter.post(
  '/dify/:workflow',
  requireAuth,
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const workflow = req.params.workflow as DifyWorkflow;
        if (!ALLOWED.includes(workflow)) {
          throw new AppError(
            400,
            ErrorCodes.BAD_REQUEST,
            `workflow 必须是 ${ALLOWED.join(' / ')} 之一`,
          );
        }
        const body = invokeSchema.parse(req.body);
        const outputs = await difyService.invoke(workflow, body.inputs, {
          userId: req.user!.id,
          responseMode: body.responseMode,
        });
        res.json({ workflow, outputs });
      } catch (err) {
        next(err);
      }
    })();
  },
);
