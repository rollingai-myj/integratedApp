/**
 * admin-web 鉴权:复用与 apps/web 同一套后端
 *
 * - 登录:POST /api/v1/auth/login(legacy_account + password)→ 下发 session cookie
 * - 当前用户:GET /api/v1/auth/me
 * - 登出:POST /api/v1/auth/logout
 *
 * 准入条件:super_admin 角色。非超管登录后 me 也能拿到,但 AppShell 会拦截跳到无权页。
 */
import { apiFetch } from './api';

export interface AdminUser {
  id: string;
  name: string;
  email?: string | null;
  avatarUrl?: string | null;
  roles: string[];
}

interface LoginResponse {
  user: AdminUser;
  expiresAt: string;
}

interface MeResponse {
  authenticated: boolean;
  user?: AdminUser;
}

export async function login(account: string, password: string): Promise<AdminUser> {
  const res = await apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account, password }),
  });
  return res.user;
}

export async function fetchMe(): Promise<AdminUser | null> {
  const res = await apiFetch<MeResponse>('/auth/me');
  if (!res.authenticated || !res.user) return null;
  return res.user;
}

export async function logout(): Promise<void> {
  await apiFetch<void>('/auth/logout', { method: 'POST' });
}

export function isSuperAdmin(user: AdminUser | null | undefined): boolean {
  return !!user?.roles.includes('super_admin');
}
