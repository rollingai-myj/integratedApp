/**
 * 极简迁移工具
 *
 * 使用：
 *   tsx src/db/migrate.ts up       # 顺序执行 migrations/ 下尚未执行的 .sql
 *   tsx src/db/migrate.ts status   # 列出已执行/未执行的迁移
 *
 * 设计：
 * - 迁移文件命名：`NNNN_description.sql`（NNNN 为四位有序前缀）
 * - 用 `migrations` 表记录已执行的文件名 + 执行时间
 * - 每个文件在单个事务中执行；任意语句失败则整体回滚
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool, closePool } from './index.js';
import { logger } from '../lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS migrations (
  filename    TEXT PRIMARY KEY,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(MIGRATIONS_TABLE_SQL);
}

async function listMigrationFiles(): Promise<string[]> {
  try {
    const entries = await readdir(MIGRATIONS_DIR);
    return entries.filter((f) => f.endsWith('.sql')).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

async function listExecuted(): Promise<Set<string>> {
  const { rows } = await pool.query<{ filename: string }>(
    'SELECT filename FROM migrations ORDER BY filename',
  );
  return new Set(rows.map((r) => r.filename));
}

async function up(): Promise<void> {
  await ensureMigrationsTable();
  const files = await listMigrationFiles();
  const executed = await listExecuted();
  const pending = files.filter((f) => !executed.has(f));

  if (pending.length === 0) {
    logger.info('[migrate] no pending migrations');
    return;
  }

  logger.info(`[migrate] applying ${pending.length} migration(s)...`);
  for (const file of pending) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO migrations (filename) VALUES ($1)',
        [file],
      );
      await client.query('COMMIT');
      logger.info(`[migrate]   applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        /* swallow */
      });
      logger.error({ err, file }, '[migrate] failed');
      throw err;
    } finally {
      client.release();
    }
  }
  logger.info('[migrate] done');
}

async function status(): Promise<void> {
  await ensureMigrationsTable();
  const files = await listMigrationFiles();
  const executed = await listExecuted();
  if (files.length === 0) {
    logger.info('[migrate] no migration files found');
    return;
  }
  for (const f of files) {
    const mark = executed.has(f) ? '[x]' : '[ ]';
    // eslint-disable-next-line no-console
    console.log(`${mark} ${f}`);
  }
  // eslint-disable-next-line no-console
  console.log(
    `\n  total=${files.length}  executed=${executed.size}  pending=${
      files.length - executed.size
    }`,
  );
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'up';
  try {
    if (cmd === 'up') {
      await up();
    } else if (cmd === 'status') {
      await status();
    } else {
      // eslint-disable-next-line no-console
      console.error(`Unknown command: ${cmd}\nUsage: migrate <up|status>`);
      process.exitCode = 1;
    }
  } catch (err) {
    logger.error({ err }, '[migrate] fatal');
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

void main();
