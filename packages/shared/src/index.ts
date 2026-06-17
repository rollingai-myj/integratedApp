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
  province: string | null;
  city: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  openedAt: string | null;
  status: 'active' | 'disabled';
  storeAreaSqm: number | null;
  poiCategory: string | null;
}

export interface ProductRow {
  id: string;
  skuCode: string;
  productName: string;
  brand: string | null;
  spec: string | null;
  unit: string | null;
  shelfLifeDays: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  categoryId: string | null;
  /** hq_categories 树递归算出的 "L1[/L2[/L3]]"；后端 fn_category_path() 实时计算 */
  categoryPath: string | null;
  /** 商品所属系列（如"经典系列"）；当前不参与业务逻辑，仅占位 */
  series: string | null;
  isNewProduct: boolean;
  isPrivateLabel: boolean;
  wholesalePrice: number | null;
  suggestedRetailPrice: number | null;
  introducedAt: string | null;
  status: 'active' | 'delisted';
}

export interface StoreSkuRow extends ProductRow {
  /** 本期实际售价（snapshot.retail_price，V027 起 snapshot 唯一价格列） */
  retailPrice: number | null;
  salesQty30d: number | null;
  salesAmount30d: number | null;
  salesQty90d: number | null;
  salesAmount90d: number | null;
  grossMargin30d: number | null;
  stockQty: number | null;
  lastDeliveryAt: string | null;
  snapshotDate: string | null;
  /** 本店该 SKU 最近一次"实际调价"的时刻（snapshot 序列里 retail_price 跳变所在的 snapshot_date）；
   *  null = 时间窗内从未跳变；V027 起从 snapshot 时间序列推导，不再读 store_price_changes */
  lastPriceChangeAt: string | null;
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

/**
 * 价盘曲线点（V027 起 snapshot 单源）：
 *   - retailPrice = snapshot.retail_price，"本期实际售价"
 *   - 涨/跌 anchor 不存字段，由前端 derive 自相邻两点 retailPrice 之差
 *   - 不再有 source / priceChangeId（不再合并 store_price_changes）
 */
export interface PriceCurvePoint {
  snapshotDate: string;
  retailPrice: number | null;
  salesQty30d: number | null;
  salesAmount30d: number | null;
  grossMargin30d: number | null;
}

export interface PriceCurveSku {
  skuCode: string;
  productName: string | null;
  /** 批发价（来自 hq_products，全期同值），用于成本线/利润计算 */
  wholesalePrice: number | null;
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
  source: 'manual' | 'rule_engine';
  effectiveDate: string;
  createdAt: string;
}

export interface SubmitPriceChangeRequest {
  skuCode: string;
  newPrice: number;
  oldPrice?: number;
  source?: 'manual' | 'rule_engine';
  note?: string;
}

export interface SubmitPriceChangeResponse {
  record: PriceChangeRecord;
}

export interface ListPriceChangesResponse {
  changes: PriceChangeRecord[];
}

// ============================================================================
// 模块 7 · 海报 (Posters)
// ============================================================================

export type PosterTemplate = 'vibrant' | 'premium' | 'minimal' | 'custom';
export type PosterMode = 'photo_compose' | 'official_bg_only' | 'multi_product';

// ---- 任务 / 生成分离模型 ----

export type PosterGenerationStatus =
  | 'queued'
  | 'claimed'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export interface PosterTaskProduct {
  productId: string;
  skuCode: string;
  displayOrder: number;
}

export interface PosterTask {
  id: string;
  batchId: string;
  userId: string;
  storeId: string;
  mode: PosterMode;
  template: PosterTemplate;
  copyText: string;
  sourcePhotoUrl: string | null;
  productImageUrl: string | null;
  customStyleDescription: string | null;
  products: PosterTaskProduct[];
  createdAt: string;
  updatedAt: string;
  latestGeneration?: PosterGeneration | null;
}

export interface PosterGeneration {
  id: string;
  taskId: string;
  attemptNo: number;
  status: PosterGenerationStatus;
  posterImageUrl: string | null;
  thumbnailUrl: string | null;
  aiModel: string | null;
  generationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  isAdopted: boolean;
  adoptedAt: string | null;
  downloadCount: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface PosterAsset {
  id: string;
  storeId: string;
  kind: 'background' | 'product_photo';
  imageUrl: string;
  uploadedBy: string | null;
  createdAt: string;
}

export interface PosterSalesTrackingItem {
  taskId: string;
  generationId: string;
  productId: string;
  skuCode: string;
  adoptedAt: string;
  beforeSnapshotDate: string | null;
  beforeSalesQty30d: number | null;
  afterSnapshotDate: string | null;
  afterSalesQty30d: number | null;
  qtyDeltaPercent: number | null;
}

export interface PosterTaskCreate {
  mode: PosterMode;
  template: PosterTemplate;
  copyText: string;
  sourcePhotoUrl?: string;
  productImageUrl?: string;
  customStyleDescription?: string;
  skuCode?: string;
  products?: Array<{ skuCode: string; displayOrder?: number }>;
  categoryName?: string;
  extras?: Record<string, unknown>;
}

export interface CreatePosterTasksRequest {
  tasks: PosterTaskCreate[];
}

export interface CreatePosterTasksResponse {
  batchId: string;
  tasks: PosterTask[];
}

export interface ListPosterTasksResponse {
  tasks: PosterTask[];
}

export interface GetPosterTaskResponse {
  task: PosterTask;
  generations: PosterGeneration[];
}

export interface AdoptPosterGenerationResponse {
  generation: PosterGeneration;
}

export interface PosterDownloadResponse {
  url: string;
  count: number;
}

export interface PosterGalleryResponse {
  generations: PosterGeneration[];
}

export interface PosterTodayCountResponse {
  count: number;
}

export interface PosterAssetUploadResponse {
  asset: PosterAsset;
}

export interface ListPosterAssetsResponse {
  assets: PosterAsset[];
}

export interface PosterSalesTrackingResponse {
  items: PosterSalesTrackingItem[];
}

// 模块 8 · 促销 (Promotions)

export type PromoActivityType =
  | 'member_price' | 'weekend_beer' | 'brand_coupon'
  | 'tuesday_member' | 'regular_coupon';

export type PromoMechanic =
  | 'flat_price' | 'bundle_price' | 'percent_discount' | 'pool_threshold';

export type PromoBundleSubtype =
  | 'fixed_total' | 'nth_ratio' | 'add_extra' | 'buy_m_get_n';

export type PromoMechanicParams =
  | { kind: 'flat_price'; target_price: number }
  | { kind: 'bundle_price'; subtype: 'fixed_total'; qty_required: number; total_price: number }
  | { kind: 'bundle_price'; subtype: 'nth_ratio'; qty_required: number; nth: number; ratio: number }
  | { kind: 'bundle_price'; subtype: 'add_extra'; qty_required: number; add_amount: number }
  | { kind: 'bundle_price'; subtype: 'buy_m_get_n'; m: number; n: number }
  | { kind: 'percent_discount'; pay_ratio: number }
  | { kind: 'pool_threshold'; threshold: number; discount: number };

export interface PromoBatch {
  id: string;
  fileName: string;
  sourceFileUrl: string | null;
  uploadedBy: string | null;
  isVoided: boolean;
  activityWindowStart: string | null;
  activityWindowEnd: string | null;
  parseWarnings: Array<{ sheet: string; row: number; reason: string; raw?: unknown }>;
  rowTotal: Record<PromoActivityType, number>;
  parsedTotal: Record<PromoActivityType, number>;
  parsedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface PromoOffer {
  id: string;
  batchId: string;
  activityType: PromoActivityType;
  skuCode: string;
  mechanic: PromoMechanic;
  mechanicParams: PromoMechanicParams;
  poolLabel: string | null;
  originalPrice: number;
  validWeekdayMask: number;
  validFrom: string;
  validTo: string;
  isStackable: boolean;
}

export interface PromoBestResult {
  skuCode: string;
  productName: string;
  unit: string | null;
  categoryName: string | null;
  originalPrice: number;
  /** base + 至多一个 add-on 组合 */
  baseOfferId: string;
  /** base 优惠的活动类型(供前端"只用会员价"等过滤) */
  baseActivityType: PromoActivityType;
  /** add-on 活动类型(若 best 选了叠加券，前端用它拼组合 label) */
  addonActivityType: PromoActivityType | null;
  addonOfferId: string | null;
  /** 单品摊销最低支付金额（套餐总价 / 件数） */
  bestUnitPrice: number;
  /** 套餐总价（base 算出来的 Q 件总价；A 机制 = 单件价） */
  bestBundleTotal: number;
  bestQty: number;
  /** 节省占比 0~1 fraction(前端要 ×100 转百分比展示) */
  bestSavingPercent: number;
  /** 池子上下文，仅 B/D 机制有 */
  poolLabel: string | null;
  poolSize: number | null;
}

export interface ActivePromotionsResponse {
  batches: PromoBatch[];
  results: PromoBestResult[];
}

export interface RecommendPromotionsResponse {
  batches: PromoBatch[];
  results: PromoBestResult[];
}

export interface UploadResult {
  batch: PromoBatch;
  warnings: Array<{ sheet: string; row: number; reason: string; raw?: unknown }>;
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
  scene: number;
  name: string;
  categories: Array<{ code: string; name: string }>;
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
