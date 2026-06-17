/**
 * 选品域 Dify SSE 客户端工具
 *
 * 业务后端把 Dify 的 SSE 原样 pipeline 给前端，前端按 Dify 协议解析：
 *  - 每个 event 以 `\n\n` 分隔
 *  - `data: <json>` 行携带 `{ event, data }`
 *  - 关注 `workflow_finished` —— `data.outputs` 是最终结果
 *
 * outputs 是个对象但内部值可能是 string（被工作流序列化过）或 object，
 * 上层取值时统一过 tryParseDifyValue 兼容（先剥 ```json 围栏 → 整段 JSON.parse → 正则兜底）。
 */

export async function readWorkflowFinished(
  response: Response,
): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error('No response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const dataStr = dataLine.slice(5).trim();
        if (!dataStr || dataStr === '[DONE]') continue;
        let evt: {
          event?: string;
          data?: { status?: string; error?: string; outputs?: Record<string, unknown> };
          message?: string;
          code?: string;
        };
        try {
          evt = JSON.parse(dataStr);
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
        if (evt.event === 'workflow_finished') {
          void reader.cancel();
          if (evt.data?.status === 'failed') {
            throw new Error(evt.data?.error || 'Workflow failed');
          }
          return evt.data?.outputs ?? {};
        }
        if (evt.event === 'error') {
          throw new Error(evt.message || evt.code || 'Dify error');
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error('Stream ended without workflow_finished');
}

/**
 * 兼容 Dify 字符串 / 对象 outputs：
 *   - 剥 <think>...</think> 推理段（DeepSeek-R1 / Qwen reasoning 系列工作流常见）
 *   - 剥 ```json 围栏
 *   - 整段 JSON.parse
 *   - 失败再用大括号 / 中括号贪婪正则兜底（捕获 {...} 或 [...]）
 */
export function tryParseDifyValue(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw !== 'string') return raw;
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ---- align / selection 类型(extractor 已迁后端 ai-shelves.service.ts) ------
// V028: 解析逻辑搬到 ai-shelves.service.ts(extractDiagnosis / extractStrategy /
//        extractVirtualShelf);前端只保留 shape 用于 setState 类型对齐(raw_outputs.parsed
//        从轮询拿)。questions extractor 保留 — QAPage bootstrap 兜底仍走 SSE。

export interface DiagnosisResult {
  /** 客群分析 */ paragraphCustomer: string;
  /** 竞争分析 */ paragraphCompetition: string;
  /** 现状分析 */ paragraphStatus: string;
}

export interface StrategyItem {
  skuCode: string;
  skuName: string;
  spec: string;
  /** 含「上架」「停止进货」「补充上架」等,下游 classifyAction 归一 */
  action: string;
  tags: string[];
  reason: string;
  avg90DaySales: string;
}

// ---- questions workflow 输出解析 -----------------------------------------

export interface QaQuestion {
  questionText: string;
  /** 是否多选；AI 给出的 single 也按 single 落库 */
  multi: boolean;
  options: string[];
  /** AI 写的"为什么问这个" — 可选 chip 展示 */
  context?: string;
}

function normalizeQuestion(raw: unknown, idx: number): QaQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const text = String(o.question ?? o.questionText ?? o.text ?? '').trim();
  if (!text) return null;
  const options = Array.isArray(o.options)
    ? o.options.map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];
  const kind = String(o.questionKind ?? o.kind ?? '').toLowerCase();
  const multi = kind ? kind === 'multi' : options.length > 2;
  const context = typeof o.context === 'string' ? o.context.trim() : '';
  // idx 仅用于稳定排序，前端不持有顺序号
  void idx;
  return { questionText: text, multi, options, context: context || undefined };
}

/** 把 outputs 里五花八门的结构（result string / questions array / 直接数组）归一化 */
export function extractQuestions(outputs: Record<string, unknown>): QaQuestion[] {
  const candidates: unknown[] = [
    outputs.result,
    outputs.questions,
    outputs.output,
    outputs.text,
    outputs,
  ];
  for (const c of candidates) {
    const v = tryParseDifyValue(c);
    if (Array.isArray(v)) {
      const out = v
        .map((q, i) => normalizeQuestion(q, i))
        .filter((q): q is QaQuestion => q !== null);
      if (out.length) return out;
    } else if (v && typeof v === 'object') {
      const arr = (v as Record<string, unknown>).questions;
      if (Array.isArray(arr)) {
        const out = arr
          .map((q, i) => normalizeQuestion(q, i))
          .filter((q): q is QaQuestion => q !== null);
        if (out.length) return out;
      }
    }
  }
  return [];
}
