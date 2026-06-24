// 海报任务上下文(后端 worker 接管后的版本)。
//
// 关键差别(对比旧版浏览器即 worker):
//   - 不再调 processPosterJob、不再开 runWorkerPool —— AI 由 api-worker 容器跑。
//   - 不再有 STUCK_MS 自杀逻辑 —— 卡死交给后端 claim_expires_at + reclaim 超时回收。
//   - 轮询从 listMyActiveJobs(只回 active) 换成 listMyRecentJobs(近 30 天全状态)
//     → 关 tab/换浏览器/换电脑回来,生成记录全在,任务队列「常驻」。
//   - localStorage 里的 Session 只剩"当前队列的视觉分隔",不再承载结果数据。
import * as React from "react";
import { toast } from "sonner";
import { authClient } from "./auth-client";
import {
  enqueuePosterJobs,
  listMyRecentJobs,
  dismissBatch,
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
  readHiddenJobIds,
  addHiddenJobIds,
  type CurrentSession,
} from "./session";

const RECENT_DAYS = 30;

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
  /** 全部近 30 天 task,「生成记录」面板用 */
  recentJobs: Job[];
  enqueueBatch: (items: JobItemInput[]) => Promise<{ batchId: string; sessionId: string; appended: boolean }>;
  requeueJob: (sourceJob: Job, style: { styleId: "vibrant" | "premium" | "minimal" | "custom"; customStyle?: string | null; copy?: string; newPhotoBase64?: string }) => Promise<void>;
  dismiss: (batchId: string) => Promise<void>;
  /** 把单个 job 从当前队列视图里藏掉(localStorage 标记,30 天历史不动) */
  dismissJob: (jobId: string) => void;
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
  const [hiddenIds, setHiddenIds] = React.useState<Set<string>>(() => readHiddenJobIds());

  const bumpSession = React.useCallback(() => setSessionTick(t => t + 1), []);

  const dismissJob = React.useCallback((jobId: string) => {
    addHiddenJobIds([jobId]);
    setHiddenIds(prev => {
      const next = new Set(prev);
      next.add(jobId);
      return next;
    });
  }, []);

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

  // Dedupe by job.id, keeping the most "advanced" status.
  const dedupeJobs = (rows: Job[]): Job[] => {
    const byId = new Map<string, Job>();
    const statusRank: Record<Job["status"], number> = {
      queued: 0, processing: 1, error: 2, done: 3,
    };
    for (const r of rows) {
      const prev = byId.get(r.id);
      if (!prev) { byId.set(r.id, r); continue; }
      const winner = statusRank[r.status] >= statusRank[prev.status] ? r : prev;
      const loser  = winner === r ? prev : r;
      byId.set(r.id, { ...loser, ...winner });
    }
    return Array.from(byId.values());
  };

  // 拉近 30 天全状态 → 服务端 = 唯一事实源。
  // 关 tab 后回来也能完整重建队列 + 生成记录。
  const refresh = React.useCallback(async () => {
    if (!userId) return;
    try {
      const { jobs: rows } = await listMyRecentJobs(RECENT_DAYS);
      setJobs(dedupeJobs(rows as Job[]));
    } catch (e) { console.warn("[jobs] list", e); }
  }, [userId]);

  // Initial load + 3s polling.
  React.useEffect(() => {
    if (!userId) return;
    refresh();
    const interval = setInterval(() => refresh(), 3000);
    return () => clearInterval(interval);
  }, [userId, refresh]);

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

  const enqueueBatch = async (items: JobItemInput[]) => {
    const res = await enqueuePosterJobs({ data: { items } });

    // Update Session BEFORE state set so activeSession picks it up.
    const { session, created } = getOrStartSession();
    appendBatchToSession(res.batchId ?? '');
    bumpSession();

    // 把刚入队的 job 占位插到本地 state(状态 queued),让 badge/drawer 秒亮。
    // 下一轮 3s refresh 拉到真实状态(processing/done/error)会按 statusRank 合并覆盖。
    if (res.batchId && Array.isArray(res.jobIds) && res.jobIds.length > 0) {
      const now = new Date().toISOString();
      const placeholderJobs: Job[] = res.jobIds.map((id, idx) => ({
        id,
        batch_id: res.batchId,
        status: "queued",
        result_image_url: null,
        error: null,
        position: idx,
        params: {
          copy: items[idx]?.copy,
          sku: items[idx]?.sku ?? null,
        },
        created_at: now,
      }));
      setJobs(prev => dedupeJobs([...prev, ...placeholderJobs]));
    }

    // 立刻拉一遍,缩短"提交→看到 worker 拣起"的窗口(从 3s 降到 ~100ms)
    refresh();

    // Toast: only when appending into an existing live session.
    if (!created) {
      const known = jobsRef.current.filter(j =>
        session.batchIds.includes(j.batch_id) && j.batch_id !== res.batchId,
      ).length;
      const newTotal = known + items.length;
      toast.success(`已加入队列 · 当前 ${newTotal} 张`);
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
    // clearSession 而非 endSession:后者只标 endedAt,session.batchIds 还在,
    // 下一轮 refresh 把后端的 canceled 行拉回 jobs,activeSession 又重新渲染出
    // 全失败状态的浮球。clearSession 直接抹掉 localStorage,
    // getCurrentSession 返回 null → activeSession 也返回 null,浮球真正消失。
    clearSession();
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

    // 如果服务端把失败的原行删了,本地也立刻摘掉
    if (res.sourceDeleted) {
      setJobs(prev => prev.filter(j => j.id !== sourceJob.id));
    }

    // Append the new single-job batch into the live session (or start a fresh one).
    getOrStartSession();
    appendBatchToSession(res.batchId ?? '');
    bumpSession();

    refresh();

    const s = getCurrentSession();
    const known = s
      ? jobsRef.current.filter(j => s.batchIds.includes(j.batch_id) && j.batch_id !== res.batchId && j.id !== sourceJob.id).length
      : 0;
    toast.success(`已加入队列 · 当前 ${known + 1} 张`);
  };

  const batches = React.useMemo(() => buildBatches(jobs), [jobs]);

  const active = React.useMemo(() => {
    const live = batches.find(b => b.active > 0);
    if (live) return live;
    return batches.find(b => b.done > 0 || b.error > 0) ?? null;
  }, [batches]);

  const activeSession = React.useMemo<SessionView | null>(() => {
    // sessionTick is read implicitly to re-evaluate when localStorage changes.
    void sessionTick;
    const s = getCurrentSession();
    if (!s) return null;
    const sessionJobs = jobs.filter(j => s.batchIds.includes(j.batch_id) && !hiddenIds.has(j.id));

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
  }, [jobs, sessionTick, hiddenIds]);

  return (
    <JobsCtx.Provider value={{
      batches, active, activeSession,
      recentJobs: jobs,
      enqueueBatch, requeueJob, dismiss, dismissJob,
      endCurrentSession, dismissCurrentSession,
      refresh,
    }}>
      {children}
    </JobsCtx.Provider>
  );
}
