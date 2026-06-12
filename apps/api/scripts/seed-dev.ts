/**
 * 本地开发测试数据一键灌入(幂等,可重复跑)
 *
 * 用法: npm run -w apps/api seed:dev
 * 内容见 src/db/dev-seed/dev_fixture.sql 头部注释。
 * 仅限本地/测试库使用 —— 生产环境禁止执行。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from '../src/db/index.js';
import { logger } from '../src/lib/logger.js';

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed:dev 禁止在生产环境执行');
  }
  const sql = readFileSync(join(here, '../src/db/dev-seed/dev_fixture.sql'), 'utf8');
  await pool.query(sql);
  const counts = await pool.query<{ k: string; n: string }>(
    `SELECT 'stores' k, count(*)::text n FROM stores
     UNION ALL SELECT 'dim_product', count(*)::text FROM dim_product
     UNION ALL SELECT 'fact_store_sku_weekly', count(*)::text FROM fact_store_sku_weekly
     UNION ALL SELECT 'product_promotions', count(*)::text FROM product_promotions`,
  );
  for (const row of counts.rows) logger.info(`[seed:dev] ${row.k}: ${row.n}`);
  await pool.end();
}

main().catch((err) => {
  logger.error({ err }, '[seed:dev] failed');
  process.exit(1);
});
