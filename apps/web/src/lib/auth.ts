/**
 * 认证状态（基于 @tanstack/react-query 缓存 /auth/me）
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { authApi, portalApi, ApiError } from './api-client.js';
import type {
  LoginRequest,
  MeResponse,
  SwitchStoreRequest,
} from '@myj/shared';

const ME_QUERY_KEY = ['auth', 'me'] as const;
const STORES_QUERY_KEY = ['portal', 'stores'] as const;

/** Hook：当前登录用户（含门店、可访问模块） */
export function useMe() {
  return useQuery<MeResponse>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => authApi.me(),
    staleTime: 60_000,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && err.status === 401) return false;
      return failureCount < 2;
    },
  });
}

/** Hook：账密登录（成功后失效 me 缓存） */
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => authApi.login(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

/** Hook：飞书 code 兑换登录 */
export function useFeishuExchange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { code: string; state?: string }) =>
      authApi.feishuExchange({ ...vars, client: 'browser' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

/** Hook：可见门店列表（仅在已登录且多店时使用） */
export function useVisibleStores() {
  return useQuery({
    queryKey: STORES_QUERY_KEY,
    queryFn: () => portalApi.stores(),
    staleTime: 5 * 60_000,
  });
}

/** Hook：切店 */
export function useSwitchStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SwitchStoreRequest) => portalApi.switchStore(body),
    onSuccess: async () => {
      // 切店是全局上下文变更：scenes / runtime / store skus 等所有按 storeId 隔离
      // 的 query 缓存键里没有 storeId，不清掉会把上家店的数据带到新店。
      //
      // 注意：不能直接 qc.removeQueries() 全清 —— 那会把 ME 的 cache 条目也删掉，
      // 紧跟的 invalidateQueries(ME) 找不到 entry → useMe 观察者卡 pending、
      // HomePage 走 isAuthenticated=false 分支被踢到登录页。
      // 所以只清 auth/portal 之外的（即按 storeId 隔离的那一坨），ME 走 invalidate 让 useMe 立刻 refetch。
      qc.removeQueries({
        predicate: (q) =>
          q.queryKey[0] !== 'auth' && q.queryKey[0] !== 'portal',
      });
      await qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
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
      await qc.invalidateQueries({ queryKey: STORES_QUERY_KEY });
    }
  };
}

/** 判断是否已登录（基于 /auth/me 的返回） */
export function isAuthenticated(me: MeResponse | undefined): boolean {
  return !!me?.user;
}
