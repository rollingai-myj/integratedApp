/**
 * Poster Worker 进程
 *
 * 把"AI 生成"从浏览器移到后端常驻进程。
 *
 * 工作循环：
 *   while (running) {
 *     const { generation } = await claimAndProcess(workerId);
 *     if (!generation) await sleep(POLL_INTERVAL_MS);
 *   }
 *
 * - 没有可认领时 sleep 1s 再轮询
 * - 有任务时直接背靠背做下一条（claimAndProcess 同步阻塞到完成）
 * - 单容器并发 = CONCURRENCY（默认 2，避免一次打太多 AI 上游）
 * - 收到 SIGINT/SIGTERM：标记 running=false → 正在跑的那一条做完再退
 *   (claimAndProcess 单条 ~30s，配合 compose stop_grace_period: 60s)
 *
 * 部署：docker-compose 起 `api-worker` 服务，复用 api 镜像，启动命令换成 worker。
 * 数据库共享，靠 FOR UPDATE SKIP LOCKED 防多 worker 同时认领同一条。
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { closePool } from '../db/index.js';
import { claimAndProcess } from '../services/posters.service.js';

const POLL_INTERVAL_MS = Number(process.env.POSTER_WORKER_POLL_MS ?? 1000);
const CONCURRENCY = Number(process.env.POSTER_WORKER_CONCURRENCY ?? 2);

let running = true;
const workerId = `poster-worker-${randomUUID().slice(0, 8)}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loop(slotId: number): Promise<void> {
  const slotName = `${workerId}#${slotId}`;
  while (running) {
    try {
      const { generation } = await claimAndProcess(slotName);
      if (!generation) {
        // 没活儿，歇一下
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      // 有任务做完了，立刻背靠背捞下一条，不 sleep
    } catch (err) {
      // 单次失败不要拖垮整个 loop —— 记一下接着干
      logger.error({ err, slot: slotName }, 'poster worker loop error');
      await sleep(POLL_INTERVAL_MS);
    }
  }
  logger.info({ slot: slotName }, 'poster worker slot stopped');
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal, workerId }, 'poster worker shutting down...');
  running = false;
  // claimAndProcess 不可中断 —— 等当前那条做完循环自然退。
  // 给最多 65s（compose stop_grace_period 设 60s，留 5s buffer）：
  // claimAndProcess 内部约 30s，最坏两轮也能完。
  await sleep(65_000).catch(() => {});
  try {
    await closePool();
  } catch (err) {
    logger.error({ err }, 'failed to close pg pool');
  }
  logger.info('poster worker bye');
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'worker unhandledRejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'worker uncaughtException');
  process.exit(1);
});

logger.info(
  {
    workerId,
    concurrency: CONCURRENCY,
    pollMs: POLL_INTERVAL_MS,
    env: config.NODE_ENV,
  },
  'poster worker starting',
);

// 起 N 个 slot 并行跑 loop。slot 之间共享 pg pool，靠 DB 行锁分配工作。
for (let i = 0; i < CONCURRENCY; i++) {
  void loop(i);
}
