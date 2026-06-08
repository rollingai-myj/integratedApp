/**
 * 货架配置 + 运行时 + 照片业务层
 *
 * 表：
 *   store_shelf_config       货架配置主表
 *   shelf_runtime_state      运行时状态（一架一条，UNIQUE shelf_id）
 *   shelf_photos             当前最多 3 张照片（slot 1-3）
 *   shelf_photo_history      每次拍的快照历史
 */
import { query, withTransaction } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

// ---- 类型 -----------------------------------------------------------------

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

export interface UpsertShelfConfigInput {
  shelfCode: string;
  positionCode: number;
  groupName?: string | null;
  widthCm?: number | null;
  layerCount?: number | null;
  supportedCategories?: string[];
  displayOrder?: number;
  notes?: string | null;
  attributes?: Record<string, unknown>;
}

export interface ShelfRuntime {
  shelfId: string;
  storeId: string;
  shelfCode: string;
  status:
    | 'empty'
    | 'photo_uploaded'
    | 'detected'
    | 'reviewing'
    | 'confirmed';
  currentSkus: unknown[];
  lastDetectResult: Record<string, unknown>;
  lastDetectedAt: string | null;
  virtualStatus: 'idle' | 'pending' | 'running' | 'succeeded' | 'failed';
  virtualLastImageUrl: string | null;
  virtualLastOutput: Record<string, unknown>;
  virtualLastRunAt: string | null;
  photos: { slot: number; url: string; uploadedAt: string }[];
  updatedAt: string;
}

export interface ShelfPhotoHistory {
  id: string;
  shelfId: string;
  imageUrls: string[];
  detectSummary: Record<string, unknown>;
  uploadedAt: string;
}

// ---- 货架配置 -------------------------------------------------------------

export async function listShelfConfigs(storeId: string): Promise<ShelfConfig[]> {
  const res = await query<ShelfConfigDbRow>(
    `SELECT id, store_id, shelf_code, position_code, group_name, width_cm,
            layer_count, supported_categories, display_order, notes, attributes
       FROM store_shelf_config
      WHERE store_id = $1 AND deleted_at IS NULL
   ORDER BY position_code, display_order, shelf_code`,
    [storeId],
  );
  return res.rows.map(mapShelfConfig);
}

interface ShelfConfigDbRow {
  id: string;
  store_id: string;
  shelf_code: string;
  position_code: number;
  group_name: string | null;
  width_cm: number | null;
  layer_count: number | null;
  supported_categories: string[] | null;
  display_order: number;
  notes: string | null;
  attributes: Record<string, unknown>;
}

function mapShelfConfig(r: ShelfConfigDbRow): ShelfConfig {
  return {
    id: r.id,
    storeId: r.store_id,
    shelfCode: r.shelf_code,
    positionCode: r.position_code,
    groupName: r.group_name,
    widthCm: r.width_cm,
    layerCount: r.layer_count,
    supportedCategories: r.supported_categories ?? [],
    displayOrder: r.display_order,
    notes: r.notes,
    attributes: r.attributes,
  };
}

export async function createShelfConfig(
  storeId: string,
  input: UpsertShelfConfigInput,
): Promise<ShelfConfig> {
  const res = await query<ShelfConfigDbRow>(
    `INSERT INTO store_shelf_config
       (store_id, shelf_code, position_code, group_name, width_cm, layer_count,
        supported_categories, display_order, notes, attributes)
     VALUES ($1, $2, $3, $4, $5, $6, $7::text[], COALESCE($8, 0), $9, $10::jsonb)
     RETURNING id, store_id, shelf_code, position_code, group_name, width_cm,
               layer_count, supported_categories, display_order, notes, attributes`,
    [
      storeId,
      input.shelfCode,
      input.positionCode,
      input.groupName ?? null,
      input.widthCm ?? null,
      input.layerCount ?? null,
      input.supportedCategories ?? [],
      input.displayOrder ?? null,
      input.notes ?? null,
      JSON.stringify(input.attributes ?? {}),
    ],
  );
  return mapShelfConfig(res.rows[0]!);
}

