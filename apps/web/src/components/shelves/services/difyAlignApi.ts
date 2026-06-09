/**
 * Dify 货架对齐+诊断智能体 API（唯一诊断入口）
 * 调用 workflow API，一次返回：区域诊断结果（圆圈坐标 + 描述）
 */

import { difyProxyUrl } from "@/components/shelves/lib/difyProxyUrl";
import { getAuthHeaders } from "@/components/shelves/lib/api-client";
import { getDifyUser } from "@/components/shelves/lib/difyUser";
import { readWorkflowFinished } from "@/components/shelves/lib/difyWorkflowStream";

function getCurrentDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 之前从硬编码 STORE_CITY_MAP / PROJECT_STORES 取数；V029 之后 stores 表加了
 * city + is_project_store 列，由 /auth/me 透出，无硬编码。
 *
 * 注：current-store.ts 缓存的 CurrentStoreInfo 只透 id/code/name；city + isProjectStore
 * 还要发一次 /auth/me 拿全字段。后续 PR 应在 current-store 里扩字段一并缓存。
 */
async function getStoreContextForDify(): Promise<{ city: string; isProjectStore: boolean }> {
  try {
    const res = await fetch("/api/v1/auth/me", { credentials: "include" });
    if (!res.ok) return { city: "", isProjectStore: false };
    const data = (await res.json()) as {
      currentStore?: { city?: string | null; isProjectStore?: boolean };
    };
    return {
      city: data.currentStore?.city ?? "",
      isProjectStore: !!data.currentStore?.isProjectStore,
    };
  } catch {
    return { city: "", isProjectStore: false };
  }
}

/** 诊断结果：三段话 */
export interface DiagnosisResult {
  paragraph_customer: string;    // 客群分析
  paragraph_competition: string; // 竞争分析
  paragraph_status: string;      // 现状分析
}

export interface AlignmentResult {
  diagnosis?: DiagnosisResult;
}

/** Try to extract any JSON value (object or array) from messy text */
function extractJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    /* fallback */
  }

  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      /* fallback */
    }
  }

  // Prefer top-level array if it appears before any object
  const arrIdx = raw.indexOf("[");
  const objIdx = raw.indexOf("{");
  const tryArrFirst = arrIdx !== -1 && (objIdx === -1 || arrIdx < objIdx);

  if (tryArrFirst) {
    const arrMatch = raw.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try {
        return JSON.parse(arrMatch[0]);
      } catch {
        /* fallback */
      }
    }
  }

  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {
      /* fallback */
    }
  }

  if (!tryArrFirst) {
    const arrMatch = raw.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try {
        return JSON.parse(arrMatch[0]);
      } catch {
        /* fallback */
      }
    }
  }

  return null;
}

/**
 * Call Dify alignment+diagnosis workflow: send photo URL + SKU data, return diagnosis circles
 */
export async function alignShelf(
  photoUrl: string,
  payload: {
    sku_data: unknown;
    benchmark_sku_data?: unknown;
    gapAnalysis_benchmarkOnly?: unknown;
    question_answers?: unknown;
    major_category?: string;
    mid_category?: string;
    sub_category?: string;
    is_project_store?: string;
    competitor_products?: unknown;
    poi_data?: unknown;
  },
): Promise<AlignmentResult> {
  const storeCtx = await getStoreContextForDify();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60 * 1000);

  const res = await fetch(difyProxyUrl("align", "workflows/run"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    signal: controller.signal,
    body: JSON.stringify({
      inputs: {
        photo: { transfer_method: "remote_url", url: photoUrl, type: "image" },
        sku_data: payload.sku_data,
        benchmark_sku_data: payload.benchmark_sku_data ?? { items: [] },
        gapAnalysis_benchmarkOnly: payload.gapAnalysis_benchmarkOnly ?? { items: [] },
        major_category: payload.major_category ?? "",
        mid_category: payload.mid_category ?? "",
        sub_category: payload.sub_category ?? "",
        current_date: getCurrentDateStr(),
        province: "广东",
        city: storeCtx.city,
        is_project_store: payload.is_project_store ?? (storeCtx.isProjectStore ? "true" : "false"),
        ...(payload.question_answers ? { question_answers: payload.question_answers } : {}),
        ...(payload.competitor_products ? { competitor_products: payload.competitor_products } : {}),
        ...(payload.poi_data ? { poi_data: payload.poi_data } : {}),
      },
      response_mode: "streaming",
      user: getDifyUser(),
    }),
  }).finally(() => clearTimeout(timeoutId));

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`诊断API错误 [${res.status}]: ${errText}`);
  }

  const outputs = await readWorkflowFinished(res);

  // Dify returns outputs["Diagnosis"] as a JSON-encoded string wrapping { "diagnosis": { paragraph_* } }
  const rawStr = typeof outputs["Diagnosis"] === "string" ? outputs["Diagnosis"] as string : JSON.stringify(outputs);
  const outer = extractJsonValue(rawStr);
  const inner = (outer && typeof outer === "object" && !Array.isArray(outer))
    ? (outer as Record<string, unknown>)["diagnosis"] ?? outer
    : outer;

  if (!inner || typeof inner !== "object" || Array.isArray(inner)) {
    return {};
  }
  const d = inner as Record<string, unknown>;
  const diagnosis: DiagnosisResult = {
    paragraph_customer: String(d.paragraph_customer ?? ""),
    paragraph_competition: String(d.paragraph_competition ?? ""),
    paragraph_status: String(d.paragraph_status ?? ""),
  };

  const hasContent = diagnosis.paragraph_customer || diagnosis.paragraph_competition || diagnosis.paragraph_status;
  return { diagnosis: hasContent ? diagnosis : undefined };
}
