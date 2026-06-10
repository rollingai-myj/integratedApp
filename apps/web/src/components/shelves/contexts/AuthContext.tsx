/**
 * AuthContext stub
 *
 * 原 repo 的 AuthContext 自己管 login/logout（sessionStorage 存 token）。整合 app
 * 走 cookie + /api/v1/auth/me，登录在外层 routes/login.tsx 处理。
 *
 * 这里仅保留 useAuth() 接口，返回 ShelvesAppShell 注入的最小用户身份，让 StoreInfoBar
 * 等老组件挂载时不抛错（v2 流程实际不用到）。
 */
import React, { createContext, useContext, type ReactNode } from 'react';

export interface AuthUser {
  account: string;
  storeId: string;
  storeLabel: string;
  isAdmin: boolean;
}

interface AuthState {
  user: AuthUser | null;
  login: (account: string, password: string) => Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be within AuthProvider');
  return ctx;
};

export const AuthProvider = ({ user, children }: { user: AuthUser | null; children: ReactNode }) => {
  const value: AuthState = {
    user,
    login: async () => ({ ok: false as const, error: '请在整合 app 的登录页登录' }),
    logout: () => {
      // 路由层处理跳转 + 调 /api/v1/auth/logout
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
