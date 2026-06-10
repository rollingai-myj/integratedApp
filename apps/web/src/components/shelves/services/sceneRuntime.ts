/**
 * 场景级运行时（V027 之后真正接 backend）
 *
 * Backend：
 *   GET    /api/v1/scenes/:sceneId/runtime  → { runtime }
 *   PUT    /api/v1/scenes/:sceneId/runtime  → partial upsert
 *   DELETE /api/v1/scenes/:sceneId/runtime
 *
 * 跨设备共享：店长换设备登录同一店 + 同一场景，能立即恢复未提交的拍照草稿
 * 与上次完整调改快照（LastRecordPage）。
 *
 * 兼容：原 repo 的 saveSceneRuntime/getSceneRuntime 用 shelfId 字符串
 * （"pos-{N}"）做索引，shim 内解析 N 即 sceneId 传给 backend。
 *
 * 照片仍走 /storage/upload（OSS），URL 持久化进 photos 字段；blob/localPreview
 * 是浏览器内 transient，落 backend 时去掉。
 */
import { apiFetch } from '@/components/shelves/lib/api-client';
import type { DetectMatch } from '@/components/shelves/services/scenes';

export interface ScenePhoto {
  url: string;
  localPreview?: string;
  blob?: Blob;
  matches?: DetectMatch[];
}

export interface SceneRuntime {
  store_id: string;
  shelf_id: string;
  photos?: ScenePhoto[];
  detection_data?: Record<string, DetectMatch[]>;
  virtual_shelf_status?: string;
  virtual_shelf_raw_outputs?: unknown;
  virtual_shelf_context?: unknown;
  last_snapshot?: unknown;
  [k: string]: unknown;
}

interface BackendSceneRuntime {
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

/** "pos-3" → 3；"pos-3-1" → 3；任何非数字 → null */
function shelfIdToSceneId(shelfId: string): number | null {
  const m = /^pos-(\d+)/.exec(shelfId);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function backendToFront(b: BackendSceneRuntime, shelfId: string): SceneRuntime {
  return {
    store_id: b.storeId,
    shelf_id: shelfId,
    photos: Array.isArray(b.photos) ? (b.photos as ScenePhoto[]) : [],
    detection_data: (b.detectionData as Record<string, DetectMatch[]>) ?? {},
    virtual_shelf_status: b.virtualShelfStatus,
    virtual_shelf_raw_outputs: b.virtualShelfRawOutputs,
    virtual_shelf_context: b.virtualShelfContext,
    last_snapshot: b.lastSnapshot,
  };
}

// ---- 照片上传：OSS ---------------------------------------------------------

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function uploadPhoto(_storeId: string, _shelfId: string, blob: Blob): Promise<string> {
  const contentBase64 = await blobToBase64(blob);
  const res = await apiFetch('/storage/upload', {
    method: 'POST',
    body: JSON.stringify({
      filename: `shelf-${Date.now()}.jpg`,
      contentType: blob.type || 'image/jpeg',
      contentBase64,
      purpose: 'shelf-photo',
    }),
  });
  if (!res.ok) throw new Error(`上传失败 ${res.status}`);
  const data = (await res.json()) as { url: string };
  return data.url;
}

// ---- 场景 runtime ---------------------------------------------------------

export async function getSceneRuntime(
  _storeCode: string,
  shelfId: string,
): Promise<SceneRuntime | null> {
  const sceneId = shelfIdToSceneId(shelfId);
  if (sceneId === null) return null;
  try {
    const res = await apiFetch(`/scenes/${sceneId}/runtime`);
    if (!res.ok) return null;
    const data = (await res.json()) as { runtime?: BackendSceneRuntime | null };
    return data.runtime ? backendToFront(data.runtime, shelfId) : null;
  } catch (err) {
    console.warn('[shelves/sceneRuntime.get] failed', err);
    return null;
  }
}

export async function saveSceneRuntime(
  _storeCode: string,
  shelfId: string,
  patch: Partial<SceneRuntime>,
): Promise<void> {
  const sceneId = shelfIdToSceneId(shelfId);
  if (sceneId === null) return;
  // photos 内 blob / localPreview 不可序列化，去掉
  const photosSerializable = Array.isArray(patch.photos)
    ? patch.photos.map((p) => ({ url: p.url, matches: p.matches }))
    : undefined;
  const body: Record<string, unknown> = {};
  if (photosSerializable !== undefined) body.photos = photosSerializable;
  if (patch.detection_data !== undefined) body.detectionData = patch.detection_data;
  if (patch.virtual_shelf_status !== undefined) body.virtualShelfStatus = patch.virtual_shelf_status;
  if (patch.virtual_shelf_raw_outputs !== undefined) body.virtualShelfRawOutputs = patch.virtual_shelf_raw_outputs;
  if (patch.virtual_shelf_context !== undefined) body.virtualShelfContext = patch.virtual_shelf_context;
  if (patch.last_snapshot !== undefined) body.lastSnapshot = patch.last_snapshot;
  if (Object.keys(body).length === 0) return;
  try {
    await apiFetch(`/scenes/${sceneId}/runtime`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn('[shelves/sceneRuntime.save] failed', err);
  }
}
