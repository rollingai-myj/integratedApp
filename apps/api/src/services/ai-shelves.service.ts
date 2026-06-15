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

/**
 * 从一组 sku items 里抽 distinct categoryLevel（用于 major_category / mid_category 顶层标签）。
 * Items 里的 `majorCategory` / `midCategory` 来自 hq_categories 的真实 L1/L2 名称
 * （见 buildSkuData：`categoryPath.split('/')`）。
 */
function distinctSkuLevel(
  items: ReadonlyArray<{ majorCategory?: string; midCategory?: string }>,
  level: 'major' | 'mid',
): string[] {
  const key = level === 'major' ? 'majorCategory' : 'midCategory';
  const seen = new Set<string>();
  for (const it of items) {
    const v = (it as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.length > 0) seen.add(v);
  }
  return Array.from(seen);
}

interface BuildContext {
  storeId: string;
  scene: number;
  userId: string;
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

/** 把 listStoreSkus 输出转成 Dify 期望的格式（与前端 fmt() 保持一致字段名） */
async function buildSkuData(storeId: string, scene: number): Promise<{ items: unknown[] }> {
  const skus = await listStoreSkus({ storeId, scene });
  const items = skus.map((s) => ({
    skuCode: s.skuCode,
    skuName: s.productName,
    spec: s.spec ?? '',
    majorCategory: (s.categoryPath ?? '').split('/')[0] ?? '',
    midCategory: (s.categoryPath ?? '').split('/')[1] ?? '',
    subCategory: (s.categoryPath ?? '').split('/')[2] ?? '',
    sales30d: s.salesAmount30d != null ? s.salesAmount30d.toFixed(2) : '0',
    salesVolume30d: s.salesQty30d != null ? String(s.salesQty30d) : '0',
    psdChangetb: s.salesAmountChange30d != null ? String(s.salesAmountChange30d) : '0',
    shelfLifeDays: null,
  }));
  return { items };
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

  const baseRows = kept.map((s) => {
    const parts = (s.categoryPath ?? '').split('/');
    return {
      商品代码: s.skuCode,
      商品名称: s.productName,
      大类: parts[0] ?? '',
      中类: parts[1] ?? '',
      品牌: s.brand ?? '',
      单位: s.unit ?? '',
      宽cm: s.widthCm,
      高cm: s.heightCm,
      小类: parts[2] ?? '',
      '30日销售量': s.salesQty30d ?? 0,
      '30日销售额': s.salesAmount30d ?? 0,
    };
  });

  if (newCodes.length === 0) return baseRows;

  const newRows = await query<{
    sku_code: string;
    product_name: string;
    brand: string | null;
    unit: string | null;
    width_cm: string | null;
    height_cm: string | null;
    cat_path: string | null;
  }>(
    `SELECT p.sku_code, p.product_name, p.brand, p.unit,
            p.width_cm, p.height_cm,
            fn_category_path(p.category_id) AS cat_path
       FROM hq_products p
      WHERE p.sku_code = ANY($1::text[]) AND p.deleted_at IS NULL`,
    [newCodes],
  );
  const addedRows = newRows.rows.map((r) => {
    const parts = (r.cat_path ?? '').split('/');
    return {
      商品代码: r.sku_code,
      商品名称: r.product_name,
      大类: parts[0] ?? '',
      中类: parts[1] ?? '',
      品牌: r.brand ?? '',
      单位: r.unit ?? '',
      宽cm: r.width_cm != null ? Number(r.width_cm) : null,
      高cm: r.height_cm != null ? Number(r.height_cm) : null,
      小类: parts[2] ?? '',
      '30日销售量': 0,
      '30日销售额': 0,
    };
  });
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
 * Dify align / selection 工作流当前期望的 inputs 字段（用户在 Dify Studio 同步给出）：
 *   通用：sku_data / major_category / mid_category / benchmark_sku_data / question_answers / poi_data
 *   align 多一个：photo
 * 其他历史字段（gapAnalysis_benchmarkOnly / sub_category / province / city / is_project_store /
 * env_crowd / env_competitor / current_date / corrections / new_product_skus / whitelist 等）
 * 都已从工作流定义里删除，传过去会被丢弃，传少了不会报错，但 Python 节点参数缺失会 TypeError。
 */
export async function buildAlignInputs(
  ctx: BuildContext,
  photoUrl: string,
): Promise<Record<string, unknown>> {
  const [sku, qa, benchmark] = await Promise.all([
    buildSkuData(ctx.storeId, ctx.scene),
    loadSurveyAnswers(ctx.storeId, ctx.scene),
    computeBenchmarkForScene(ctx.storeId, ctx.scene),
  ]);
  const skuItems = sku.items as Array<{ majorCategory?: string; midCategory?: string }>;
  // 前端拿到的 photoUrl 是反代 URL（/api/v1/storage/oss-image?key=...）
  // Dify 在外网拉不到反代，必须把它转回 OSS 直链。
  return {
    photo: { transfer_method: 'remote_url', url: ossService.toExternalUrl(photoUrl), type: 'image' },
    sku_data: sku,
    // major_category = 当前 SKU 集涉及的大类 L1，mid_category = 中类 L2，distinct 去重逗号串。
    // 之前 mid_category 错塞 L1 列表 → Dify 拿到错误的"中类"，对位/选品判断走偏。
    major_category: distinctSkuLevel(skuItems, 'major').join(','),
    mid_category: distinctSkuLevel(skuItems, 'mid').join(','),
    // benchmark = 其他门店该场景 L1 类目的加权销量基准，
    // 由 benchmark.service.ts 即时算出（latest snapshot + sales_amount 加权）。
    benchmark_sku_data: { items: benchmark },
    question_answers: qa,
    poi_data: '',
  };
}

export async function buildStrategyInputs(
  ctx: BuildContext,
): Promise<Record<string, unknown>> {
  const [sku, qa, benchmark] = await Promise.all([
    buildSkuData(ctx.storeId, ctx.scene),
    loadSurveyAnswers(ctx.storeId, ctx.scene),
    computeBenchmarkForScene(ctx.storeId, ctx.scene),
  ]);
  const skuItems = sku.items as Array<{ majorCategory?: string; midCategory?: string }>;
  return {
    sku_data: sku,
    major_category: distinctSkuLevel(skuItems, 'major').join(','),
    mid_category: distinctSkuLevel(skuItems, 'mid').join(','),
    benchmark_sku_data: { items: benchmark },
    question_answers: qa,
    poi_data: '',
  };
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
  const [skuJson, def, shelves] = await Promise.all([
    buildSkuJsonForVirtualShelf(args.storeId, args.scene, delta),
    loadSceneDef(args.scene),
    query<{ width_cm: string | null; layer_count: number | null }>(
      `SELECT width_cm, layer_count FROM store_scene_shelves
        WHERE store_id = $1 AND scene = $2 ORDER BY group_index`,
      [args.storeId, args.scene],
    ),
  ]);
  const widths = shelves.rows.map((r) => (r.width_cm ? Number(r.width_cm) : 75));
  const layers = shelves.rows.map((r) => r.layer_count ?? 5);
  return {
    scene_code: String(args.scene),
    category: def?.categories[0]?.name ?? '',
    shelf_width: widths,
    shelf_layers: layers,
    sku_json: skuJson,
    promo: {},
    store_id: args.storeId,
  };
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

export async function buildInsightInputs(args: {
  storeId: string;
}): Promise<Record<string, unknown>> {
  const store = await loadStoreCtx(args.storeId);
  if (!store.location) {
    return { competitor: { items: [] }, crowdSource: { items: [] } };
  }
  const { competitor, crowdSource } = await getOrFetchPoi({
    storeId: args.storeId,
    location: store.location,
  });
  return {
    competitor: summarizePois(competitor),
    crowdSource: summarizePois(crowdSource),
  };
}

// ---- 登录触发：确保 store_insights + 各场景问卷 完整 -----------------------

/**
 * 已开放给用户使用的场景。与前端 HomePage ENABLED_SCENES 保持一致。
 * 登录时只对这些场景预生成问卷题目，未开放场景不调 Dify 浪费 token。
 */
export const ENABLED_SCENES: ReadonlyArray<number> = [2, 12];

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
 * 登录到该门店的统一引导任务：洞察（POI + 4 字段）+ 已开放场景的问卷题目。
 * 由 portal.switchActiveStore / auth.loginWith* fire-and-forget 调用；
 * 串行执行避免 Dify 并发挤兑，整体失败也不抛（内部函数都已自吞）。
 */
export async function runStoreLoginBootstrap(storeId: string): Promise<void> {
  await ensureStoreInsight(storeId);
  for (const scene of ENABLED_SCENES) {
    await ensureSceneQuestions(storeId, scene);
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