export async function updateShelfConfig(
  storeId: string,
  shelfId: string,
  patch: Partial<UpsertShelfConfigInput>,
): Promise<ShelfConfig> {
  const set: string[] = [];
  const params: unknown[] = [storeId, shelfId];
  if (patch.shelfCode !== undefined) {
    params.push(patch.shelfCode);
    set.push(`shelf_code = $${params.length}`);
  }
  if (patch.positionCode !== undefined) {
    params.push(patch.positionCode);
    set.push(`position_code = $${params.length}`);
  }
  if (patch.groupName !== undefined) {
    params.push(patch.groupName);
    set.push(`group_name = $${params.length}`);
  }
  if (patch.widthCm !== undefined) {
    params.push(patch.widthCm);
    set.push(`width_cm = $${params.length}`);
  }
  if (patch.layerCount !== undefined) {
    params.push(patch.layerCount);
    set.push(`layer_count = $${params.length}`);
  }
  if (patch.supportedCategories !== undefined) {
    params.push(patch.supportedCategories);
    set.push(`supported_categories = $${params.length}::text[]`);
  }
  if (patch.displayOrder !== undefined) {
    params.push(patch.displayOrder);
    set.push(`display_order = $${params.length}`);
  }
  if (patch.notes !== undefined) {
    params.push(patch.notes);
    set.push(`notes = $${params.length}`);
  }
  if (patch.attributes !== undefined) {
    params.push(JSON.stringify(patch.attributes));
    set.push(`attributes = $${params.length}::jsonb`);
  }
  if (set.length === 0) {
    const existing = await listShelfConfigs(storeId);
    const found = existing.find((s) => s.id === shelfId);
    if (!found) throw new AppError(404, ErrorCodes.NOT_FOUND, '货架不存在');
    return found;
  }
  set.push('updated_at = now()');
  const res = await query<ShelfConfigDbRow>(
    `UPDATE store_shelf_config
        SET ${set.join(', ')}
      WHERE store_id = $1 AND id = $2 AND deleted_at IS NULL
  RETURNING id, store_id, shelf_code, position_code, group_name, width_cm,
            layer_count, supported_categories, display_order, notes, attributes`,
    params,
  );
  if (res.rows.length === 0) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, '货架不存在');
  }
  return mapShelfConfig(res.rows[0]!);
}

export async function deleteShelfConfigs(
  storeId: string,
  shelfCodes: string[],
): Promise<{ deleted: number }> {
  if (shelfCodes.length === 0) return { deleted: 0 };
  const res = await query(
    `UPDATE store_shelf_config
        SET deleted_at = now()
      WHERE store_id = $1
        AND shelf_code = ANY($2::text[])
        AND deleted_at IS NULL`,
    [storeId, shelfCodes],
  );
  return { deleted: res.rowCount ?? 0 };
}

