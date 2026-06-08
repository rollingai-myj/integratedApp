/**
 * 模块 11：AI 网关（Dify 统一入口）
 *
 * 覆盖统一接口规划文档：
 *   - SK-J1 转发任意 Dify 工作流调用（升级为统一入口，价盘也走这里）
 *
 * workflow 取值见 services/dify.service.ts 的 DifyWorkflow 类型：
 *   selection | align | insight | questions | virtual-shelf | price-diagnose
 */
import { Router } from 'express';
import { NotImplementedError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';

export const aiRouter = Router();

/** 触发 Dify 工作流 */
aiRouter.post('/dify/:workflow', requireAuth, (_req, _res, next) => {
  next(new NotImplementedError());
});
