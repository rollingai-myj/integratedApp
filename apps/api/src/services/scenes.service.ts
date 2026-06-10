/**
 * 场景定义 + 调改 + 虚拟货架历史 业务层
 *
 * 表：
 *   plan_position_mapping   场景定义（position_code + name + category 关联）
 *   scene_remake            场景调改计数（store × position）
 *   scene_adjustment        场景调改批次摘要（决策 D4 上层）
 *   ops_store_assortment_change  上下架流水（决策 D4 下层，每 SKU 一行）
 *   virtual_shelf_history   虚拟货架生成历史
 */
import { query, withTransaction } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

// ---- 类型 -----------------------------------------------------------------

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

export interface VirtualShelfRecord {
  id: string;
  storeId: string;
  shelfId: string | null;
  positionCode: number | null;
  imageUrl: string;
  rawOutput: Record<string, unknown>;
  aiModel: string | null;
  aiSessionId: string | null;
  generatedAt: string;
}

// ---- 场景定义 ------------------------------------------------------------

export async function listScenes(): Promise<SceneDefinition[]> {
  const res = await query<{
    position_code: number;
    position_name: string;
    category_name: string;
    category_code: string | null;
    display_order: number;
  }>(
    `SELECT position_code, position_name, category_name, category_code, display_order
       FROM plan_position_mapping
      WHERE is_active = TRUE
   ORDER BY position_code, display_order, category_name`,
  );

  // 同一个 position_code 可对应多个 position_name（如 code 1 = 面包架【常温奶】
  // + 面包架【烘焙】，code 9 = 日化 + 家杂），所以分组 key 必须是 (code, name) 复合，
  // 不能只按 code 折叠（否则两条场景会被合成一条）。
  const byScene = new Map<string, SceneDefinition>();
  for (const r of res.rows) {
    const key = `${r.position_code}::${r.position_name}`;
    const existing = byScene.get(key);
    if (existing) {
      existing.categories.push({
        name: r.category_name,
        code: r.category_code,
        displayOrder: r.display_order,
      });
    } else {
      byScene.set(key, {
        positionCode: r.position_code,
        positionName: r.position_name,
        categories: [
          {
            name: r.category_name,
            code: r.category_code,
            displayOrder: r.display_order,
          },
        ],
      });
    }
  }
  // SQL 已经按 position_code ASC, display_order ASC 排好，Map 插入序即等于
  // 「场景的展示顺序」，直接转数组保持插入序。
  return Array.from(byScene.values());
}

// ---- 调改次数 ------------------------------------------------------------

export async function listSceneAdjustmentCounts(
  storeId: string,
): Promise<SceneAdjustmentCount[]> {
  const res = await query<{
    position_code: number;
    position_name: string | null;
    remake_count: number;
    last_remake_at: string | null;
  }>(
    `SELECT sr.position_code,
            (SELECT DISTINCT position_name FROM plan_position_mapping pm
              WHERE pm.position_code = sr.position_code LIMIT 1) AS position_name,
            sr.remake_count, sr.last_remake_at
       FROM scene_remake sr
      WHERE sr.store_id = $1
   ORDER BY sr.position_code`,
    [storeId],
  );
  return res.rows.map((r) => ({
    positionCode: r.position_code,
    positionName: r.position_name,
    remakeCount: r.remake_count,
    lastRemakeAt: r.last_remake_at,
  }));
}

// ---- 一键应用调改（决策 D4 两层写入） ---------------------------------

export interface ApplyAdjustmentInput {
  positionCode: number;
  summaryText?: string;
  aiSessionId?: string;
  items: SceneAdjustmentItem[];
}

export async function applyAdjustment(
  storeId: string,
  input: ApplyAdjustmentInput,
  userId: string,
  userDisplayName: string,
): Promise<SceneAdjustment> {
  if (input.items.length === 0) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, '调改项不能为空');
  }

  let added = 0;
  let removed = 0;
  let replaced = 0;
  for (const it of input.items) {
    if (it.action === 'add') added++;
    else if (it.action === 'remove') removed++;
    else if (it.action === 'replace') replaced++;
  }

  const summary =
    input.summaryText ??
    `上架 ${added} 个、下架 ${removed} 个${replaced ? `、替换 ${replaced} 个` : ''}`;

  return withTransaction(async (client) => {
    // 上层：scene_adjustment 一行
    const ins = await client.query<{ id: string; triggered_at: string }>(
      `INSERT INTO scene_adjustment
         (store_id, position_code, summary_text, added_count, removed_count, replaced_count,
          items, ai_session_id, triggered_by, triggered_display)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
       RETURNING id, triggered_at`,
      [
        storeId,
        input.positionCode,
        summary,
        added,
        removed,
        replaced,
        JSON.stringify(input.items),
        input.aiSessionId ?? null,
        userId,
        userDisplayName,
      ],
    );
    const batchId = ins.rows[0]!.id;
    const triggeredAt = ins.rows[0]!.triggered_at;

    // 下层：每个 SKU 写 ops_store_assortment_change
    for (const it of input.items) {
      // 取 product_id（按 sku_code）
      const p = await client.query<{ id: string }>(
        `SELECT id FROM dim_product WHERE sku_code = $1 AND deleted_at IS NULL LIMIT 1`,
        [it.skuCode],
      );
      const productId = p.rows[0]?.id;
      if (!productId) {
        // 找不到主数据时跳过，避免 FK 违反；后台可后续补
        continue;
      }
      const validReason = [
        'ai_recommend_core',
        'ai_recommend_innovation',
        'low_sales',
        'competitor_replace',
        'shelf_space_limit',
        'manual_keep',
        'manual_remove',
        'other',
      ].includes(it.reasonCode ?? '')
        ? it.reasonCode
        : 'other';

      await client.query(
        `INSERT INTO ops_store_assortment_change
           (store_id, product_id, sku_code, action, reason_code, reason_text,
            scene_code, batch_id, operator_user_id, operator_display)
         VALUES ($1, $2, $3, $4::assortment_action, $5::assortment_reason, $6,
                 $7, $8, $9, $10)`,
        [
          storeId,
          productId,
          it.skuCode,
          it.action,
          validReason,
          it.reasonText ?? null,
          input.positionCode,
          batchId,
          userId,
          userDisplayName,
        ],
      );
    }

    // 更新 scene_remake 计数
    await client.query(
      `INSERT INTO scene_remake (store_id, position_code, remake_count, last_remake_at, last_adjustment_id)
       VALUES ($1, $2, 1, now(), $3)
       ON CONFLICT (store_id, position_code) DO UPDATE
         SET remake_count = scene_remake.remake_count + 1,
             last_remake_at = now(),
             last_adjustment_id = EXCLUDED.last_adjustment_id,
             updated_at = now()`,
      [storeId, input.positionCode, batchId],
    );

    return {
      id: batchId,
      storeId,
      positionCode: input.positionCode,
      summaryText: summary,
      addedCount: added,
      removedCount: removed,
      replacedCount: replaced,
      items: input.items,
      aiSessionId: input.aiSessionId ?? null,
      triggeredBy: userId,
      triggeredDisplay: userDisplayName,
      triggeredAt,
    };
  });
}

