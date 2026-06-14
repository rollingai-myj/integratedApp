/**
 * 路由总注册
 *
 * 所有业务路由都挂在 /api/v1 下。/health 不在 spec 里但任何后端都该有。
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { HealthResponse } from '../types/api.js';

import { authRouter } from './auth.routes.js';
import { portalRouter } from './portal.routes.js';
import { hqRouter } from './hq.routes.js';
import { storeRouter } from './store.routes.js';
import { scenesRouter } from './scenes.routes.js';
import { storageRouter } from './storage.routes.js';
import { insightsRouter } from './insights.routes.js';
import { pricesRouter } from './prices.routes.js';
import { postersRouter } from './posters.routes.js';
import { promotionsRouter } from './promotions.routes.js';
import { adminRouter } from './admin.routes.js';
import { competitorsRouter } from './competitors.routes.js';
import { docsRouter } from './docs.routes.js';

const VERSION = '0.1.0-p3';

export function registerRoutes(): Router {
  const apiV1 = Router();

  // 健康检查
  apiV1.get('/health', (_req: Request, res: Response) => {
    const body: HealthResponse = { status: 'ok', version: VERSION };
    res.json(body);
  });

  // Swagger / OpenAPI docs
  apiV1.use(docsRouter);

  // 10 业务模块
  apiV1.use(authRouter);        // 认证
  apiV1.use(portalRouter);      // 门户 + usage
  apiV1.use(hqRouter);          // 总部主数据
  apiV1.use(storeRouter);       // 门店经营
  apiV1.use(scenesRouter);      // 选品（场景维度，含 detect / benchmark）
  apiV1.use(storageRouter);     // 文件存储（dev local + 后续 OSS）
  apiV1.use(insightsRouter);    // 洞察 + 问卷
  apiV1.use(promotionsRouter);  // 促销批次
  apiV1.use(pricesRouter);      // 价盘
  apiV1.use(postersRouter);     // 海报
  apiV1.use(competitorsRouter); // 竞品采集
  // adminRouter 内部用 router.use(requireRole('super_admin')) 全局拦截，必须挂到
  // /admin 前缀下，否则任何未匹配路径都会被它染成 403（掩盖真实的 404）。
  apiV1.use('/admin', adminRouter);

  return apiV1;
}
