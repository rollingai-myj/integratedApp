/**
 * @myj/shared
 *
 * 前后端共享的 TypeScript 类型定义。M0 仅放最基础的接口契约；
 * 后续里程碑（M1+）按模块逐步补充。
 */

// ---- 通用错误 ----

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

// ---- 健康检查 ----

export interface HealthResponse {
  status: 'ok';
  version: string;
}

// ---- 当前用户（GET /api/v1/auth/me）----

export interface CurrentUser {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  roles: string[];
}

export interface CurrentStore {
  storeId: string;
  storeLabel: string;
  storeType: string | null;
}

export interface MeResponse {
  user: CurrentUser | null;
  currentStore: CurrentStore | null;
  stores: Array<{
    storeId: string;
    storeLabel: string;
    isPrimary: boolean;
  }>;
  feishuLinked: boolean;
  modules: Array<'shelves' | 'prices' | 'posters' | 'admin'>;
}
