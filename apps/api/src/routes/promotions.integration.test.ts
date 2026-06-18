// apps/api/src/routes/promotions.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../app.js';
import { pool, query } from '../db/index.js';

const enabled = process.env.INTEGRATION_DB === '1';
const d = enabled ? describe : describe.skip;
const FIXTURE = path.resolve(process.cwd(), '../../6月下营销活动（会员价+叠券）.xlsx');

let server: Server;
let base = '';

interface Ctx { cookie: string }

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

d('Phase 6 · promotions multi-sheet upload (integration)', () => {
  let adminCtx: Ctx;

  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    if (typeof addr === 'object' && addr) base = `http://127.0.0.1:${addr.port}`;
    if (!enabled) return;
    await query(`DELETE FROM hq_promo_batches`);
    adminCtx = await login('admin', 'Admin@1234');
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (enabled) await query(`DELETE FROM hq_promo_batches`);
    await pool.end();
  });

  it('上传真实 Excel: 5 sheet 全解析 + 批次 + 档案 + offer 入库', async () => {
    const buf = fs.readFileSync(FIXTURE);
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const fd = new FormData();
    fd.set('file', blob, '6月下营销活动.xlsx');

    const res = await fetch(`${base}/api/v1/promotions/batches:upload`, {
      method: 'POST',
      headers: { cookie: adminCtx.cookie },
      body: fd,
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.batch).toBeDefined();
    expect(body.batch.rowTotal.member_price).toBeGreaterThan(1000);
    expect(body.batch.rowTotal.weekend_beer).toBeGreaterThan(50);
    expect(body.batch.rowTotal.brand_coupon).toBeGreaterThan(300);
    expect(body.batch.rowTotal.tuesday_member).toBeGreaterThan(20);
    expect(body.batch.rowTotal.regular_coupon).toBeGreaterThan(30);

    const rawCount = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM hq_promo_raw_items`);
    expect(rawCount.rows[0]!.c).toBeGreaterThan(1100);

    const offerCount = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM hq_promo_offers`);
    expect(offerCount.rows[0]!.c).toBeGreaterThan(1000);

    // 抽查：百威系列池里应有 ≥10 个 sku
    const poolCount = await query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM hq_promo_offers WHERE pool_label LIKE 'brand_coupon/百威系列%'`,
    );
    expect(poolCount.rows[0]!.c).toBeGreaterThanOrEqual(10);
  }, 30_000);

  it('GET /promotions/active 返回 results', async () => {
    const res = await fetch(`${base}/api/v1/promotions/active`, {
      headers: { cookie: adminCtx.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.batches)).toBe(true);
    // 注意：v_active_offers 受 current_date 过滤 — 若今天不在活动窗,results 可能空
    expect(Array.isArray(body.results)).toBe(true);
  });
});
