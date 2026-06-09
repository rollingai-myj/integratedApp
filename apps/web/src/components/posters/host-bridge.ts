/**
 * 桥接原 poster repo 的 vanilla 模块（auth-client、recent、ai 等）和
 * 统一应用的 React session。
 *
 * 原 poster repo 是独立 SPA，自带 localStorage JWT auth。
 * 接到统一应用后，用户登录在 host 路由（/login）已完成，poster-app 子树只需
 * 透传 host 的当前用户 + 当前门店即可。
 *
 * 入口路由 `/posters` 在 mount 时调 setHostContext(...) 把 useMe() 的结果灌进来；
 * 所有 vanilla shim（@/lib/*.functions、auth-client 等）从这里读。
 */

export interface HostContext {
  userId: string;
  userName: string;
  userEmail: string | null;
  storeId: string | null;
  storeCode: string | null;
  storeName: string | null;
  isSuperAdmin: boolean;
}

let current: HostContext | null = null;

export function setHostContext(ctx: HostContext | null): void {
  current = ctx;
}

export function getHostContext(): HostContext | null {
  return current;
}

export function requireHostContext(): HostContext {
  if (!current) {
    throw new Error('host-bridge: 未设置上下文（确认 /posters 路由调过 setHostContext）');
  }
  return current;
}
