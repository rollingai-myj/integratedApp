/**
 * 路由总注册
 *
 * 所有业务路由都挂在 /api/v1 下。
 * 一个独立的 /api/v1/health 不在规划文档里，但任何后端都该有。
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { HealthResponse } from '../types/api.js';

import { authRouter } from './auth.routes.js';
import { portalRouter } from './portal.routes.js';
import { masterRouter } from './master.routes.js';
import { shelvesRouter } from './shelves.routes.js';
import { pricesRouter } from './prices.routes.js';
import { postersRouter } from './posters.routes.js';
import { promotionsRouter } from './promotions.routes.js';
import { adminRouter } from './admin.routes.js';
import { storageRouter } from './storage.routes.js';
import { aiRouter } from './ai.routes.js';
import { sessionsRouter } from './sessions.routes.js';
import { detectRouter } from './detect.routes.js';
import { docsRouter } from './docs.routes.js';

const VERSION = '0.1.0-m0';

export function registerRoutes(): Router {
  const apiV1 = Router();

  // ---- 健康检查（不在规划文档里，但通用） ----
  apiV1.get('/health', (_req: Request, res: Response) => {
    const body: HealthResponse = { status: 'ok', version: VERSION };
    res.json(body);
  });

  // ---- 接口文档（Swagger UI）----
  apiV1.use(docsRouter);  // /docs, /docs.json, /docs.yaml

  // ---- 11 个业务模块 ----
  apiV1.use(authRouter);        // 模块 1 + 模块 2 设备
  apiV1.use(portalRouter);      // 模块 2
  apiV1.use(masterRouter);      // 模块 3 + 模块 4
  apiV1.use(shelvesRouter);     // 模块 5
  apiV1.use(pricesRouter);      // 模块 6
  apiV1.use(postersRouter);     // 模块 7
  apiV1.use(promotionsRouter);  // 模块 8
  apiV1.use(adminRouter);       // 模块 9
  apiV1.use(storageRouter);     // 模块 10
  apiV1.use(aiRouter);          // 模块 11
  apiV1.use(sessionsRouter);    // 模块 12
  apiV1.use(detectRouter);      // 选品 detect / virtual-shelf 触发

  return apiV1;
}
