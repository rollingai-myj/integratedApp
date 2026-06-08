/**
 * Dify 工作流代理
 *
 * 涉及接口：
 * - POST /api/v1/dify/:workflow  （选品 / 诊断 / 洞察 / 问卷 / 虚拟货架 / 价盘诊断）
 *
 * M0：占位，全部抛 NotImplementedError。M2 接入 Dify 真实调用。
 */
import { NotImplementedError } from '../lib/errors.js';

export type DifyWorkflow =
  | 'selection'
  | 'align'
  | 'insight'
  | 'questions'
  | 'virtual-shelf'
  | 'price-diagnose';

export class DifyService {
  /** 触发 Dify 工作流，返回 AI 输出 */
  async invoke<TInput = unknown, TOutput = unknown>(
    _workflow: DifyWorkflow,
    _input: TInput,
  ): Promise<TOutput> {
    throw new NotImplementedError(
      '[dify.invoke] will be implemented in M2',
    );
  }
}

export const difyService = new DifyService();
