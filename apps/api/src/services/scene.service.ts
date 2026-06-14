/**
 * 场景域：场景定义 / overview 聚合 / 工作台 runtime（含草稿、env）/
 *        货架组 / 调改 / 勘误 / 虚拟陈列历史
 *
 * 表：store_scene_state / store_scene_shelves / store_scene_adjustments /
 *     store_assortment_changes / store_scene_remakes / store_sku_corrections /
 *     store_scene_virtual_history / store_survey_questions
 */
import { query, withTransaction } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import type { Pool, PoolClient } from 'pg';

// ---- overview：场景列表角标聚合 -------------------------------------------

export interface SceneOverview {
  scene: number;
  shelfConfigured: boolean;
  qaDone: boolean;
  adjustmentCount: number;
  hasDraft: boolean;
  /** 该场景 store_scene_state.updated_at（仅当 draft 非空时有值），用于首屏"继续 X 的调改"选最近一次 */
  draftUpdatedAt: string | null;
  /** 最近一次有数据的调改的销售额变化（%）；null = 还没数据 */
  lastSalesDeltaPercent: number | null;
}

export async function getStoreSceneOverview(storeId: string): Promise<SceneOverview[]> {
  const res = await query<{
    scene: number;
    shelf_configured: boolean;
    qa_done: boolean;
    adjustment_count: number;
    has_draft: boolean;
    draft_updated_at: string | Date | null;
    last_adjustment_id: string | null;
  }>(
    `SELECT s.scene,
            EXISTS(SELECT 1 FROM store_scene_shelves sh
                    WHERE sh.store_id = $1 AND sh.scene = s.scene) AS shelf_configured,
            EXISTS(SELECT 1 FROM store_survey_questions q
                    JOIN store_survey_answers a ON a.question_id = q.id
                   WHERE q.store_id = $1 AND q.scene = s.scene) AS qa_done,
            COALESCE((SELECT remake_count FROM store_scene_remakes
                       WHERE store_id = $1 AND scene = s.scene), 0) AS adjustment_count,
            (SELECT draft IS NOT NULL FROM store_scene_state
              WHERE store_id = $1 AND scene = s.scene) AS has_draft,
            (SELECT CASE WHEN draft IS NOT NULL THEN updated_at END
               FROM store_scene_state
              WHERE store_id = $1 AND scene = s.scene) AS draft_updated_at,
            (SELECT last_adjustment_id FROM store_scene_remakes
              WHERE store_id = $1 AND scene = s.scene) AS last_adjustment_id
       FROM hq_categories s
      WHERE s.level = 0 AND s.is_active
   ORDER BY s.scene`,
    [storeId],
  );

  // last_sales_delta：对于每个场景的最近一次调改，求"调改后最新一期 vs 调改前一期"
  // 调改时间之前最近一期与之后最近一期，按调改商品销量总和对比；若任一缺失则 null。
  const deltaMap = new Map<number, number | null>();
  const withAdj = res.rows.filter((r) => r.last_adjustment_id);
  if (withAdj.length > 0) {
    const adjustmentIds = withAdj.map((r) => r.last_adjustment_id!);
    const deltaRes = await query<{
      adjustment_id: string;
      scene: number;
      delta_pct: number | null;
    }>(
      `WITH adj AS (
         SELECT a.id AS adjustment_id, a.store_id, a.scene, a.triggered_at::date AS d
           FROM store_scene_adjustments a
          WHERE a.id = ANY($1::uuid[])
       ),
       prod AS (
         SELECT adj.adjustment_id, adj.store_id, adj.scene, adj.d, c.product_id
           FROM adj
           JOIN store_assortment_changes c ON c.adjustment_id = adj.adjustment_id
          WHERE c.product_id IS NOT NULL
       ),
       before_amt AS (
         SELECT prod.adjustment_id, SUM(s.sales_amount_30d) AS amt
           FROM prod
           JOIN LATERAL (
             SELECT sales_amount_30d FROM store_sku_snapshots
              WHERE store_id = prod.store_id AND product_id = prod.product_id
                AND snapshot_date <= prod.d
              ORDER BY snapshot_date DESC LIMIT 1
           ) s ON true
          GROUP BY prod.adjustment_id
       ),
       after_amt AS (
         SELECT prod.adjustment_id, SUM(s.sales_amount_30d) AS amt
           FROM prod
           JOIN LATERAL (
             SELECT sales_amount_30d FROM store_sku_snapshots
              WHERE store_id = prod.store_id AND product_id = prod.product_id
                AND snapshot_date > prod.d
              ORDER BY snapshot_date DESC LIMIT 1
           ) s ON true
          GROUP BY prod.adjustment_id
       )
       SELECT adj.adjustment_id, adj.scene,
              CASE WHEN b.amt IS NULL OR a.amt IS NULL OR b.amt = 0 THEN NULL
                   ELSE ROUND(((a.amt - b.amt) * 100.0 / b.amt)::numeric, 1) END AS delta_pct
         FROM adj
         LEFT JOIN before_amt b ON b.adjustment_id = adj.adjustment_id
         LEFT JOIN after_amt  a ON a.adjustment_id = adj.adjustment_id`,
      [adjustmentIds],
    );
    for (const d of deltaRes.rows) {
      deltaMap.set(d.scene, d.delta_pct == null ? null : Number(d.delta_pct));
    }
  }

  return res.rows.map((r) => ({
    scene: r.scene,
    shelfConfigured: r.shelf_configured,
    qaDone: r.qa_done,
    adjustmentCount: Number(r.adjustment_count) || 0,
    hasDraft: r.has_draft ?? false,
    draftUpdatedAt: r.draft_updated_at
      ? (typeof r.draft_updated_at === 'string'
          ? r.draft_updated_at
          : r.draft_updated_at.toISOString())
      : null,
    lastSalesDeltaPercent: deltaMap.get(r.scene) ?? null,
  }));
}

