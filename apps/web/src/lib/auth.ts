/**
 * 认证状态（基于 @tanstack/react-query 缓存 /auth/me）
 *
 * M0 只暴露最小接口；M1 接通飞书后会扩展更多状态。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, ApiError } from './api-client.js';
import type { MeResponse } from '@myj/shared';

const ME_QUERY_KEY = ['auth', 'me'] as const;

/** Hook：当前登录用户（含门店、可访问模块） */
export function useMe() {
  return useQuery<MeResponse>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => authApi.me(),
    staleTime: 60_000, // 1 分钟内不重复拉
    retry: (failureCount, err) => {
      // 401 不重试
      if (err instanceof ApiError && err.status === 401) return false;
      return failureCount < 2;
    },
  });
}

/** Hook：退出登录（成功后失效 me 缓存） */
export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    try {
      await authApi.logout();
    } finally {
      await qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    }
  };
}

/** 判断是否已登录（基于 /auth/me 的返回） */
export function isAuthenticated(me: MeResponse | undefined): boolean {
  return !!me?.user;
}
