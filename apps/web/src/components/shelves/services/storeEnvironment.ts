/**
 * 周边环境洞察（V025 之后真正接 backend）
 *
 * Backend：
 *   GET  /api/v1/master/environment/:storeUuid   返回 { insight }
 *   PUT  /api/v1/master/environment/:storeUuid   partial upsert，未传字段不覆盖
 *
 * Schema：V025 在 store_environment_insights 加了 6 列 —— category /
 * crowd_source_analysis / competitor_analysis / top_competitors[] /
 * questions[] / report_markdown，原 repo 字段全部 1:1 对应（不再借 JSONB 兜）。
 *
 * 入参 storeId 是原 repo 的 store 编号（"粤37893" / "1534"），不是 UUID；
 * shim 内通过 current-store 把 code 翻译成 UUID。
 */
import type { InsightQuestion } from '@/components/shelves/lib/difyInsightApi';
import { apiFetch } from '@/components/shelves/lib/api-client';
import { getCurrentStore } from '@/components/shelves/lib/current-store';

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

interface BackendInsight {
  storeId: string;
  city: string | null;
  mainDemographic: string | null;
  consumptionLevel: string | null;
  competitorCount: number | null;
  populationDensity: string | null;
  category: string | null;
  crowdSourceAnalysis: string | null;
  competitorAnalysis: string | null;
  topCompetitors: string[];
  questions: InsightQuestion[];
  reportMarkdown: string | null;
  insightData: Record<string, unknown>;
  generatedAt: string;
  source: string | null;
}

function backendToFront(b: BackendInsight): StoreEnvironmentInsight {
  const poi = (b.insightData?.poi_count as number | undefined) ?? b.competitorCount ?? 0;
  return {
    store_id: b.storeId,
    poi_count: poi,
    category: b.category,
    crowd_source_analysis: b.crowdSourceAnalysis,
    top_competitors: b.topCompetitors ?? [],
    competitor_analysis: b.competitorAnalysis,
    questions: b.questions ?? [],
    report_markdown: b.reportMarkdown ?? '',
    updated_at: b.generatedAt,
  };
}

export async function getEnvironmentInsight(
  _storeCode: string,
): Promise<StoreEnvironmentInsight | null> {
  const store = await getCurrentStore();
  if (!store) return null;
  try {
    const res = await apiFetch(`/master/environment/${store.id}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { insight?: BackendInsight | null };
    if (!data.insight) return null;
    return backendToFront(data.insight);
  } catch (err) {
    console.warn('[shelves/storeEnvironment.get] failed', err);
    return null;
  }
}

interface SaveInput {
  storeId: string;
  poiCount?: number;
  category?: string;
  crowdSourceAnalysis?: string;
  topCompetitors?: string[];
  competitorAnalysis?: string;
  questions?: InsightQuestion[];
}

async function upsert(body: Record<string, unknown>) {
  const store = await getCurrentStore();
  if (!store) throw new Error('未选择门店');
  const res = await apiFetch(`/master/environment/${store.id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`保存失败 ${res.status}`);
}

export async function saveEnvironmentInsight(input: SaveInput): Promise<void> {
  await upsert({
    category: input.category ?? null,
    crowdSourceAnalysis: input.crowdSourceAnalysis ?? null,
    topCompetitors: input.topCompetitors ?? [],
    competitorAnalysis: input.competitorAnalysis ?? null,
    questions: input.questions ?? [],
    // poi_count 放在 insightData 里（backend 没有专列）
    ...(input.poiCount !== undefined
      ? { insightData: { poi_count: input.poiCount } }
      : {}),
  });
}

export async function updateEnvironmentCategory(_storeCode: string, category: string): Promise<void> {
  await upsert({ category });
}

export async function updateEnvironmentQuestions(
  _storeCode: string,
  questions: InsightQuestion[],
): Promise<void> {
  await upsert({ questions });
}
