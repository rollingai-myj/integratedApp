/**
 * 选品域 AI 业务层
 *
 * 把 4 个 Dify 工作流（align/selection/questions/virtual-shelf）按业务语义封装：
 *   - 拼 inputs（结合 store / scene / runtime / 周边 POI）
 *   - 触发流式调用
 *   - SSE 透传给前端
 *   - 在 workflow_finished 之后落库（虚拟陈列历史）
 *
 * 端点形态：业务端点（POST /scenes/:scene/ai/...）；前端不再直调 Dify proxy。
 */
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { streamDifyWorkflow, difyService, type DifyWorkflow } from './dify.service.js';
import { query } from '../db/index.js';
import { searchAround, AMAP_COMPETITOR_TYPES, AMAP_CROWD_TYPES, type AmapPoi } from './amap.service.js';
import { listStoreSkus } from './store-skus.service.js';
import { getSceneRuntime, type AdjustmentItem } from './scene.service.js';
import { computeBenchmarkForScene } from './benchmark.service.js';
import { ossService } from './oss.service.js';
import {
  getCachedPoi, writeCachedPoi, upsertStoreInsight, replaceSurveyQuestions,
} from './surveys.service.js';
import { logger } from '../lib/logger.js';
import type { SceneDef } from './hq.service.js';

