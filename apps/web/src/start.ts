/**
 * TanStack Start 实例
 *
 * 同时供客户端 (`router.tsx`) 与 SSR (`server.ts`) 使用。
 */
import { createStart } from '@tanstack/react-start';

export const startInstance = createStart(() => ({}));
