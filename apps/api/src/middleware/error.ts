/**
 * 全局错误中间件 + 404 兜底
 *
 * 所有错误最终在这里转成统一 JSON：
 *   { error: { code, message, details? }, requestId }
 */
import type {
  Request,
  Response,
  NextFunction,
  ErrorRequestHandler,
} from 'express';
import { ZodError } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isProd } from '../config/env.js';
import type { ApiErrorResponse } from '../types/api.js';

/** 404 兜底（在所有路由之后挂载） */
export function notFoundHandler(
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const body: ApiErrorResponse = {
    error: {
      code: ErrorCodes.NOT_FOUND,
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    },
    requestId: res.locals.requestId ?? 'req_unknown',
  };
  res.status(404).json(body);
}

/**
 * 全局错误处理（必须 4 参签名 Express 才识别为 error handler）
 */
export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) => {
  const requestId: string = res.locals.requestId ?? 'req_unknown';

  // 1) AppError —— 业务可预期错误
  if (err instanceof AppError) {
    const body: ApiErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined && !isProd
          ? { details: err.details }
          : {}),
      },
      requestId,
    };
    // 4xx 用 warn，5xx 用 error
    if (err.status >= 500) {
      logger.error({ err, requestId, path: req.originalUrl }, 'request failed');
    } else {
      logger.warn(
        {
          requestId,
          path: req.originalUrl,
          code: err.code,
          status: err.status,
        },
        'request rejected',
      );
    }
    res.status(err.status).json(body);
    return;
  }

  // 2) ZodError —— 入参/环境/响应校验失败
  if (err instanceof ZodError) {
    const body: ApiErrorResponse = {
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Request validation failed',
        ...(isProd ? {} : { details: err.issues }),
      },
      requestId,
    };
    logger.warn(
      { requestId, path: req.originalUrl, issues: err.issues },
      'validation failed',
    );
    res.status(400).json(body);
    return;
  }

  // 3) 其它未知错误 —— 5xx
  const message =
    err instanceof Error ? err.message : 'Unknown internal error';
  const body: ApiErrorResponse = {
    error: {
      code: ErrorCodes.INTERNAL_ERROR,
      message: isProd ? 'Internal server error' : message,
    },
    requestId,
  };
  logger.error(
    { err, requestId, path: req.originalUrl },
    'unhandled internal error',
  );
  res.status(500).json(body);
};