/** YYYY-MM-DD in Asia/Shanghai（容器 TZ 通常是 UTC，UTC 0~8 时本地已经是次日，用 en-CA + TZ 保证不漂） */
function todayInShanghai(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

interface BuildContext {
  storeId: string;
  scene: number;
  /** 仅审计用,build*Inputs 内部不消费;ensureXxx 走 fire-and-forget 路径时无 user 上下文,可省 */
  userId?: string;
}

interface StoreContext {
  city: string | null;
  province: string | null;
  isProjectStore: boolean;
  location: string | null;     // "lng,lat"
}

async function loadStoreCtx(storeId: string): Promise<StoreContext> {
  const res = await query<{
    city: string | null;
    province: string | null;
    is_project_store: boolean;
    latitude: string | null;
    longitude: string | null;
  }>(
    `SELECT city, province, is_project_store, latitude, longitude
       FROM stores WHERE id = $1 LIMIT 1`,
    [storeId],
  );
  const r = res.rows[0];
  if (!r) throw new Error('门店不存在');
  return {
    city: r.city,
    province: r.province,
    isProjectStore: r.is_project_store,
    location:
      r.latitude && r.longitude ? `${Number(r.longitude)},${Number(r.latitude)}` : null,
  };
}

interface StoreProfile {
  storeCode: string;
  storeName: string;
  storeArea: number | null;
  isProjectStore: boolean;
  poiCategory: string | null;
  openDate: string | null;
  province: string | null;
  city: string | null;
}

/**
 * Dify inputs.store_profile：门店档案投影（字段名按 Dify 端约定 camelCase）。
 * - storeArea: stores.store_area_sqm (numeric → number)
 * - openDate:  stores.opened_at (date → YYYY-MM-DD)
 * - 其他字段直传字符串/布尔
 */
async function loadStoreProfile(storeId: string): Promise<StoreProfile> {
  const res = await query<{
    store_code: string;
    store_name: string;
    store_area_sqm: string | null;
    is_project_store: boolean;
    poi_category: string | null;
    opened_at: Date | string | null;
    province: string | null;
    city: string | null;
  }>(
    `SELECT store_code, store_name, store_area_sqm, is_project_store, poi_category,
            opened_at, province, city
       FROM stores WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [storeId],
  );
  const r = res.rows[0];
  if (!r) throw new Error('门店不存在');
  return {
    storeCode: r.store_code,
    storeName: r.store_name,
    storeArea: r.store_area_sqm == null ? null : Number(r.store_area_sqm),
    isProjectStore: r.is_project_store,
    poiCategory: r.poi_category,
    openDate:
      r.opened_at instanceof Date
        ? `${r.opened_at.getFullYear()}-${String(r.opened_at.getMonth() + 1).padStart(2, '0')}-${String(r.opened_at.getDate()).padStart(2, '0')}`
        : r.opened_at,
    province: r.province,
    city: r.city,
  };
}

async function loadSceneDef(scene: number): Promise<SceneDef | null> {
  const res = await query<{
    scene: number;
    name: string;
    cat_code: string | null;
    cat_name: string | null;
  }>(
    `SELECT s.scene, s.category_name AS name, c.category_code AS cat_code, c.category_name AS cat_name
       FROM hq_categories s
       LEFT JOIN hq_categories c ON c.parent_id = s.id AND c.level = 1 AND c.is_active
      WHERE s.level = 0 AND s.scene = $1
   ORDER BY c.display_order`,
    [scene],
  );
  if (res.rows.length === 0) return null;
  const first = res.rows[0]!;
  return {
    scene: first.scene,
    name: first.name,
    categories: res.rows
      .filter((r) => r.cat_code)
      .map((r) => ({ code: r.cat_code!, name: r.cat_name ?? r.cat_code! })),
  };
}

/**
 * Dify inputs.sku_attributes：场景全量 active 商品 + 20 字段属性（V026 三新列：tags / market_min_price / market_min_price_source）。
 *   - 字段命名按用户给的示例：大部分 camelCase；`is_whitelisted`/`allocation_unit`/`introduced_at` 三个保持 snake_case
 *   - tags 是 TEXT[]，node-pg 自动映成 string[]，被 serializeInputs 时变成自然 JSON 数组
 *   - introduced_at 走 YYYY-MM-DD（容器 TZ UTC）→ pg 把 DATE 当 Date 实例返回，自己手动格式化
 *   - 与 store_sku_data / benchmark_sku_data 故意拆开：sku_attributes 只承载主数据属性，销量指标在另两个字段
 */
async function buildSkuAttributes(scene: number): Promise<{ items: unknown[] }> {
  const res = await query<{
    sku_code: string;
    product_name: string;
    spec: string | null;
    unit: string | null;
    brand: string | null;
    l1: string | null;
    l2: string | null;
    l3: string | null;
    shelf_life_days: number | null;
    tags: string[] | null;
    wholesale_price: string | null;
    suggested_retail_price: string | null;
    market_min_price: string | null;
    market_min_price_source: string | null;
    is_new_product: boolean;
    is_whitelisted: boolean;
    is_returnable: boolean | null;
    is_private_label: boolean;
    allocation_unit: number | null;
    introduced_at: Date | string | null;
  }>(
    `SELECT p.sku_code, p.product_name, p.spec, p.unit, p.brand,
            fn_category_ancestor_name(p.category_id, 1::smallint) AS l1,
            fn_category_ancestor_name(p.category_id, 2::smallint) AS l2,
            fn_category_ancestor_name(p.category_id, 3::smallint) AS l3,
            p.shelf_life_days, p.tags,
            p.wholesale_price, p.suggested_retail_price,
            p.market_min_price, p.market_min_price_source,
            p.is_new_product, p.is_whitelisted, p.is_returnable, p.is_private_label,
            p.allocation_unit, p.introduced_at
       FROM hq_products p
      WHERE p.deleted_at IS NULL
        AND p.status = 'active'::product_status
        AND fn_category_scene(p.category_id) = $1
   ORDER BY p.sku_code`,
    [scene],
  );
  const items = res.rows.map((r) => ({
    skuCode: r.sku_code,
    skuName: r.product_name,
    spec: r.spec,
    unit: r.unit,
    brand: r.brand,
    majorCategory: r.l1,
    midCategory: r.l2,
    subCategory: r.l3,
    shelfLifeDays: r.shelf_life_days,
    tags: r.tags ?? [],
    wholesalePrice: r.wholesale_price == null ? null : Number(r.wholesale_price),
    suggestedPrice: r.suggested_retail_price == null ? null : Number(r.suggested_retail_price),
    marketMinPrice: r.market_min_price == null ? null : Number(r.market_min_price),
    marketMinPriceSource: r.market_min_price_source,
    isNew: r.is_new_product,
    is_whitelisted: r.is_whitelisted,
    isReturnable: r.is_returnable ?? false,
    isPrivate: r.is_private_label,
    allocation_unit: r.allocation_unit,
    introduced_at:
      r.introduced_at instanceof Date
        ? `${r.introduced_at.getFullYear()}-${String(r.introduced_at.getMonth() + 1).padStart(2, '0')}-${String(r.introduced_at.getDate()).padStart(2, '0')}`
        : r.introduced_at,
  }));
  return { items };
}

/**
 * Dify inputs.store_sku_data：本店本场景销售指标（瘦版,只 4 个字段）。
 * 跟 sku_attributes 用 skuCode 关联;Dify 端 join。
 */
async function loadStoreSkuMetrics(
  storeId: string,
  scene: number,
): Promise<{ items: unknown[] }> {
  const skus = await listStoreSkus({ storeId, scene });
  const items = skus.map((s) => ({
    skuCode: s.skuCode,
    sales30d: s.salesRealamt30d != null ? s.salesRealamt30d.toFixed(2) : '0',
    salesVolume30d: s.salesQty30d != null ? String(s.salesQty30d) : '0',
    psdChange: s.psdHb30d != null ? String(s.psdHb30d) : '0',
  }));
  return { items };
}

interface StructuredPoi {
  category: string | null;
  top_competitors: unknown[];
  competitor_analysis: string | null;
  crowd_source_analysis: string | null;
}

/**
 * Dify inputs.poi_data：从 store_insights 直接读 4 字段（V015 已建好）。
 *   - top_competitors 是 JSONB（pg-node 自动 parse 成 array），保持原结构透传
 *   - 没有 insight 记录 → 全空（store_insights 是登录时按 store 兜底，但极端情况可能缺）
 */
async function loadStructuredPoi(storeId: string): Promise<StructuredPoi> {
  const res = await query<{
    category: string | null;
    top_competitors: unknown[] | null;
    competitor_analysis: string | null;
    crowd_source_analysis: string | null;
  }>(
    `SELECT category, top_competitors, competitor_analysis, crowd_source_analysis
       FROM store_insights WHERE store_id = $1 LIMIT 1`,
    [storeId],
  );
  const r = res.rows[0];
  return {
    category: r?.category ?? null,
    top_competitors: Array.isArray(r?.top_competitors) ? r!.top_competitors : [],
    competitor_analysis: r?.competitor_analysis ?? null,
    crowd_source_analysis: r?.crowd_source_analysis ?? null,
  };
}

/**
 * 虚拟陈列图工作流的 sku_json：中文键名、数值类型，按 Dify Studio 定义字段顺序。
 * 与 buildSkuData 故意分开 —— align/selection 工作流仍依赖英文 majorCategory/midCategory 做去重。
 *
 * delta：调改清单的差量。virtual-shelf 工作流要看的是"调改后的货架"，所以：
 *   - removeSkuCodes: 本店已存在但本次"停止进货"的，要从 sku_json 里剔掉
 *   - addSkuCodes: 本次"上架新品"的，store_sku_snapshots 还没有它，从 hq_products 取基础数据补进来；
 *     新品没有 30 日销量历史 → 数值字段填 0（Dify 占位即可）
 */
async function buildSkuJsonForVirtualShelf(
  storeId: string,
  scene: number,
  delta: { addSkuCodes: string[]; removeSkuCodes: string[] },
): Promise<unknown[]> {
  const skus = await listStoreSkus({ storeId, scene });
  const removeSet = new Set(delta.removeSkuCodes);
  const kept = skus.filter((s) => !removeSet.has(s.skuCode));
  const existing = new Set(kept.map((s) => s.skuCode));
  const newCodes = delta.addSkuCodes.filter((c) => !existing.has(c));

  const baseRows = kept.map((s) => ({
    商品代码: s.skuCode,
    商品名称: s.productName,
    大类: s.categoryL1Name ?? '',
    中类: s.categoryL2Name ?? '',
    品牌: s.brand ?? '',
    单位: s.unit ?? '',
    宽cm: s.widthCm,
    高cm: s.heightCm,
    小类: s.categoryL3Name ?? '',
    '30日销售量': s.salesQty30d ?? 0,
    '30日销售额': s.salesRealamt30d ?? 0,
  }));

  if (newCodes.length === 0) return baseRows;

  // 新品在本店 store_sku_snapshots 里还没有；从 hq_products 直接取，大/中/小类同样走
  // fn_category_ancestor_name(category_id, level) 三个函数调用而不是 split。
  const newRows = await query<{
    sku_code: string;
    product_name: string;
    brand: string | null;
    unit: string | null;
    width_cm: string | null;
    height_cm: string | null;
    cat_l1: string | null;
    cat_l2: string | null;
    cat_l3: string | null;
  }>(
    `SELECT p.sku_code, p.product_name, p.brand, p.unit,
            p.width_cm, p.height_cm,
            fn_category_ancestor_name(p.category_id, 1::smallint) AS cat_l1,
            fn_category_ancestor_name(p.category_id, 2::smallint) AS cat_l2,
            fn_category_ancestor_name(p.category_id, 3::smallint) AS cat_l3
       FROM hq_products p
      WHERE p.sku_code = ANY($1::text[]) AND p.deleted_at IS NULL`,
    [newCodes],
  );
  const addedRows = newRows.rows.map((r) => ({
    商品代码: r.sku_code,
    商品名称: r.product_name,
    大类: r.cat_l1 ?? '',
    中类: r.cat_l2 ?? '',
    品牌: r.brand ?? '',
    单位: r.unit ?? '',
    宽cm: r.width_cm != null ? Number(r.width_cm) : null,
    高cm: r.height_cm != null ? Number(r.height_cm) : null,
    小类: r.cat_l3 ?? '',
    '30日销售量': 0,
    '30日销售额': 0,
  }));
  return [...baseRows, ...addedRows];
}

/** 周边环境摘要：来自 store_scene_state.env_*，无则取 store_insights 兜底 */
async function loadEnvSummary(
  storeId: string,
  scene: number,
): Promise<{ crowd: string | null; competitor: string | null }> {
  const rt = await getSceneRuntime(storeId, scene);
  if (rt?.envCrowd || rt?.envCompetitor) {
    return { crowd: rt.envCrowd, competitor: rt.envCompetitor };
  }
  const ins = await query<{ crowd: string | null; comp: string | null }>(
    `SELECT crowd_source_analysis AS crowd, competitor_analysis AS comp
       FROM store_insights WHERE store_id = $1 LIMIT 1`,
    [storeId],
  );
  return {
    crowd: ins.rows[0]?.crowd ?? null,
    competitor: ins.rows[0]?.comp ?? null,
  };
}

/** 勘误清单：作为 selection 的"避免再推"提示 */
async function loadCorrectionMemos(
  storeId: string,
  scene: number,
): Promise<{ items: unknown[] }> {
  const res = await query<{
    sku_code: string;
    kind: string;
    reason_code: string;
    reason_text: string | null;
  }>(
    `SELECT sku_code, correction_kind AS kind, reason_code, reason_text
       FROM store_sku_corrections
      WHERE store_id = $1 AND scene = $2 AND correction_scope = 'decision'
   ORDER BY submitted_at DESC LIMIT 50`,
    [storeId, scene],
  );
  return {
    items: res.rows.map((r) => ({
      skuCode: r.sku_code,
      kind: r.kind,
      reasonCode: r.reason_code,
      reasonText: r.reason_text ?? '',
    })),
  };
}

function summarizePois(pois: ReadonlyArray<AmapPoi | unknown>): { items: unknown[] } {
  return {
    items: pois.map((raw) => {
      const p = raw as Partial<AmapPoi>;
      return {
        name: p.name,
        type: p.type,
        typecode: p.typecode,
        address: p.address,
        location: p.location,
        business: p.business,
      };
    }),
  };
}

/**
 * 拉门店 600m 内的高德 POI。命中 store_insights.poi_data 缓存则直接返回；
 * 未命中则实时调高德 + 写回缓存，下次 buildQuestionsInputs / buildInsightInputs 复用。
 * 想强制刷新就传 force=true（目前未在路由层暴露，留给后续手动刷新按钮用）。
 */
async function getOrFetchPoi(args: {
  storeId: string;
  location: string;
  force?: boolean;
}): Promise<{ competitor: unknown[]; crowdSource: unknown[] }> {
  if (!args.force) {
    const cached = await getCachedPoi(args.storeId);
    if (cached) return { competitor: cached.competitor, crowdSource: cached.crowdSource };
  }
  const [competitor, crowdSource] = await Promise.all([
    searchAround({ location: args.location, radius: 600, types: AMAP_COMPETITOR_TYPES }),
    searchAround({ location: args.location, radius: 600, types: AMAP_CROWD_TYPES }),
  ]);
  await writeCachedPoi(args.storeId, {
    competitor,
    crowdSource,
    fetchedAt: new Date().toISOString(),
  });
  return { competitor, crowdSource };
}

/** 用户问卷答案（聊一聊的回答），结构 [{ question, answer }, ...] */
async function loadSurveyAnswers(
  storeId: string,
  scene: number,
): Promise<{ items: unknown[] }> {
  const res = await query<{
    question: string;
    value: unknown;
  }>(
    `SELECT q.question_text AS question, a.answer_value AS value
       FROM store_survey_questions q
       JOIN LATERAL (
         SELECT answer_value FROM store_survey_answers
          WHERE question_id = q.id
          ORDER BY answered_at DESC LIMIT 1
       ) a ON true
      WHERE q.store_id = $1 AND q.scene = $2
   ORDER BY q.question_no`,
    [storeId, scene],
  );
  return {
    items: res.rows.map((r) => ({ question: r.question, answer: r.value })),
  };
}

// ---- 业务端点：拼 inputs ---------------------------------------------------

/**
 * Dify align / selection 工作流 inputs（V026 起重构 / 与旧字段不兼容）：
 *
 *   sku_attributes      场景全量 active 商品 + 20 字段属性（含 tags / market_min_price 等 V026 新字段）
 *   store_sku_data      本店本场景销售指标（4 字段，按 skuCode 与 sku_attributes 关联）
 *   benchmark_sku_data  跨店归一化平均销量指标（4 字段，同上）
 *   store_profile       门店档案（stores 表 8 字段投影）
 *   poi_data            周边洞察（store_insights：category / top_competitors / competitor_analysis / crowd_source_analysis）
 *   question_answers    店长问答（已有，{items:[{question, answer}]}）
 *   current_date        Asia/Shanghai 时区今日 YYYY-MM-DD
 *   major_category      本场景所属 L1 大类标签集（hq_categories 中 scene 直属 L1 子节点 name），
 *                       多个用英文逗号连接;让 Dify prompt 可以点名"当前场景的大类"
 *   align 多一个 photos(Files 数组,远程 URL 形式)
 *
 * 已删除的旧字段：sku_data / mid_category / whitelist / new_product_skus
 *   - 白名单信息现在以每 SKU 的 is_whitelisted 标记表达（Dify 端自己 filter）
 *   - 新品同理：每 SKU 的 isNew 标记
 *   - 中/小类集合：每 SKU 都带 midCategory / subCategory，Dify 自己 distinct
 *
 * 全部顶层字段在 Dify Studio 端 type=text；dify.service.ts:serializeInputs 会把对象/数组自动 JSON.stringify。
 */
async function buildCommonInputs(ctx: BuildContext): Promise<Record<string, unknown>> {
  const [skuAttr, storeSku, benchmarkRich, storeProfile, poi, qa, sceneDef] = await Promise.all([
    buildSkuAttributes(ctx.scene),
    loadStoreSkuMetrics(ctx.storeId, ctx.scene),
    computeBenchmarkForScene(ctx.storeId, ctx.scene),
    loadStoreProfile(ctx.storeId),
    loadStructuredPoi(ctx.storeId),
    loadSurveyAnswers(ctx.storeId, ctx.scene),
    loadSceneDef(ctx.scene),
  ]);
  // benchmark.service.ts 还返回富 row（含 skuName / 三级 category / spec），这里 trim 到 4 字段对齐 store_sku_data
  const benchmarkSku = {
    items: benchmarkRich.map((b) => ({
      skuCode: b.skuCode,
      sales30d: b.sales30d,
      salesVolume30d: b.salesVolume30d,
      psdChange: b.psdChange,
    })),
  };
  // 场景所属 L1 大类标签;多个大类用英文逗号连接(Dify 工作流要在 prompt 里点名当前场景的大类)
  const majorCategory = (sceneDef?.categories ?? [])
    .map((c) => c.name.trim())
    .filter((s) => s.length > 0)
    .join(',');
  return {
    sku_attributes: skuAttr,
    store_sku_data: storeSku,
    benchmark_sku_data: benchmarkSku,
    store_profile: storeProfile,
    poi_data: poi,
    question_answers: qa,
    current_date: todayInShanghai(),
    major_category: majorCategory,
  };
}

export async function buildAlignInputs(
  ctx: BuildContext,
  photoUrls: string[],
): Promise<Record<string, unknown>> {
  const common = await buildCommonInputs(ctx);
  // 前端拿到的 photoUrl 是反代 URL（/api/v1/storage/oss-image?key=...）
  // Dify 在外网拉不到反代，必须把它转回 OSS 直链。
  // photos 走 Dify "Files" 数组,允许一次诊断多张照片。
  return {
    photos: photoUrls.map((u) => ({
      transfer_method: 'remote_url',
      url: ossService.toExternalUrl(u),
      type: 'image',
    })),
    ...common,
  };
}

export async function buildStrategyInputs(
  ctx: BuildContext,
): Promise<Record<string, unknown>> {
  return buildCommonInputs(ctx);
}

export async function buildVirtualShelfInputs(args: {
  storeId: string;
  scene: number;
  /** 应用调改后传入；服务端自动拉取 */
}): Promise<Record<string, unknown>> {
  // virtual-shelf 在 applyAdjustment 之后触发：拿最近一笔 store_scene_adjustments
  // 算 add/remove 差量，喂给 sku_json，让陈列图反映"调改后"的货架。
  const adjItems = await query<{ items: AdjustmentItem[] | null }>(
    `SELECT items FROM store_scene_adjustments
      WHERE store_id = $1 AND scene = $2
   ORDER BY triggered_at DESC LIMIT 1`,
    [args.storeId, args.scene],
  );
  const items = adjItems.rows[0]?.items ?? [];
  const delta = {
    addSkuCodes: items.filter((i) => i.action === 'add').map((i) => i.skuCode),
    removeSkuCodes: items.filter((i) => i.action === 'remove').map((i) => i.skuCode),
  };
  const [skuJson, def, shelves, promo] = await Promise.all([
    buildSkuJsonForVirtualShelf(args.storeId, args.scene, delta),
    loadSceneDef(args.scene),
    query<{ width_cm: string | null; layer_count: number | null }>(
      `SELECT width_cm, layer_count FROM store_scene_shelves
        WHERE store_id = $1 AND scene = $2 ORDER BY group_index`,
      [args.storeId, args.scene],
    ),
    buildPromoMap(args.scene),
  ]);
  const widths = shelves.rows.map((r) => (r.width_cm ? Number(r.width_cm) : 75));
  const layers = shelves.rows.map((r) => r.layer_count ?? 5);
  return {
    scene_code: String(args.scene),
    category: def?.categories[0]?.name ?? '',
    shelf_width: widths,
    shelf_layers: layers,
    sku_json: skuJson,
    promo,
    store_id: args.storeId,
  };
}

/**
 * Dify virtual-shelf 入参 promo:本场景大类(L1)目前有效的会员价活动,
 * 按 promo_group_code 分组 → 每组列出参与的 sku_code 与原始优惠描述。
 *
 * 取数:
 *   - 表 hq_promo_raw_items × hq_promo_batches(过滤掉已作废 batch)
 *   - activity_type = 'member_price'
 *   - category_code 命中场景的 L1 集合(loadSceneDef.categories[].code)
 *   - promo_group_code / raw_method_text 都非空(分组键 + 文案必须存在)
 *
 * 结构(Dify 那边 text 字段接收,后续会被 serializeInputs 整体 JSON.stringify):
 *   { "<promo_group_code>": { "<sku_code>": "<raw_method_text>" } }
 */
async function buildPromoMap(scene: number): Promise<Record<string, Record<string, string>>> {
  const def = await loadSceneDef(scene);
  const codes = (def?.categories ?? [])
    .map((c) => c.code)
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
  if (codes.length === 0) return {};

  const res = await query<{
    group_code: string;
    sku_code: string;
    raw_method_text: string;
  }>(
    `SELECT r.promo_group_code AS group_code,
            r.sku_code,
            r.raw_method_text
       FROM hq_promo_raw_items r
       JOIN hq_promo_batches b ON b.id = r.batch_id
      WHERE r.activity_type = 'member_price'
        AND NOT b.is_voided
        AND r.promo_group_code IS NOT NULL
        AND r.raw_method_text IS NOT NULL
        AND r.category_code = ANY($1::text[])
      ORDER BY r.promo_group_code, r.sku_code`,
    [codes],
  );

  const map: Record<string, Record<string, string>> = {};
  for (const r of res.rows) {
    if (!map[r.group_code]) map[r.group_code] = {};
    map[r.group_code]![r.sku_code] = r.raw_method_text;
  }
  return map;
}

export async function buildQuestionsInputs(args: {
  storeId: string;
  scene: number;
}): Promise<Record<string, unknown>> {
  const store = await loadStoreCtx(args.storeId);
  const def = await loadSceneDef(args.scene);
  // Dify questions 工作流的条件分支用 13 个场景规范名（糖巧/冷藏/...）做精确匹配，
  // 必须传场景级 category_name（def.name），不能传 categories[0]（那是大类名）。
  const scene = def?.name ?? '';
  if (!store.location) {
    logger.warn({ storeId: args.storeId }, 'questions: 门店缺经纬度，POI 跳过');
    return {
      competitor: { items: [] },
      crowdSource: { items: [] },
      scene,
    };
  }
  const { competitor, crowdSource } = await getOrFetchPoi({
    storeId: args.storeId,
    location: store.location,
  });
  return {
    competitor: summarizePois(competitor),
    crowdSource: summarizePois(crowdSource),
    scene,
  };
}

// ---- 登录触发：确保 store_insights + 各场景问卷 完整 -----------------------

/**
 * 列出该 store 在 store_sku_snapshots 里**实际有数据**的场景集合。
 * 跟前端"有数据就能进"对齐:登录时给这些场景预生成问卷,没数据的场景跳过,
 * 不浪费 Dify token 去给空场景拉问题。
 *
 * 场景归属来自 fn_category_scene(category_id),与 listStoreSkus 同口径。
 */
async function listScenesWithData(storeId: string): Promise<number[]> {
  const res = await query<{ scene: number }>(
    `SELECT DISTINCT fn_category_scene(p.category_id)::int AS scene
       FROM store_sku_snapshots s
       JOIN hq_products p ON p.id = s.product_id
      WHERE s.store_id = $1
        AND fn_category_scene(p.category_id) IS NOT NULL`,
    [storeId],
  );
  return res.rows.map((r) => r.scene).filter((n) => Number.isFinite(n));
}

/** Dify questions workflow outputs.text 兼容字符串 / 对象，再剥 ```json 围栏 / <think> 等 */
function tryParseDifyValue(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw !== 'string') return raw;
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { return null; }
    }
    return null;
  }
}

