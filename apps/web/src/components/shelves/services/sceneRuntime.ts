/**
 * 场景运行时状态（shim）—— localStorage + OSS 上传混合实现
 *
 * 背景：原 repo 把"场景级"的 photos / detection_data / virtual_shelf_status /
 * last_snapshot 都塞在 shelf_runtime_state(shelf_id TEXT) 上；整合 app 的
 * shelf_runtime_state.shelf_id 是 UUID FK，"pos-${sceneId}" 这种合成 ID 装不下。
 *
 * 取舍：把这层不需要跨设备共享的"草稿态" + 一次性的"上次调改快照"放浏览器
 * localStorage，按 (storeId, shelfId) 索引。真正需要落库的：
 *   - 应用调改  → scene_adjustment（走 scenes.applyAdjustment）
 *   - 虚拟货架  → virtual_shelf_history（走 scenes.recordVirtualHistory）
 *   - 上传照片  → /api/v1/storage/upload（OSS）
 *
 * 跨设备查看：LastRecordPage / VirtualPage 走数据库查询，不依赖本 runtime。
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

const KEY = (storeId: string, shelfId: string) => `scene_runtime_${storeId}_${shelfId}`;

// ---- 照片上传 ------------------------------------------------------------

/** Blob → base64（无 data URL 前缀） */
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

/**
 * 上传图片到 OSS，返回 URL。
 * 后端约定：JSON body `{filename, contentType, contentBase64, purpose}`。
 * storeId / shelfId 形态在原 repo 是 "粤37893" / "pos-0"，非 UUID，所以这里
 * 不上送 —— 后端用 session 的 currentStoreId，OSS 路径不强依赖 shelfId。
 */
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

// ---- 场景 runtime（localStorage） ----------------------------------------

export async function getSceneRuntime(storeId: string, shelfId: string): Promise<SceneRuntime | null> {
  if (!storeId || !shelfId) return null;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY(storeId, shelfId)) : null;
    if (!raw) return null;
    return JSON.parse(raw) as SceneRuntime;
  } catch {
    return null;
  }
}

export async function saveSceneRuntime(
  storeId: string,
  shelfId: string,
  patch: Partial<SceneRuntime>,
): Promise<void> {
  if (!storeId || !shelfId) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const cur = (await getSceneRuntime(storeId, shelfId)) ?? { store_id: storeId, shelf_id: shelfId };
    // photos 内 blob / localPreview 不可序列化，去掉
    const sanitizedPatch: Partial<SceneRuntime> = { ...patch };
    if (Array.isArray(patch.photos)) {
      sanitizedPatch.photos = patch.photos.map((p) => ({ url: p.url, matches: p.matches }));
    }
    const merged: SceneRuntime = { ...cur, ...sanitizedPatch };
    localStorage.setItem(KEY(storeId, shelfId), JSON.stringify(merged));
  } catch (err) {
    console.warn('[shelves/sceneRuntime.saveSceneRuntime] write failed', err);
  }
}
