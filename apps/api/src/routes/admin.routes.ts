/**
 * 模块 9：后台管理（超管）
 *
 * 覆盖统一接口规划文档：
 *   - 账号列表（合并 SK-A2 + PO-F5）
 *   - 创建账号（合并 SK-A3 + PO-F6）
 *   - 重置密码 PO-F7
 *   - 删除账号 PO-F8
 *   - 绑定 / 解绑门店（新增）
 *   - 修改角色（新增）
 *   - 登录事件列表 PO-F1
 *   - 海报列表 PO-F2
 *   - 操作日志 / 审计事件查询（合并 SK-M2 + PO-F1/F2）
 *   - 用户使用时长 PO-F3
 *   - 门店综合统计 PO-F4
 *   - 实时统计 PO-F9
 *   - 查询 AI 模型设置 PO-F10
 *   - 切换 AI 模型 PO-F11
 *   - AI 压力测试 PO-F12
 */
import { Router } from 'express';
import { NotImplementedError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';

export const adminRouter = Router();

// 该模块所有接口都要求 super_admin。
// 注意必须限定 '/admin' 路径:Router.use 不带路径会对"流经本 router 的所有请求"
// 生效,而本 router 在 routes/index.ts 挂载靠前,曾把后面挂载的 storage/ai/
// sessions/detect 等模块对非超管整体 403。
adminRouter.use('/admin', requireAuth, requireRole('super_admin'));

// 账号管理 --------------------------------------------------------------

/** 账号列表 */
adminRouter.get('/admin/accounts', (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 创建账号（店主 / 超管） */
adminRouter.post('/admin/accounts', (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 重置某账号密码 */
adminRouter.post(
  '/admin/accounts/:accountId/reset-password',
  (_req, _res, next) => {
    next(new NotImplementedError());
  },
);

/** 删除账号 */
adminRouter.delete('/admin/accounts/:accountId', (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 给账号绑定 / 解绑门店 */
adminRouter.put('/admin/accounts/:accountId/stores', (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 修改账号角色 */
adminRouter.put('/admin/accounts/:accountId/roles', (_req, _res, next) => {
  next(new NotImplementedError());
});

// 审计 / 列表 ------------------------------------------------------------

/** 登录事件列表（PO-F1，新审计表） */
adminRouter.get('/admin/login-events', (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 海报列表（PO-F2，新审计表） */
adminRouter.get('/admin/posters', (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 操作日志 / 审计事件查询（SK-M2 + PO-F1/F2 合并） */
adminRouter.get('/admin/audit-events', (_req, _res, next) => {
  next(new NotImplementedError());
});

// 统计 ------------------------------------------------------------------

/** 用户使用时长（今日 / 本周 / 本月 / 累计） */
adminRouter.get('/admin/stats/user-usage', (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 门店综合统计 */
adminRouter.get('/admin/stats/stores', (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 实时统计（5 分钟 / 1 小时 / 今日 + 在线人数） */
adminRouter.get('/admin/stats/realtime', (_req, _res, next) => {
  next(new NotImplementedError());
});

// AI 模型设置 + 压测 ----------------------------------------------------

/** 查询当前 AI 模型设置 */
adminRouter.get('/admin/ai/model', (_req, _res, next) => {
  next(new NotImplementedError());
});

/** 切换 AI 模型 */
adminRouter.put('/admin/ai/model', (_req, _res, next) => {
  next(new NotImplementedError());
});

/** AI 压力测试（并发 1-20） */
adminRouter.post('/admin/ai/load-test', (_req, _res, next) => {
  next(new NotImplementedError());
});
