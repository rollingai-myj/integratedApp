/**
 * 会话令牌
 *
 * - 客户端持有不透明的随机 64 位 hex 字符串（cookie / Authorization Bearer）
 * - 服务端只在 user_sessions.token_hash 里存它的 SHA-256
 * - 校验时把入参 token 也哈希一遍再比对
 *
 * 选这个方案而不是 JWT 的理由：
 *   - 想随时单条 revoke（设 revoked_at），不用维护黑名单
 *   - 不需要客户端自带身份信息；当前业务规模看 DB 一次查询毫无压力
 *   - schema (V003 user_sessions) 已经预留了 token_hash 字段
 */
import { randomBytes, createHash } from 'node:crypto';
import type { CookieOptions } from 'express';
import { config } from '../config/env.js';

export const COOKIE_NAME = 'sso_token';

export function issueToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function sessionCookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    domain: config.COOKIE_DOMAIN === 'localhost' ? undefined : config.COOKIE_DOMAIN,
    maxAge: maxAgeMs,
  };
}

export function clearCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    domain: config.COOKIE_DOMAIN === 'localhost' ? undefined : config.COOKIE_DOMAIN,
  };
}
