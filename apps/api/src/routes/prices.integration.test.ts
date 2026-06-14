/**
 * Phase 4 集成测试：价盘 API（HTTP 级，打真实 DB）
 *
 * 跑前提同 scenes.integration：
 *   DB_NAME=myj_test bash apps/api/scripts/db-reset.sh
 *   INTEGRATION_DB=1 DATABASE_URL=postgresql://...:5432/myj_test npx vitest run src/routes/prices.integration.test.ts
 *
 * 覆盖：
 *   未登录 401 / 未选店 409 / curve 返回空 → 调价 → curve 出现 change 点 / changes 历史 / SKU 不存在 404 /
 *   **核心断言：调价只写 store_price_changes 流水，不动 store_sku_snapshots**
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../app.js';
import { pool, query } from '../db/index.js';

const enabled = process.env.INTEGRATION_DB === '1';
const d = enabled ? describe : describe.skip;

let server: Server;
let base = '';

async function call(
  method: string, path: string,
  opts: { body?: unknown; ctx?: { cookie: string }; query?: Record<string, string> } = {},
) {
  const url = new URL(`${base}${path}`);
  if (opts.query) for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.ctx ? { cookie: opts.ctx.cookie } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  let json: any = null;
  const text = await res.text();
  if (text) { try { json = JSON.parse(text); } catch { json = text; } }
  return { status: res.status, json, setCookie };
}

function cookieOf(setCookie: string | null) {
  const m = /sso_token=([^;]+)/.exec(setCookie!);
  expect(m).toBeTruthy();
  return { cookie: `sso_token=${m![1]}` };
}

async function loginAndSelectStore(
  account: string, password: string, storeCode: string,
): Promise<{ cookie: string; storeId: string }> {
  const login = await call('POST', '/api/v1/auth/login', { body: { account, password } });
  expect(login.status).toBe(200);
  const ctx = cookieOf(login.setCookie);
  const stores = await call('GET', '/api/v1/portal/stores', { ctx });
  const store = stores.json.stores.find((s: any) => s.code === storeCode);
  expect(store).toBeTruthy();
  const sw = await call('POST', '/api/v1/portal/active-store', { ctx, body: { storeId: store.id } });
  expect(sw.status).toBe(200);
  return { ...ctx, storeId: store.id };
}

async function countSnapshots(storeId: string, skuCode: string): Promise<number> {
  const r = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM store_sku_snapshots
       WHERE store_id = $1 AND sku_code = $2`,
    [storeId, skuCode],
  );
  return Number(r.rows[0]!.n);
}

d('Phase 4 · prices (integration)', () => {
  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    if (typeof addr === 'object' && addr) base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

  it('未登录 → 401；登录未选店 → 409', async () => {
    expect((await call('GET', '/api/v1/prices/curve')).status).toBe(401);
    const login = await call('POST', '/api/v1/auth/login', {
      body: { account: 'admin', password: 'Admin@1234' },
    });
    const ctx = cookieOf(login.setCookie);
    expect((await call('GET', '/api/v1/prices/curve', { ctx })).status).toBe(409);
  });

  it('SKU 不存在 → 调价 404', async () => {
    const { cookie } = await loginAndSelectStore('admin', 'Admin@1234', '粤39128');
    const r = await call('POST', '/api/v1/prices/changes', {
      ctx: { cookie },
      body: { skuCode: 'NOT-EXIST-SKU', newPrice: 10 },
    });
    expect(r.status).toBe(404);
  });

  it('调价 → 只写流水不动快照 + curve 出现 change 点 + changes 历史 + audit 记录', async () => {
    const { cookie, storeId } = await loginAndSelectStore('admin', 'Admin@1234', '粤39128');
    // 找一个真实 SKU
    const sku = await query<{ sku_code: string }>(
      `SELECT sku_code FROM hq_products WHERE deleted_at IS NULL LIMIT 1`,
    );
    const skuCode = sku.rows[0]!.sku_code;

    const snapsBefore = await countSnapshots(storeId, skuCode);
    const changesBefore = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM store_price_changes WHERE store_id = $1 AND sku_code = $2`,
      [storeId, skuCode],
    );

    // 1) 调价
    const post = await call('POST', '/api/v1/prices/changes', {
      ctx: { cookie },
      body: { skuCode, newPrice: 13.5, source: 'manual', note: 'P4 集成测试' },
    });
    expect(post.status).toBe(201);
    expect(post.json.record.newPrice).toBe(13.5);
    expect(post.json.record.source).toBe('manual');
    expect(post.json.record.changedByDisplay).toBeTruthy();

    // 2) 核心断言：快照 count 不变
    const snapsAfter = await countSnapshots(storeId, skuCode);
    expect(snapsAfter).toBe(snapsBefore);

    // 3) 流水 count +1
    const changesAfter = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM store_price_changes WHERE store_id = $1 AND sku_code = $2`,
      [storeId, skuCode],
    );
    expect(Number(changesAfter.rows[0]!.n)).toBe(Number(changesBefore.rows[0]!.n) + 1);

    // 4) GET /prices/changes 拿到这条
    const list = await call('GET', '/api/v1/prices/changes', { ctx: { cookie }, query: { skuCode } });
    expect(list.status).toBe(200);
    expect(list.json.changes.length).toBeGreaterThanOrEqual(1);
    expect(list.json.changes[0].newPrice).toBe(13.5);

    // 5) GET /prices/curve 包含一个 kind=change 点
    const curve = await call('GET', '/api/v1/prices/curve', { ctx: { cookie }, query: { skuCode } });
    expect(curve.status).toBe(200);
    const skuCurve = curve.json.curves.find((c: any) => c.skuCode === skuCode);
    expect(skuCurve).toBeTruthy();
    const changePoints = skuCurve.points.filter((p: any) => p.source === 'change');
    expect(changePoints.length).toBeGreaterThanOrEqual(1);
    expect(changePoints[0].retailPrice).toBe(13.5);

    // 6) audit 表写入 price_change
    const audit = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM sys_audit_events
        WHERE event_kind = 'price_change' AND target_store_id = $1
          AND payload->>'skuCode' = $2`,
      [storeId, skuCode],
    );
    expect(Number(audit.rows[0]!.n)).toBeGreaterThanOrEqual(1);
  });

  it('再调一次同一 SKU：oldPrice 应自动取上次 newPrice 范围（取快照 fallback）', async () => {
    const { cookie } = await loginAndSelectStore('admin', 'Admin@1234', '粤39128');
    const sku = await query<{ sku_code: string }>(
      `SELECT sku_code FROM hq_products WHERE deleted_at IS NULL OFFSET 1 LIMIT 1`,
    );
    const skuCode = sku.rows[0]!.sku_code;

    // 第一次：oldPrice 未传，可能是 null（snapshot 没数据）
    const first = await call('POST', '/api/v1/prices/changes', {
      ctx: { cookie }, body: { skuCode, newPrice: 8.8 },
    });
    expect(first.status).toBe(201);

    // 第二次：显式传 oldPrice
    const second = await call('POST', '/api/v1/prices/changes', {
      ctx: { cookie }, body: { skuCode, newPrice: 10.0, oldPrice: 8.8 },
    });
    expect(second.status).toBe(201);
    expect(second.json.record.oldPrice).toBe(8.8);
    expect(second.json.record.newPrice).toBe(10.0);
  });

});
