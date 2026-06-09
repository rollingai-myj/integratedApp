/**
 * 模块 12：审计与会话/统计
 *
 * 覆盖统一接口规划文档：
 *   - 写一条审计事件（合并 SK-M1 + PO-A2）
 *   - PO-G1 开始一次使用会话
 *   - PO-G2 会话心跳
 *   - PO-G3 查询今日海报生成数
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { NotImplementedError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import {
  writeAuditEvent,
  shelvesActionToEventKind,
  type AuditEventKind,
} from '../services/audit.service.js';

export const sessionsRouter = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ---- 审计事件写入（前端埋点统一入口） ------------------------------------

const auditEventSchema = z.object({
  // 完整模式：调用方明确指定 eventKind
  eventKind: z.string().optional(),
  // 模块快速模式：调用方传 module='shelves' + actionType，service 内查表映射
  module: z.enum(['shelves', 'prices', 'posters']).optional(),
  actionType: z.string().optional(),
  actionLabel: z.string().optional(),
  // 通用字段
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  isAiCall: z.boolean().optional(),
  aiWorkflow: z.string().optional(),
  aiModel: z.string().optional(),
  aiLatencyMs: z.number().int().optional(),
  aiStatus: z.string().optional(),
  aiError: z.string().optional(),
});

sessionsRouter.post(
  '/sessions/audit-events',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = auditEventSchema.parse(req.body);

    // 解析 eventKind：优先 explicit；否则按 module 查映射表
    let eventKind: AuditEventKind | null = null;
    if (body.eventKind) {
      eventKind = body.eventKind as AuditEventKind;
    } else if (body.module === 'shelves' && body.actionType) {
      eventKind = shelvesActionToEventKind(body.actionType);
    }
    if (!eventKind) {
      res.status(400).json({
        error: { code: 'BAD_REQUEST', message: '无法解析 eventKind（需 explicit 字段或 module + 已注册 actionType）' },
      });
      return;
    }

    const role = req.user!.roles[0] ?? null;
    const result = await writeAuditEvent({
      eventKind,
      actorUserId: req.user!.id,
      actorRole: role,
      actorDisplayName: req.user!.name,
      targetStoreId: req.user!.currentStoreId ?? null,
      targetType: body.targetType ?? null,
      targetId: body.targetId ?? null,
      summary: body.actionLabel ?? null,
      payload: {
        ...(body.payload ?? {}),
        ...(body.module ? { module: body.module } : {}),
        ...(body.actionType ? { actionType: body.actionType } : {}),
      },
      isAiCall: body.isAiCall ?? false,
      aiWorkflow: body.aiWorkflow ?? null,
      aiModel: body.aiModel ?? null,
      aiLatencyMs: body.aiLatencyMs ?? null,
      aiStatus: body.aiStatus ?? null,
      aiError: body.aiError ?? null,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });
    res.status(201).json(result);
  }),
);

/** PO-G1 开始一次使用会话 */
sessionsRouter.post('/sessions/start', requireAuth, (_req, _res, next) => {
  next(new NotImplementedError());
});

/** PO-G2 会话心跳（前端每 30 秒一次） */
sessionsRouter.post(
  '/sessions/heartbeat',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** PO-G3 查询今日海报生成数（已用 / 上限 / 剩余） */
sessionsRouter.get('/usage/today', requireAuth, (_req, _res, next) => {
  next(new NotImplementedError());
});
