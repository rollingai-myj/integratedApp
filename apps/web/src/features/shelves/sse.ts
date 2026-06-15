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

// ---- align workflow（诊断） 输出解析 -------------------------------------

export interface DiagnosisResult {
  /** 客群分析 */
  paragraphCustomer: string;
  /** 竞争分析 */
  paragraphCompetition: string;
  /** 现状分析 */
  paragraphStatus: string;
}

/**
 * Dify align 工作流返回 outputs.Diagnosis（JSON 字符串），内部 { diagnosis: { paragraph_* } }
 * 兜底兼容：直接放 outputs.paragraph_*；嵌在 outputs.text 里的情况
 */
export function extractDiagnosis(outputs: Record<string, unknown>): DiagnosisResult | null {
  const candidates: unknown[] = [
    outputs.Diagnosis,
    outputs.diagnosis,
    outputs.result,
    outputs.text,
    outputs,
  ];
  for (const c of candidates) {
    const v = tryParseDifyValue(c);
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    // 可能是 { diagnosis: { paragraph_* } }，也可能直接是 { paragraph_* }
    const inner = (o.diagnosis && typeof o.diagnosis === 'object' && !Array.isArray(o.diagnosis))
      ? (o.diagnosis as Record<string, unknown>)
      : o;
    const customer = String(inner.paragraph_customer ?? inner.paragraphCustomer ?? '');
    const competition = String(inner.paragraph_competition ?? inner.paragraphCompetition ?? '');
    const status = String(inner.paragraph_status ?? inner.paragraphStatus ?? '');
    if (customer || competition || status) {
      return {
        paragraphCustomer: customer,
        paragraphCompetition: competition,
        paragraphStatus: status,
      };
    }
  }
  return null;
}

// ---- selection workflow（选品方案） 输出解析 -----------------------------

export interface StrategyItem {
  skuCode: string;
  skuName: string;
  spec: string;
  /** 原版动作字符串：含「上架」「停止进货」「补充上架」等，下游用 classifyAction 归一 */
  action: string;
  tags: string[];
  reason: string;
  avg90DaySales: string;
}

export interface StrategyResult {
  name: string;
  description: string;
  items: StrategyItem[];
}

/** 把 6/7 位 sku code 左补 0 到 8 位（原版 padSkuCode） */
function padSkuCode(v: unknown): string {
  const s = String(v ?? '').trim();
  if (/^\d+$/.test(s) && s.length < 8) return s.padStart(8, '0');
  return s;
}

function looksLikeStrategy(o: unknown): o is Record<string, unknown> {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const r = o as Record<string, unknown>;
  return (
    Array.isArray(r.skus) ||
    Array.isArray(r['SKU列表']) ||
    typeof r.name === 'string' ||
    typeof r['策略名称'] === 'string'
  );
}

function coerceStrategyList(v: unknown): Record<string, unknown>[] | null {
  const parsed = tryParseDifyValue(v);
  if (parsed == null) return null;
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (looksLikeStrategy(parsed)) return [parsed];
  return null;
}

function normalizeStrategy(item: Record<string, unknown>): StrategyResult {
  const skusRaw =
    (Array.isArray(item.skus) ? item.skus
    : Array.isArray(item['SKU列表']) ? item['SKU列表']
    : []) as Array<Record<string, unknown>>;
  return {
    name: String(item.name ?? item['策略名称'] ?? ''),
    description: String(item.description ?? item['策略描述'] ?? ''),
    items: skusRaw.map((s) => ({
      skuCode: padSkuCode(s.skuCode ?? s['商品代码']),
      skuName: String(s.skuName ?? s['商品名称'] ?? ''),
      spec: String(s.spec ?? s['规格'] ?? ''),
      action: String(s.action ?? s['建议动作'] ?? ''),
      tags: Array.isArray(s.tags) ? (s.tags as string[]).map(String) : [],
      reason: String(s.reason ?? s['理由'] ?? ''),
      avg90DaySales: String(s.avg90DaySales ?? s['日均销量'] ?? ''),
    })),
  };
}

export function extractStrategy(outputs: Record<string, unknown>): StrategyResult | null {
  // 按 legacy difyApi.ts 的优先级扫描
  for (const key of ['Selection', 'ShelfAiResult', 'SelectionResult', 'result', 'text', 'output']) {
    const list = coerceStrategyList(outputs[key]);
    if (list && list.length) return normalizeStrategy(list[0]!);
  }
  // outputs 自身就是策略对象
  const self = coerceStrategyList(outputs);
  if (self && self.length) return normalizeStrategy(self[0]!);
  // 兜底：扫描所有值
  for (const v of Object.values(outputs)) {
    const list = coerceStrategyList(v);
    if (list && list.length) return normalizeStrategy(list[0]!);
  }
  return null;
}

// ---- virtual-shelf workflow 输出解析 -------------------------------------

/** virtual-shelf 输出结构由 Dify 工作流自定义，前端 VirtualShelfRenderer 直接消费 raw */
export function extractVirtualShelf(outputs: Record<string, unknown>): unknown {
  // 优先常见 key，否则透传整个 outputs
  for (const key of ['VirtualShelf', 'virtual_shelf', 'result', 'text']) {
    const v = tryParseDifyValue(outputs[key]);
    if (v != null) return v;
  }
  return outputs;
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