export async function replaceAllShelfConfigs(
  storeId: string,
  configs: UpsertShelfConfigInput[],
): Promise<{ replaced: number }> {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE store_shelf_config SET deleted_at = now() WHERE store_id = $1 AND deleted_at IS NULL`,
      [storeId],
    );
    for (const c of configs) {
      await client.query(
        `INSERT INTO store_shelf_config
           (store_id, shelf_code, position_code, group_name, width_cm, layer_count,
            supported_categories, display_order, notes, attributes)
         VALUES ($1, $2, $3, $4, $5, $6, $7::text[], COALESCE($8, 0), $9, $10::jsonb)`,
        [
          storeId,
          c.shelfCode,
          c.positionCode,
          c.groupName ?? null,
          c.widthCm ?? null,
          c.layerCount ?? null,
          c.supportedCategories ?? [],
          c.displayOrder ?? null,
          c.notes ?? null,
          JSON.stringify(c.attributes ?? {}),
        ],
      );
    }
    return { replaced: configs.length };
  });
}

// ---- 货架运行时 -----------------------------------------------------------

export async function getShelfRuntime(
  storeId: string,
  shelfCode?: string,
): Promise<ShelfRuntime[]> {
  const params: unknown[] = [storeId];
  let filter = '';
  if (shelfCode) {
    params.push(shelfCode);
    filter = `AND sc.shelf_code = $${params.length}`;
  }
  const res = await query<{
    shelf_id: string;
    store_id: string;
    shelf_code: string;
    status: ShelfRuntime['status'];
    current_skus: unknown[];
    last_detect_result: Record<string, unknown>;
    last_detected_at: string | null;
    virtual_status: ShelfRuntime['virtualStatus'];
    virtual_last_image_url: string | null;
    virtual_last_output: Record<string, unknown>;
    virtual_last_run_at: string | null;
    updated_at: string;
  }>(
    `SELECT rt.shelf_id, rt.store_id, sc.shelf_code, rt.status, rt.current_skus,
            rt.last_detect_result, rt.last_detected_at, rt.virtual_status,
            rt.virtual_last_image_url, rt.virtual_last_output, rt.virtual_last_run_at,
            rt.updated_at
       FROM shelf_runtime_state rt
       JOIN store_shelf_config sc ON sc.id = rt.shelf_id AND sc.deleted_at IS NULL
      WHERE rt.store_id = $1 ${filter}
   ORDER BY sc.position_code, sc.display_order, sc.shelf_code`,
    params,
  );

  if (res.rows.length === 0) return [];

  const shelfIds = res.rows.map((r) => r.shelf_id);
  const photoRes = await query<{
    shelf_id: string;
    slot_index: number;
    image_url: string;
    uploaded_at: string;
  }>(
    `SELECT shelf_id, slot_index, image_url, uploaded_at
       FROM shelf_photos
      WHERE shelf_id = ANY($1::uuid[])
   ORDER BY shelf_id, slot_index`,
    [shelfIds],
  );
  const photosByShelf = new Map<
    string,
    { slot: number; url: string; uploadedAt: string }[]
  >();
  for (const p of photoRes.rows) {
    const list = photosByShelf.get(p.shelf_id) ?? [];
    list.push({ slot: p.slot_index, url: p.image_url, uploadedAt: p.uploaded_at });
    photosByShelf.set(p.shelf_id, list);
  }

  return res.rows.map((r) => ({
    shelfId: r.shelf_id,
    storeId: r.store_id,
    shelfCode: r.shelf_code,
    status: r.status,
    currentSkus: r.current_skus,
    lastDetectResult: r.last_detect_result,
    lastDetectedAt: r.last_detected_at,
    virtualStatus: r.virtual_status,
    virtualLastImageUrl: r.virtual_last_image_url,
    virtualLastOutput: r.virtual_last_output,
    virtualLastRunAt: r.virtual_last_run_at,
    updatedAt: r.updated_at,
    photos: photosByShelf.get(r.shelf_id) ?? [],
  }));
}

export interface UpdateRuntimeInput {
  status?: ShelfRuntime['status'];
  currentSkus?: unknown[];
  lastDetectResult?: Record<string, unknown>;
  virtualStatus?: ShelfRuntime['virtualStatus'];
  virtualLastImageUrl?: string | null;
  virtualLastOutput?: Record<string, unknown>;
}

export async function updateShelfRuntime(
  storeId: string,
  shelfCode: string,
  patch: UpdateRuntimeInput,
  userId: string,
): Promise<ShelfRuntime> {
  // 先按 (store, shelf_code) 找到 shelf_id；并 upsert 一条 runtime
  const cfg = await query<{ id: string }>(
    `SELECT id FROM store_shelf_config WHERE store_id = $1 AND shelf_code = $2 AND deleted_at IS NULL LIMIT 1`,
    [storeId, shelfCode],
  );
  const shelfId = cfg.rows[0]?.id;
  if (!shelfId) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, '货架不存在');
  }

  await query(
    `INSERT INTO shelf_runtime_state (store_id, shelf_id, updated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (shelf_id) DO NOTHING`,
    [storeId, shelfId, userId],
  );

  const set: string[] = [];
  const params: unknown[] = [shelfId];
  if (patch.status !== undefined) {
    params.push(patch.status);
    set.push(`status = $${params.length}::shelf_runtime_status`);
  }
  if (patch.currentSkus !== undefined) {
    params.push(JSON.stringify(patch.currentSkus));
    set.push(`current_skus = $${params.length}::jsonb`);
  }
  if (patch.lastDetectResult !== undefined) {
    params.push(JSON.stringify(patch.lastDetectResult));
    set.push(`last_detect_result = $${params.length}::jsonb`);
    set.push('last_detected_at = now()');
  }
  if (patch.virtualStatus !== undefined) {
    params.push(patch.virtualStatus);
    set.push(`virtual_status = $${params.length}::virtual_shelf_status`);
    if (
      patch.virtualStatus === 'succeeded' ||
      patch.virtualStatus === 'failed'
    ) {
      set.push('virtual_last_run_at = now()');
    }
  }
  if (patch.virtualLastImageUrl !== undefined) {
    params.push(patch.virtualLastImageUrl);
    set.push(`virtual_last_image_url = $${params.length}`);
  }
  if (patch.virtualLastOutput !== undefined) {
    params.push(JSON.stringify(patch.virtualLastOutput));
    set.push(`virtual_last_output = $${params.length}::jsonb`);
  }
  params.push(userId);
  set.push(`updated_by = $${params.length}`);
  set.push('updated_at = now()');

  await query(
    `UPDATE shelf_runtime_state SET ${set.join(', ')} WHERE shelf_id = $1`,
    params,
  );

  const after = await getShelfRuntime(storeId, shelfCode);
  if (after.length === 0) {
    throw new AppError(500, ErrorCodes.INTERNAL_ERROR, '运行时更新失败');
  }
  return after[0]!;
}

export async function deleteShelfRuntime(
  storeId: string,
  shelfCode?: string,
): Promise<{ deleted: number }> {
  const params: unknown[] = [storeId];
  let filter = '';
  if (shelfCode) {
    params.push(shelfCode);
    filter = `AND sc.shelf_code = $${params.length}`;
  }
  const res = await query(
    `DELETE FROM shelf_runtime_state rt
      USING store_shelf_config sc
     WHERE rt.shelf_id = sc.id
       AND rt.store_id = $1 ${filter}`,
    params,
  );
  return { deleted: res.rowCount ?? 0 };
}

// ---- 照片 -----------------------------------------------------------------

export async function listShelfPhotoHistory(
  storeId: string,
  shelfCode: string,
  limit = 20,
): Promise<ShelfPhotoHistory[]> {
  const res = await query<{
    id: string;
    shelf_id: string;
    image_urls: string[];
    detect_summary: Record<string, unknown>;
    uploaded_at: string;
  }>(
    `SELECT ph.id, ph.shelf_id, ph.image_urls, ph.detect_summary, ph.uploaded_at
       FROM shelf_photo_history ph
       JOIN store_shelf_config sc ON sc.id = ph.shelf_id AND sc.deleted_at IS NULL
      WHERE ph.store_id = $1 AND sc.shelf_code = $2
   ORDER BY ph.uploaded_at DESC
      LIMIT $3`,
    [storeId, shelfCode, limit],
  );
  return res.rows.map((r) => ({
    id: r.id,
    shelfId: r.shelf_id,
    imageUrls: r.image_urls,
    detectSummary: r.detect_summary,
    uploadedAt: r.uploaded_at,
  }));
}

export async function addShelfPhotoHistory(
  storeId: string,
  shelfCode: string,
  imageUrls: string[],
  detectSummary: Record<string, unknown>,
  userId: string,
): Promise<{ id: string }> {
  const cfg = await query<{ id: string }>(
    `SELECT id FROM store_shelf_config WHERE store_id = $1 AND shelf_code = $2 AND deleted_at IS NULL LIMIT 1`,
    [storeId, shelfCode],
  );
  const shelfId = cfg.rows[0]?.id;
  if (!shelfId) throw new AppError(404, ErrorCodes.NOT_FOUND, '货架不存在');

  const ins = await query<{ id: string }>(
    `INSERT INTO shelf_photo_history (store_id, shelf_id, image_urls, detect_summary, uploaded_by)
     VALUES ($1, $2, $3::text[], $4::jsonb, $5)
     RETURNING id`,
    [storeId, shelfId, imageUrls, JSON.stringify(detectSummary), userId],
  );
  return { id: ins.rows[0]!.id };
}

/**
 * 更新当前货架照片（shelf_photos 表，最多 3 张）
 * urls 数组里第 i 项对应 slot_index = i+1；空字符串/undefined 表示该 slot 不更新
 */
export async function updateCurrentShelfPhotos(
  storeId: string,
  shelfCode: string,
  urls: (string | null | undefined)[],
  userId: string,
): Promise<void> {
  const cfg = await query<{ id: string }>(
    `SELECT id FROM store_shelf_config WHERE store_id = $1 AND shelf_code = $2 AND deleted_at IS NULL LIMIT 1`,
    [storeId, shelfCode],
  );
  const shelfId = cfg.rows[0]?.id;
  if (!shelfId) throw new AppError(404, ErrorCodes.NOT_FOUND, '货架不存在');

  await withTransaction(async (client) => {
    for (let i = 0; i < Math.min(urls.length, 3); i++) {
      const url = urls[i];
      if (!url) continue;
      await client.query(
        `INSERT INTO shelf_photos (shelf_id, store_id, slot_index, image_url, uploaded_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (shelf_id, slot_index) DO UPDATE
           SET image_url = EXCLUDED.image_url,
               uploaded_by = EXCLUDED.uploaded_by,
               uploaded_at = now()`,
        [shelfId, storeId, i + 1, url, userId],
      );
    }
  });
}
