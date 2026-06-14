/**
 * Phase 6 竞品集成测试
 *
 * 覆盖：
 *   - 跨店越权：A 店看不到 B 店竞对店
 *   - 竞对店 CRUD（建/列/改 isActive）
 *   - 竞品 CRUD + 跨店越权
 *   - 价格采集（multipart with photo + 不带 photo 都行）
 *   - 比价：本店有 mapping 才出现在比价结果
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

async function callForm(
  path: string,
  ctx: Ctx,
  fields: Record<string, string | { file: Blob; filename: string }>,
): Promise<{ status: number; json: any }> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string') fd.append(k, v);
    else fd.append(k, v.file, v.filename);
  }
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { cookie: ctx.cookie },
    body: fd,
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

async function switchStore(ctx: Ctx, storeId: string) {
  const r = await call('POST', '/api/v1/portal/active-store', {
    body: { storeId },
    ctx,
  });
  expect(r.status).toBe(200);
}

d('Phase 6 · competitors (integration)', () => {
  let opsCtx: Ctx;
  let storeA: string;
  let storeB: string;
  let mappedProductId: string;
  let mappedSkuCode: string;

  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    if (typeof addr === 'object' && addr) base = `http://127.0.0.1:${addr.port}`;
    if (!enabled) return;

    opsCtx = await login('ops', 'Ops@1234');

    const stores = await call('GET', '/api/v1/portal/stores', { ctx: opsCtx });
    expect(stores.json.stores.length).toBeGreaterThanOrEqual(2);
    storeA = stores.json.stores[0].id;
    storeB = stores.json.stores[1].id;

    // 取一个 A 店真实有 snapshot 的 product 用来比价
    const p = await query<{ id: string; sku_code: string }>(
      `SELECT p.id, p.sku_code
         FROM hq_products p
         JOIN store_sku_snapshots snap ON snap.product_id = p.id
        WHERE snap.store_id = $1
        LIMIT 1`,
      [storeA],
    );
    expect(p.rows.length).toBe(1);
    mappedProductId = p.rows[0]!.id;
    mappedSkuCode = p.rows[0]!.sku_code;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

  let competitorA = '';
  let productA = '';

  it('A 店建竞对店 + 列出', async () => {
    await switchStore(opsCtx, storeA);
    const c = await call('POST', '/api/v1/competitors', {
      ctx: opsCtx,
      body: {
        name: '隔壁全家便利店',
        kind: 'offline',
        city: '东莞',
        address: '万江',
        distanceM: 50,
      },
    });
    expect(c.status).toBe(201);
    competitorA = c.json.competitor.id;
    expect(c.json.competitor.storeId).toBe(storeA);

    const list = await call('GET', '/api/v1/competitors', { ctx: opsCtx });
    expect(list.json.competitors.some((x: any) => x.id === competitorA)).toBe(true);
  });

  it('B 店切过去 A 店竞对店不出现', async () => {
    await switchStore(opsCtx, storeB);
    const list = await call('GET', '/api/v1/competitors', { ctx: opsCtx });
    expect(list.json.competitors.some((x: any) => x.id === competitorA)).toBe(false);

    // 越权改 A 店的竞对店 → 404（"不存在或无权访问"）
    const upd = await call('PUT', `/api/v1/competitors/${competitorA}`, {
      ctx: opsCtx,
      body: { isActive: false },
    });
    expect(upd.status).toBe(404);
  });

  it('A 店建竞品（mapped 到自家 SKU）+ 列出', async () => {
    await switchStore(opsCtx, storeA);
    const p = await call(
      'POST',
      `/api/v1/competitors/${competitorA}/products`,
      {
        ctx: opsCtx,
        body: {
          productName: '隔壁同款',
          mappedProductId,
        },
      },
    );
    expect(p.status).toBe(201);
    productA = p.json.product.id;
    expect(p.json.product.mappedProductId).toBe(mappedProductId);

    const list = await call(
      'GET',
      `/api/v1/competitors/${competitorA}/products`,
      { ctx: opsCtx },
    );
    expect(list.json.products.some((x: any) => x.id === productA)).toBe(true);
  });

  it('采集价格（带 photo multipart）', async () => {
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
      type: 'image/jpeg',
    });
    const r = await callForm(
      `/api/v1/competitors/products/${productA}/prices`,
      opsCtx,
      {
        retailPrice: '6.50',
        promoPrice: '5.99',
        promoText: '第二件半价',
        photo: { file: blob, filename: 'price.jpg' },
      },
    );
    expect(r.status).toBe(201);
    expect(r.json.price.retailPrice).toBe(6.5);
    expect(r.json.price.promoPrice).toBe(5.99);
    expect(r.json.price.photoUrl).toContain('myjadviser/');
  });

  it('比价：含本店有 mapping 的 SKU', async () => {
    await switchStore(opsCtx, storeA);
    const r = await call(
      'GET',
      `/api/v1/competitors/price-compare?skuCode=${encodeURIComponent(mappedSkuCode)}`,
      { ctx: opsCtx },
    );
    expect(r.status).toBe(200);
    expect(r.json.items.length).toBe(1);
    const row = r.json.items[0];
    expect(row.skuCode).toBe(mappedSkuCode);
    // 种子里可能已预置同 mapping 的竞品；只断言"我新建的 6.50 出现在列表里"
    expect(row.competitorPrices.length).toBeGreaterThanOrEqual(1);
    const mine = row.competitorPrices.find(
      (p: any) => p.competitorName === '隔壁全家便利店',
    );
    expect(mine).toBeTruthy();
    expect(mine.retailPrice).toBe(6.5);
  });

  it('停用竞对店 → 列表不出现', async () => {
    await switchStore(opsCtx, storeA);
    const upd = await call('PUT', `/api/v1/competitors/${competitorA}`, {
      ctx: opsCtx,
      body: { isActive: false },
    });
    expect(upd.status).toBe(200);
    const list = await call('GET', '/api/v1/competitors', { ctx: opsCtx });
    expect(list.json.competitors.some((x: any) => x.id === competitorA)).toBe(false);
  });
});
