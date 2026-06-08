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
  /** 角色列表，如 ['shop_owner', 'super_admin'] */
  roles: string[];
  /** 当前激活的门店编号（可选） */
  currentStoreId?: string | null;
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

/** /api/v1/auth/me 在 M0 的返回结构 */
export interface MeResponse {
  user: AuthenticatedUser | null;
  currentStore: { id: string; name: string } | null;
  stores: Array<{ id: string; name: string }>;
  feishuLinked: boolean;
  modules: string[];
}

/** /api/v1/health 返回结构 */
export interface HealthResponse {
  status: 'ok';
  version: string;
}
