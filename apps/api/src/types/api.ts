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

/** 登录或 me 接口的友好告警（如飞书部门指向的门店尚未在系统中登记） */
export interface AuthNotice {
  code: 'NO_STORE_MATCHED';
  message: string;
  /** 飞书部门里出现但未匹配上的门店号候选 */
  unmatchedCandidates?: string[];
}

/** /api/v1/auth/me 返回结构 */
export interface MeResponse {
  user: AuthenticatedUser | null;
  currentStore: StoreRef | null;
  stores: StoreRef[];
  feishuLinked: boolean;
  /** 可见的功能模块 key：'shelves' | 'prices' | 'posters' | 'admin' */
  modules: string[];
  /** 友好告警（前端在没 store 时根据此渲染空状态卡片）；不挂出时为 null */
  notice?: AuthNotice | null;
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
  /** 飞书登录可能携带的 notice（账密登录恒为 null/undefined） */
  notice?: AuthNotice | null;
}

/** POST /api/v1/auth/feishu/exchange 请求体 */
export interface FeishuExchangeRequest {
  code: string;
  /** 客户端类型：feishu_h5 / feishu_pc / browser */
  client?: 'feishu_h5' | 'feishu_pc' | 'browser';
}

/** /api/v1/health 返回结构 */
export interface HealthResponse {
  status: 'ok';
  version: string;
}
