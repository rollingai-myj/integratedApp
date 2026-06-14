// Session-level history persisted in localStorage. One history entry = one
// store-manager work block (= one Session, may span multiple batches).
//
// Migrates one-time from the older v1 batch-history (one entry per batch)
// into the v2 session shape (each old batch becomes a single-batch session).

const KEY_V2 = 'poster-app/session-history-v2';
const KEY_V1 = 'poster-app/batch-history-v1';
const MAX = 30;

export type SessionHistoryItem = {
  imageUrl: string;
  copy?: string;
  sku?: string | null;
};

export type SessionHistory = {
  id: string;
  startedAt: number;
  endedAt: number;
  total: number;             // including failed jobs across all batches
  items: SessionHistoryItem[]; // successful posters only
  /** 写入时当前 currentStore.id。销量跟踪 tab 按当前 store 过滤；老数据为空。 */
  storeId?: string | null;
};

function migrateV1IfNeeded() {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(KEY_V2)) return; // already migrated/started
    const rawV1 = localStorage.getItem(KEY_V1);
    if (!rawV1) return;
    const arr = JSON.parse(rawV1);
    if (!Array.isArray(arr)) return;
    const migrated: SessionHistory[] = arr.map((b: any) => ({
      id: b.id,
      startedAt: b.ts,
      endedAt: b.ts,
      total: b.total ?? (Array.isArray(b.items) ? b.items.length : 0),
      items: Array.isArray(b.items) ? b.items : [],
    }));
    localStorage.setItem(KEY_V2, JSON.stringify(migrated.slice(0, MAX)));
    // Keep v1 around for now (cheap) — could remove later.
  } catch { /* ignore */ }
}

export function loadSessionHistory(): SessionHistory[] {
  if (typeof window === 'undefined') return [];
  migrateV1IfNeeded();
  try {
    const raw = localStorage.getItem(KEY_V2);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // 老条目 items[].imageUrl 可能是 data:image/...;base64,...（OSS 转存修复之前留下）。
    // iOS Safari 拿大 base64 渲染失败显示纯黑——load 时过滤掉这些 item，session 也跟着
    // 重写回 localStorage 顺手清理。空 session 不丢，记录还在。
    let dirty = false;
    const cleaned = arr.map((s: SessionHistory) => {
      const items = Array.isArray(s.items)
        ? s.items.filter(it => typeof it?.imageUrl === 'string' && !it.imageUrl.startsWith('data:'))
        : [];
      if (items.length !== s.items?.length) dirty = true;
      return { ...s, items };
    });
    if (dirty) {
      try { localStorage.setItem(KEY_V2, JSON.stringify(cleaned)); } catch {}
    }
    return cleaned;
  } catch { return []; }
}

export function saveSession(s: SessionHistory): SessionHistory[] {
  const list = loadSessionHistory().filter(x => x.id !== s.id); // dedupe by sessionId
  const next = [s, ...list].slice(0, MAX);
  try { localStorage.setItem(KEY_V2, JSON.stringify(next)); } catch { }
  return next;
}

export function removeSession(id: string): SessionHistory[] {
  const next = loadSessionHistory().filter(x => x.id !== id);
  try { localStorage.setItem(KEY_V2, JSON.stringify(next)); } catch { }
  return next;
}

export function isSessionSaved(id: string): boolean {
  return loadSessionHistory().some(x => x.id === id);
}
