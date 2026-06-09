/**
 * 周边环境洞察（shim）
 *
 * 整合 app 的 /master/environment/:storeId 字段（city / mainDemographic / consumptionLevel / ...）
 * 与原 repo 的（category / crowd_source_analysis / top_competitors[] / questions[] / ...）
 * 是两个完全不同的领域模型。这一轮 1:1 移植不动后端 schema —— 把整个原结构存
 * localStorage，按 storeCode 索引；跨设备不共享，但同一浏览器内 PhotoPage 的
 * `runSceneSelection` 能拿到 env 输入。
 *
 * 后续要做超管后台共享 env 时，再开 backend schema 字段扩展。
 */
import type { InsightQuestion } from '@/components/shelves/lib/difyInsightApi';

export interface StoreEnvironmentInsight {
  store_id: string;
  poi_count: number;
  category: string | null;
  crowd_source_analysis: string | null;
  top_competitors: string[];
  competitor_analysis: string | null;
  questions: InsightQuestion[];
  report_markdown: string;
  updated_at: string;
}

const KEY = (storeId: string) => `store_env_${storeId}`;

function readRaw(storeId: string): Partial<StoreEnvironmentInsight> | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(KEY(storeId));
    return raw ? (JSON.parse(raw) as Partial<StoreEnvironmentInsight>) : null;
  } catch {
    return null;
  }
}

function writeRaw(storeId: string, patch: Partial<StoreEnvironmentInsight>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const cur = readRaw(storeId) ?? {};
    const merged = { ...cur, ...patch, store_id: storeId, updated_at: new Date().toISOString() };
    localStorage.setItem(KEY(storeId), JSON.stringify(merged));
  } catch (err) {
    console.warn('[shelves/storeEnvironment.write] failed', err);
  }
}

function normalize(p: Partial<StoreEnvironmentInsight> | null, storeId: string): StoreEnvironmentInsight | null {
  if (!p) return null;
  return {
    store_id: p.store_id ?? storeId,
    poi_count: p.poi_count ?? 0,
    category: p.category ?? null,
    crowd_source_analysis: p.crowd_source_analysis ?? null,
    top_competitors: Array.isArray(p.top_competitors) ? p.top_competitors : [],
    competitor_analysis: p.competitor_analysis ?? null,
    questions: Array.isArray(p.questions) ? p.questions : [],
    report_markdown: p.report_markdown ?? '',
    updated_at: p.updated_at ?? '',
  };
}

export async function getEnvironmentInsight(storeId: string): Promise<StoreEnvironmentInsight | null> {
  if (!storeId) return null;
  return normalize(readRaw(storeId), storeId);
}

export async function saveEnvironmentInsight(input: {
  storeId: string;
  poiCount?: number;
  category?: string;
  crowdSourceAnalysis?: string;
  topCompetitors?: string[];
  competitorAnalysis?: string;
  questions?: InsightQuestion[];
}): Promise<void> {
  writeRaw(input.storeId, {
    poi_count: input.poiCount,
    category: input.category ?? null,
    crowd_source_analysis: input.crowdSourceAnalysis ?? null,
    top_competitors: input.topCompetitors ?? [],
    competitor_analysis: input.competitorAnalysis ?? null,
    questions: input.questions ?? [],
  });
}

export async function updateEnvironmentCategory(storeId: string, category: string): Promise<void> {
  writeRaw(storeId, { category });
}

export async function updateEnvironmentQuestions(
  storeId: string,
  questions: InsightQuestion[],
): Promise<void> {
  writeRaw(storeId, { questions });
}
