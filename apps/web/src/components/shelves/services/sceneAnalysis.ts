import type { SkuRow } from "@/components/shelves/data/skuData";
import { alignShelf, type DiagnosisResult } from "@/components/shelves/services/difyAlignApi";
import { analyzeSelection, type StrategyResult } from "@/components/shelves/services/difyApi";
import { getShelfSurveyAnswers } from "@/components/shelves/services/shelfSurvey";
import { getEnvironmentInsight } from "@/components/shelves/services/storeEnvironment";
import type { PlanPosition } from "@/components/shelves/services/scenes";

function fmt(s: SkuRow) {
  const sales30 = parseFloat(s.sales30d || "0") || 0;
  const vol30 = parseFloat(s.salesVolume30d || "0") || 0;
  return {
    skuCode: s.skuCode,
    skuName: s.skuName,
    spec: s.spec || "",
    majorCategory: s.majorCategory,
    midCategory: s.midCategory || "",
    subCategory: s.subCategory,
    sales30d: sales30.toFixed(2),
    salesVolume30d: vol30.toFixed(2),
    psdChangetb: s.salesChange30d,
    shelfLifeDays: s.shelfLifeDays ?? null,
  };
}

/** 场景级 SKU 集合（按场景品类过滤门店 SKU） */
export function sceneSkus(allStoreSkus: SkuRow[], position: PlanPosition | null): SkuRow[] {
  if (!position) return [];
  const cats = new Set(position.categories);
  return allStoreSkus.filter((s) => cats.has(s.majorCategory));
}

/** 诊断（DIFY_KEY_ALIGN）：传首图 + 场景 SKU */
export async function runSceneDiagnosis(
  storeId: string,
  shelfId: string,
  photoUrl: string,
  skus: SkuRow[],
  position: PlanPosition | null,
): Promise<DiagnosisResult | null> {
  const qa = (await getShelfSurveyAnswers(storeId, shelfId)) ?? [];
  const res = await alignShelf(photoUrl, {
    sku_data: { items: skus.map(fmt) },
    question_answers: qa.length ? { items: qa.map((x) => ({ question: x.question, answer: x.answer })) } : undefined,
    major_category: position?.categories?.[0] ?? "",
    mid_category: [...new Set(skus.map((s) => s.midCategory).filter(Boolean))].join(","),
    sub_category: [...new Set(skus.map((s) => s.subCategory).filter(Boolean))].join(","),
  });
  return res.diagnosis ?? null;
}

/** 选品（DIFY_KEY_SELECTION）：返回单策略（包成数组的第一个） */
export async function runSceneSelection(
  storeId: string,
  shelfId: string,
  skus: SkuRow[],
  position: PlanPosition | null,
): Promise<StrategyResult | null> {
  const [qaRaw, env] = await Promise.all([
    getShelfSurveyAnswers(storeId, shelfId).catch(() => []),
    getEnvironmentInsight(storeId).catch(() => null),
  ]);
  const qa = qaRaw ?? [];
  const questionAnswersJson = qa.length
    ? { items: qa.map((x) => ({ question: x.question, answer: x.answer })) }
    : undefined;
  const results = await analyzeSelection(
    { items: skus.map(fmt) },
    position?.categories?.[0] ?? "",
    [...new Set(skus.map((s) => s.subCategory).filter(Boolean))].join(","),
    [...new Set(skus.map((s) => s.midCategory).filter(Boolean))].join(","),
    undefined,
    undefined,
    questionAnswersJson,
    undefined,
    undefined,
    env ?? undefined,
  );
  return results[0] ?? null;
}
