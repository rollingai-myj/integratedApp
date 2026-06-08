/**
 * 模块 7：活动海报（业务接口）
 *
 * 覆盖统一接口规划文档：
 *   - PO-C1 单张同步生成
 *   - PO-D1 批量入队
 *   - PO-D2 认领并处理某任务
 *   - PO-D3 列出我最近的活跃任务
 *   - PO-D4 移除整个批次
 *   - PO-D5 重置卡死的任务
 *   - PO-D6 失败任务换参数重新生成
 */
import { Router } from 'express';
import { NotImplementedError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';

export const postersRouter = Router();

/** PO-C1 单张同步生成（拍照合成 / 仅背景+商品官方图 / 多商品混排） */
postersRouter.post(
  '/posters/generate',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** PO-D1 批量入队（1-10 张） */
postersRouter.post(
  '/posters/queue/enqueue',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** PO-D2 认领并处理某个任务 */
postersRouter.post(
  '/posters/queue/process',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** PO-D3 列出我最近 2 小时的活跃任务 */
postersRouter.get(
  '/posters/queue/active',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** PO-D4 移除整个批次 */
postersRouter.delete(
  '/posters/queue/batch/:batchId',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** PO-D5 重置卡死的任务（超过 60 秒处理中） */
postersRouter.post(
  '/posters/queue/task/:taskId/reset',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** PO-D6 失败任务换参数重新生成 */
postersRouter.post(
  '/posters/queue/task/:taskId/retry',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);
