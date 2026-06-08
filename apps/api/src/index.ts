/**
 * 进程入口
 *
 * - 启动 HTTP 服务
 * - 优雅退出：收到 SIGINT/SIGTERM 后停止接收新请求 + 关闭 DB 连接池
 */
import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './lib/logger.js';
import { closePool } from './db/index.js';

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
