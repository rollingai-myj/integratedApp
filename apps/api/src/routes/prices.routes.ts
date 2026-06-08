/**
 * 模块 6：价盘管理（业务接口）
 *
 * 覆盖统一接口规划文档：
 *   - PR-A2 查询价格曲线
 *   - PR-A4 提交一次调价
 *   - 批量价盘 AI 诊断（合并 PR-B1 + 走统一 AI 网关）
 *
 * 注：「查询当前门店在售商品（含价格）」和「查询竞品价格」已合并到 master.routes.ts，
 *     按规划文档"已并入模块 4"。
 */
import { Router } from 'express';
import { NotImplementedError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';

export const pricesRouter = Router();

/** PR-A2 查询所有 SKU 的价格曲线 */
pricesRouter.get('/prices/curve', requireAuth, (_req, _res, next) => {
  next(new NotImplementedError());
});

/** PR-A4 提交一次调价 */
pricesRouter.post('/prices/adjust', requireAuth, (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 批量价盘 AI 诊断（PR-B1 改走自己后端） */
pricesRouter.post(
  '/prices/diagnose',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);
