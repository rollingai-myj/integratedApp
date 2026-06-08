/**
 * 通用 API 响应/请求类型
 */

/** 当前请求的鉴权主体 */
export interface AuthenticatedUser {
  /** 用户唯一 ID（UUID） */
  id: string;
  /** 显示名 */
  name: string;
  /** 邮箱（可选） */
  email?: string;
  /** 头像（可选） */
  avatarUrl?: string;
  /** 角色列表，如 ['store_owner']、['super_admin'] */
  roles: string[];
}

/** 门店引用（门户、auth/me、切店等共用） */
export interface StoreRef {
  id: string;
  code: string;
  name: string;
  isPrimary?: boolean;
}

/** 统一错误响应体 */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

/** 统一成功响应体（可选包裹） */
export interface ApiSuccessResponse<T> {
  data: T;
  requestId?: string;
}

/** /api/v1/auth/me 返回结构 */
export interface MeResponse {
  user: AuthenticatedUser | null;
  currentStore: StoreRef | null;
  stores: StoreRef[];
  feishuLinked: boolean;
  /** 可见的功能模块 key：'shelves' | 'prices' | 'posters' | 'admin' */
  modules: string[];
}

/** POST /api/v1/auth/login 请求体 */
export interface LoginRequest {
  account: string;
  password: string;
}

/** POST /api/v1/auth/login 响应体 */
export interface LoginResponse {
  user: AuthenticatedUser;
  /** ISO 时间戳，方便前端做"会话快过期"提示 */
  expiresAt: string;
}

/** /api/v1/health 返回结构 */
export interface HealthResponse {
  status: 'ok';
  version: string;
}
