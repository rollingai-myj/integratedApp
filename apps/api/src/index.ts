/**
 * 进程入口
 *
 * - 启动 HTTP 服务
 * - 优雅退出：收到 SIGINT/SIGTERM 后停止接收新请求 + 关闭 DB 连接池
 */
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './lib/logger.js';
import { closePool } from './db/index.js';

// Node 的 fetch(undici)默认不读 HTTP(S)_PROXY 环境变量,在必须走代理的
// 网络里会裸连外网导致超时(如 openrouter.ai)。这里尊重标准代理变量,
// 并把连接超时从默认 10s 放宽到 30s 以容忍代理隧道建立的抖动。
// 不设代理变量时行为不变(直连)。NO_PROXY 照常生效(本地地址不走代理)。
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent({ connect: { timeout: 30_000 } }));
  logger.info(
    { proxy: process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY },
    'outbound fetch via proxy (EnvHttpProxyAgent)',
  );
}

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info(
    {
      port: config.PORT,
      env: config.NODE_ENV,
      version: '0.1.0-m0',
    },
    'myj-api listening',
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down...');
  // 1) 停止接收新连接
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  // 2) 关闭 pg pool
  try {
    await closePool();
  } catch (err) {
    logger.error({ err }, 'failed to close pg pool');
  }
  logger.info('bye');
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandledRejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
  process.exit(1);
});
