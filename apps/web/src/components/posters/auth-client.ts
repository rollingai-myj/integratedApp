/**
 * Adapted for 统一应用：原 poster repo 是独立 SPA，这文件管自己的 JWT + localStorage。
 * 整合后登录在 host 路由（/login）完成 → 统一 cookie sso_token；
 * 这里只剩 host-bridge → PosterApp 的"用户/门店变了"通知通道，
 * 不再保留 signIn / signOut（PosterApp 内的旧账密登录页已删）。
 */
import { getHostContext } from './host-bridge';

type User = { id: string; email: string; display_name?: string };
type Session = { user: User; token: string };
type AuthCallback = (session: Session | null) => void;

const listeners = new Set<AuthCallback>();

function buildSession(): Session | null {
  const ctx = getHostContext();
  if (!ctx) return null;
  return {
    user: {
      id: ctx.userId,
      email: ctx.userEmail ?? '',
      display_name: ctx.userName,
    },
    token: 'host-session',
  };
}

export const authClient = {
  getSession(): Session | null {
    return buildSession();
  },

  onAuthStateChange(cb: AuthCallback) {
    listeners.add(cb);
    queueMicrotask(() => cb(buildSession()));
    return {
      subscription: {
        unsubscribe() {
          listeners.delete(cb);
        },
      },
    };
  },

  notifyHostContextChanged() {
    const sess = buildSession();
    listeners.forEach((cb) => cb(sess));
  },
};
