// Background poster-generation queue, lives at the app root.
// Exposes enqueueBatch(items) to kick off N posters; tracks live progress via
// polling since we no longer use Supabase Realtime.
//
// On top of raw batches we maintain a *Session*: a store-manager-visible
// "work block" that aggregates multiple batches queued close together. UI
// reads `activeSession` instead of the single-batch `active`.
import * as React from "react";
import { toast } from "sonner";
import { authClient } from "./auth-client";
import {
  enqueuePosterJobs,
  processPosterJob,
  listMyActiveJobs,
  dismissBatch,
  resetStaleJob,
  requeuePosterJob,
  type JobItemInput,
} from "@/lib/poster-jobs.functions";
import {
  getOrStartSession,
  appendBatchToSession,
  endSession,
  clearSession,
  getCurrentSession,
  isLive,
  touchSession,
  type CurrentSession,
} from "./session";

const CONCURRENCY = 5;
// A queued/processing job older than this is considered "stuck" (worker
// likely died with the tab). We hide it from the active session view and
// silently dismiss it, so it can't contaminate the next group's count.
const STUCK_MS = 90_000;
// Processing rows older than this almost certainly have no live worker —
// reset them to queued so the auto-resume loop will pick them up.
const PROCESSING_STALE_MS = 60_000;

export type Job = {
  id: string;
  batch_id: string;
  status: "queued" | "processing" | "done" | "error";
  result_image_url: string | null;
  error: string | null;
  position: number;
  params: { copy?: string; sku?: string | null } & Record<string, any>;
  created_at: string;
};

export type Batch = {
  id: string;
  jobs: Job[];
  total: number;
  done: number;
  error: number;
  active: number;
  createdAt: number;
};

export type SessionView = {
  id: string;
  startedAt: number;
  batchIds: string[];
  jobs: Job[];          // flat, ordered by (batch enqueue index, position)
  total: number;
  done: number;
  error: number;
  active: number;
  allFinal: boolean;
  endedAt: number | null;
};

type Ctx = {
  batches: Batch[];
  active: Batch | null;          // kept for backwards-compat (latest batch)
  activeSession: SessionView | null;
  enqueueBatch: (items: JobItemInput[]) => Promise<{ batchId: string; sessionId: string; appended: boolean }>;
  requeueJob: (sourceJob: Job, style: { styleId: "vibrant" | "premium" | "minimal" | "custom"; customStyle?: string | null; copy?: string; newPhotoBase64?: string }) => Promise<void>;
  dismiss: (batchId: string) => Promise<void>;
  endCurrentSession: (reason: "saved" | "cleared" | "new-batch" | "timeout" | "logout") => void;
  dismissCurrentSession: () => Promise<void>;
  refresh: () => Promise<void>;
};

const JobsCtx = React.createContext<Ctx | null>(null);

export function useJobs() {
  const ctx = React.useContext(JobsCtx);
  if (!ctx) throw new Error("JobsProvider missing");
  return ctx;
}