export async function listSceneHistory(
  storeId: string,
  positionCode: number,
  limit = 50,
): Promise<SceneAdjustment[]> {
  const res = await query<{
    id: string;
    store_id: string;
    position_code: number;
    summary_text: string | null;
    added_count: number;
    removed_count: number;
    replaced_count: number;
    items: SceneAdjustmentItem[];
    ai_session_id: string | null;
    triggered_by: string | null;
    triggered_display: string | null;
    triggered_at: string;
  }>(
    `SELECT id, store_id, position_code, summary_text, added_count, removed_count,
            replaced_count, items, ai_session_id, triggered_by, triggered_display, triggered_at
       FROM scene_adjustment
      WHERE store_id = $1 AND position_code = $2
   ORDER BY triggered_at DESC
      LIMIT $3`,
    [storeId, positionCode, limit],
  );
  return res.rows.map((r) => ({
    id: r.id,
    storeId: r.store_id,
    positionCode: r.position_code,
    summaryText: r.summary_text,
    addedCount: r.added_count,
    removedCount: r.removed_count,
    replacedCount: r.replaced_count,
    items: r.items,
    aiSessionId: r.ai_session_id,
    triggeredBy: r.triggered_by,
    triggeredDisplay: r.triggered_display,
    triggeredAt: r.triggered_at,
  }));
}

// ---- 虚拟货架历史 -------------------------------------------------------

export async function listVirtualShelfHistory(
  storeId: string,
  positionCode: number,
  limit = 20,
): Promise<VirtualShelfRecord[]> {
  const res = await query<{
    id: string;
    store_id: string;
    shelf_id: string | null;
    position_code: number | null;
    image_url: string;
    raw_output: Record<string, unknown>;
    ai_model: string | null;
    ai_session_id: string | null;
    generated_at: string;
  }>(
    `SELECT id, store_id, shelf_id, position_code, image_url, raw_output,
            ai_model, ai_session_id, generated_at
       FROM virtual_shelf_history
      WHERE store_id = $1 AND position_code = $2
   ORDER BY generated_at DESC
      LIMIT $3`,
    [storeId, positionCode, limit],
  );
  return res.rows.map(mapVirtualShelf);
}

function mapVirtualShelf(r: {
  id: string;
  store_id: string;
  shelf_id: string | null;
  position_code: number | null;
  image_url: string;
  raw_output: Record<string, unknown>;
  ai_model: string | null;
  ai_session_id: string | null;
  generated_at: string;
}): VirtualShelfRecord {
  return {
    id: r.id,
    storeId: r.store_id,
    shelfId: r.shelf_id,
    positionCode: r.position_code,
    imageUrl: r.image_url,
    rawOutput: r.raw_output,
    aiModel: r.ai_model,
    aiSessionId: r.ai_session_id,
    generatedAt: r.generated_at,
  };
}

export interface RecordVirtualShelfInput {
  positionCode: number;
  shelfId?: string;
  imageUrl: string;
  rawOutput?: Record<string, unknown>;
  aiModel?: string;
  aiSessionId?: string;
}

export async function recordVirtualShelf(
  storeId: string,
  input: RecordVirtualShelfInput,
  userId: string,
): Promise<VirtualShelfRecord> {
  const res = await query<{
    id: string;
    store_id: string;
    shelf_id: string | null;
    position_code: number | null;
    image_url: string;
    raw_output: Record<string, unknown>;
    ai_model: string | null;
    ai_session_id: string | null;
    generated_at: string;
  }>(
    `INSERT INTO virtual_shelf_history
       (store_id, shelf_id, position_code, image_url, raw_output, ai_model, ai_session_id, generated_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
     RETURNING id, store_id, shelf_id, position_code, image_url, raw_output,
               ai_model, ai_session_id, generated_at`,
    [
      storeId,
      input.shelfId ?? null,
      input.positionCode,
      input.imageUrl,
      JSON.stringify(input.rawOutput ?? {}),
      input.aiModel ?? null,
      input.aiSessionId ?? null,
      userId,
    ],
  );
  return mapVirtualShelf(res.rows[0]!);
}
