/**
 * pg Pool 单例
 *
 * - 整个进程共用一个连接池
 * - 退出时调用 closePool() 优雅释放
 */
import pg from 'pg';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'pg pool: idle client error');
});

/** 简易 query 包装，自动记录耗时 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: ReadonlyArray<unknown>,
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params as unknown[] | undefined);
    const ms = Date.now() - start;
    logger.debug({ sql: text, rows: result.rowCount, ms }, 'sql');
    return result;
  } catch (err) {
    logger.error({ err, sql: text }, 'sql error');
    throw err;
  }
}

/** 在同一连接上执行事务回调 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* swallow */
    });
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