function buildBatches(jobs: Job[]): Batch[] {
  const byBatch = new Map<string, Job[]>();
  for (const j of jobs) {
    if (!byBatch.has(j.batch_id)) byBatch.set(j.batch_id, []);
    byBatch.get(j.batch_id)!.push(j);
  }
  const result: Batch[] = [];
  for (const [id, js] of byBatch) {
    js.sort((a, b) => a.position - b.position);
    const total = js.length;
    const done = js.filter(j => j.status === "done").length;
    const errors = js.filter(j => j.status === "error").length;
    const active = js.filter(j => j.status === "queued" || j.status === "processing").length;
    const createdAt = Math.max(...js.map(j => new Date(j.created_at).getTime()));
    result.push({ id, jobs: js, total, done, error: errors, active, createdAt });
  }
  result.sort((a, b) => b.createdAt - a.createdAt);
  return result;
}

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [userId, setUserId] = React.useState<string | null>(null);
  const [sessionTick, setSessionTick] = React.useState(0); // re-read localStorage on change
  const workersByBatch = React.useRef<Set<string>>(new Set());

  const bumpSession = React.useCallback(() => setSessionTick(t => t + 1), []);

  React.useEffect(() => {
    const sess = authClient.getSession();
    setUserId(sess?.user?.id ?? null);
    const { subscription } = authClient.onAuthStateChange((session) => {
      setUserId(session?.user?.id ?? null);
      if (!session) {
        setJobs([]);
        clearSession();
        bumpSession();
      }
    });
    return () => subscription.unsubscribe();
  }, [bumpSession]);

  // Dedupe by job.id, keeping the most "complete" copy (later status wins).
  const dedupeJobs = (rows: Job[]): Job[] => {
    const byId = new Map<string, Job>();
    const statusRank: Record<Job["status"], number> = {
      queued: 0, processing: 1, error: 2, done: 3,
    };
    for (const r of rows) {
      const prev = byId.get(r.id);
      if (!prev) { byId.set(r.id, r); continue; }
      // Prefer the row with the more advanced status; merge fields otherwise.
      const winner = statusRank[r.status] >= statusRank[prev.status] ? r : prev;
      const loser  = winner === r ? prev : r;
      byId.set(r.id, { ...loser, ...winner });
    }
    return Array.from(byId.values());
  };

  const refresh = React.useCallback(async () => {
    if (!userId) return;
    try {
      const { jobs: rows } = await listMyActiveJobs();
      setJobs(dedupeJobs(rows as Job[]));
    } catch (e) { console.warn("[jobs] list", e); }
  }, [userId]);

  // Initial load + polling (replaces Supabase Realtime).
  React.useEffect(() => {
    if (!userId) return;
    refresh();
    const interval = setInterval(() => refresh(), 3000);
    return () => clearInterval(interval);
  }, [userId, refresh]);

  // Auto-resume processing for queued jobs (covers tab-reload mid-batch).
  // Also rescues "processing" rows whose worker died with the previous tab:
  // we reset them to queued (server-side, idempotent) then enqueue them.
  React.useEffect(() => {
    if (!userId) return;
    const now = Date.now();
    const queuedByBatch = new Map<string, Job[]>();
    const staleProcessing: Job[] = [];
    for (const j of jobs) {
      const ageMs = now - new Date(j.created_at).getTime();
      if (j.status === "queued") {
        if (ageMs > STUCK_MS) continue; // hidden / will be dismissed elsewhere
        if (!queuedByBatch.has(j.batch_id)) queuedByBatch.set(j.batch_id, []);
        queuedByBatch.get(j.batch_id)!.push(j);
      } else if (j.status === "processing" && ageMs > PROCESSING_STALE_MS && ageMs <= STUCK_MS) {
        staleProcessing.push(j);
      }
    }
    // Kick off rescue for stale-processing rows; once reset they'll show up
    // as queued via realtime and the next effect run will pick them up.
    for (const j of staleProcessing) {
      resetStaleJob({ data: { jobId: j.id } }).catch(e => console.warn("[jobs] reset", e));
    }
    for (const [batchId, list] of queuedByBatch) {
      if (workersByBatch.current.has(batchId)) continue;
      workersByBatch.current.add(batchId);
      runWorkerPool(list.map(j => j.id)).finally(() => {
        workersByBatch.current.delete(batchId);
      });
    }
  }, [jobs, userId]);

  // Idle timeout: every 60s, if session is fully finalized and idle > TTL,
  // auto-end it silently so the next enqueue starts a fresh group.
  React.useEffect(() => {
    const t = setInterval(() => {
      const s = getCurrentSession();
      if (!s || s.endedAt !== null) return;
      if (!isLive(s)) {
        endSession("timeout");
        bumpSession();
      }
    }, 60_000);
    return () => clearInterval(t);
  }, [bumpSession]);

  const runWorkerPool = async (jobIds: string[]) => {
    const queue = jobIds.slice();
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const id = queue.shift();
        if (!id) break;
        // Optimistically mark as processing locally — Supabase realtime does
        // NOT guarantee event order, so the server's "processing" UPDATE can
        // arrive after "done" and get dropped by the statusRank dedupe,
        // causing UI to jump straight from "排队中" to the finished image.
        setJobs(prev => prev.map(j =>
          j.id === id && j.status === "queued" ? { ...j, status: "processing" } : j
        ));
        try {
          await processPosterJob({ data: { jobId: id } });
        } catch (e) {
          console.warn("[jobs] process failed", id, e);
        }
      }
    });
    await Promise.all(workers);
  };

  const enqueueBatch = async (items: JobItemInput[]) => {
    // Health check: if the existing "live" session is actually empty after
    // we hide stuck/abandoned rows, force-end it so the next batch starts a
    // fresh group instead of inheriting phantom counters.
    const existing = getCurrentSession();
    if (existing && existing.endedAt === null) {
      const now = Date.now();
      const aliveInSession = jobsRef.current.filter(j => {
        if (!existing.batchIds.includes(j.batch_id)) return false;
        const ageMs = now - new Date(j.created_at).getTime();
        const isStuck = (j.status === "queued" || j.status === "processing") && ageMs > STUCK_MS;
        return !isStuck;
      });
      if (aliveInSession.length === 0 && existing.batchIds.length > 0) {
        // Silently dismiss the phantom batches so they stop being pulled back.
        const ids = existing.batchIds.slice();
        endSession("timeout");
        clearSession();
        bumpSession();
        for (const bid of ids) {
          dismissBatch({ data: { batchId: bid } }).catch(() => {});
        }
        // Drop them from local state too.
        setJobs(prev => prev.filter(j => !ids.includes(j.batch_id)));
      }
    }

    const res = await enqueuePosterJobs({ data: { items } });

    // Update Session BEFORE state set so activeSession picks it up.
    const { session, created } = getOrStartSession();
    appendBatchToSession(res.batchId ?? '');
    bumpSession();

    // No optimistic local insert — realtime + refresh are the only source of
    // truth for job rows, which avoids "ghost" duplicates of the same batch.
    // Trigger a refresh as a safety net in case realtime is briefly delayed.
    refresh();

    // Toast: only when appending into an existing live session.
    if (!created) {
      const nowMs = Date.now();
      const known = jobsRef.current.filter(j => {
        if (!session.batchIds.includes(j.batch_id)) return false;
        if (j.batch_id === res.batchId) return false; // don't double-count new batch
        const ageMs = nowMs - new Date(j.created_at).getTime();
        const isStuck = (j.status === "queued" || j.status === "processing") && ageMs > STUCK_MS;
        return !isStuck;
      }).length;
      const newTotal = known + items.length;
      toast.success(`已加入本组 · 现共 ${newTotal} 张`);
    }

    return { batchId: res.batchId, sessionId: session.id, appended: !created };
  };

  // Keep latest jobs in a ref so enqueueBatch's toast can read fresh totals
  // without making the callback depend on jobs state.
  const jobsRef = React.useRef<Job[]>([]);
  React.useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  const dismiss = async (batchId: string) => {
    setJobs(prev => prev.filter(j => j.batch_id !== batchId));
    try { await dismissBatch({ data: { batchId } }); } catch (e) { console.warn(e); }
  };

  const endCurrentSession = (reason: "saved" | "cleared" | "new-batch" | "timeout" | "logout") => {
    endSession(reason);
    bumpSession();
  };

  const dismissCurrentSession = async () => {
    const s = getCurrentSession();
    if (!s) return;
    const ids = s.batchIds.slice();
    setJobs(prev => prev.filter(j => !ids.includes(j.batch_id)));
    endSession("cleared");
    bumpSession();
    for (const bid of ids) {
      try { await dismissBatch({ data: { batchId: bid } }); } catch (e) { console.warn(e); }
    }
  };

  const requeueJob = async (
    sourceJob: Job,
    style: { styleId: "vibrant" | "premium" | "minimal" | "custom"; customStyle?: string | null; copy?: string; newPhotoBase64?: string },
  ) => {
    const res = await requeuePosterJob({
      data: {
        jobId: sourceJob.id,
        styleId: style.styleId,
        customStyle: style.customStyle ?? null,
        ...(style.copy ? { copy: style.copy } : {}),
        ...(style.newPhotoBase64 ? { newPhotoBase64: style.newPhotoBase64 } : {}),
      },
    });

    // 如果服务端把失败的原行删了，本地也立刻摘掉，避免汇总页面和悬浮球的失败数还残留。
    if (res.sourceDeleted) {
      setJobs(prev => prev.filter(j => j.id !== sourceJob.id));
    }

    // Append the new single-job batch into the live session (or start a fresh one).
    getOrStartSession();
    appendBatchToSession(res.batchId ?? '');
    bumpSession();

    // No optimistic insert — let realtime / refresh deliver the new row,
    // so we never render a ghost duplicate alongside it.
    refresh();

    const s = getCurrentSession();
    const known = s
      ? jobsRef.current.filter(j => s.batchIds.includes(j.batch_id) && j.batch_id !== res.batchId && j.id !== sourceJob.id).length
      : 0;
    toast.success(`已加入本组 · 现共 ${known + 1} 张`);
  };

  const batches = React.useMemo(() => buildBatches(jobs), [jobs]);

  const active = React.useMemo(() => {
    const live = batches.find(b => b.active > 0);
    if (live) return live;
    return batches.find(b => b.done > 0 || b.error > 0) ?? null;
  }, [batches]);

  // Track stuck batch_ids we've already dismissed to avoid spamming the API.
  const dismissedStuckBatches = React.useRef<Set<string>>(new Set());

  const activeSession = React.useMemo<SessionView | null>(() => {
    // sessionTick is read implicitly to re-evaluate when localStorage changes.
    void sessionTick;
    const s = getCurrentSession();
    if (!s) return null;
    const now = Date.now();
    // Drop stuck queued/processing rows from the user-visible session view.
    const rawSessionJobs = jobs.filter(j => s.batchIds.includes(j.batch_id));
    const sessionJobs = rawSessionJobs.filter(j => {
      const ageMs = now - new Date(j.created_at).getTime();
      const isStuck = (j.status === "queued" || j.status === "processing") && ageMs > STUCK_MS;
      return !isStuck;
    });
    // Silently dismiss any batch where ALL remaining rows are stuck — they
    // are leftovers from a previous tab that crashed, and the user has no
    // way to recover them. Skip batches that have at least one healthy row.
    const batchHealth = new Map<string, { stuck: number; healthy: number }>();
    for (const j of rawSessionJobs) {
      const h = batchHealth.get(j.batch_id) ?? { stuck: 0, healthy: 0 };
      const ageMs = now - new Date(j.created_at).getTime();
      const isStuck = (j.status === "queued" || j.status === "processing") && ageMs > STUCK_MS;
      if (isStuck) h.stuck += 1; else h.healthy += 1;
      batchHealth.set(j.batch_id, h);
    }
    for (const [bid, h] of batchHealth) {
      if (h.healthy === 0 && h.stuck > 0 && !dismissedStuckBatches.current.has(bid)) {
        dismissedStuckBatches.current.add(bid);
        dismissBatch({ data: { batchId: bid } }).catch(() => {});
      }
    }

    if (s.endedAt !== null && sessionJobs.length === 0) return null;
    if (sessionJobs.length === 0) return null;

    // Order: by batch index within session, then position.
    const batchIdx = new Map(s.batchIds.map((id, i) => [id, i]));
    const sorted = sessionJobs.slice().sort((a, b) => {
      const ai = batchIdx.get(a.batch_id) ?? 0;
      const bi = batchIdx.get(b.batch_id) ?? 0;
      if (ai !== bi) return ai - bi;
      return a.position - b.position;
    });

    const total = sorted.length;
    const done = sorted.filter(j => j.status === "done").length;
    const errors = sorted.filter(j => j.status === "error").length;
    const activeN = sorted.filter(j => j.status === "queued" || j.status === "processing").length;
    return {
      id: s.id,
      startedAt: s.startedAt,
      batchIds: s.batchIds,
      jobs: sorted,
      total, done, error: errors, active: activeN,
      allFinal: activeN === 0,
      endedAt: s.endedAt,
    };
  }, [jobs, sessionTick]);

  return (
    <JobsCtx.Provider value={{
      batches, active, activeSession,
      enqueueBatch, requeueJob, dismiss,
      endCurrentSession, dismissCurrentSession,
      refresh,
    }}>
      {children}
    </JobsCtx.Provider>
  );
}
