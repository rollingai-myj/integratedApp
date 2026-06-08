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
    mutationFn: (code: string) =>
      authApi.feishuExchange({ code, client: 'browser' }),
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

/** Hook：切店 — 成功后失效所有业务 query（数据都是按当前门店缓存的） */
export function useSwitchStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SwitchStoreRequest) => portalApi.switchStore(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
      // 业务模块的 query 都按当前 session 门店取，切店后必须重新拉
      await qc.invalidateQueries({ queryKey: ['skus'] });
      await qc.invalidateQueries({ queryKey: ['shelves'] });
      await qc.invalidateQueries({ queryKey: ['scenes'] });
      await qc.invalidateQueries({ queryKey: ['prices'] });
      await qc.invalidateQueries({ queryKey: ['posters'] });
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
