/**
 * 鉴权中间件 requireAuth / optionalAuth
 *
 * 凭证来源（按优先级）：
 *   1. HTTP-only Cookie `sso_token`
 *   2. Header `Authorization: Bearer <token>`
 *
 * 校验：token → SHA-256 → auth_sessions.token_hash 查找；过期 / revoked / 用户停用都视为未登录
 *
 * 中间件挂上的 req.user 包含基础字段（id / name / roles / currentStoreId），
 * 进一步的门店列表等让 handler 自己再去查（保持中间件轻）
 */
import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { COOKIE_NAME, hashToken } from '../lib/session.js';
import { query } from '../db/index.js';
import type { AuthenticatedUser } from '../types/api.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
    sessionToken?: string;
  }
}

interface SessionLookupRow {
  user_id: string;
  display_name: string;
  status: 'active' | 'disabled';
  active_store_id: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  email: string | null;
  avatar_url: string | null;
}

export function extractToken(req: Request): string | null {
  const cookieToken =
    (req as Request & { cookies?: Record<string, string> }).cookies?.[
      COOKIE_NAME
    ] ?? null;
  if (cookieToken) return cookieToken;

  const auth = req.header('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

async function loadUserFromToken(
  token: string,
): Promise<AuthenticatedUser | null> {
  const tokenHash = hashToken(token);
  const sessionRes = await query<SessionLookupRow>(
    `SELECT s.user_id,
            u.display_name,
            u.email,
            u.avatar_url,
            u.status,
            s.active_store_id,
            s.expires_at,
            s.revoked_at
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
      WHERE s.token_hash = $1
      LIMIT 1`,
    [tokenHash],
  );
  const row = sessionRes.rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at.getTime() < Date.now()) return null;
  if (row.status !== 'active') return null;

  const rolesRes = await query<{ role: string }>(
    `SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role`,
    [row.user_id],
  );

  return {
    id: row.user_id,
    name: row.display_name,
    email: row.email ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    roles: rolesRes.rows.map((r) => r.role),
  };
}

/** 强制登录，未登录 401 */
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  void (async () => {
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
    try {
      const user = await loadUserFromToken(token);
      if (!user) {
        next(
          new AppError(
            401,
            ErrorCodes.TOKEN_INVALID,
            'Session not found or expired',
          ),
        );
        return;
      }
      req.user = user;
      req.sessionToken = token;
      next();
    } catch (err) {
      next(err);
    }
  })();
}

/** 可选登录：无 token 直接 next；token 无效也直接 next（不挂 user） */
export function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  void (async () => {
    const token = extractToken(req);
    if (!token) {
      next();
      return;
    }
    try {
      const user = await loadUserFromToken(token);
      if (user) {
        req.user = user;
        req.sessionToken = token;
      }
      next();
    } catch (err) {
      // optional 鉴权失败不阻塞请求
      next();
      void err;
    }
  })();
}
