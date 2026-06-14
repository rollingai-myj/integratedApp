/**
 * Phase 5 促销集成测试（HTTP 级，打真实 DB）
 *
 * 跑前提：
 *   1) DB_NAME=myj_test bash apps/api/scripts/db-reset.sh
 *   2) INTEGRATION_DB=1 DATABASE_URL=postgresql://...:5432/myj_test npx vitest run src/routes/promotions.integration.test.ts
 *
 * 覆盖：
 *   - 普通用户上传 403、超管 admin 上传 201
 *   - 上传带 activate=true → /promotions/active 立刻能读到
 *   - 第二批次 activate → 第一批次自动 deactivated（约束 #9）
 *   - 单品聚合到 mix group（mix_group_code 相同 → 一条 group）
 *   - 删除批次 → 列表里没了 + active 视图也空
 *   - recommend 不挂（即使无历史海报，也按 saving_percent 倒序）
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../app.js';
import { pool, query } from '../db/index.js';

const enabled = process.env.INTEGRATION_DB === '1';
const d = enabled ? describe : describe.skip;

let server: Server;
let base = '';

interface Ctx { cookie: string }

async function call(
  method: string,
  path: string,
  opts: { body?: unknown; ctx?: Ctx } = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.ctx ? { cookie: opts.ctx.cookie } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  const text = await res.text();
  if (text) {
    try { json = JSON.parse(text); } catch { json = text; }
  }
  return { status: res.status, json };
}

function cookieOf(setCookie: string | null): Ctx {
  expect(setCookie).toBeTruthy();
  const m = /sso_token=([^;]+)/.exec(setCookie!);
  expect(m).toBeTruthy();
  return { cookie: `sso_token=${m![1]}` };
}

async function login(account: string, password: string): Promise<Ctx> {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account, password }),
  });
  expect(res.status).toBe(200);
  return cookieOf(res.headers.get('set-cookie'));
}

d('Phase 5 · promotions (integration)', () => {
  let adminCtx: Ctx;
  let opsCtx: Ctx;
  let skuCodeA: string;
  let skuCodeB: string;
  let skuCodeC: string;

  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    if (typeof addr === 'object' && addr) base = `http://127.0.0.1:${addr.port}`;
    if (!enabled) return;

    adminCtx = await login('admin', 'Admin@1234');
    opsCtx = await login('ops', 'Ops@1234');

    const skuRows = await query<{ sku_code: string }>(
      `SELECT sku_code FROM hq_products WHERE category_id IS NOT NULL LIMIT 3`,
    );
    expect(skuRows.rows.length).toBe(3);
    skuCodeA = skuRows.rows[0]!.sku_code;
    skuCodeB = skuRows.rows[1]!.sku_code;
    skuCodeC = skuRows.rows[2]!.sku_code;

    // 清理种子已激活的批次，让我们的测试自己控状态
    await query(`UPDATE hq_promo_batches SET is_active = FALSE, deactivated_at = now() WHERE is_active = TRUE`);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

  it('店长上传促销 → 403', async () => {
    const r = await call('POST', '/api/v1/promotions/batches:upload', {
      ctx: opsCtx,
      body: {
        fileName: 't1.xlsx',
        rows: [
          { rowIndex: 1, skuCode: skuCodeA, productName: 'p1', bestSavingPercent: 20 },
        ],
      },
    });
    expect(r.status).toBe(403);
  });

  let firstBatchId = '';

  it('超管上传 batch + activate → /active 能读到', async () => {
    const r = await call('POST', '/api/v1/promotions/batches:upload', {
      ctx: adminCtx,
      body: {
        fileName: 't-first.xlsx',
        activate: true,
        rows: [
          {
            rowIndex: 1, skuCode: skuCodeA, productName: 'A',
            bestLabel: '第二件半价', bestSavingPercent: 25, bestTotalPrice: 12,
            mixGroupCode: 'MG1',
          },
          {
            rowIndex: 2, skuCode: skuCodeB, productName: 'B',
            bestLabel: '第二件半价', bestSavingPercent: 20, bestTotalPrice: 11,
            mixGroupCode: 'MG1',
          },
        ],
      },
    });
    expect(r.status).toBe(201);
    expect(r.json.upload.isActive).toBe(true);
    expect(r.json.productCount).toBe(2);
    expect(r.json.groupCount).toBe(1);
    firstBatchId = r.json.upload.id;

    const ar = await call('GET', '/api/v1/promotions/active', { ctx: opsCtx });
    expect(ar.status).toBe(200);
    expect(ar.json.upload.id).toBe(firstBatchId);
    expect(ar.json.products).toHaveLength(2);
    expect(ar.json.groups).toHaveLength(1);
    expect(ar.json.groups[0].skuCodes).toEqual([skuCodeA, skuCodeB]);
    // 按 saving_percent DESC 排序：A(25) 在前
    expect(ar.json.products[0].skuCode).toBe(skuCodeA);
  });

  let secondBatchId = '';

  it('上传第二批次 + activate → 第一个自动 deactivated', async () => {
    const r = await call('POST', '/api/v1/promotions/batches:upload', {
      ctx: adminCtx,
      body: {
        fileName: 't-second.xlsx',
        activate: true,
        rows: [
          {
            rowIndex: 1, skuCode: skuCodeC, productName: 'C',
            bestLabel: '满 2 件 9 折', bestSavingPercent: 10,
          },
        ],
      },
    });
    expect(r.status).toBe(201);
    secondBatchId = r.json.upload.id;
    expect(r.json.upload.isActive).toBe(true);

    const all = await call('GET', '/api/v1/promotions/batches', { ctx: adminCtx });
    expect(all.status).toBe(200);
    const firstStill = all.json.batches.find((b: any) => b.id === firstBatchId);
    expect(firstStill).toBeTruthy();
    expect(firstStill.isActive).toBe(false);

    const active = await call('GET', '/api/v1/promotions/active', { ctx: opsCtx });
    expect(active.json.upload.id).toBe(secondBatchId);
    expect(active.json.products[0].skuCode).toBe(skuCodeC);
  });

  it('recommend 不挂，返回当前 active 的 products', async () => {
    const r = await call('GET', '/api/v1/promotions/recommend', { ctx: opsCtx });
    expect(r.status).toBe(200);
    expect(r.json.upload?.id).toBe(secondBatchId);
    expect(r.json.products).toHaveLength(1);
  });

  it('删除第二批次 → /active 为空', async () => {
    const del = await call(
      'DELETE',
      `/api/v1/promotions/batches/${secondBatchId}`,
      { ctx: adminCtx },
    );
    expect(del.status).toBe(200);
    expect(del.json.deleted).toBe(true);

    const active = await call('GET', '/api/v1/promotions/active', { ctx: opsCtx });
    expect(active.json.upload).toBeNull();
  });

  it('手动 activate 第一批次 → 重新激活', async () => {
    const act = await call(
      'POST',
      `/api/v1/promotions/batches/${firstBatchId}/activate`,
      { ctx: adminCtx },
    );
    expect(act.status).toBe(200);
    expect(act.json.upload.id).toBe(firstBatchId);
    expect(act.json.upload.isActive).toBe(true);

    const active = await call('GET', '/api/v1/promotions/active', { ctx: opsCtx });
    expect(active.json.upload.id).toBe(firstBatchId);
  });
});
