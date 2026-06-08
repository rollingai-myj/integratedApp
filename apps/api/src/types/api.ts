/**
 * 后端 API 类型 —— 全部来自 @myj/shared
 *
 * 在 packages/shared 是 single source of truth，本文件只是 re-export 给后端用，
 * 顺便加几个仅服务端用的辅助类型（如鉴权中间件挂载的 user 形态）。
 */
export type {
  ApiErrorBody,
  HealthResponse,
  CurrentUser,
  StoreRef,
  ModuleKey,
  AuthNotice,
  MeResponse,
  LoginRequest,
  LoginResponse,
  FeishuAuthorizeResponse,
  FeishuExchangeRequest,
  FeishuJsapiConfigResponse,
  PortalModulesResponse,
  PortalStoresResponse,
  SwitchStoreRequest,
  SwitchStoreResponse,
  // M2/M3/M4 — UI 对接所需契约
  StoreDetail,
  ProductRow,
  StoreSkuRow,
  ListStoresResponse,
  ListStoreSkusResponse,
  PriceCurvePoint,
  PriceCurveSku,
  PriceCurveResponse,
  PriceChangeRecord,
  SubmitPriceChangeRequest,
  SubmitPriceChangeResponse,
  DiagnoseSkuResult,
  DiagnoseBatchResponse,
  PosterTemplate,
  PosterMode,
  PosterGenerateRequest,
  PosterRecord,
  PosterGenerateResponse,
  PosterListResponse,
  PromotionUpload,
  ProductPromotion,
  PromotionGroupRow,
  ActivePromotionsResponse,
  RecommendPromotionsResponse,
  ShelfConfig,
  ListShelfConfigsResponse,
  SceneDefinition,
  SceneAdjustmentItem,
  SceneAdjustment,
  SceneAdjustmentCount,
  ListScenesResponse,
  ListSceneAdjustmentCountsResponse,
} from '@myj/shared';

import type { CurrentUser } from '@myj/shared';

/** 中间件挂在 req.user 上的鉴权主体（仅服务端用） */
export type AuthenticatedUser = CurrentUser & {
  /** 服务端可选附加：当前会话激活的门店 ID（middleware 不挂；handler 自己查） */
  currentStoreId?: string | null;
};

/** 统一错误响应体（与 ApiErrorBody 同形，仅给 errorHandler 用） */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

/** 统一成功响应体（可选包裹；多数路由直接返 data） */
export interface ApiSuccessResponse<T> {
  data: T;
  requestId?: string;
}