interface ParsedQuestion {
  questionText: string;
  questionKind: 'single' | 'multi' | 'text';
  options: string[];
}

function normalizeQuestion(raw: unknown): ParsedQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const text = String(o.question ?? o.questionText ?? o.text ?? '').trim();
  if (!text) return null;
  const options = Array.isArray(o.options)
    ? o.options.map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];
  const kindRaw = String(o.questionKind ?? o.kind ?? '').toLowerCase();
  const questionKind: 'single' | 'multi' | 'text' =
    kindRaw === 'multi' ? 'multi'
      : kindRaw === 'text' ? 'text'
      : kindRaw === 'single' ? 'single'
      // 没指明就按选项数兜底：>2 算多选
      : options.length > 2 ? 'multi' : 'single';
  return { questionText: text, questionKind, options };
}

function extractQuestions(outputs: Record<string, unknown>): ParsedQuestion[] {
  const candidates: unknown[] = [
    outputs.result, outputs.questions, outputs.output, outputs.text, outputs,
  ];
  for (const c of candidates) {
    const v = tryParseDifyValue(c);
    if (Array.isArray(v)) {
      const out = v.map(normalizeQuestion).filter((q): q is ParsedQuestion => q !== null);
      if (out.length) return out;
    } else if (v && typeof v === 'object') {
      const arr = (v as Record<string, unknown>).questions;
      if (Array.isArray(arr)) {
        const out = arr.map(normalizeQuestion).filter((q): q is ParsedQuestion => q !== null);
        if (out.length) return out;
      }
    }
  }
  return [];
}

