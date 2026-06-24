// "Session" = a store manager's notion of "one work block":
// they may queue 5 posters, then while those generate add 3 more, and treat
// all 8 as one logical group. A Session contains 1..N underlying batches.
// Persisted in localStorage so refreshes don't break the grouping.

const KEY = 'poster-app/current-session-v1';
export const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 minutes

export type CurrentSession = {
  id: string;
  batchIds: string[];      // in append order
  startedAt: number;
  lastActivityAt: number;
  endedAt: number | null;  // null = still live
};

function read(): CurrentSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s.id !== 'string') return null;
    return s as CurrentSession;
  } catch { return null; }
}

function write(s: CurrentSession | null) {
  if (typeof window === 'undefined') return;
  try {
    if (s === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

export function getCurrentSession(): CurrentSession | null {
  return read();
}

export function isLive(s: CurrentSession | null, now = Date.now()): boolean {
  if (!s) return false;
  if (s.endedAt !== null) return false;
  if (now - s.lastActivityAt > SESSION_IDLE_MS) return false;
  return true;
}

/**
 * Get the live Session if one exists, otherwise create a new empty one.
 * Returned session is persisted. Caller should then call appendBatchToSession.
 */
export function getOrStartSession(now = Date.now()): { session: CurrentSession; created: boolean } {
  const existing = read();
  if (existing && isLive(existing, now)) {
    return { session: existing, created: false };
  }
  const next: CurrentSession = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `s_${now}_${Math.random().toString(36).slice(2, 8)}`,
    batchIds: [],
    startedAt: now,
    lastActivityAt: now,
    endedAt: null,
  };
  write(next);
  return { session: next, created: true };
}

export function appendBatchToSession(batchId: string, now = Date.now()): CurrentSession | null {
  const s = read();
  if (!s) return null;
  if (s.batchIds.includes(batchId)) {
    s.lastActivityAt = now;
    write(s);
    return s;
  }
  s.batchIds = [...s.batchIds, batchId];
  s.lastActivityAt = now;
  write(s);
  return s;
}

export function touchSession(now = Date.now()) {
  const s = read();
  if (!s || s.endedAt !== null) return;
  s.lastActivityAt = now;
  write(s);
}

export function endSession(_reason: 'saved' | 'cleared' | 'new-batch' | 'timeout' | 'logout', now = Date.now()): CurrentSession | null {
  const s = read();
  if (!s) return null;
  s.endedAt = now;
  write(s);
  return s;
}

export function clearSession() {
  write(null);
}

// ============================================================================
// 单张「删除」(从队列视图里隐藏)
// ============================================================================
// 后端 generation 是 30 天审计留痕,不能让用户随便真删 — 任务列表「删除」语义
// 退化为「从我面前藏掉」。下次刷新 / 切设备依旧能从 RecentDrawer 找回。

const HIDDEN_KEY = 'poster-app/hidden-job-ids-v1';

export function readHiddenJobIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch { return new Set(); }
}

export function addHiddenJobIds(ids: string[]) {
  if (typeof window === 'undefined') return;
  const current = readHiddenJobIds();
  for (const id of ids) current.add(id);
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...current])); } catch {}
}
