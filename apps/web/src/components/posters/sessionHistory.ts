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
    return Array.isArray(arr) ? arr : [];
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
