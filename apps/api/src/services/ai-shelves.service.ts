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
import { streamDifyWorkflow, type DifyWorkflow } from './dify.service.js';
import { query } from '../db/index.js';
import { searchAround, AMAP_COMPETITOR_TYPES, AMAP_CROWD_TYPES, type AmapPoi } from './amap.service.js';
import { listStoreSkus } from './store-skus.service.js';
import { getSceneRuntime } from './scene.service.js';
import { computeBenchmarkForScene } from './benchmark.service.js';
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

function summarizePois(pois: AmapPoi[]): { items: unknown[] } {
  return {
    items: pois.map((p) => ({
      name: p.name,
      type: p.type,
      typecode: p.typecode,
      address: p.address,
      location: p.location,
      business: p.business,
    })),
  };
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
  return {
    photo: { transfer_method: 'remote_url', url: photoUrl, type: 'image' },
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
  const [sku, def, shelves] = await Promise.all([
    buildSkuData(args.storeId, args.scene),
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
    position_code: String(args.scene),
    category: def?.categories[0]?.name ?? '',
    shelf_width: widths,
    shelf_layers: layers,
    sku_json: sku.items,
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
  const [competitor, crowdSource] = await Promise.all([
    searchAround({ location: store.location, radius: 600, types: AMAP_COMPETITOR_TYPES }),
    searchAround({ location: store.location, radius: 600, types: AMAP_CROWD_TYPES }),
  ]);
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
  const [competitor, crowdSource] = await Promise.all([
    searchAround({ location: store.location, radius: 600, types: AMAP_COMPETITOR_TYPES }),
    searchAround({ location: store.location, radius: 600, types: AMAP_CROWD_TYPES }),
  ]);
  return {
    competitor: summarizePois(competitor),
    crowdSource: summarizePois(crowdSource),
  };
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
