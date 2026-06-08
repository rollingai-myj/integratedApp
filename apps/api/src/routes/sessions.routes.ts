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
import { NotImplementedError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';

export const sessionsRouter = Router();

/** 写一条审计事件（所有项目埋点统一入口） */
sessionsRouter.post(
  '/sessions/audit-events',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
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
