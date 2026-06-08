/**
 * 鉴权中间件 requireAuth
 *
 * 凭证来源（按优先级）：
 *   1. HTTP-only Cookie `sso_token`
 *   2. Header `Authorization: Bearer <token>`
 *
 * M0：JWT 的真正校验逻辑（用 jose）会在 M1 接入飞书时补齐。
 * 当前只要能识别到 token 就算未实现；任何调用 requireAuth 的请求都返回 401，
 * 直到 M1 把会话存储/JWT 校验接上为止。
 *
 * 这样做的目的是：
 * - 所有 routes 文件里都能正确写出 `requireAuth` 中间件链
 * - M1 只改这一个文件就能让所有受保护路由瞬间可用
 */
import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCodes } from '../lib/errors.js';

const COOKIE_NAME = 'sso_token';

function extractToken(req: Request): string | null {
  // Cookie
  const cookieToken =
    (req as Request & { cookies?: Record<string, string> }).cookies?.[
      COOKIE_NAME
    ] ?? null;
  if (cookieToken) return cookieToken;

  // Bearer
  const auth = req.header('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

/**
 * 强制要求登录。
 * - 无 token → 401 UNAUTHENTICATED
 * - 有 token 但校验未实现 → 501 NOT_IMPLEMENTED（M0 当前状态）
 *
 * 注：M0 整体策略是「所有需要登录的路由先返回 501」，但这里特别区分了
 * 「没带 token」（401）与「带了但还没接 JWT」（M1 实现），前端能据此调试。
 */
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const token = extractToken(req);
  if (!token) {
    next(
      new AppError(
        401,
        ErrorCodes.UNAUTHENTICATED,
        'Authentication required',
      ),
    );
    return;
  }

  // TODO(M1): 用 jose 验证 token，加载 req.user。
  // 目前先按 NOT_IMPLEMENTED 处理，避免假装登录成功。
  next(
    new AppError(
      501,
      ErrorCodes.NOT_IMPLEMENTED,
      'Session verification will be implemented in M1',
    ),
  );
}

/**
 * 可选鉴权：有 token 就尝试解析，无 token 不报错。
 * 用于 /auth/me 这种"未登录也要能调"的接口。
 *
 * M0 阶段：什么都不做，直接 next()。
 */
export function optionalAuth(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  // TODO(M1): 同 requireAuth，但失败时静默 next()
  next();
}
