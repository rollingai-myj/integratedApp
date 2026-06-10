// Dify 提问生成智能体（通过后端代理转发，密钥由后端持有）
import type { InsightQuestion } from "./difyInsightApi";
import { difyProxyUrl } from "./difyProxyUrl";
import { getAuthHeaders } from "@/components/shelves/lib/api-client";
import { readWorkflowFinished } from "./difyWorkflowStream";
import { getDifyUser } from "./difyUser";

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

function extractQuestions(obj: any): InsightQuestion[] {
  if (!obj) return [];
  if (Array.isArray(obj)) return normalizeQuestions(obj);
  if (typeof obj === "object") {
    if (Array.isArray(obj.questions)) return normalizeQuestions(obj.questions);
    if (obj.result) return extractQuestions(obj.result);
  }
  return [];
}

export async function runQuestionsWorkflow(
  competitor: unknown,
  crowdSource: unknown,
  category: string = "",
): Promise<InsightQuestion[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60 * 1000);
  const res = await fetch(difyProxyUrl("questions", "workflows/run"), {
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
        position: category,
      },
      response_mode: "streaming",
      user: getDifyUser(),
    }),
  }).finally(() => clearTimeout(t));
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Dify Questions API 错误", res.status, body);
    throw new Error(`Dify Questions API 错误: ${res.status}${body ? ` - ${body.slice(0, 200)}` : ""}`);
  }
  const outputs = await readWorkflowFinished(res);

  if (outputs?.result) {
    if (typeof outputs.result === "string") {
      const parsed = tryParseJson(outputs.result);
      if (parsed) return extractQuestions(parsed);
    } else {
      return extractQuestions(outputs.result);
    }
  }
  if (Array.isArray(outputs?.questions)) return normalizeQuestions(outputs.questions as unknown[]);
  const candidates = [outputs?.text, outputs?.output];
  for (const c of candidates) {
    if (typeof c === "string") {
      const parsed = tryParseJson(c);
      if (parsed) return extractQuestions(parsed);
    } else if (c && typeof c === "object") {
      return extractQuestions(c);
    }
  }
  return [];
}
