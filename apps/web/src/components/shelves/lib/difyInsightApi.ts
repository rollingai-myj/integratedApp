// Dify 周边商圈洞察工作流（通过后端代理转发，密钥由后端持有）
import { difyProxyUrl } from "./difyProxyUrl";
import { getAuthHeaders } from "@/components/shelves/lib/api-client";
import { readWorkflowFinished } from "./difyWorkflowStream";
import { getDifyUser } from "./difyUser";

export interface InsightQuestion {
  id: number;
  direction: string;
  context: string;
  question: string;
  options: string[];
}

export interface InsightResult {
  category: string;
  crowdSource_analysis: string;
  top_competitors: string[];
  competitor_analysis: string;
}

function tryParseJson(raw: string): any | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {}
    }
    return null;
  }
}

function normalizeQuestions(arr: any): InsightQuestion[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((q: any, idx: number) => ({
      id: typeof q?.id === "number" ? q.id : idx + 1,
      direction: String(q?.direction ?? "").trim(),
      context: String(q?.context ?? "").trim(),
      question: String(q?.question ?? "").trim(),
      options: Array.isArray(q?.options)
        ? q.options.map((x: any) => String(x)).filter(Boolean)
        : [],
    }))
    .filter((q) => q.question || q.context);
}

function normalize(obj: any): InsightResult {
  // 若包了一层 result，向下取
  const src = obj && typeof obj === "object" && obj.result && typeof obj.result === "object" ? obj.result : obj;
  return {
    category: String(src?.category ?? "").trim(),
    crowdSource_analysis: String(
      src?.crowdSource_analysis ?? src?.crowd_source_analysis ?? ""
    ).trim(),
    top_competitors: Array.isArray(src?.top_competitors)
      ? src.top_competitors.map((x: any) => String(x)).filter(Boolean)
      : [],
    competitor_analysis: String(src?.competitor_analysis ?? "").trim(),
  };
}

// 保留以兼容旧引用
function _unusedNormQ() { return normalizeQuestions([]); }

export async function runEnvironmentInsightWorkflow(
  competitor: unknown,
  crowdSource: unknown,
): Promise<InsightResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60 * 1000);
  const res = await fetch(difyProxyUrl("insight", "workflows/run"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    signal: ctrl.signal,
    body: JSON.stringify({
      inputs: {
        competitor: { items: competitor },
        crowdSource: { items: crowdSource },
      },
      response_mode: "streaming",
      user: getDifyUser(),
    }),
  }).finally(() => clearTimeout(t));
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Dify API 错误", res.status, body);
    throw new Error(`Dify API 错误: ${res.status}${body ? ` - ${body.slice(0, 200)}` : ""}`);
  }
  const outputs = await readWorkflowFinished(res);

  // 1) outputs.result（新结构）
  if (outputs && outputs.result) {
    if (typeof outputs.result === "string") {
      const parsed = tryParseJson(outputs.result);
      if (parsed) return normalize(parsed);
    } else if (typeof outputs.result === "object") {
      return normalize(outputs.result);
    }
  }
  // 2) outputs 直接含字段
  if (outputs && (outputs.category || outputs.top_competitors)) {
    return normalize(outputs);
  }
  // 3) outputs.text / outputs.output 是 JSON 字符串或对象
  const candidates = [outputs?.text, outputs?.output];
  for (const c of candidates) {
    if (typeof c === "string") {
      const parsed = tryParseJson(c);
      if (parsed) return normalize(parsed);
    } else if (c && typeof c === "object") {
      return normalize(c as Record<string, unknown>);
    }
  }
  throw new Error("Dify 返回结构无法解析");
}
