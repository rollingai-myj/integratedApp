/**
 * 给每个请求生成一个短 ID（无依赖，不强求 ULID 库；用 crypto 随机串）
 *
 * - 写入 res.locals.requestId
 * - 写入响应头 X-Request-Id，便于前端/网关追踪
 * - 如果上游已带 X-Request-Id，复用之
 */
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

const PREFIX = 'req_';

function generateId(): string {
  // 取 UUID v4 去横线，截前 16 位，足够本地排障
  return PREFIX + randomUUID().replace(/-/g, '').slice(0, 16);
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header('x-request-id');
  const id = incoming && incoming.length <= 64 ? incoming : generateId();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
