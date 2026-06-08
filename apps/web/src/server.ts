/**
 * SSR 入口（TanStack Start）
 *
 * 用于服务端渲染请求处理。本地开发时由 Vite Plugin 接管。
 *
 * 1.167+ API 约定：default export 必须是 `{ fetch: RequestHandler }` 对象，
 * 而不是 RequestHandler 本身。dev plugin 会调用 `default.fetch(request)`。
 *
 * 形态来自 `@tanstack/react-start/src/default-entry/server.ts`。
 */
import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server';
import type { RequestHandler } from '@tanstack/react-start/server';
import type { Register } from '@tanstack/react-router';

const fetch = createStartHandler(defaultStreamHandler);

export type ServerEntry = { fetch: RequestHandler<Register> };

function createServerEntry(entry: ServerEntry): ServerEntry {
  return {
    async fetch(...args) {
      return await entry.fetch(...args);
    },
  };
}

export default createServerEntry({ fetch });
