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
  | 'virtual-shelf'
  | 'price-diagnose';

const KEY_MAP: Record<DifyWorkflow, () => string> = {
  selection: () => config.DIFY_KEY_SELECTION,
  align: () => config.DIFY_KEY_ALIGN,
  insight: () => config.DIFY_KEY_INSIGHT,
  questions: () => config.DIFY_KEY_QUESTIONS,
  'virtual-shelf': () => config.DIFY_KEY_VIRTUAL_SHELF,
  'price-diagnose': () => config.DIFY_KEY_PRICE_DIAGNOSE,
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
  /** 触发 Dify 工作流，返回原始 outputs 对象（由调用方按 workflow 解析） */
  async invoke<TInput extends Record<string, unknown> = Record<string, unknown>>(
    workflow: DifyWorkflow,
    inputs: TInput,
    args: { userId?: string; responseMode?: 'blocking' | 'streaming' } = {},
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
          response_mode: args.responseMode ?? 'blocking',
          user: args.userId ?? 'system',
        }),
        signal: AbortSignal.timeout(config.SESSION_TTL_SECONDS > 0 ? 120_000 : 60_000),
      });
    } catch (err) {
      logger.error({ err, workflow }, 'dify fetch failed');
      throw new AppError(502, ErrorCodes.UPSTREAM_ERROR, `调用 Dify 失败：${(err as Error).message}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn({ status: res.status, body: body.slice(0, 500), workflow }, 'dify non-2xx');
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `Dify 工作流 ${workflow} 返回 ${res.status}`,
      );
    }

    const data = (await res.json()) as DifyRunResponse;
    if (data.data?.status === 'failed') {
      throw new AppError(
        502,
        ErrorCodes.UPSTREAM_ERROR,
        `Dify 工作流执行失败：${data.data.error ?? 'unknown'}`,
      );
    }
    return data.data?.outputs ?? {};
  }
}

export const difyService = new DifyService();
