/**
 * Dify 工作流代理
 *
 * 设计：单实例，按 workflow 选 API key（env: DIFY_KEY_*），POST 到 DIFY_BASE_URL/workflows/run。
 * 如果对应 workflow 的 key 未配置 → 返回 502 UPSTREAM_ERROR 而非崩溃。
 * 测试环境通过 spyOn 替换 invoke()。
 */
import { config } from '../config/env.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export type DifyWorkflow =
  | 'selection'
  | 'align'
  | 'insight'
  | 'questions'
  | 'virtual-shelf';

const KEY_MAP: Record<DifyWorkflow, () => string> = {
  selection: () => config.DIFY_KEY_SELECTION,
  align: () => config.DIFY_KEY_ALIGN,
  insight: () => config.DIFY_KEY_INSIGHT,
  questions: () => config.DIFY_KEY_QUESTIONS,
  'virtual-shelf': () => config.DIFY_KEY_VIRTUAL_SHELF,
};

export interface DifyRunResponse {
  workflow_run_id?: string;
  task_id?: string;
  data?: {
    id?: string;
    status?: 'running' | 'succeeded' | 'failed';
    outputs?: Record<string, unknown>;
    error?: string;
    elapsed_time?: number;
  };
}

/**
 * Dify text-input/paragraph 字段不允许 object/array，必须 JSON.stringify 成字符串；
 * 但文件类输入（带 transfer_method 字段的 object）必须保持原样。
 * 这里统一序列化，所有后端 invoke 调用点（detect / prices / ai 通用入口）一次性覆盖。
 */
function isDifyFileObject(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { transfer_method?: unknown }).transfer_method === 'string'
  );
}
function serializeInputs(
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (v == null || typeof v !== 'object') out[k] = v;
    else if (isDifyFileObject(v)) out[k] = v;
    else out[k] = JSON.stringify(v);
  }
  return out;
}

export class DifyService {
  /**
   * 触发 Dify 工作流，返回 workflow_finished 事件里的 outputs（由调用方按 workflow 解析）。
   * 统一走 streaming 模式：
   *  - blocking 模式下 Dify 端点对长耗时工作流容易触发上游 504，且我们这边的 timeout 窗口里 socket 空闲会被中间层切断
   *  - streaming 模式持续吐 ping/中间事件，socket 不会空闲超时
   *  - 我们这里在 SSE 流上抽出 workflow_finished 还原对外接口，调用方无感
   */
  async invoke<TInput extends Record<string, unknown> = Record<string, unknown>>(
    workflow: DifyWorkflow,
    inputs: TInput,
    args: { userId?: string } = {},
  ): Promise<Record<string, unknown>> {
    const apiKey = KEY_MAP[workflow]?.();
    if (!apiKey) {
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `Dify 工作流 ${workflow} 未配置 API key（DIFY_KEY_${workflow.toUpperCase().replace('-', '_')}）`,
      );
    }

    const url = `${config.DIFY_BASE_URL.replace(/\/$/, '')}/workflows/run`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          inputs: serializeInputs(inputs),
          response_mode: 'streaming',
          user: args.userId ?? 'system',
        }),
        signal: AbortSignal.timeout(STREAM_TIMEOUT_MS[workflow]),
      });
    } catch (err) {
      logger.error({ err, workflow }, 'dify fetch failed');
      throw new AppError(502, ErrorCodes.UPSTREAM_ERROR, `调用 Dify 失败：${(err as Error).message}`);
    }

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      logger.warn({ status: res.status, body: body.slice(0, 500), workflow }, 'dify non-2xx');
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `Dify 工作流 ${workflow} 返回 ${res.status}`,
      );
    }

    return await readWorkflowFinishedSse(res.body, workflow);
  }
}

export const difyService = new DifyService();

// ---------------------------------------------------------------------------
// SSE 流式调用：把 Dify 的 SSE 直接转给前端（业务端点 ai/* 用）
// 工作流耗时差异大：实测 align 已超过 120s 被我们 abort，
// 导致 Dify 端 workflow run 未写完整执行记录（前端表现：诊断"无返回"，Dify 后台"无记录"）
// 统一放宽到能覆盖 P99：align/selection 5 分钟，virtual-shelf 10 分钟
// ---------------------------------------------------------------------------

const STREAM_TIMEOUT_MS: Record<DifyWorkflow, number> = {
  align: 300_000,
  selection: 300_000,
  insight: 180_000,
  questions: 120_000,
  'virtual-shelf': 600_000,
};

/**
 * 触发 Dify 工作流并返回原生 SSE Response（业务端点 pipeline 透传给前端）。
 * 失败时抛 AppError；成功返回的 Response.body 需由 caller pipeline 到 res。
 */
export async function streamDifyWorkflow(
  workflow: DifyWorkflow,
  inputs: Record<string, unknown>,
  args: { userId?: string } = {},
): Promise<Response> {
  const apiKey = KEY_MAP[workflow]?.();
  if (!apiKey) {
    throw new AppError(
      502,
      ErrorCodes.UPSTREAM_ERROR,
      `Dify 工作流 ${workflow} 未配置 API key`,
    );
  }
  const url = `${config.DIFY_BASE_URL.replace(/\/$/, '')}/workflows/run`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        inputs: serializeInputs(inputs),
        response_mode: 'streaming',
        user: args.userId ?? 'system',
      }),
      signal: AbortSignal.timeout(STREAM_TIMEOUT_MS[workflow]),
    });
  } catch (err) {
    logger.error({ err, workflow }, 'dify stream fetch failed');
    throw new AppError(
      502,
      ErrorCodes.UPSTREAM_ERROR,
      `调用 Dify 流式失败：${(err as Error).message}`,
    );
  }
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    logger.warn(
      { status: res.status, body: body.slice(0, 500), workflow },
      'dify stream non-2xx',
    );
    throw new AppError(
      502,
      ErrorCodes.UPSTREAM_ERROR,
      `Dify 工作流 ${workflow} 返回 ${res.status}`,
    );
  }
  return res;
}

/**
 * 从 Dify streaming SSE 流里抽出 workflow_finished 事件的 outputs。
 * 用于 invoke()：保留"返回 outputs 对象"的接口给非 SSE 调用方（bootstrap 等）。
 *
 * SSE 协议：事件之间空行分隔；每个事件是若干 `data: <json>` 行。
 * 关心的事件：`workflow_finished`（带 status / outputs / error）。
 */
async function readWorkflowFinishedSse(
  body: ReadableStream<Uint8Array>,
  workflow: DifyWorkflow,
): Promise<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const dataLines = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim());
      if (dataLines.length === 0) continue;
      let payload: { event?: string; data?: { status?: string; outputs?: Record<string, unknown>; error?: string } };
      try {
        payload = JSON.parse(dataLines.join(''));
      } catch {
        continue;
      }
      if (payload.event !== 'workflow_finished') continue;
      const d = payload.data ?? {};
      if (d.status === 'failed') {
        throw new AppError(
          502,
          ErrorCodes.UPSTREAM_ERROR,
          `Dify 工作流 ${workflow} 执行失败：${d.error ?? 'unknown'}`,
        );
      }
      return d.outputs ?? {};
    }
  }
  throw new AppError(
    502,
    ErrorCodes.UPSTREAM_ERROR,
    `Dify 工作流 ${workflow} 流结束但未收到 workflow_finished`,
  );
}
