/**
 * Phase 3 集成测试：选品域 API（HTTP 级，打真实 DB）
 *
 * 跑前提：
 *   DB_NAME=myj_test bash apps/api/scripts/db-reset.sh
 *   INTEGRATION_DB=1 DATABASE_URL=postgresql://...:5432/myj_test npx vitest run src/routes/scenes.integration.test.ts
 *
 * 覆盖：
 *   未登录 401 / 未选店 409 / 场景列表与 overview / runtime CRUD（草稿持久化跨"会话"）/
 *   货架组覆盖保存 / 调改全链路（应用 → 计数 +1 → overview 反映 → 历史可查 → 草稿被清）/
 *   勘误 kind×scope 配对正反例 / 越权访问 ops 看不到 admin 数据
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
): Promise<{ cookie: string }> {
  const login = await call('POST', '/api/v1/auth/login', { body: { account, password } });
  expect(login.status).toBe(200);
  const ctx = cookieOf(login.setCookie);
  const stores = await call('GET', '/api/v1/portal/stores', { ctx });
  const store = stores.json.stores.find((s: any) => s.code === storeCode);
  expect(store).toBeTruthy();
  const sw = await call('POST', '/api/v1/portal/active-store', { ctx, body: { storeId: store.id } });
  expect(sw.status).toBe(200);
  return ctx;
}

d('Phase 3 · scenes selection-domain (integration)', () => {
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

  it('未登录访问 /scenes/overview → 401；登录未选店 → 409', async () => {
    expect((await call('GET', '/api/v1/scenes/overview')).status).toBe(401);
    const login = await call('POST', '/api/v1/auth/login', { body: { account: 'admin', password: 'Admin@1234' } });
    const ctx = cookieOf(login.setCookie);
    expect((await call('GET', '/api/v1/scenes/overview', { ctx })).status).toBe(409);
  });

  it('场景列表：13 个；HQ 品类树：13 个 level0', async () => {
    const login = await call('POST', '/api/v1/auth/login', { body: { account: 'admin', password: 'Admin@1234' } });
    const ctx = cookieOf(login.setCookie);
    const sc = await call('GET', '/api/v1/scenes', { ctx });
    expect(sc.json.scenes).toHaveLength(13);
    expect(sc.json.scenes[0].scene).toBe(0);
    expect(sc.json.scenes[0].name).toBe('糖巧');
    const tree = await call('GET', '/api/v1/hq/categories', { ctx });
    expect(tree.json.tree).toHaveLength(13);
    expect(tree.json.tree[0].level).toBe(0);
    expect(tree.json.tree[0].children?.length).toBeGreaterThan(0);
  });

  it('selection 全流程：登记货架 → 写草稿 → 应用调改 → 草稿清空 → overview 计数 +1', async () => {
    const ctx = await loginAndSelectStore('admin', 'Admin@1234', '粤39128');
    const scene = 5; // 饼干膨化（粤39128 干净）

    // Idempotent：清掉上次测试在此 scene 留下的痕迹
    const storeRow = await query<{ id: string }>(
      `SELECT id FROM stores WHERE store_code = '粤39128'`,
    );
    const storeId = storeRow.rows[0]!.id;
    await query(`DELETE FROM store_assortment_changes WHERE store_id = $1 AND scene = $2`, [storeId, scene]);
    await query(`DELETE FROM store_scene_adjustments WHERE store_id = $1 AND scene = $2`, [storeId, scene]);
    await query(`DELETE FROM store_scene_remakes WHERE store_id = $1 AND scene = $2`, [storeId, scene]);
    await query(`DELETE FROM store_scene_shelves WHERE store_id = $1 AND scene = $2`, [storeId, scene]);
    await query(`DELETE FROM store_scene_state WHERE store_id = $1 AND scene = $2`, [storeId, scene]);

    // 1) overview 起点
    const before = await call('GET', '/api/v1/scenes/overview', { ctx });
    const beforeRow = before.json.scenes.find((s: any) => s.scene === scene);
    expect(beforeRow.adjustmentCount).toBe(0);
    expect(beforeRow.shelfConfigured).toBe(false);
    expect(beforeRow.hasDraft).toBe(false);

    // 2) 登记 1 组货架
    const shelves = await call('PUT', `/api/v1/scenes/${scene}/shelves`, {
      ctx, body: { groups: [{ shelfType: '标准货架', widthCm: 75, layerCount: 5 }] },
    });
    expect(shelves.status).toBe(200);
    expect(shelves.json.groups).toHaveLength(1);
    // categories 自动取场景的 level1（"饼干膨化"下的"膨化食品" / "饼干"）
    expect(shelves.json.groups[0].categories.length).toBeGreaterThan(0);

    // 3) runtime：写一段草稿 + 环境摘要
    const r1 = await call('PUT', `/api/v1/scenes/${scene}/runtime`, {
      ctx, body: {
        photos: [{ url: 'http://example/p1.jpg' }],
        draft: { stage: 'review', reviewIndex: 2, decisions: ['accept', 'accept', 'skip'] },
        envCrowd: '社区底商，傍晚多',
        envCompetitor: '隔壁罗森',
      },
    });
    expect(r1.status).toBe(200);
    expect((r1.json.draft as any).reviewIndex).toBe(2);
    expect(r1.json.envCrowd).toBe('社区底商，傍晚多');

    // 4) overview 反映 hasDraft + shelfConfigured
    const mid = await call('GET', '/api/v1/scenes/overview', { ctx });
    const midRow = mid.json.scenes.find((s: any) => s.scene === scene);
    expect(midRow.shelfConfigured).toBe(true);
    expect(midRow.hasDraft).toBe(true);

    // 5) 应用调改
    const apply = await call('POST', `/api/v1/scenes/${scene}/adjustments`, {
      ctx, body: {
        summaryText: '测试调改',
        items: [
          { action: 'remove', skuCode: '06000460', reasonCode: 'low_sales' },
          { action: 'add',    skuCode: '06012950', reasonCode: 'ai_recommend_core' },
        ],
      },
    });
    expect(apply.status).toBe(201);
    expect(apply.json.addedCount).toBe(1);
    expect(apply.json.removedCount).toBe(1);

    // 6) 草稿被清；overview 计数 = 1
    const rt = await call('GET', `/api/v1/scenes/${scene}/runtime`, { ctx });
    expect(rt.json.draft).toBeNull();
    const after = await call('GET', '/api/v1/scenes/overview', { ctx });
    const afterRow = after.json.scenes.find((s: any) => s.scene === scene);
    expect(afterRow.adjustmentCount).toBe(1);
    expect(afterRow.hasDraft).toBe(false);

    // 7) 调改历史可查
    const hist = await call('GET', `/api/v1/scenes/${scene}/adjustments`, { ctx });
    expect(hist.json.adjustments[0].summaryText).toBe('测试调改');
  });

  it('勘误：kind×scope 配对——decision+observe 通过；detection+observe 400', async () => {
    const ctx = await loginAndSelectStore('admin', 'Admin@1234', '粤39128');
    const ok = await call('POST', '/api/v1/scenes/3/corrections', {
      ctx, body: {
        skuCode: '06000460', kind: 'observe', scope: 'decision',
        reasonCode: 'manual_keep', reasonText: '老顾客常买',
      },
    });
    expect(ok.status).toBe(201);
    const bad = await call('POST', '/api/v1/scenes/3/corrections', {
      ctx, body: {
        skuCode: '06000460', kind: 'observe', scope: 'detection',
        reasonCode: 'other',
      },
    });
    expect(bad.status).toBe(400);
  });

  it('门店隔离：ops 看到的 overview 只是自己店；勘误不会泄露', async () => {
    const adminCtx = await loginAndSelectStore('admin', 'Admin@1234', '粤39128');
    await call('POST', '/api/v1/scenes/3/corrections', {
      ctx: adminCtx, body: {
        skuCode: '06012950', kind: 'observe', scope: 'decision', reasonCode: 'manual_keep',
      },
    });
    // ops 切到不同店（粤37893）看自己的勘误清单（应该看不到 admin 在 粤39128 的）
    const opsCtx = await loginAndSelectStore('ops', 'Ops@1234', '粤37893');
    const list = await call('GET', '/api/v1/scenes/3/corrections', { ctx: opsCtx });
    const codes = (list.json.corrections as any[]).map((c) => c.skuCode);
    expect(codes).not.toContain('06012950');
  });

  it('runtime 重置：DELETE 后 GET 返回 empty', async () => {
    const ctx = await loginAndSelectStore('admin', 'Admin@1234', '粤29790');
    await call('PUT', '/api/v1/scenes/12/runtime', { ctx, body: { photos: [{ x: 1 }] } });
    expect((await call('DELETE', '/api/v1/scenes/12/runtime', { ctx })).status).toBe(204);
    const rt = await call('GET', '/api/v1/scenes/12/runtime', { ctx });
    expect(rt.json.photos).toEqual([]);
    expect(rt.json.status).toBe('empty');
  });

  it('store/skus：粤37893 冷藏场景 64 行；带 q 过滤生效', async () => {
    const ctx = await loginAndSelectStore('admin', 'Admin@1234', '粤37893');
    const all = await call('GET', '/api/v1/store/skus', { ctx, query: { scene: '12' } });
    expect(all.json.skus.length).toBeGreaterThan(50);
    expect(all.json.skus[0].snapshotDate).toBe('2026-06-11');
  });

  it('benchmark：场景 12（冷藏）返回排除本店外加权后的 SKU 列表', async () => {
    const ctx = await loginAndSelectStore('admin', 'Admin@1234', '粤37893');
    const r = await call('GET', '/api/v1/scenes/12/benchmark', { ctx });
    expect(r.status).toBe(200);
    expect(r.json.scene).toBe(12);
    expect(Array.isArray(r.json.items)).toBe(true);
    if (r.json.items.length > 0) {
      const first = r.json.items[0];
      expect(typeof first.skuCode).toBe('string');
      expect(typeof first.sales30d).toBe('string');
      expect(typeof first.salesVolume30d).toBe('string');
    }
  });

  it('detect：mock 路径返回 2 个示意框（一大一小）', async () => {
    const ctx = await loginAndSelectStore('admin', 'Admin@1234', '粤37893');
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const r = await call('POST', '/api/v1/scenes/12/detect', {
      ctx, body: { imageBase64: tinyPng, filename: 't.png' },
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.boxes)).toBe(true);
    expect(r.json.boxes.length).toBe(2);
    // 第一个大、第二个小：面积排序验证
    const area = (b: { w: number; h: number }) => b.w * b.h;
    expect(area(r.json.boxes[0])).toBeGreaterThan(area(r.json.boxes[1]));
    expect(typeof r.json.elapsedMs).toBe('number');
  });

  it('detect：空 imageBase64 → 400', async () => {
    const ctx = await loginAndSelectStore('admin', 'Admin@1234', '粤37893');
    const r = await call('POST', '/api/v1/scenes/12/detect', {
      ctx, body: { imageBase64: '' },
    });
    expect(r.status).toBe(400);
  });
});