// ---- runtime ---------------------------------------------------------------

export interface SceneRuntime {
  scene: number;
  status: 'empty' | 'photo_uploaded' | 'detected' | 'reviewing' | 'confirmed';
  photos: unknown[];
  detectionData: Record<string, unknown>;
  virtualStatus: 'idle' | 'processing' | 'completed' | 'failed';
  virtualRawOutputs: unknown;
  virtualContext: unknown;
  lastSnapshot: unknown;
  envCrowd: string | null;
  envCompetitor: string | null;
  draft: unknown;
  updatedAt: string;
}

function rowToRuntime(r: any): SceneRuntime {
  return {
    scene: r.scene,
    status: r.status,
    photos: Array.isArray(r.photos) ? r.photos : [],
    detectionData: r.detection_data ?? {},
    virtualStatus: r.virtual_status,
    virtualRawOutputs: r.virtual_raw_outputs,
    virtualContext: r.virtual_context,
    lastSnapshot: r.last_snapshot,
    envCrowd: r.env_crowd,
    envCompetitor: r.env_competitor,
    draft: r.draft,
    updatedAt: r.updated_at,
  };
}

export async function getSceneRuntime(
  storeId: string,
  scene: number,
): Promise<SceneRuntime | null> {
  const res = await query(
    `SELECT scene, status, photos, detection_data,
            virtual_status, virtual_raw_outputs, virtual_context,
            last_snapshot, env_crowd, env_competitor, draft, updated_at
       FROM store_scene_state
      WHERE store_id = $1 AND scene = $2 LIMIT 1`,
    [storeId, scene],
  );
  return res.rows[0] ? rowToRuntime(res.rows[0]) : null;
}

export interface UpsertRuntimeInput {
  status?: SceneRuntime['status'];
  photos?: unknown[];
  detectionData?: Record<string, unknown>;
  virtualStatus?: SceneRuntime['virtualStatus'];
  virtualRawOutputs?: unknown;
  virtualContext?: unknown;
  lastSnapshot?: unknown;
  envCrowd?: string | null;
  envCompetitor?: string | null;
  /** 草稿：传 null 显式清空；传 undefined 保留 */
  draft?: unknown;
}

