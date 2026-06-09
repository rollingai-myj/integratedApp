/**
 * 场景级业务服务（shim）—— 对接整合 app 的 /api/v1/* 端点
 *
 * 后端实际路由：见 apps/api/src/routes/shelves.routes.ts、apps/api/src/routes/detect.routes.ts
 *   GET    /api/v1/scenes                            场景定义 + 品类
 *   GET    /api/v1/scenes/adjustments-count          各场景调改次数（当前店）
 *   POST   /api/v1/scenes/:sceneId/apply             应用一次调改
 *   GET    /api/v1/scenes/:sceneId/history           调改历史
 *   GET    /api/v1/scenes/:sceneId/virtual-shelf-history  虚拟货架历史
 *   POST   /api/v1/scenes/:sceneId/virtual-shelf     记录一次虚拟货架（落库）
 *   GET    /api/v1/shelves/config                    本店全部货架配置
 *   POST   /api/v1/shelves/config                    新建一条货架配置
 *   DELETE /api/v1/shelves/config (body: shelfCodes) 删除一批
 *   POST   /api/v1/detect                            商品识别（JSON base64）
 *
 * 命名约定：
 *   - 场景层 shelfId = `pos-${sceneId}`（用作浏览器内 sceneRuntime/草稿 key）
 *   - 组层 shelfCode = `pos-${sceneId}-${i}`（落库 store_shelf_config.shelf_code）
 *
 * 与原 repo 差异：业务接口 100% 从 session.currentStoreId 取门店，shim 内 `storeId`
 * 参数仅用于日志/兼容签名，并不真正上行。
 */
import { apiFetch } from '@/components/shelves/lib/api-client';
import { classifyAction } from '@/components/shelves/lib/strategyAction';

// ---- 类型 ----------------------------------------------------------------

export interface PlanPosition {
  position_code: number;
  position_name: string;
  categories: string[];
}

export interface RemakeCount {
  position_code: number;
  position_name: string;
  remake_count: number;
  last_remake_at: string | null;
}

export interface AdjustmentItem {
  skuCode: string;
  skuName: string;
  spec?: string;
  action: string;
  tags?: string[];
  reason?: string;
}

export interface SceneAdjustment {
  id: number;
  created_at: string;
  summary: string;
  items: AdjustmentItem[];
}

export interface VirtualHistoryRow {
  id: number;
  created_at: string;
  raw_outputs: unknown;
  context: unknown;
}

export interface ShelfGroup {
  shelf_type: string;
  shelf_width: number;
  shelf_layers: number;
  category?: string;
}

export interface DetectMatch {
  id: string;
  bbox: [number, number, number, number];
  matched_sku_id: string | null;
  matched_combined: number | null;
}

// ---- 命名约定（沿用原 repo） ---------------------------------------------

export const sceneShelfId = (sceneId: number | string) => `pos-${sceneId}`;
export const groupShelfId = (sceneId: number | string, i: number) => `pos-${sceneId}-${i}`;

// ---- 场景定义 ------------------------------------------------------------

interface BackendScene {
  positionCode: number;
  positionName: string;
  categories: Array<{ name: string; code: string | null; displayOrder: number }>;
}

export async function listPlanPositions(): Promise<PlanPosition[]> {
  try {
    const res = await apiFetch('/scenes');
    if (!res.ok) return [];
    const data = (await res.json()) as { scenes?: BackendScene[] };
    return (data.scenes ?? []).map((s) => ({
      position_code: s.positionCode,
      position_name: s.positionName,
      categories: s.categories.map((c) => c.name),
    }));
  } catch {
    return [];
  }
}

// ---- 调改计数 ------------------------------------------------------------

interface BackendCount {
  positionCode: number;
  positionName: string | null;
  remakeCount: number;
  lastRemakeAt: string | null;
}

export async function listRemakeCounts(_storeId: string): Promise<RemakeCount[]> {
  try {
    const res = await apiFetch('/scenes/adjustments-count');
    if (!res.ok) return [];
    const data = (await res.json()) as { counts?: BackendCount[] };
    return (data.counts ?? []).map((c) => ({
      position_code: c.positionCode,
      position_name: c.positionName ?? '',
      remake_count: c.remakeCount,
      last_remake_at: c.lastRemakeAt,
    }));
  } catch {
    return [];
  }
}

// ---- 应用调改 ------------------------------------------------------------

