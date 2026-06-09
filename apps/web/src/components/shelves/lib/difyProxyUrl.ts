/**
 * Dify 流式代理 URL 构造器
 *
 * 后端路由：`POST /api/v1/dify-proxy?app=<workflow>&path=<dify-path>`
 * 见 apps/api/src/routes/ai.routes.ts —— 后端按 app 注入对应 DIFY_KEY，
 * 把 body 透传到 `${DIFY_BASE_URL}/${path}` 并把流式响应 pipe 回来。
 * AI key 永不出现在前端 bundle。
 *
 * 注：原 repo 支持 `files/upload`（前端把图片上传给 Dify）。整合 app 走自家 OSS，
 * Dify 直接用 `transfer_method:'remote_url'` 拉 OSS 公网 URL，故 path 白名单不含
 * `files/upload`。如未来要恢复，后端 ai.routes.ts 的 DIFY_PATH_WHITELIST 加上即可。
 */
// 始终用相对路径，依赖 vite proxy 转发到后端；同源避免 CORS。
const BASE_URL = '';

export type DifyApp =
  | 'selection'
  | 'insight'
  | 'questions'
  | 'align'
  | 'virtual_shelf';

export type DifyPath = 'workflows/run' | 'chat-messages';

export function difyProxyUrl(app: DifyApp, path: DifyPath): string {
  return `${BASE_URL}/api/v1/dify-proxy?app=${app}&path=${encodeURIComponent(path)}`;
}
