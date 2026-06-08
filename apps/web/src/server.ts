/**
 * SSR 入口（TanStack Start）
 *
 * 用于服务端渲染请求处理。本地开发时由 Vite Plugin 接管。
 */
import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server';
import { createRouter } from './router.js';

export default createStartHandler({
  createRouter,
})(defaultStreamHandler);