export async function upsertSceneRuntime(
  storeId: string,
  scene: number,
  patch: UpsertRuntimeInput,
  userId: string,
): Promise<SceneRuntime> {
  const existing = await getSceneRuntime(storeId, scene);
  const merged = {
    status: patch.status ?? existing?.status ?? 'empty',
    photos: patch.photos !== undefined ? patch.photos : existing?.photos ?? [],
    detectionData:
      patch.detectionData !== undefined ? patch.detectionData : existing?.detectionData ?? {},
    virtualStatus: patch.virtualStatus ?? existing?.virtualStatus ?? 'idle',
    virtualRawOutputs:
      patch.virtualRawOutputs !== undefined ? patch.virtualRawOutputs : existing?.virtualRawOutputs ?? null,
    virtualContext:
      patch.virtualContext !== undefined ? patch.virtualContext : existing?.virtualContext ?? null,
    lastSnapshot:
      patch.lastSnapshot !== undefined ? patch.lastSnapshot : existing?.lastSnapshot ?? null,
    envCrowd: patch.envCrowd !== undefined ? patch.envCrowd : existing?.envCrowd ?? null,
    envCompetitor:
      patch.envCompetitor !== undefined ? patch.envCompetitor : existing?.envCompetitor ?? null,
    draft: patch.draft !== undefined ? patch.draft : existing?.draft ?? null,
  };
  await query(
    `INSERT INTO store_scene_state
       (store_id, scene, status, photos, detection_data, virtual_status,
        virtual_raw_outputs, virtual_context, last_snapshot,
        env_crowd, env_competitor, draft, updated_by)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6,
             $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12::jsonb, $13)
     ON CONFLICT (store_id, scene) DO UPDATE
       SET status = EXCLUDED.status,
           photos = EXCLUDED.photos,
           detection_data = EXCLUDED.detection_data,
           virtual_status = EXCLUDED.virtual_status,
           virtual_raw_outputs = EXCLUDED.virtual_raw_outputs,
           virtual_context = EXCLUDED.virtual_context,
           last_snapshot = EXCLUDED.last_snapshot,
           env_crowd = EXCLUDED.env_crowd,
           env_competitor = EXCLUDED.env_competitor,
           draft = EXCLUDED.draft,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
    [
      storeId, scene, merged.status,
      JSON.stringify(merged.photos),
      JSON.stringify(merged.detectionData),
      merged.virtualStatus,
      merged.virtualRawOutputs !== null ? JSON.stringify(merged.virtualRawOutputs) : null,
      merged.virtualContext !== null ? JSON.stringify(merged.virtualContext) : null,
      merged.lastSnapshot !== null ? JSON.stringify(merged.lastSnapshot) : null,
      merged.envCrowd, merged.envCompetitor,
      merged.draft !== null ? JSON.stringify(merged.draft) : null,
      userId,
    ],
  );
  const out = await getSceneRuntime(storeId, scene);
  if (!out) throw new Error('场景 runtime 保存失败');
  return out;
}

export async function clearSceneRuntime(storeId: string, scene: number): Promise<void> {
  await query(
    `DELETE FROM store_scene_state WHERE store_id = $1 AND scene = $2`,
    [storeId, scene],
  );
}

// ---- 调改：应用 + 历史 ----------------------------------------------------

export interface AdjustmentItem {
  action: 'add' | 'remove';
  skuCode: string;
  productName?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
}

export interface Adjustment {
  id: string;
  scene: number;
  summaryText: string | null;
  addedCount: number;
  removedCount: number;
  items: AdjustmentItem[];
  triggeredBy: string | null;
  triggeredByDisplay: string | null;
  triggeredAt: string;
}

const VALID_REASON_CODES = new Set([
  'ai_recommend_core', 'ai_recommend_innovation', 'low_sales',
  'competitor_replace', 'shelf_space_limit', 'manual_keep', 'manual_remove', 'other',
]);

export async function applyAdjustment(args: {
  storeId: string;
  scene: number;
  summaryText?: string;
  aiSessionId?: string;
  items: AdjustmentItem[];
  userId: string;
  userDisplayName: string;
}): Promise<Adjustment> {
  if (args.items.length === 0) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, '调改项不能为空');
  }
  const added = args.items.filter((i) => i.action === 'add').length;
  const removed = args.items.filter((i) => i.action === 'remove').length;
  const summary = args.summaryText ?? `上架 ${added} 个、停止进货 ${removed} 个`;

  return withTransaction(async (client) => {
    const ins = await client.query<{ id: string; triggered_at: string }>(
      `INSERT INTO store_scene_adjustments
         (store_id, scene, summary_text, added_count, removed_count, items,
          ai_session_id, triggered_by, triggered_by_display)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       RETURNING id, triggered_at`,
      [
        args.storeId, args.scene, summary, added, removed,
        JSON.stringify(args.items), args.aiSessionId ?? null,
        args.userId, args.userDisplayName,
      ],
    );
    const id = ins.rows[0]!.id;
    for (const it of args.items) {
      const reason = it.reasonCode && VALID_REASON_CODES.has(it.reasonCode)
        ? it.reasonCode
        : 'other';
      const prod = await client.query<{ id: string }>(
        `SELECT id FROM hq_products WHERE sku_code = $1 AND deleted_at IS NULL LIMIT 1`,
        [it.skuCode],
      );
      const productId = prod.rows[0]?.id ?? null;
      await client.query(
        `INSERT INTO store_assortment_changes
           (store_id, product_id, sku_code, action, reason_code, reason_text, scene,
            adjustment_id, created_by, created_by_display)
         VALUES ($1, $2, $3, $4::assortment_action, $5::assortment_reason, $6, $7, $8, $9, $10)`,
        [
          args.storeId, productId, it.skuCode, it.action, reason,
          it.reasonText ?? null, args.scene, id, args.userId, args.userDisplayName,
        ],
      );
    }
    // 调改计数 + 清掉运行时的草稿
    await client.query(
      `INSERT INTO store_scene_remakes (store_id, scene, remake_count, last_remake_at, last_adjustment_id)
       VALUES ($1, $2, 1, now(), $3)
       ON CONFLICT (store_id, scene) DO UPDATE
         SET remake_count = store_scene_remakes.remake_count + 1,
             last_remake_at = now(),
             last_adjustment_id = EXCLUDED.last_adjustment_id,
             updated_at = now()`,
      [args.storeId, args.scene, id],
    );
    await client.query(
      `UPDATE store_scene_state SET draft = NULL, updated_at = now()
        WHERE store_id = $1 AND scene = $2`,
      [args.storeId, args.scene],
    );
    return {
      id,
      scene: args.scene,
      summaryText: summary,
      addedCount: added,
      removedCount: removed,
      items: args.items,
      triggeredBy: args.userId,
      triggeredByDisplay: args.userDisplayName,
      triggeredAt: ins.rows[0]!.triggered_at,
    };
  });
}

export async function listAdjustments(
  storeId: string,
  scene: number,
  limit = 50,
): Promise<Adjustment[]> {
  const res = await query(
    `SELECT id, scene, summary_text, added_count, removed_count, items,
            triggered_by, triggered_by_display, triggered_at
       FROM store_scene_adjustments
      WHERE store_id = $1 AND scene = $2
   ORDER BY triggered_at DESC LIMIT $3`,
    [storeId, scene, limit],
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    scene: r.scene,
    summaryText: r.summary_text,
    addedCount: r.added_count,
    removedCount: r.removed_count,
    items: r.items ?? [],
    triggeredBy: r.triggered_by,
    triggeredByDisplay: r.triggered_by_display,
    triggeredAt: r.triggered_at,
  }));
}

// ---- 勘误 ----------------------------------------------------------------

export interface Correction {
  id: string;
  scene: number;
  skuCode: string;
  productId: string | null;
  kind: 'missed' | 'false_positive' | 'remove' | 'add' | 'observe';
  scope: 'detection' | 'decision';
  reasonCode: string;
  reasonText: string | null;
  evidenceImageUrl: string | null;
  submittedAt: string;
}

const KIND_BY_SCOPE: Record<string, string[]> = {
  detection: ['missed', 'false_positive'],
  decision: ['remove', 'add', 'observe'],
};

export async function listCorrections(args: {
  storeId: string;
  scene: number;
  scope?: 'detection' | 'decision';
}): Promise<Correction[]> {
  const params: unknown[] = [args.storeId, args.scene];
  let where = `store_id = $1 AND scene = $2`;
  if (args.scope) {
    params.push(args.scope);
    where += ` AND correction_scope = $${params.length}::sku_correction_scope`;
  }
  const res = await query(
    `SELECT id, scene, sku_code, product_id, correction_kind, correction_scope,
            reason_code, reason_text, evidence_image_url, submitted_at
       FROM store_sku_corrections WHERE ${where}
   ORDER BY submitted_at DESC LIMIT 200`,
    params,
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    scene: r.scene,
    skuCode: r.sku_code,
    productId: r.product_id,
    kind: r.correction_kind,
    scope: r.correction_scope,
    reasonCode: r.reason_code,
    reasonText: r.reason_text,
    evidenceImageUrl: r.evidence_image_url,
    submittedAt: r.submitted_at,
  }));
}

export async function submitCorrection(args: {
  storeId: string;
  scene: number;
  skuCode: string;
  kind: Correction['kind'];
  scope: Correction['scope'];
  reasonCode: string;
  reasonText?: string | null;
  evidenceImageUrl?: string | null;
  userId: string;
}): Promise<Correction> {
  if (!KIND_BY_SCOPE[args.scope]?.includes(args.kind)) {
    throw new AppError(
      400, ErrorCodes.VALIDATION_ERROR,
      `勘误类型 ${args.kind} 与范围 ${args.scope} 不匹配`,
    );
  }
  const prod = await query<{ id: string }>(
    `SELECT id FROM hq_products WHERE sku_code = $1 AND deleted_at IS NULL LIMIT 1`,
    [args.skuCode],
  );
  const productId = prod.rows[0]?.id ?? null;
  const res = await query(
    `INSERT INTO store_sku_corrections
       (store_id, scene, sku_code, product_id, correction_kind, correction_scope,
        reason_code, reason_text, evidence_image_url, submitted_by)
     VALUES ($1, $2, $3, $4, $5::sku_correction_kind, $6::sku_correction_scope,
             $7, $8, $9, $10)
     RETURNING id, scene, sku_code, product_id, correction_kind, correction_scope,
               reason_code, reason_text, evidence_image_url, submitted_at`,
    [
      args.storeId, args.scene, args.skuCode, productId,
      args.kind, args.scope, args.reasonCode,
      args.reasonText ?? null, args.evidenceImageUrl ?? null, args.userId,
    ],
  );
  const r: any = res.rows[0];
  return {
    id: r.id,
    scene: r.scene,
    skuCode: r.sku_code,
    productId: r.product_id,
    kind: r.correction_kind,
    scope: r.correction_scope,
    reasonCode: r.reason_code,
    reasonText: r.reason_text,
    evidenceImageUrl: r.evidence_image_url,
    submittedAt: r.submitted_at,
  };
}

// ---- 虚拟陈列历史 --------------------------------------------------------

export async function listVirtualHistory(
  storeId: string,
  scene: number,
  limit = 20,
): Promise<Array<{
  id: string;
  imageUrl: string;
  rawOutput: unknown;
  aiModel: string | null;
  aiSessionId: string | null;
  generatedAt: string;
}>> {
  const res = await query(
    `SELECT id, image_url, raw_output, ai_model, ai_session_id, generated_at
       FROM store_scene_virtual_history
      WHERE store_id = $1 AND scene = $2
   ORDER BY generated_at DESC LIMIT $3`,
    [storeId, scene, limit],
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    imageUrl: r.image_url,
    rawOutput: r.raw_output,
    aiModel: r.ai_model,
    aiSessionId: r.ai_session_id,
    generatedAt: r.generated_at,
  }));
}

export async function recordVirtualHistory(args: {
  storeId: string;
  scene: number;
  imageUrl: string;
  rawOutput?: unknown;
  aiModel?: string;
  aiSessionId?: string;
  userId: string;
}): Promise<{ id: string }> {
  const res = await query<{ id: string }>(
    `INSERT INTO store_scene_virtual_history
       (store_id, scene, image_url, raw_output, ai_model, ai_session_id, generated_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
     RETURNING id`,
    [
      args.storeId, args.scene, args.imageUrl,
      args.rawOutput !== undefined ? JSON.stringify(args.rawOutput) : null,
      args.aiModel ?? null, args.aiSessionId ?? null, args.userId,
    ],
  );
  return { id: res.rows[0]!.id };
}

// ---- 场景下的促销文案（虚拟陈列 / 选品页用） -------------------------------

export async function listScenePromoTexts(scene: number): Promise<Array<{
  groupCode: string;
  groupName: string | null;
  skuCode: string;
  promoText: string;
}>> {
  const res = await query<{
    group_code: string;
    group_name: string | null;
    sku_code: string;
    promo_text: string;
  }>(
    `SELECT t.group_code, t.group_name, t.sku_code, t.promo_text
       FROM hq_promo_sku_texts t
       LEFT JOIN hq_products p ON p.id = t.product_id
      WHERE t.is_active
        AND (t.scope <> 'store_list')
        AND fn_category_scene(COALESCE(t.category_id, p.category_id)) = $1
   ORDER BY t.group_code, t.sku_code`,
    [scene],
  );
  return res.rows.map((r) => ({
    groupCode: r.group_code,
    groupName: r.group_name,
    skuCode: r.sku_code,
    promoText: r.promo_text,
  }));
}

export const _internal = { rowToRuntime } as const;
