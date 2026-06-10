import { padSkuCode } from "@/components/shelves/lib/skuCode";
import { difyProxyUrl, type DifyApp } from "@/components/shelves/lib/difyProxyUrl";
import { getAuthHeaders } from "@/components/shelves/lib/api-client";
import { readWorkflowFinished } from "@/components/shelves/lib/difyWorkflowStream";
import { getDifyUser } from "@/components/shelves/lib/difyUser";
import { serializeDifyInputs } from "@/components/shelves/lib/difyInputs";

async function callWorkflow(
  app: DifyApp,
  inputs: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const res = await fetch(difyProxyUrl(app, "workflows/run"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    signal: controller.signal,
    body: JSON.stringify({
      // Dify text-input/paragraph 字段不允许 object/array；统一在出口序列化。
      inputs: serializeDifyInputs(inputs),
      response_mode: "streaming",
      user: getDifyUser(),
    }),
  }).finally(() => clearTimeout(timeoutId));

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Dify API 错误 [${res.status}]: ${errText}`);
  }

  return readWorkflowFinished(res);
}

/** Extract the first string value from Dify workflow outputs, checking common field names first */
function extractOutputString(outputs: Record<string, unknown>): string {
  for (const key of ["Selection", "ShelfAiResult", "SelectionResult", "result", "text"]) {
    if (typeof outputs[key] === "string") return outputs[key] as string;
  }
  for (const val of Object.values(outputs)) {
    if (typeof val === "string") return val as string;
  }
  return JSON.stringify(outputs);
}

/** Parse JSON array from potentially messy Dify output (plain text, markdown code blocks, etc.) */
function extractJsonArray(raw: string): unknown[] {
  // 1. Direct parse
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* fallback */
  }

  // 2. Extract from markdown ```json ... ``` code blocks
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return [parsed];
    } catch {
      /* fallback */
    }
  }

  // 3. Find JSON array in mixed text
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      // 4. Repair truncated JSON
      let repaired = arrayMatch[0];
      let braces = 0,
        brackets = 0;
      for (const ch of repaired) {
        if (ch === "{") braces++;
        if (ch === "}") braces--;
        if (ch === "[") brackets++;
        if (ch === "]") brackets--;
      }
      while (braces > 0) {
        repaired += "}";
        braces--;
      }
      while (brackets > 0) {
        repaired += "]";
        brackets--;
      }
      try {
        return JSON.parse(repaired);
      } catch {
        /* give up */
      }
    }
  }

  throw new Error("无法从AI返回中提取JSON数组");
}

export interface StrategySkuItem {
  skuCode: string;
  skuName: string;
  spec?: string;
  action: string;
  tags?: string[];
  reason: string;
  avg90DaySales?: string;
}

export interface StrategyResult {
  name: string;
  description: string;
  skus: StrategySkuItem[];
}

function getCurrentDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 之前从硬编码 STORE_CITY_MAP 取数；V029 之后改读 /auth/me 的 currentStore.city。
 */
async function getStoreCity(): Promise<string> {
  try {
    const res = await fetch("/api/v1/auth/me", { credentials: "include" });
    if (!res.ok) return "";
    const data = (await res.json()) as { currentStore?: { city?: string | null } };
    return data.currentStore?.city ?? "";
  } catch {
    return "";
  }
}

/**
 * Call Dify workflow for SKU selection strategies
 */
export async function analyzeSelection(
  skuData: unknown,
  majorCategory: string,
  subCategory: string,
  midCategory?: string,
  benchmarkSkuData?: unknown,
  gapAnalysisBenchmarkOnly?: unknown,
  questionAnswers?: unknown,
  isProjectStore?: string,
  competitorProducts?: unknown,
  poiData?: unknown,
): Promise<StrategyResult[]> {
  const city = await getStoreCity();
  const inputs: Record<string, unknown> = {
    sku_data: skuData,
    major_category: majorCategory,
    mid_category: midCategory,
    sub_category: subCategory,
    current_date: getCurrentDateStr(),
    province: "广东",
    city,
  };
  if (typeof isProjectStore === "string") {
    inputs.is_project_store = isProjectStore;
  }
  inputs.benchmark_sku_data = benchmarkSkuData ?? { items: [] };
  inputs.gapAnalysis_benchmarkOnly = gapAnalysisBenchmarkOnly ?? { items: [] };
  if (competitorProducts) {
    inputs.competitor_products = competitorProducts;
  }
  if (poiData) {
    inputs.poi_data = poiData;
  }
  if (questionAnswers) {
    inputs.question_answers = questionAnswers;
  }
  const outputs = await callWorkflow("selection", inputs, 5 * 60 * 1000);

  // 鲁棒提取策略：Dify 可能把结果放在 Selection/result/text 字段（字符串或对象），
  // 也可能把整个 outputs 当作策略对象（{name,description,skus}）返回。
  const looksLikeStrategy = (o: unknown): o is Record<string, unknown> =>
    !!o && typeof o === "object" && !Array.isArray(o) &&
    (Array.isArray((o as any).skus) || Array.isArray((o as any)["SKU列表"]) ||
      "name" in (o as any) || "策略名称" in (o as any));

  const coerce = (v: unknown): Record<string, unknown>[] | null => {
    if (v == null) return null;
    if (typeof v === "string") {
      // Dify 工作流的 output 字段类型若是 string/paragraph，会把 strategy 对象
      // JSON.stringify 后返回。
      //
      // 顺序敏感：必须先尝试整段 JSON.parse 辨别 strategy/array；如果直接走
      // extractJsonArray 的"找 \[...\] 子串"正则，会错抓 strategy 对象 *内部*
      // 的 skus 子数组当成 strategy 数组（每个 SKU 被当成"一个 strategy"，结
      // 果策略级 skus 字段全空）—— 真实 case 见 commit 历史。
      try {
        const parsed = JSON.parse(v);
        if (looksLikeStrategy(parsed)) return [parsed as Record<string, unknown>];
        if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
      } catch { /* 不是干净 JSON，尝试兜底 */ }
      // 兜底：响应可能裹了 ```json 块或夹杂自然语言；extractJsonArray 用正则提取
      try {
        const a = extractJsonArray(v);
        if (a.length) return a as Record<string, unknown>[];
      } catch { /* give up */ }
      return null;
    }
    if (Array.isArray(v)) return v as Record<string, unknown>[];
    if (looksLikeStrategy(v)) return [v];
    return null;
  };

  let itemsToMap: Record<string, unknown>[] | null = null;
  for (const key of ["Selection", "ShelfAiResult", "SelectionResult", "result", "text", "output"]) {
    itemsToMap = coerce(outputs[key]);
    if (itemsToMap) break;
  }
  if (!itemsToMap) itemsToMap = coerce(outputs);                 // outputs 本身就是策略对象
  if (!itemsToMap) {                                             // 兜底：扫描所有值
    for (const v of Object.values(outputs)) { itemsToMap = coerce(v); if (itemsToMap) break; }
  }
  if (!itemsToMap) itemsToMap = [];

  const results = itemsToMap.map((item: Record<string, unknown>) => ({
    name: String(item.name || item["策略名称"] || ""),
    description: String(item.description || item["策略描述"] || ""),
    skus: Array.isArray(item.skus || item["SKU列表"])
      ? ((item.skus as Record<string, unknown>[]) || (item["SKU列表"] as Record<string, unknown>[])).map(
          (sku: Record<string, unknown>) => ({
            skuCode: padSkuCode(sku.skuCode || sku["商品代码"]),
            skuName: String(sku.skuName || sku["商品名称"] || ""),
            action: String(sku.action || sku["建议动作"] || ""),
            tags: Array.isArray(sku.tags) ? (sku.tags as string[]) : [],
            reason: String(sku.reason || sku["理由"] || ""),
          }),
        )
      : [],
  }));

  const invalidSkus = results.flatMap(s => s.skus.filter(sku => !/^\d{8}$/.test(sku.skuCode)));
  if (invalidSkus.length > 0) {
    const samples = invalidSkus.slice(0, 3).map(s => `${s.skuCode}(${s.skuName})`).join("、");
    throw new Error(`INVALID_SKU_CODE:${samples}`);
  }

  return results;
}

/** Check if Dify keys are configured (always true now that keys live server-side). */
export const isDifyConfigured = {
  selection: () => true,
};
