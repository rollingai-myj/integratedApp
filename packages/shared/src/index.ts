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
  /** 城市（V029 起），如 '东莞'；Dify ALIGN/SELECTION 工作流 prompt 用 */
  city?: string | null;
  /** 是否项目店（V029 起）；项目店有定制陈列规则，Dify 工作流分支 */
  isProjectStore?: boolean;
  /** GCJ02 纬度；选品/价盘的"周边商圈洞察"调高德 v5 around 必填 */
  latitude?: number | null;
  /** GCJ02 经度；同上 */
  longitude?: number | null;
  /** 详细地址；Dify insight 工作流 prompt 也会用 */
  address?: string | null;
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

// ============================================================================
// 模块 3 + 4 · 主数据 (Master)
// ============================================================================

export interface StoreDetail {
  id: string;
  code: string;
  name: string;
  ownership: 'direct' | 'franchise';
  province: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  openedAt: string | null;
  status: 'active' | 'disabled';
}

export interface ProductRow {
  id: string;
  skuCode: string;
  productName: string;
  brand: string | null;
  spec: string | null;
  unit: string | null;
  shelfLifeDays: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  categoryId: string | null;
  /** dim_category 树递归算出的 "L1[/L2[/L3]]"；后端 fn_category_path() 实时计算 */
  categoryPath: string | null;
  /** 商品所属系列（如"经典系列"）；当前不参与业务逻辑，仅占位 */
  series: string | null;
  isNewProduct: boolean;
  isPrivateLabel: boolean;
  wholesalePrice: number | null;
  suggestedRetailPrice: number | null;
  introducedAt: string | null;
  officialImageUrl: string | null;
  status: 'active' | 'delisted';
}

export interface StoreSkuRow extends ProductRow {
  retailPrice: number | null;
  originalPrice: number | null;
  hasPriceChange: boolean;
  salesQty30d: number | null;
  salesAmount30d: number | null;
  salesQty90d: number | null;
  salesAmount90d: number | null;
  grossMargin30d: number | null;
  stockQty: number | null;
  lastDeliveryAt: string | null;
  snapshotDate: string | null;
}

export interface ListStoresResponse {
  stores: StoreDetail[];
  total: number;
}

export interface ListStoreSkusResponse {
  skus: StoreSkuRow[];
  total: number;
}

// ============================================================================
// 模块 6 · 价盘 (Prices)
// ============================================================================

export interface PriceCurvePoint {
  snapshotDate: string;
  retailPrice: number | null;
  originalPrice: number | null;
  wholesalePrice: number | null;
  salesQty30d: number | null;
  salesAmount30d: number | null;
  grossMargin30d: number | null;
  source: string;
  priceChangeId: string | null;
}

export interface PriceCurveSku {
  skuCode: string;
  productName: string | null;
  points: PriceCurvePoint[];
}

export interface PriceCurveResponse {
  curves: PriceCurveSku[];
}

export interface PriceChangeRecord {
  id: string;
  storeId: string;
  productId: string;
  skuCode: string;
  oldPrice: number | null;
  newPrice: number;
  source: 'manual' | 'ai_suggest' | 'rule_engine';
  effectiveDate: string;
  createdAt: string;
}

export interface SubmitPriceChangeRequest {
  skuCode: string;
  newPrice: number;
  oldPrice?: number;
  source?: 'manual' | 'ai_suggest' | 'rule_engine';
  note?: string;
}

export interface SubmitPriceChangeResponse {
  record: PriceChangeRecord;
}

export interface ListPriceChangesResponse {
  changes: PriceChangeRecord[];
}

export interface DiagnoseSkuResult {
  skuCode: string;
  suggestion: 'up' | 'down' | 'hold' | 'unknown';
  suggestedPrice: number | null;
  reasoning: string;
  confidence: number;
  source: string;
}

export interface DiagnoseBatchResponse {
  results: DiagnoseSkuResult[];
}

// ============================================================================
// 模块 7 · 海报 (Posters)
// ============================================================================

export type PosterTemplate = 'vibrant' | 'premium' | 'minimal' | 'custom';
export type PosterMode = 'photo_compose' | 'official_bg_only' | 'multi_product';

