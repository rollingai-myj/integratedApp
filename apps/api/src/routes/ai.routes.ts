/**
 * 模块 11：AI 网关（Dify 统一入口）
 *
 * SK-J1：店长 / 价盘 / 选品 都通过这里走 Dify，前端不持有 API key。
 *
 * workflow 取值见 services/dify.service.ts：
 *   selection | align | insight | questions | virtual-shelf | price-diagnose
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { config } from '../config/env.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { requireAuth } from '../middleware/auth.js';
import { difyService, type DifyWorkflow } from '../services/dify.service.js';

export const aiRouter = Router();

const ALLOWED: DifyWorkflow[] = [
  'selection',
  'align',
  'insight',
  'questions',
  'virtual-shelf',
  'price-diagnose',
];

// 选品模块（skuSelection 1:1 端口）的原前端代码用 `app` 名字 'virtual_shelf' / 'virtualShelf'，
// 这里允许下划线写法等价于规范的 'virtual-shelf'。
const DIFY_APP_ALIASES: Record<string, DifyWorkflow> = {
  selection: 'selection',
  align: 'align',
  insight: 'insight',
  questions: 'questions',
  'virtual-shelf': 'virtual-shelf',
  virtual_shelf: 'virtual-shelf',
  virtualShelf: 'virtual-shelf',
  'price-diagnose': 'price-diagnose',
};

const DIFY_KEY_MAP: Record<DifyWorkflow, () => string> = {
  selection: () => config.DIFY_KEY_SELECTION,
  align: () => config.DIFY_KEY_ALIGN,
  insight: () => config.DIFY_KEY_INSIGHT,
  questions: () => config.DIFY_KEY_QUESTIONS,
  'virtual-shelf': () => config.DIFY_KEY_VIRTUAL_SHELF,
  'price-diagnose': () => config.DIFY_KEY_PRICE_DIAGNOSE,
};

// 允许代理到的 Dify 子路径（白名单），其余拒绝 → 防止把代理变成开放转发
const DIFY_PATH_WHITELIST = new Set([
  'workflows/run',
  'chat-messages',
  'completion-messages',
]);

const invokeSchema = z.object({
  inputs: z.record(z.unknown()),
  responseMode: z.enum(['blocking', 'streaming']).optional(),
});

aiRouter.post(
  '/dify/:workflow',
  requireAuth,
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const workflow = req.params.workflow as DifyWorkflow;
        if (!ALLOWED.includes(workflow)) {
          throw new AppError(
            400,
            ErrorCodes.BAD_REQUEST,
            `workflow 必须是 ${ALLOWED.join(' / ')} 之一`,
          );
        }
        const body = invokeSchema.parse(req.body);
        const outputs = await difyService.invoke(workflow, body.inputs, {
          userId: req.user!.id,
          responseMode: body.responseMode,
        });
        res.json({ workflow, outputs });
      } catch (err) {
        next(err);
      }
    })();
  },
);

/**
 * SK-J2 流式代理（专为原 skuSelection 前端 1:1 移植设计）
 *
 *   POST /api/v1/dify-proxy?app=<workflow>&path=<dify-path>
 *
 * 把请求 body 原样 POST 到 `${DIFY_BASE_URL}/${path}`，注入对应 workflow 的 Bearer key；
 * 响应 status / 关键 headers / body 原样回传。`response_mode: 'streaming'` 时 NDJSON
 * 流自然透传，前端的 `readWorkflowFinished()` 可继续按 SSE/NDJSON 解析。
 *
 * AI key 100% 留后端，前端永远只见 URL 与 inputs。
 */
aiRouter.post(
  '/dify-proxy',
  requireAuth,
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const appRaw = typeof req.query.app === 'string' ? req.query.app : '';
        const pathRaw = typeof req.query.path === 'string' ? req.query.path : '';
        const workflow = DIFY_APP_ALIASES[appRaw];
        if (!workflow) {
          throw new AppError(
            400,
            ErrorCodes.BAD_REQUEST,
            `app 必须是 ${Object.keys(DIFY_APP_ALIASES).join(' / ')} 之一`,
          );
        }
        if (!DIFY_PATH_WHITELIST.has(pathRaw)) {
          throw new AppError(
            400,
            ErrorCodes.BAD_REQUEST,
            `path 必须是 ${[...DIFY_PATH_WHITELIST].join(' / ')} 之一`,
          );
        }
        const apiKey = DIFY_KEY_MAP[workflow]();
        if (!apiKey) {
          throw new AppError(
            502,
            ErrorCodes.UPSTREAM_ERROR,
            `Dify 工作流 ${workflow} 未配置 API key（DIFY_KEY_${workflow.toUpperCase().replace('-', '_')}）`,
          );
        }

        const upstreamUrl = `${config.DIFY_BASE_URL.replace(/\/$/, '')}/${pathRaw}`;
        let upstream: globalThis.Response;
        try {
          upstream = await fetch(upstreamUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(req.body ?? {}),
            // Dify 工作流可能跑几十秒，超时给足
            signal: AbortSignal.timeout(180_000),
          });
        } catch (err) {
          logger.error({ err, workflow, path: pathRaw }, 'dify-proxy fetch failed');
          throw new AppError(
            502,
            ErrorCodes.UPSTREAM_ERROR,
            `调用 Dify 失败：${(err as Error).message}`,
          );
        }

        res.status(upstream.status);
        const ct = upstream.headers.get('content-type');
        if (ct) res.setHeader('Content-Type', ct);
        // 流式响应：清掉默认 gzip / chunked 干扰
        if (ct?.includes('text/event-stream') || ct?.includes('application/x-ndjson')) {
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('X-Accel-Buffering', 'no');
        }

        if (!upstream.body) {
          res.end();
          return;
        }
        // Web ReadableStream → Node Readable → pipe 到 express res
        //
        // 必须用 pipeline 而不是 .pipe()：
        // - upstream.body 在 AbortSignal.timeout 触发或客户端断连时会 emit 'error'
        // - 旧写法 .pipe() 不转发错误，源流的 'error' 没人监听 → uncaughtException
        //   → 整个 Node 进程 FATAL 退出（之前线上 15:52:21 那次就是这个原因）
        // pipeline 会捕获并 reject promise，我们 log 后吞掉（响应已发，没法再写 502）
        const upstreamBody = Readable.fromWeb(
          upstream.body as unknown as import('node:stream/web').ReadableStream,
        );
        try {
          await pipeline(upstreamBody, res);
        } catch (streamErr) {
          // 已经开始返响应，不能再 res.status() / next(err)，只能记日志
          logger.warn(
            { err: streamErr, workflow, path: pathRaw },
            'dify-proxy stream interrupted (timeout / upstream abort / client close)',
          );
          // 兜底确保 socket 关闭（pipeline 失败时 res 一般已经 destroy）
          if (!res.destroyed) res.destroy();
        }
      } catch (err) {
        next(err);
      }
    })();
  },
);