/** 同进程内"正在跑 ensure"的店 + scene 去重键 */
const sceneQuestionsInFlight = new Set<string>();

/**
 * 登录触发：确保 (storeId, scene) 已有问卷题目。
 *
 * 流程：已有任意题目 → 跳过；否则调 Dify questions blocking → parse → replaceSurveyQuestions(userId=null)。
 * 失败只 warn 不抛；下次登录再试。
 * 依赖 store.location（buildQuestionsInputs 内部已校验，缺则返回空 POI inputs 让 Dify 自己处理）。
 */
export async function ensureSceneQuestions(storeId: string, scene: number): Promise<void> {
  const key = `${storeId}:${scene}`;
  if (sceneQuestionsInFlight.has(key)) return;
  sceneQuestionsInFlight.add(key);
  try {
    const cur = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM store_survey_questions
        WHERE store_id = $1 AND scene = $2`,
      [storeId, scene],
    );
    if (Number(cur.rows[0]?.n ?? 0) > 0) return;

    const inputs = await buildQuestionsInputs({ storeId, scene });
    let outputs: Record<string, unknown>;
    try {
      outputs = await difyService.invoke('questions', inputs, { userId: `bootstrap:${storeId}` });
    } catch (err) {
      logger.warn({ err, storeId, scene }, 'ensureSceneQuestions: Dify questions 调用失败');
      return;
    }
    const questions = extractQuestions(outputs);
    if (questions.length === 0) {
      logger.warn({ storeId, scene, outputs }, 'ensureSceneQuestions: Dify 输出无有效题目');
      return;
    }
    await replaceSurveyQuestions({
      storeId, scene, questions, source: 'ai', userId: null,
    });
    logger.info({ storeId, scene, count: questions.length }, 'ensureSceneQuestions: 题目已填充');
  } catch (err) {
    logger.warn({ err, storeId, scene }, 'ensureSceneQuestions 异常');
  } finally {
    sceneQuestionsInFlight.delete(key);
  }
}

// ---- 登录触发：确保 store_insights 完整 -----------------------------------

/**
 * Dify insight 工作流 outputs.text 解析：
 *   - 可能是 object：`{ category, crowdSource_analysis, top_competitors, competitor_analysis }`
 *   - 可能是 string：需先整段 JSON.parse
 * 字段名做映射（Dify 用 crowdSource_analysis，DB 用 crowd_source_analysis）。
 */
function parseInsightOutput(outputs: Record<string, unknown>): {
  category: string | null;
  crowdSourceAnalysis: string | null;
  competitorAnalysis: string | null;
  topCompetitors: unknown;
} | null {
  const raw = outputs.text;
  let obj: Record<string, unknown> | null = null;
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return null;
  const pick = (k: string): string | null => {
    const v = obj![k];
    return typeof v === 'string' ? v : null;
  };
  return {
    category: pick('category'),
    crowdSourceAnalysis: pick('crowdSource_analysis') ?? pick('crowd_source_analysis'),
    competitorAnalysis: pick('competitor_analysis'),
    topCompetitors: Array.isArray(obj.top_competitors) ? obj.top_competitors : [],
  };
}

/** 同进程内"正在跑 ensure"的店；防同会话短时多次切店触发重复 Dify 调用 */
const insightInFlight = new Set<string>();

/**
 * 登录 / 切店触发：确保 store_insights 的 poi_data 和 4 字段都已填充。
 *
 * 流程：
 *  1. 读 store_insights（poi_data / category）当前状态
 *  2. poi_data 空 → 调高德 + 写回（getOrFetchPoi 内部封装）
 *  3. category 空 → 调 Dify insight workflow（blocking）→ 解析 outputs.text →
 *     upsertStoreInsight 落 4 字段
 *
 * 全过程 fire-and-forget：失败只 warn 不抛；下次切店再试。
 * 门店缺经纬度时跳过 POI 与 Dify（高德 around 必填 location）。
 */
export async function ensureStoreInsight(storeId: string): Promise<void> {
  if (insightInFlight.has(storeId)) return;
  insightInFlight.add(storeId);
  try {
    // 1. 读现状
    const cur = await query<{
      poi_data: { competitor?: unknown; crowdSource?: unknown } | null;
      category: string | null;
    }>(
      `SELECT poi_data, category FROM store_insights WHERE store_id = $1 LIMIT 1`,
      [storeId],
    );
    const row = cur.rows[0];
    const poiOk =
      !!row?.poi_data &&
      Array.isArray(row.poi_data.competitor) &&
      Array.isArray(row.poi_data.crowdSource);
    const categoryOk = !!row?.category;
    if (poiOk && categoryOk) return;

    // 2. 加载门店上下文（POI / Dify 都需要）
    const store = await loadStoreCtx(storeId);
    if (!store.location) {
      logger.info({ storeId }, 'ensureStoreInsight: 门店缺经纬度，跳过');
      return;
    }

    // 3. POI 缺则补
    if (!poiOk) {
      try {
        await getOrFetchPoi({ storeId, location: store.location, force: true });
        logger.info({ storeId }, 'ensureStoreInsight: poi_data 已填充');
      } catch (err) {
        logger.warn({ err, storeId }, 'ensureStoreInsight: POI 抓取失败，跳过 Dify');
        return;
      }
    }

    if (categoryOk) return;

    // 4. 4 字段缺 → 调 Dify insight 智能体（blocking）
    const cachedPoi = await getCachedPoi(storeId);
    if (!cachedPoi) {
      logger.warn({ storeId }, 'ensureStoreInsight: 拿不到 cached POI，跳过 Dify');
      return;
    }
    const inputs = {
      competitor: { items: cachedPoi.competitor },
      crowdSource: { items: cachedPoi.crowdSource },
    };
    let outputs: Record<string, unknown>;
    try {
      outputs = await difyService.invoke('insight', inputs, { userId: `bootstrap:${storeId}` });
    } catch (err) {
      logger.warn({ err, storeId }, 'ensureStoreInsight: Dify insight 调用失败');
      return;
    }

    const parsed = parseInsightOutput(outputs);
    if (!parsed?.category) {
      logger.warn({ storeId, outputs }, 'ensureStoreInsight: Dify 输出解析失败/缺 category');
      return;
    }
    await upsertStoreInsight(storeId, parsed);
    logger.info({ storeId, category: parsed.category }, 'ensureStoreInsight: 4 字段已填充');
  } catch (err) {
    logger.warn({ err, storeId }, 'ensureStoreInsight 异常');
  } finally {
    insightInFlight.delete(storeId);
  }
}

/**
 * 登录到该门店的统一引导任务：洞察（POI + 4 字段）+ 该门店有数据场景的问卷题目。
 * 由 portal.switchActiveStore / auth.loginWith* fire-and-forget 调用；
 * 串行执行避免 Dify 并发挤兑，整体失败也不抛（内部函数都已自吞）。
 *
 * 哪些场景"开放" 早期是 hard-code [2, 12],现已改成动态查 store_sku_snapshots,
 * 跟前端 HomePage/prices.index 的"有数据就能进"对齐。
 */
export async function runStoreLoginBootstrap(storeId: string): Promise<void> {
  await ensureStoreInsight(storeId);
  let scenes: number[] = [];
  try {
    scenes = await listScenesWithData(storeId);
  } catch (err) {
    logger.warn({ err, storeId }, 'runStoreLoginBootstrap: listScenesWithData 失败,跳过问卷预生成');
    return;
  }
  for (const scene of scenes) {
    await ensureSceneQuestions(storeId, scene);
  }
}

// ============================================================================
// V028: align / selection / virtual-shelf 三个 Dify 工作流的后台 ensureXxx 范式
//
// 替换前端 fetch SSE → 浏览器 IIFE 读流 模式 — 关 tab/刷新页面会丢任务状态。
// 沿用 ensureStoreInsight / ensureSceneQuestions 的 fire-and-forget + 自吞错误 + in-flight
// Set 去重 + status enum 持久化 + raw outputs JSONB 落库 范式。
// ============================================================================

// ---- 输出解析(与 frontend sse.ts 同构,确保 string/object 双形态都能解) -----

function padSkuCode(v: unknown): string {
  const s = String(v ?? '').trim();
  if (/^\d+$/.test(s) && s.length < 8) return s.padStart(8, '0');
  return s;
}

interface DiagnosisStatusItem {
  midCategory: string;
  salesPct: number;
  dailyAvgVolume: number;
  headline: string;
  description: string;
}
interface DiagnosisResult {
  /** 客群标签列表(原长文本现已拆为单标签数组) */
  paragraphCustomer: string[];
  /** 每个中类的现状卡 */
  paragraphStatus: DiagnosisStatusItem[];
  /** 季节/时机说明 */
  paragraphSeason: string;
  /** 一句话总结(展示时字号最大) */
  summary: string;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => String(x ?? '').trim()).filter((s) => s.length > 0);
  }
  // 兼容 Dify 偶尔输出顿号/逗号拼接的字符串
  if (typeof v === 'string') {
    return v.split(/[、,，;；\n]+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function toNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[¥,，%\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normalizeStatusItems(v: unknown): DiagnosisStatusItem[] {
  const arr = Array.isArray(v) ? v : (typeof v === 'object' && v !== null ? [v] : []);
  return arr
    .map((raw): DiagnosisStatusItem | null => {
      if (!raw || typeof raw !== 'object') return null;
      const r = raw as Record<string, unknown>;
      const midCategory = String(r.midCategory ?? r.mid_category ?? r['中类'] ?? '').trim();
      const headline = String(r.headline ?? r['标题'] ?? '').trim();
      const description = String(r.description ?? r['描述'] ?? '').trim();
      if (!midCategory && !headline && !description) return null;
      return {
        midCategory,
        headline,
        description,
        salesPct: toNumber(r.salesPct ?? r.sales_pct ?? r['销售额占比']),
        dailyAvgVolume: toNumber(r.dailyAvgVolume ?? r.daily_avg_volume ?? r['日均销量']),
      };
    })
    .filter((x): x is DiagnosisStatusItem => x !== null);
}

function extractDiagnosis(outputs: Record<string, unknown>): DiagnosisResult | null {
  const candidates: unknown[] = [
    outputs.Diagnosis, outputs.diagnosis, outputs.result, outputs.text, outputs,
  ];
  for (const c of candidates) {
    const v = tryParseDifyValue(c);
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const inner = (o.diagnosis && typeof o.diagnosis === 'object' && !Array.isArray(o.diagnosis))
      ? (o.diagnosis as Record<string, unknown>)
      : o;
    const paragraphCustomer = toStringArray(inner.paragraph_customer ?? inner.paragraphCustomer);
    const paragraphStatus = normalizeStatusItems(inner.paragraph_status ?? inner.paragraphStatus);
    const paragraphSeason = String(inner.paragraph_season ?? inner.paragraphSeason ?? '').trim();
    const summary = String(inner.summary ?? inner['总结'] ?? '').trim();
    if (paragraphCustomer.length || paragraphStatus.length || paragraphSeason || summary) {
      return { paragraphCustomer, paragraphStatus, paragraphSeason, summary };
    }
  }
  return null;
}

interface StrategyItem {
  skuCode: string;
  skuName: string;
  spec: string;
  action: string;
  tags: string[];
  reason: string;
  avg90DaySales: string;
}
interface StrategyResult { name: string; description: string; items: StrategyItem[] }

function looksLikeStrategy(o: unknown): o is Record<string, unknown> {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const r = o as Record<string, unknown>;
  return (
    Array.isArray(r.skus) || Array.isArray(r['SKU列表']) ||
    typeof r.name === 'string' || typeof r['策略名称'] === 'string'
  );
}
function coerceStrategyList(v: unknown): Record<string, unknown>[] | null {
  const parsed = tryParseDifyValue(v);
  if (parsed == null) return null;
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (looksLikeStrategy(parsed)) return [parsed];
  return null;
}
function normalizeStrategy(item: Record<string, unknown>): StrategyResult {
  const skusRaw = (Array.isArray(item.skus) ? item.skus
    : Array.isArray(item['SKU列表']) ? item['SKU列表']
    : []) as Array<Record<string, unknown>>;
  return {
    name: String(item.name ?? item['策略名称'] ?? ''),
    description: String(item.description ?? item['策略描述'] ?? ''),
    items: skusRaw.map((s) => ({
      skuCode: padSkuCode(s.skuCode ?? s['商品代码']),
      skuName: String(s.skuName ?? s['商品名称'] ?? ''),
      spec: String(s.spec ?? s['规格'] ?? ''),
      action: String(s.action ?? s['建议动作'] ?? ''),
      tags: Array.isArray(s.tags) ? (s.tags as string[]).map(String) : [],
      reason: String(s.reason ?? s['理由'] ?? ''),
      avg90DaySales: String(s.avg90DaySales ?? s['日均销量'] ?? ''),
    })),
  };
}

/**
 * 用 hq_products 给 Dify selection 输出里 spec 为空的 SKU 兜底填规格。
 * Dify selection 工作流当前 spec 几乎总回 ""(产品名里也常没拼),前端在"全新上架"(本店 + 参考店都没快照)的品上拿不到任何 spec 兜底,导致卡片只展示纯名称。
 */
async function enrichStrategySpecs(items: StrategyItem[]): Promise<void> {
  const needCodes = Array.from(new Set(items.filter((i) => !i.spec).map((i) => i.skuCode)));
  if (needCodes.length === 0) return;
  const res = await query<{ sku_code: string; spec: string | null }>(
    `SELECT sku_code, spec FROM hq_products
      WHERE sku_code = ANY($1::text[]) AND deleted_at IS NULL`,
    [needCodes],
  );
  const specByCode = new Map(res.rows.map((r) => [r.sku_code, r.spec ?? '']));
  for (const it of items) {
    if (!it.spec) it.spec = specByCode.get(it.skuCode) ?? '';
  }
}

function extractStrategy(outputs: Record<string, unknown>): StrategyResult | null {
  for (const key of ['Selection', 'ShelfAiResult', 'SelectionResult', 'result', 'text', 'output']) {
    const list = coerceStrategyList(outputs[key]);
    if (list && list.length) return normalizeStrategy(list[0]!);
  }
  const self = coerceStrategyList(outputs);
  if (self && self.length) return normalizeStrategy(self[0]!);
  for (const v of Object.values(outputs)) {
    const list = coerceStrategyList(v);
    if (list && list.length) return normalizeStrategy(list[0]!);
  }
  return null;
}

function extractVirtualShelf(outputs: Record<string, unknown>): unknown {
  for (const key of ['VirtualShelf', 'virtual_shelf', 'result', 'text']) {
    const v = tryParseDifyValue(outputs[key]);
    if (v != null) return v;
  }
  return outputs;
}

// ---- 通用状态写入辅助 ---------------------------------------------------

export type AiStatusKind = 'diagnose' | 'strategy' | 'virtual';
type AiStatusColumn = AiStatusKind;
const STATUS_COL: Record<AiStatusColumn, { status: string; raw: string }> = {
  diagnose: { status: 'diagnose_status', raw: 'diagnose_raw_outputs' },
  strategy: { status: 'strategy_status', raw: 'strategy_raw_outputs' },
  virtual:  { status: 'virtual_status',  raw: 'virtual_raw_outputs'  },
};

async function setAiStatus(
  storeId: string, scene: number, col: AiStatusColumn,
  status: 'processing' | 'completed' | 'failed' | 'idle',
  rawOutputs: unknown,
): Promise<void> {
  const c = STATUS_COL[col];
  await query(
    `UPDATE store_scene_state
        SET ${c.status} = $1::scene_virtual_status,
            ${c.raw}    = $2::jsonb,
            updated_at  = now()
      WHERE store_id = $3 AND scene = $4`,
    [status, rawOutputs == null ? null : JSON.stringify(rawOutputs), storeId, scene],
  );
}

async function readAiStatus(
  storeId: string, scene: number, col: AiStatusColumn,
): Promise<string | null> {
  const c = STATUS_COL[col];
  const res = await query<{ s: string | null }>(
    `SELECT ${c.status} AS s FROM store_scene_state
      WHERE store_id = $1 AND scene = $2 LIMIT 1`,
    [storeId, scene],
  );
  return res.rows[0]?.s ?? null;
}

/**
 * 触发路由用:返回 202 之前把状态同步推到 'processing'。
 * 之前 trigger 路由是 fire-and-forget,ensureXxx 自己写 'processing' 状态,导致前端
 * 立刻 invalidateQueries 时常拿到旧的 'failed' 而覆盖乐观更新 — 出现"按钮要点两次才生效"。
 * 这里把状态写入卡在路由 200 之前,前端任何后续 GET 都看得到 'processing'。
 */
export async function markAiStatusProcessing(
  storeId: string, scene: number, kind: AiStatusKind,
): Promise<void> {
  await setAiStatus(storeId, scene, kind, 'processing', null);
}

// ---- ensureDiagnose / ensureStrategy / ensureVirtualShelf -----------------

const diagnoseInFlight = new Set<string>();
const strategyInFlight = new Set<string>();
const virtualShelfInFlight = new Set<string>();

/**
 * 触发 Dify align (三段诊断) 后台任务。
 * 幂等:status='processing' 或 'completed' 直接跳过 — 想重跑需先 applyAdjustment 或显式重置。
 * 失败:status='failed' + raw_outputs={error: msg}
 */
export async function ensureDiagnose(
  storeId: string, scene: number, photoUrls: string[], difyUser: string,
): Promise<void> {
  const key = `${storeId}:${scene}`;
  if (diagnoseInFlight.has(key)) return;
  diagnoseInFlight.add(key);
  try {
    const status = await readAiStatus(storeId, scene, 'diagnose');
    // 只跳过已完成的;'processing' 可能是路由层刚同步推上去的(见 markAiStatusProcessing),
    // 进程内并发由 diagnoseInFlight 锁拦截,这里不再因为 status='processing' 误跳。
    if (status === 'completed') return;

    await setAiStatus(storeId, scene, 'diagnose', 'processing', null);
    const inputs = await buildAlignInputs({ storeId, scene }, photoUrls);

    let outputs: Record<string, unknown>;
    try {
      outputs = await difyService.invoke('align', inputs, { userId: difyUser });
    } catch (err) {
      logger.warn({ err, storeId, scene }, 'ensureDiagnose: Dify align 调用失败');
      await setAiStatus(storeId, scene, 'diagnose', 'failed', { error: (err as Error).message });
      return;
    }
    const parsed = extractDiagnosis(outputs);
    await setAiStatus(storeId, scene, 'diagnose', 'completed', { raw: outputs, parsed });
    logger.info({ storeId, scene }, 'ensureDiagnose: 已完成');
  } catch (err) {
    logger.warn({ err, storeId, scene }, 'ensureDiagnose 异常');
    await setAiStatus(storeId, scene, 'diagnose', 'failed', { error: (err as Error).message })
      .catch(() => {});
  } finally {
    diagnoseInFlight.delete(key);
  }
}

/**
 * 触发 Dify selection (选品策略) 后台任务。
 * 用照片不需要,跟 ensureDiagnose 同时由前端"开始调改"触发。
 */
export async function ensureStrategy(storeId: string, scene: number, difyUser: string): Promise<void> {
  const key = `${storeId}:${scene}`;
  if (strategyInFlight.has(key)) return;
  strategyInFlight.add(key);
  try {
    const status = await readAiStatus(storeId, scene, 'strategy');
    // 只跳过已完成的;'processing' 可能是路由层刚同步推上去的,见 markAiStatusProcessing。
    if (status === 'completed') return;

    await setAiStatus(storeId, scene, 'strategy', 'processing', null);
    const inputs = await buildStrategyInputs({ storeId, scene });

    let outputs: Record<string, unknown>;
    try {
      outputs = await difyService.invoke('selection', inputs, { userId: difyUser });
    } catch (err) {
      logger.warn({ err, storeId, scene }, 'ensureStrategy: Dify selection 调用失败');
      await setAiStatus(storeId, scene, 'strategy', 'failed', { error: (err as Error).message });
      return;
    }
    const parsed = extractStrategy(outputs);
    // Dify selection 输出的 spec 字段经常空 — 但 hq_products 里 canonical spec 都有。
    // 后端这里一次性兜底,避免 FE 在 storeSku/benchmark 都没命中的"全新上架"品上拼不出规格。
    if (parsed?.items.length) await enrichStrategySpecs(parsed.items);
    await setAiStatus(storeId, scene, 'strategy', 'completed', { raw: outputs, parsed });
    logger.info({ storeId, scene, itemCount: parsed?.items.length ?? 0 }, 'ensureStrategy: 已完成');
  } catch (err) {
    logger.warn({ err, storeId, scene }, 'ensureStrategy 异常');
    await setAiStatus(storeId, scene, 'strategy', 'failed', { error: (err as Error).message })
      .catch(() => {});
  } finally {
    strategyInFlight.delete(key);
  }
}

/**
 * 触发 Dify virtual-shelf (虚拟陈列示意图) 后台任务。
 * 用 applyAdjustment 之后的调改差量;耗时 5~10 分钟,virtualStatus='processing' 期间
 * LastPage 显示加载态;成功 → completed + raw_outputs,前端读 raw_outputs.parsed 渲染。
 */
export async function ensureVirtualShelf(storeId: string, scene: number, difyUser: string): Promise<void> {
  const key = `${storeId}:${scene}`;
  if (virtualShelfInFlight.has(key)) return;
  virtualShelfInFlight.add(key);
  try {
    // virtual 不靠 status 判断幂等 —— 只依赖进程内 in-flight 锁;允许重跑(applyAdjustment 已
    // reset 到 idle,触发路由也可能刚刚 markAiStatusProcessing 把 status 推到 processing)。
    await setAiStatus(storeId, scene, 'virtual', 'processing', null);
    const inputs = await buildVirtualShelfInputs({ storeId, scene });

    let outputs: Record<string, unknown>;
    try {
      outputs = await difyService.invoke('virtual-shelf', inputs, { userId: difyUser });
    } catch (err) {
      logger.warn({ err, storeId, scene }, 'ensureVirtualShelf: Dify virtual-shelf 调用失败');
      await setAiStatus(storeId, scene, 'virtual', 'failed', { error: (err as Error).message });
      return;
    }
    const parsed = extractVirtualShelf(outputs);
    await setAiStatus(storeId, scene, 'virtual', 'completed', { raw: outputs, parsed });
    logger.info({ storeId, scene }, 'ensureVirtualShelf: 已完成');
  } catch (err) {
    logger.warn({ err, storeId, scene }, 'ensureVirtualShelf 异常');
    await setAiStatus(storeId, scene, 'virtual', 'failed', { error: (err as Error).message })
      .catch(() => {});
  } finally {
    virtualShelfInFlight.delete(key);
  }
}

// ---- SSE 透传 -------------------------------------------------------------

/**
 * 触发 Dify 流式工作流，直接 pipeline 给前端。
 * 调用方应预先设置 SSE 响应头。
 */
export async function streamToClient(
  workflow: DifyWorkflow,
  inputs: Record<string, unknown>,
  userId: string,
  res: Response,
): Promise<void> {
  const upstream = await streamDifyWorkflow(workflow, inputs, { userId });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const nodeStream = Readable.fromWeb(upstream.body as any);
  try {
    await pipeline(nodeStream, res);
  } catch (err) {
    logger.warn({ err, workflow }, 'sse pipeline ended');
  }
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}
