/**
 * 模块 13:美宜佳龙虾(门店 AI 对话助手,实验)
 *
 * POST /lobster/chat                      发消息,SSE 流式返回
 * GET  /lobster/conversations             会话列表
 * GET  /lobster/conversations/:id/messages 历史消息
 * DELETE /lobster/conversations/:id        删除会话
 *
 * SSE 事件统一为 `data: {"type": ...}` 行,type 见 @myj/shared LobsterStreamEvent。
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { requireAuth } from '../middleware/auth.js';
import { requireStore } from '../middleware/require-store.js';
import {
  runLobsterTurn,
  listConversations,
  getConversationWithMessages,
  deleteConversation,
} from '../services/lobster.service.js';

export const lobsterRouter = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const chatSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
  photoDataUrl: z
    .string()
    .regex(/^data:image\/(jpeg|jpg|png|webp|heic);base64,/)
    .max(11 * 1024 * 1024) // body limit 12MB,留余量
    .optional(),
});

// ---- LO-A1 发消息(SSE) ----------------------------------------------------
lobsterRouter.post(
  '/lobster/chat',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        400,
        ErrorCodes.VALIDATION_ERROR,
        parsed.error.issues[0]?.message ?? '请求体不合法',
      );
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx 不缓冲
    res.flushHeaders();

    const send = (event: Record<string, unknown>) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await runLobsterTurn({
        userId: req.user!.id,
        storeId: req.user!.currentStoreId!,
        conversationId: parsed.data.conversationId,
        message: parsed.data.message,
        photoDataUrl: parsed.data.photoDataUrl,
        events: {
          onStart: (conversationId) => send({ type: 'start', conversationId }),
          onDelta: (text) => send({ type: 'delta', text }),
          onToolStart: (name, label) => send({ type: 'tool_start', name, label }),
          onToolEnd: (name, ok) => send({ type: 'tool_end', name, ok }),
          onPoster: (posterUrl, posterId) => send({ type: 'poster', posterUrl, posterId }),
          onSkuCards: (payload) => send({ type: 'sku_cards', ...payload }),
        },
      });
      send({ type: 'done' });
    } catch (err) {
      // SSE 已开流,错误只能走事件而不是 HTTP 状态码
      const message =
        err instanceof AppError ? err.message : '龙虾开小差了,请稍后再试';
      logger.error({ err }, 'lobster: turn failed');
      send({ type: 'error', message });
    } finally {
      res.end();
    }
  }),
);

// ---- LO-B1 会话列表 ---------------------------------------------------------
lobsterRouter.get(
  '/lobster/conversations',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const rows = await listConversations(req.user!.id, req.user!.currentStoreId!);
    res.json({
      conversations: rows.map((r) => ({
        id: r.id,
        title: r.title,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  }),
);

// ---- LO-B2 历史消息(只回放 user/assistant 文本) ---------------------------
lobsterRouter.get(
  '/lobster/conversations/:id/messages',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    const { conversation, messages } = await getConversationWithMessages(
      req.params.id!,
      req.user!.id,
      req.user!.currentStoreId!,
    );
    res.json({
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
      },
      messages: messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          text:
            (m.content.text ?? '') +
            (m.role === 'user' && m.content.hasPhoto ? '\n[📷 已上传照片]' : ''),
          posterUrl: m.content.posterUrl ?? null,
          skuCards: m.content.skuCards ?? null,
          createdAt: m.created_at,
        })),
    });
  }),
);

// ---- LO-B3 删除会话 ---------------------------------------------------------
lobsterRouter.delete(
  '/lobster/conversations/:id',
  requireAuth,
  requireStore,
  asyncHandler(async (req, res) => {
    await deleteConversation(req.params.id!, req.user!.id, req.user!.currentStoreId!);
    res.status(204).end();
  }),
);
