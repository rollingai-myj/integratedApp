// Recent posters persisted in localStorage.
const KEY = 'poster-app/recent-v1';
const MAX = 30;

export type RecentPoster = {
  id: string;
  imageUrl: string;
  copy: string;
  ts: number;
};

export function loadRecent(): RecentPoster[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // 老条目 imageUrl 可能是 data:image/...;base64,...（OSS 转存修复之前留下）。
    // iOS Safari 拿大 base64 渲染失败显示纯黑——loadRecent 时直接过掉，并写回 localStorage 顺手清理。
    const cleaned = arr.filter((r: RecentPoster) => typeof r?.imageUrl === 'string' && !r.imageUrl.startsWith('data:'));
    if (cleaned.length !== arr.length) {
      try { localStorage.setItem(KEY, JSON.stringify(cleaned)); } catch {}
    }
    return cleaned;
  } catch { return []; }
}

export function addRecent(p: Omit<RecentPoster, 'id' | 'ts'>): RecentPoster[] {
  const list = loadRecent();
  // Skip duplicate if same imageUrl as most-recent entry.
  if (list[0]?.imageUrl === p.imageUrl) return list;
  const item: RecentPoster = { ...p, id: String(Date.now()), ts: Date.now() };
  const next = [item, ...list].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  return next;
}

export function removeRecent(id: string): RecentPoster[] {
  const next = loadRecent().filter(r => r.id !== id);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  return next;
}

// Count of items created within the current ISO week (Mon-Sun).
export function countThisWeek(list: RecentPoster[]): number {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 0=Mon
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - day);
  const start = monday.getTime();
  return list.filter(r => r.ts >= start).length;
}
