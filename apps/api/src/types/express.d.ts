/**
 * 扩展 Express Request 与 res.locals
 *
 * 注意：用 declaration merging 把 user / requestId 加到 req / res.locals 上。
 */
import type { AuthenticatedUser } from './api.js';

declare global {
  namespace Express {
    interface Request {
      /** 由 requireAuth 中间件填充；未登录的路由上为 undefined */
      user?: AuthenticatedUser;
    }

    interface Locals {
      /** 由 request-id 中间件填充，每个请求唯一 */
      requestId: string;
    }
  }
}

export {};