interface BackendAdjustmentItem {
  action: 'add' | 'remove' | 'replace';
  skuCode: string;
  productName?: string | null;
  reasonCode?: string;
  reasonText?: string | null;
}

interface BackendSceneAdjustment {
  id: string;
  storeId: string;
  positionCode: number;
  summaryText: string | null;
  addedCount: number;
  removedCount: number;
  replacedCount: number;
  items: Array<{
    action: 'add' | 'remove' | 'replace';
    skuCode: string;
    productName?: string | null;
    reasonText?: string | null;
    [k: string]: unknown;
  }>;
  triggeredAt: string;
}

/**
 * 把原 repo 五花八门的 action 文案（"上架"、"撤场"、"保留"…）归一化成
 * 后端 enum 'add'/'remove'/'replace'。其它视为 replace（保持记录但不区分动作）。
 */
function actionToBackend(action: string): 'add' | 'remove' | 'replace' {
  const k = classifyAction(action);
  if (k === 'push') return 'add';
  if (k === 'remove') return 'remove';
  return 'replace';
}

function adjustmentToFront(rec: BackendSceneAdjustment, originalItems: AdjustmentItem[]): SceneAdjustment {
  // 后端只存 enum action + skuCode + productName + reasonText；原 repo 表格还要
  // 展示 spec / 富文本 action / tags / reason。我们用 triggeredAt 后立即写回的
  // originalItems 做补充展示；若是从 listAdjustments 拿回的旧记录，spec/tags 已丢，
  // 仅展示后端字段。
  const byCode = new Map(originalItems.map((it) => [it.skuCode, it]));
  return {
    id: Number(rec.id.replace(/-/g, '').slice(0, 12)) || 0, // UUID → 稳定数字 key 给 React
    created_at: rec.triggeredAt,
    summary: rec.summaryText ?? '',
    items: rec.items.map((bi) => {
      const orig = byCode.get(bi.skuCode);
      return {
        skuCode: bi.skuCode,
        skuName: orig?.skuName ?? bi.productName ?? bi.skuCode,
        spec: orig?.spec,
        action: orig?.action ?? bi.action,
        tags: orig?.tags,
        reason: orig?.reason ?? bi.reasonText ?? undefined,
      };
    }),
  };
}