export interface PosterGenerateRequest {
  template: PosterTemplate;
  mode: PosterMode;
  copyText: string;
  sourcePhotoUrl?: string;
  productImageUrl?: string;
  officialImageUrls?: string[];
  customStyleDescription?: string;
  skuCode?: string;
  categoryName?: string;
}

export interface PosterRecord {
  id: string;
  jobId: string | null;
  userId: string;
  storeId: string | null;
  template: PosterTemplate;
  mode: PosterMode;
  copyText: string;
  skuCode: string | null;
  categoryName: string | null;
  posterImageUrl: string;
  thumbnailUrl: string | null;
  aiModel: string | null;
  aiPrompt: string | null;
  generationMs: number | null;
  createdAt: string;
}

export interface PosterGenerateResponse {
  poster: PosterRecord;
}

export interface PosterListResponse {
  posters: PosterRecord[];
}

// ============================================================================
// 模块 8 · 促销 (Promotions)
// ============================================================================

export interface PromotionUpload {
  id: string;
  fileName: string;
  sourceFileUrl: string | null;
  rowTotal: number;
  productCount: number;
  groupCount: number;
  isActive: boolean;
  activatedAt: string | null;
  notes: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

export interface ProductPromotionDealOption {
  label: string;
  requiredQty: number;
  totalPrice: number;
  effectiveUnitPrice: number;
  savingPercent: number;
  channel?: string;
  sources?: string[];
  promoType?: string;
  detail?: string;
  validFrom?: string | null;
  validTo?: string | null;
  validDates?: string[] | null;
  validDayOfWeek?: number[] | null;
}

export interface ProductPromotion {
  id: string;
  uploadId: string;
  rowIndex: number;
  skuCode: string;
  productName: string;
  unit: string | null;
  categoryName: string | null;
  originalPrice: number | null;
  bestLabel: string | null;
  bestRequiredQty: number | null;
  bestTotalPrice: number | null;
  bestEffectiveUnitPrice: number | null;
  bestSavingPercent: number | null;
  allOptions: ProductPromotionDealOption[] | null;
  validFrom: string | null;
  validTo: string | null;
  validDates: string[] | null;
  mixGroupCode: string | null;
  displayText: string | null;
}

export interface PromotionGroupRow {
  id: string;
  uploadId: string;
  mixGroupCode: string;
  displayName: string | null;
  categoryName: string | null;
  skuCodes: string[];
  productCount: number;
  bestLabel: string | null;
  bestTotalPrice: number | null;
  bestSavingPercent: number | null;
  representativeImageUrl: string | null;
}

export interface ActivePromotionsResponse {
  upload: PromotionUpload | null;
  products: ProductPromotion[];
  groups: PromotionGroupRow[];
}

export interface RecommendPromotionsResponse {
  upload: PromotionUpload | null;
  products: ProductPromotion[];
}

// ============================================================================
// 模块 5 · 货架/场景 (Shelves & Scenes)
// ============================================================================

export interface ShelfConfig {
  id: string;
  storeId: string;
  shelfCode: string;
  positionCode: number;
  groupName: string | null;
  widthCm: number | null;
  layerCount: number | null;
  supportedCategories: string[];
  displayOrder: number;
  notes: string | null;
  attributes: Record<string, unknown>;
}

export interface ListShelfConfigsResponse {
  configs: ShelfConfig[];
}

export interface SceneDefinition {
  positionCode: number;
  positionName: string;
  categories: Array<{ name: string; code: string | null; displayOrder: number }>;
}

export interface SceneAdjustmentCount {
  positionCode: number;
  positionName: string | null;
  remakeCount: number;
  lastRemakeAt: string | null;
}

export interface SceneAdjustmentItem {
  action: 'add' | 'remove' | 'replace';
  skuCode: string;
  productName?: string | null;
  reasonCode?: string;
  reasonText?: string | null;
}

export interface SceneAdjustment {
  id: string;
  storeId: string;
  positionCode: number;
  summaryText: string | null;
  addedCount: number;
  removedCount: number;
  replacedCount: number;
  items: SceneAdjustmentItem[];
  aiSessionId: string | null;
  triggeredBy: string | null;
  triggeredDisplay: string | null;
  triggeredAt: string;
}

export interface ListScenesResponse {
  scenes: SceneDefinition[];
}

export interface ListSceneAdjustmentCountsResponse {
  counts: SceneAdjustmentCount[];
}
