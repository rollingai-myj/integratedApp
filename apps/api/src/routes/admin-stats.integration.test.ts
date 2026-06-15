/**
 * Phase 6 后台统计 / 审计集成测试
 *
 * 覆盖：
 *   - 非超管访问 admin 端点 → 403
 *   - login-events / audit-events 返回数组（admin 登录已写一条审计）
 *   - usage-stats / store-stats / realtime-stats 返回字段齐全
 *   - settings/image-model 默认值 + PUT 切换 + 二次 GET 反映新值
 *   - load-test/poster 并发 3 → 立即拿到 batchId 和 created=3
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

d('Phase 6 · admin stats (integration)', () => {
  let adminCtx: Ctx;
  let opsCtx: Ctx;
  let storeA: string;
  let skuCode: string;

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

    const s = await call('GET', '/api/v1/portal/stores', { ctx: adminCtx });
    storeA = s.json.stores[0].id;
    const p = await query<{ sku_code: string }>(
      `SELECT sku_code FROM hq_products WHERE category_id IS NOT NULL LIMIT 1`,
    );
    skuCode = p.rows[0]!.sku_code;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

  it('ops 访问 admin 端点 → 403', async () => {
    expect((await call('GET', '/api/v1/admin/login-events', { ctx: opsCtx })).status).toBe(403);
    expect((await call('GET', '/api/v1/admin/usage-stats', { ctx: opsCtx })).status).toBe(403);
  });

  it('login-events 返回数组（admin 登录已留痕）', async () => {
    const r = await call('GET', '/api/v1/admin/login-events?limit=20', { ctx: adminCtx });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.events)).toBe(true);
    // admin 自己登录至少 1 条
    expect(r.json.events.some((e: any) => e.eventKind === 'user_login')).toBe(true);
  });

  it('audit-events 返回数组', async () => {
    const r = await call('GET', '/api/v1/admin/audit-events?limit=10', { ctx: adminCtx });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.events)).toBe(true);
  });

  it('usage-stats 字段齐全', async () => {
    const r = await call('GET', '/api/v1/admin/usage-stats', { ctx: adminCtx });
    expect(r.status).toBe(200);
    expect(r.json.windowSeconds).toMatchObject({
      today: expect.any(Number),
      thisWeek: expect.any(Number),
      thisMonth: expect.any(Number),
      total: expect.any(Number),
    });
    expect(typeof r.json.activeUsersNow).toBe('number');
  });

  it('store-stats 含 3 家种子门店', async () => {
    const r = await call('GET', '/api/v1/admin/store-stats', { ctx: adminCtx });
    expect(r.status).toBe(200);
    expect(r.json.stores.length).toBe(3);
    for (const s of r.json.stores) {
      expect(typeof s.skuCount).toBe('number');
      expect(typeof s.snapshotDates).toBe('number');
    }
  });

  it('realtime-stats 字段齐全', async () => {
    const r = await call('GET', '/api/v1/admin/realtime-stats', { ctx: adminCtx });
    expect(r.status).toBe(200);
    expect(r.json.posterTasks).toMatchObject({ last5m: expect.any(Number) });
    expect(r.json.priceChanges).toMatchObject({ last5m: expect.any(Number) });
    expect(typeof r.json.loginsToday).toBe('number');
    expect(typeof r.json.onlineUsersNow).toBe('number');
  });

  it('settings/image-model：GET 默认 → PUT → 再 GET 反映新值', async () => {
    const r1 = await call('GET', '/api/v1/admin/settings/image-model', { ctx: adminCtx });
    expect(r1.status).toBe(200);
    expect(r1.json.value.length).toBeGreaterThan(0);
    const originalModel = r1.json.value as string;

    try {
      const r2 = await call('PUT', '/api/v1/admin/settings/image-model', {
        ctx: adminCtx,
        body: { value: 'google/test-model-x' },
      });
      expect(r2.status).toBe(200);
      expect(r2.json.value).toBe('google/test-model-x');

      const r3 = await call('GET', '/api/v1/admin/settings/image-model', { ctx: adminCtx });
      expect(r3.json.value).toBe('google/test-model-x');
    } finally {
      // 测试若误连 dev DB（DATABASE_URL 没指 myj_test），原状一定要 PUT 回去，
      // 否则 poster_image_model 留在 'google/test-model-x'，整个 dev 环境
      // 海报生成全 400。
      await call('PUT', '/api/v1/admin/settings/image-model', {
        ctx: adminCtx,
        body: { value: originalModel },
      });
    }
  });

  it('load-test/poster 并发 3 → 立即返回', async () => {
    const r = await call('POST', '/api/v1/admin/load-test/poster', {
      ctx: adminCtx,
      body: {
        concurrency: 3,
        storeId: storeA,
        skuCode,
      },
    });
    expect(r.status).toBe(200);
    expect(r.json.created).toBe(3);
    expect(r.json.batchId).toBeTruthy();
    expect(typeof r.json.elapsedMs).toBe('number');
  });
});