export async function applyAdjustment(params: {
  storeId: string;
  positionCode: number;
  positionName: string;
  summary: string;
  items: AdjustmentItem[];
}): Promise<SceneAdjustment> {
  const body = {
    summaryText: params.summary,
    items: params.items.map<BackendAdjustmentItem>((it) => ({
      action: actionToBackend(it.action),
      skuCode: it.skuCode,
      productName: it.skuName ?? null,
      reasonText: it.reason ?? null,
    })),
  };
  const res = await apiFetch(`/scenes/${params.positionCode}/apply`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { record?: BackendSceneAdjustment } & BackendSceneAdjustment;
  const rec = data.record ?? (data as BackendSceneAdjustment);
  return adjustmentToFront(rec, params.items);
}

// ---- 历史 ----------------------------------------------------------------

export async function listAdjustments(_storeId: string, code: number): Promise<SceneAdjustment[]> {
  try {
    const res = await apiFetch(`/scenes/${code}/history`);
    if (!res.ok) return [];
    const data = (await res.json()) as { records?: BackendSceneAdjustment[] };
    return (data.records ?? []).map((r) => adjustmentToFront(r, []));
  } catch {
    return [];
  }
}

interface BackendVirtualRecord {
  id: string;
  positionCode: number | null;
  imageUrl: string;
  rawOutput: Record<string, unknown>;
  generatedAt: string;
}

export async function listVirtualHistory(_storeId: string, code: number): Promise<VirtualHistoryRow[]> {
  try {
    const res = await apiFetch(`/scenes/${code}/virtual-shelf-history`);
    if (!res.ok) return [];
    const data = (await res.json()) as { records?: BackendVirtualRecord[] };
    return (data.records ?? []).map((r, i) => ({
      id: i,
      created_at: r.generatedAt,
      raw_outputs: r.rawOutput?.raw_outputs ?? r.rawOutput, // 兼容两种形态
      context: r.rawOutput?.context ?? null,
    }));
  } catch {
    return [];
  }
}

export async function recordVirtualHistory(params: {
  storeId: string;
  positionCode: number;
  rawOutputs: unknown;
  context: unknown;
}): Promise<void> {
  // 后端 schema：{ shelfId?, imageUrl, rawOutput?, aiModel?, aiSessionId? }
  // raw_outputs 内通常含 image_url；尽量从里面挖出来一个；否则用占位
  const ro = params.rawOutputs as Record<string, unknown> | null;
  const imageUrl =
    (ro?.image_url as string | undefined) ??
    (ro?.imageUrl as string | undefined) ??
    '';
  await apiFetch(`/scenes/${params.positionCode}/virtual-shelf`, {
    method: 'POST',
    body: JSON.stringify({
      imageUrl: imageUrl || 'data:image/svg+xml;utf8,<svg/>',
      rawOutput: { raw_outputs: params.rawOutputs, context: params.context },
    }),
  });
}

// ---- 货架组（store_shelf_config，按场景过滤） -----------------------------

interface BackendShelfConfig {
  shelfId: string;          // UUID
  shelfCode: string;        // 业务编号（如 pos-0-0）
  positionCode: number;
  groupName: string | null;
  widthCm: number | null;
  layerCount: number | null;
  supportedCategories: string[];
  displayOrder: number;
  attributes: Record<string, unknown>;
}

export async function getShelfGroups(_storeId: string, sceneId: number): Promise<ShelfGroup[]> {
  try {
    const res = await apiFetch('/shelves/config');
    if (!res.ok) return [];
    const data = (await res.json()) as { configs?: BackendShelfConfig[] };
    return (data.configs ?? [])
      .filter((c) => c.positionCode === sceneId)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((c) => ({
        shelf_type: (c.attributes?.shelf_type as string) || '标准货架',
        shelf_width: Number(c.widthCm ?? 0),
        shelf_layers: Number(c.layerCount ?? 0),
        category: c.supportedCategories?.[0],
      }));
  } catch {
    return [];
  }
}

export async function saveShelfGroups(params: {
  storeId: string;
  sceneId: number;
  positionName: string;
  categories: string[];
  groups: ShelfGroup[];
}): Promise<void> {
  const { sceneId, positionName, categories, groups } = params;
  // 1. 取当前 store 全部 config，挑出本场景的 shelfCode 列表
  const list = await apiFetch('/shelves/config');
  const data = list.ok ? ((await list.json()) as { configs?: BackendShelfConfig[] }) : { configs: [] };
  const existingCodes = (data.configs ?? [])
    .filter((c) => c.positionCode === sceneId)
    .map((c) => c.shelfCode);
  // 2. 删除本场景旧行
  if (existingCodes.length) {
    await apiFetch('/shelves/config', {
      method: 'DELETE',
      body: JSON.stringify({ shelfCodes: existingCodes }),
    });
  }
  // 3. 顺序插入新行
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const supportedCategories = g.category ? [g.category] : categories;
    await apiFetch('/shelves/config', {
      method: 'POST',
      body: JSON.stringify({
        shelfCode: groupShelfId(sceneId, i),
        positionCode: sceneId,
        groupName: positionName,
        widthCm: g.shelf_width,
        layerCount: g.shelf_layers,
        supportedCategories,
        displayOrder: i,
        notes: `${positionName} ${i + 1}`,
        attributes: { shelf_type: g.shelf_type || '标准货架' },
      }),
    });
  }
}

// ---- 商品识别 ------------------------------------------------------------

/** Blob → base64 字符串（不带 data URL 前缀） */
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

interface BackendDetectResp {
  boxes?: Array<{ x: number; y: number; w: number; h: number; skuCode: string; confidence: number }>;
  elapsedMs?: number;
}

/**
 * 调商品识别服务，返回原 repo 形态 `matches[]`。
 * 后端 detect-service 若不可用（未部署 GPU/PE/Qdrant 那一套），后端会抛 502；
 * 这里 catch 后返回空数组 —— 上游红框无标注，但诊断/选品/虚拟货架链路不阻塞。
 */
export async function detectImage(blob: Blob): Promise<DetectMatch[]> {
  try {
    const imageBase64 = await blobToBase64(blob);
    const res = await apiFetch('/detect', {
      method: 'POST',
      body: JSON.stringify({ imageBase64, filename: 'shelf.jpg' }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as BackendDetectResp;
    return (data.boxes ?? []).map((b, i) => ({
      id: String(i),
      bbox: [b.x, b.y, b.x + b.w, b.y + b.h],
      matched_sku_id: b.skuCode || null,
      matched_combined: b.confidence,
    }));
  } catch (err) {
    console.warn('[shelves/scenes.detectImage] failed', err);
    return [];
  }
}
