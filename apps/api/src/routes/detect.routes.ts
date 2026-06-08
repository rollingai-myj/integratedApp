/**
 * 选品业务里的「商品检测」与「虚拟货架生成触发」
 *
 * 覆盖统一接口规划文档：
 *   - SK-I1 上传图片做商品识别（detect）
 *   - SK-K1 触发虚拟货架生成（generate-virtual-shelf）
 *
 * 放在独立路由文件，因为这两条都是"会去调外部 AI 服务"的长耗时入口，
 * 单独文件方便后续配限流、超时、队列。
 */
import { Router } from 'express';
import { NotImplementedError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';

export const detectRouter = Router();

/** SK-I1 上传图片做商品识别（返回每个商品框 + 匹配 SKU） */
detectRouter.post('/detect', requireAuth, (_req, _res, next) => {
  next(new NotImplementedError());
});

/** SK-K1 触发虚拟货架生成（异步，店长点按钮后等几十秒看结果） */
detectRouter.post(
  '/generate-virtual-shelf',
  requireAuth,
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);
