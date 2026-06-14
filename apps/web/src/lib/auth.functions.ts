/**
 * Shim：兼容原 poster repo 引用的 @/lib/auth.functions
 *
 * 原 repo 用 TanStack Start 的 createServerFn 把这些函数包成 server function。
 * 我们这边已经有自己的 /api/v1/auth/* + session cookie，所以这里把同名 export
 * 实现成：① 走 host-bridge 拿当前用户身份；② 用 fetch 调统一后端接口。
 *
 * 这样 poster-app 子树（components/posters/**）不需要改一行 import。
 */
import { getHostContext } from '@/components/posters/host-bridge';

interface ServerFnInput<T> {
  data?: T;
}

// ── login：兼容老签名，但实际登录走 host 路由的 /login 页，这里只是占位 ───────
export interface LoginInput {
  email: string;
  password: string;
}
export interface LoginResult {
  token: string;
  user: { id: string; email: string; display_name?: string };
}

/**
 * 老 poster repo 的 login() 通过 createServerFn 实现，前端 LoginScreen 调它后存 JWT。
 * 整合到统一应用后，登录由 host 完成（/login 页面 → 统一 cookie），
 * poster-app 内部不再触发自己的登录流程（auth-client.ts 已重写为读 host）。
 * 这个 shim 仅为保留 import 路径兼容，被调直接抛错提示走 host。
 */
export async function login(_input: ServerFnInput<LoginInput>): Promise<LoginResult> {
  throw new Error('请在统一应用的 /login 页面登录');
}

// ── recordLogin：no-op（host 已经在 sys_audit_events 写过 user_login） ────────────
export async function recordLogin(_input?: ServerFnInput<{ storeId?: string | null }>): Promise<{ ok: true }> {
  return { ok: true };
}

// ── getMyRole：从 host context 读 ────────────────────────────────────────
export interface GetMyRoleResult {
  isSuperAdmin: boolean;
  roles: string[];
}
export async function getMyRole(): Promise<GetMyRoleResult> {
  const ctx = getHostContext();
  if (!ctx) return { isSuperAdmin: false, roles: [] };
  const roles = ctx.isSuperAdmin ? ['super_admin'] : ['store_owner'];
  return { isSuperAdmin: ctx.isSuperAdmin, roles };
}
