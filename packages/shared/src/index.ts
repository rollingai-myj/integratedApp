/**
 * @myj/shared
 *
 * 前后端共享的 TypeScript 类型定义。
 * **本文件是前后端契约的 single source of truth**：
 *   - 后端 apps/api/src/types/api.ts 必须从这里复用同名 interface
 *   - 前端 apps/web/src/lib/api-client.ts 也复用
 *   - 字段命名 / 可空性变动时 → 必须从这里改，前后端同步
 */

// ============================================================================
// 通用错误
// ============================================================================

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

// ============================================================================
// 健康检查
// ============================================================================

export interface HealthResponse {
  status: 'ok';
  version: string;
}

// ============================================================================
// 模块 1 · 认证
// ============================================================================

/** 登录主体 */
export interface CurrentUser {
  /** 用户唯一 ID (UUID) */
  id: string;
  /** 显示名 */
  name: string;
  /** 邮箱（可能为空） */
  email?: string | null;
  /** 头像 URL（可能为空） */
  avatarUrl?: string | null;
  /** 角色列表，如 ['super_admin']、['store_owner'] */
  roles: string[];
}

/** 门店引用（auth/me、门店列表、切店共用） */
export interface StoreRef {
  /** 门店唯一 ID (UUID) */
  id: string;
  /** 业务编号，如 '粤37893' */
  code: string;
  /** 显示名，如 '深圳光明南店' */
  name: string;
  /** 是否为该用户的"默认门店"（无明确指定时进入这家） */
  isPrimary?: boolean;
}

export type ModuleKey = 'shelves' | 'prices' | 'posters' | 'admin';

/** 友好告警（飞书部门指向的门店未登记等场景） */
export interface AuthNotice {
  code: 'NO_STORE_MATCHED';
  message: string;
  unmatchedCandidates?: string[];
}

/** GET /api/v1/auth/me */
export interface MeResponse {
  user: CurrentUser | null;
  currentStore: StoreRef | null;
  stores: StoreRef[];
  feishuLinked: boolean;
  modules: ModuleKey[];
  notice?: AuthNotice | null;
}

/** POST /api/v1/auth/login */
export interface LoginRequest {
  account: string;
  password: string;
}

/** POST /api/v1/auth/login + POST /api/v1/auth/feishu/exchange */
export interface LoginResponse {
  user: CurrentUser;
  /** ISO 时间戳，方便前端做"会话快过期"提示 */
  expiresAt: string;
  notice?: AuthNotice | null;
}

/** GET /api/v1/auth/feishu/authorize */
export interface FeishuAuthorizeResponse {
  authorizeUrl: string;
  state: string;
}

/** POST /api/v1/auth/feishu/exchange */
export interface FeishuExchangeRequest {
  code: string;
  state?: string;
  client?: 'feishu_h5' | 'feishu_pc' | 'browser';
}

/** GET /api/v1/auth/feishu/jsapi-config?url= */
export interface FeishuJsapiConfigResponse {
  appId: string;
  timestamp: number;
  nonceStr: string;
  signature: string;
}

// ============================================================================
// 模块 2 · 门户 (Portal)
// ============================================================================

/** GET /api/v1/portal/modules — 当前用户可访问的模块 + 是否启用 */
export interface PortalModulesResponse {
  modules: Array<{
    key: ModuleKey;
    label: string;
    enabled: boolean;
    /** 禁用原因（启用时为 null） */
    disabledReason?: string | null;
  }>;
}

/** GET /api/v1/portal/stores — 当前用户可访问的门店列表（超管 = 全部） */
export interface PortalStoresResponse {
  stores: StoreRef[];
  total: number;
}

/** POST /api/v1/portal/switch-store */
export interface SwitchStoreRequest {
  storeId: string;
}

/** POST /api/v1/portal/switch-store 响应 */
export interface SwitchStoreResponse {
  currentStore: StoreRef;
}
