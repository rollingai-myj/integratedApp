/**
 * 场景级运行时业务层（V027 之后）
 *
 * 跟"货架级 shelf_runtime_state"在概念上不同 —— 这里的 key 是 (store, scene_position_code)，
 * 不引用任何 store_shelf_config.id。
 *
 * 用途：
 *   - 拍照草稿（店长拍了但未提交诊断的照片）
 *   - 最新一次检测结果（matches）
 *   - 虚拟货架异步任务状态
 *   - 上一次完整调改快照（LastRecordPage 跨设备回看）
 */
import { query } from '../db/index.js';

export interface SceneRuntime {
  storeId: string;
  scenePositionCode: number;
  photos: unknown[];
  detectionData: Record<string, unknown>;
  virtualShelfStatus: string;
  virtualShelfRawOutputs: unknown;
  virtualShelfContext: unknown;
  lastSnapshot: unknown;
  updatedAt: string;
}

interface DbRow {
  store_id: string;
  scene_position_code: number;
  photos: unknown[];
  detection_data: Record<string, unknown>;
  virtual_shelf_status: string;
  virtual_shelf_raw_outputs: unknown;
  virtual_shelf_context: unknown;
  last_snapshot: unknown;
  updated_at: string;
}

function rowToSceneRuntime(r: DbRow): SceneRuntime {
  return {
    storeId: r.store_id,
    scenePositionCode: r.scene_position_code,
    photos: Array.isArray(r.photos) ? r.photos : [],
    detectionData: r.detection_data ?? {},
    virtualShelfStatus: r.virtual_shelf_status,
    virtualShelfRawOutputs: r.virtual_shelf_raw_outputs,
    virtualShelfContext: r.virtual_shelf_context,
    lastSnapshot: r.last_snapshot,
    updatedAt: r.updated_at,
  };
}

export async function getSceneRuntime(
  storeId: string,
  scenePositionCode: number,
): Promise<SceneRuntime | null> {
  const res = await query<DbRow>(
    `SELECT store_id, scene_position_code, photos, detection_data,
            virtual_shelf_status, virtual_shelf_raw_outputs, virtual_shelf_context,
            last_snapshot, updated_at
       FROM scene_runtime_state
      WHERE store_id = $1 AND scene_position_code = $2
      LIMIT 1`,
    [storeId, scenePositionCode],
  );
  return res.rows[0] ? rowToSceneRuntime(res.rows[0]) : null;
}

export interface UpsertSceneRuntimeInput {
  photos?: unknown[];
  detectionData?: Record<string, unknown>;
  virtualShelfStatus?: string;
  virtualShelfRawOutputs?: unknown;
  virtualShelfContext?: unknown;
  lastSnapshot?: unknown;
}

/** Partial upsert：未传字段保留旧值；以便前端按片段保存（如只更新 virtualShelfStatus）。 */
export async function upsertSceneRuntime(
  storeId: string,
  scenePositionCode: number,
  patch: UpsertSceneRuntimeInput,
  userId: string,
): Promise<SceneRuntime> {
  const existing = await getSceneRuntime(storeId, scenePositionCode);
  const merged = {
    photos: patch.photos !== undefined ? patch.photos : existing?.photos ?? [],
    detectionData: patch.detectionData !== undefined ? patch.detectionData : existing?.detectionData ?? {},
    virtualShelfStatus: patch.virtualShelfStatus !== undefined ? patch.virtualShelfStatus : existing?.virtualShelfStatus ?? 'idle',
    virtualShelfRawOutputs: patch.virtualShelfRawOutputs !== undefined ? patch.virtualShelfRawOutputs : existing?.virtualShelfRawOutputs ?? null,
    virtualShelfContext: patch.virtualShelfContext !== undefined ? patch.virtualShelfContext : existing?.virtualShelfContext ?? null,
    lastSnapshot: patch.lastSnapshot !== undefined ? patch.lastSnapshot : existing?.lastSnapshot ?? null,
  };
  await query(
    `INSERT INTO scene_runtime_state
       (store_id, scene_position_code, photos, detection_data,
        virtual_shelf_status, virtual_shelf_raw_outputs, virtual_shelf_context,
        last_snapshot, updated_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)
     ON CONFLICT (store_id, scene_position_code) DO UPDATE
       SET photos = EXCLUDED.photos,
           detection_data = EXCLUDED.detection_data,
           virtual_shelf_status = EXCLUDED.virtual_shelf_status,
           virtual_shelf_raw_outputs = EXCLUDED.virtual_shelf_raw_outputs,
           virtual_shelf_context = EXCLUDED.virtual_shelf_context,
           last_snapshot = EXCLUDED.last_snapshot,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
    [
      storeId,
      scenePositionCode,
      JSON.stringify(merged.photos),
      JSON.stringify(merged.detectionData),
      merged.virtualShelfStatus,
      merged.virtualShelfRawOutputs !== null ? JSON.stringify(merged.virtualShelfRawOutputs) : null,
      merged.virtualShelfContext !== null ? JSON.stringify(merged.virtualShelfContext) : null,
      merged.lastSnapshot !== null ? JSON.stringify(merged.lastSnapshot) : null,
      userId,
    ],
  );
  const out = await getSceneRuntime(storeId, scenePositionCode);
  if (!out) throw new Error('场景 runtime 保存失败');
  return out;
}

export async function deleteSceneRuntime(
  storeId: string,
  scenePositionCode: number,
): Promise<{ deleted: number }> {
  const res = await query(
    `DELETE FROM scene_runtime_state WHERE store_id = $1 AND scene_position_code = $2`,
    [storeId, scenePositionCode],
  );
  return { deleted: res.rowCount ?? 0 };
}
