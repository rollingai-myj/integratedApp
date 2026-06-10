/**
 * Express 应用装配
 *
 * 顺序至关重要：
 *   1. requestIdMiddleware   先生成 requestId
 *   2. pino-http              用 requestId 串联日志
 *   3. body/cookie 解析       为 handler 准备 req.body / req.cookies
 *   4. /api/v1/*              业务路由
 *   5. notFoundHandler        404 兜底
 *   6. errorHandler           最终错误转换（4 参 ErrorRequestHandler）
 */
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';

import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { registerRoutes } from './routes/index.js';
import { logger } from './lib/logger.js';

export function createApp(): Express {
  const app = express();

  // 关闭 X-Powered-By（小心思但常见）
  app.disable('x-powered-by');

  // 1) requestId
  app.use(requestIdMiddleware);

  // 2) HTTP 访问日志（沿用 requestId）
  app.use(
    pinoHttp({
      logger,
      customProps: (_req, res) => ({
        requestId: (res as { locals?: { requestId?: string } }).locals
          ?.requestId,
      }),
      // 健康检查不必淹没日志
      autoLogging: {
        ignore: (req) => req.url === '/api/v1/health',
      },
    }),
  );

  // 3) 解析 body / cookie
  //    海报源图（base64 data URL）+ 选品货架照片（base64）都会走 JSON body，
  //    一张 ~3-5MB 的 JPEG base64 后会接近 7MB，所以放宽到 12MB。
  //    （海报最初提的 8MB 上限对单图勉强够用，但叠加多张商品图就超；统一 12MB。）
  app.use(express.json({ limit: '12mb' }));
  app.use(express.urlencoded({ extended: true, limit: '12mb' }));
  app.use(cookieParser());

  // 4) 业务路由
  app.use('/api/v1', registerRoutes());

  // 5) 404
  app.use(notFoundHandler);

  // 6) 全局错误
  app.use(errorHandler);

  return app;
}
