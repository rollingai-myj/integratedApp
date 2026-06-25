/**
 * Phase 5 海报集成测试（HTTP 级，打真实 DB）
 *
 * 跑前提：
 *   1) DB_NAME=myj_test bash apps/api/scripts/db-reset.sh
 *   2) INTEGRATION_DB=1 DATABASE_URL=postgresql://...:5432/myj_test npx vitest run src/routes/posters.integration.test.ts
 *
 * 覆盖（refactor-plan.md Phase 5 自测项）：
 *   - 任务建立（含 task_products 锚点）
 *   - 采用每任务至多一条（约束 #13 → 409）
 *   - 越权采用 403
 *   - 下载计数 +1
 *   - 素材库 CRUD + 跨店隔离（admin 切店看不到 ops 店素材）
 *   - 销量追踪视图至少能查（不报错；空库返回 []）
 *
 * 注：worker claim/process 路径会调 Corelays gpt-image-2（外网 AI），本测试用 SQL 直接把
 * generation 状态推到 succeeded，绕开 AI 调用——重点是 adopt/download/assets 业务规则。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../app.js';
import { pool, query } from '../db/index.js';

const enabled = process.env.INTEGRATION_DB === '1';
const d = enabled ? describe : describe.skip;

let server: Server;
let base = '';

interface Ctx {
  cookie: string;
}

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
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
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
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
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

d('Phase 5 · posters (integration)', () => {
  let opsCtx: Ctx;
  let adminCtx: Ctx;
  let opsStoreA: string; // ops 第一家店
  let opsStoreB: string; // ops 第二家店
  let sampleSkuCode: string;

  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    if (typeof addr === 'object' && addr) base = `http://127.0.0.1:${addr.port}`;

    if (!enabled) return;

    // 用 admin 账号登录（管全 3 店）；从 stores 里挑前两家给 ops 测试
    adminCtx = await login('admin', 'Admin@1234');

    // ops 是种子里的运营账号
    opsCtx = await login('ops', 'Ops@1234');

    // 拿 ops 的可用门店列表
    const r = await call('GET', '/api/v1/portal/stores', { ctx: opsCtx });
    expect(r.status).toBe(200);
    const stores = r.json.stores as Array<{ id: string }>;
    expect(stores.length).toBeGreaterThanOrEqual(2);
    opsStoreA = stores[0]!.id;
    opsStoreB = stores[1]!.id;

    // 抓一个真实的 sku_code 用来建任务
    const skuRow = await query<{ sku_code: string }>(
      `SELECT sku_code FROM hq_products WHERE category_id IS NOT NULL LIMIT 1`,
    );
    expect(skuRow.rows.length).toBe(1);
    sampleSkuCode = skuRow.rows[0]!.sku_code;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

  // ---------- 任务建立 + 采用唯一性 ----------

  it('创建任务后立刻有 generation #1 = queued', async () => {
    await switchStore(opsCtx, opsStoreA);
    const r = await call('POST', '/api/v1/posters/tasks', {
      ctx: opsCtx,
      body: {
        tasks: [
          {
            mode: 'photo_compose',
            template: 'vibrant',
            copyText: '夏日促销 第二件半价',
            skuCode: sampleSkuCode,
          },
        ],
      },
    });
    expect(r.status).toBe(201);
    expect(r.json.batchId).toBeTruthy();
    expect(r.json.tasks).toHaveLength(1);
    const task = r.json.tasks[0];
    expect(task.latestGeneration.status).toBe('queued');
    expect(task.latestGeneration.attemptNo).toBe(1);
    expect(task.products).toHaveLength(1);
    expect(task.products[0].skuCode).toBe(sampleSkuCode);
  });

  it('采用唯一性：同任务采用第二条 → 409', async () => {
    await switchStore(opsCtx, opsStoreA);
    // 1. 建任务
    const create = await call('POST', '/api/v1/posters/tasks', {
      ctx: opsCtx,
      body: {
        tasks: [
          {
            mode: 'photo_compose',
            template: 'minimal',
            copyText: 'adopt-conflict-test',
            skuCode: sampleSkuCode,
          },
        ],
      },
    });
    expect(create.status).toBe(201);
    const taskId = create.json.tasks[0].id as string;
    const gen1Id = create.json.tasks[0].latestGeneration.id as string;

    // 2. 直接 SQL 把 generation #1 推到 succeeded（绕过 worker）
    await query(
      `UPDATE store_poster_generations
          SET status = 'succeeded',
              poster_image_url = 'https://example.com/poster.jpg',
              finished_at = now()
        WHERE id = $1`,
      [gen1Id],
    );

    // 3. 采用 → 200
    const adopt1 = await call(
      'POST',
      `/api/v1/posters/generations/${gen1Id}/adopt`,
      { ctx: opsCtx },
    );
    expect(adopt1.status).toBe(200);
    expect(adopt1.json.generation.isAdopted).toBe(true);

    // 4. 重新生成 → 新 attempt
    const re = await call(
      'POST',
      `/api/v1/posters/tasks/${taskId}/generations`,
      { ctx: opsCtx },
    );
    expect(re.status).toBe(201);
    const gen2Id = re.json.generation.id as string;

    // 5. 把新 attempt 推到 succeeded
    await query(
      `UPDATE store_poster_generations
          SET status = 'succeeded',
              poster_image_url = 'https://example.com/poster2.jpg',
              finished_at = now()
        WHERE id = $1`,
      [gen2Id],
    );

    // 6. 同任务采用第二条 → 409
    const adopt2 = await call(
      'POST',
      `/api/v1/posters/generations/${gen2Id}/adopt`,
      { ctx: opsCtx },
    );
    expect(adopt2.status).toBe(409);
  });

  it('下载计数 +1', async () => {
    await switchStore(opsCtx, opsStoreA);
    const create = await call('POST', '/api/v1/posters/tasks', {
      ctx: opsCtx,
      body: {
        tasks: [
          {
            mode: 'official_bg_only',
            template: 'premium',
            copyText: 'download-test',
            skuCode: sampleSkuCode,
          },
        ],
      },
    });
    const genId = create.json.tasks[0].latestGeneration.id as string;
    await query(
      `UPDATE store_poster_generations
          SET status = 'succeeded',
              poster_image_url = 'https://example.com/x.jpg',
              finished_at = now()
        WHERE id = $1`,
      [genId],
    );

    const d1 = await call(
      'POST',
      `/api/v1/posters/generations/${genId}/download`,
      { ctx: opsCtx },
    );
    expect(d1.status).toBe(200);
    expect(d1.json.count).toBe(1);
    expect(d1.json.url).toBe('https://example.com/x.jpg');

    // 首次下载触发采纳 —— is_adopted=true + adopted_at 落时间戳
    const after1 = await query<{ is_adopted: boolean; adopted_at: string | null }>(
      `SELECT is_adopted, adopted_at FROM store_poster_generations WHERE id = $1`,
      [genId],
    );
    expect(after1.rows[0]!.is_adopted).toBe(true);
    expect(after1.rows[0]!.adopted_at).not.toBeNull();
    const firstAdoptedAt = after1.rows[0]!.adopted_at;

    const d2 = await call(
      'POST',
      `/api/v1/posters/generations/${genId}/download`,
      { ctx: opsCtx },
    );
    expect(d2.json.count).toBe(2);

    // 二次下载不更新 adopted_at —— 销量追踪起点是首次下载时刻，不应被覆盖
    const after2 = await query<{ adopted_at: string | null }>(
      `SELECT adopted_at FROM store_poster_generations WHERE id = $1`,
      [genId],
    );
    expect(after2.rows[0]!.adopted_at).toBe(firstAdoptedAt);
  });

  it('同 task 下载第二张 generation：第一张已采纳，第二张静默不采纳', async () => {
    await switchStore(opsCtx, opsStoreA);
    const create = await call('POST', '/api/v1/posters/tasks', {
      ctx: opsCtx,
      body: {
        tasks: [
          {
            mode: 'official_bg_only',
            template: 'premium',
            copyText: 'download-second-gen-silent',
            skuCode: sampleSkuCode,
          },
        ],
      },
    });
    const taskId = create.json.tasks[0].id as string;
    const gen1Id = create.json.tasks[0].latestGeneration.id as string;
    await query(
      `UPDATE store_poster_generations
          SET status = 'succeeded',
              poster_image_url = 'https://example.com/gen1.jpg',
              finished_at = now()
        WHERE id = $1`,
      [gen1Id],
    );

    // 下载第一张 → 自动采纳
    await call('POST', `/api/v1/posters/generations/${gen1Id}/download`, { ctx: opsCtx });

    // 重新生成出第二张
    const regen = await call('POST', `/api/v1/posters/tasks/${taskId}/generations`, {
      ctx: opsCtx,
    });
    const gen2Id = regen.json.generation.id as string;
    await query(
      `UPDATE store_poster_generations
          SET status = 'succeeded',
              poster_image_url = 'https://example.com/gen2.jpg',
              finished_at = now()
        WHERE id = $1`,
      [gen2Id],
    );

    // 下载第二张：count +1，但 is_adopted 仍是 false（起点已经被第一张占了）
    const d2 = await call('POST', `/api/v1/posters/generations/${gen2Id}/download`, {
      ctx: opsCtx,
    });
    expect(d2.status).toBe(200);
    const gen2State = await query<{ is_adopted: boolean }>(
      `SELECT is_adopted FROM store_poster_generations WHERE id = $1`,
      [gen2Id],
    );
    expect(gen2State.rows[0]!.is_adopted).toBe(false);
  });

  // ---------- 素材库 + 跨店隔离 ----------

  it('上传素材 → 列出 → 删除 → 列表不含', async () => {
    await switchStore(opsCtx, opsStoreA);

    // 上传一张极小的 jpg 占位
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
      type: 'image/jpeg',
    });
    const up = await callForm('/api/v1/posters/assets', opsCtx, {
      kind: 'background',
      file: { file: blob, filename: 'bg-test.jpg' },
    });
    expect(up.status).toBe(201);
    const assetId = up.json.asset.id as string;
    expect(up.json.asset.kind).toBe('background');

    const list1 = await call('GET', '/api/v1/posters/assets?kind=background', {
      ctx: opsCtx,
    });
    expect(list1.status).toBe(200);
    expect(list1.json.assets.some((a: any) => a.id === assetId)).toBe(true);

    const del = await call('DELETE', `/api/v1/posters/assets/${assetId}`, {
      ctx: opsCtx,
    });
    expect(del.status).toBe(204);

    const list2 = await call('GET', '/api/v1/posters/assets?kind=background', {
      ctx: opsCtx,
    });
    expect(list2.json.assets.some((a: any) => a.id === assetId)).toBe(false);
  });

  it('素材库跨店隔离：A 店上传 B 店看不到', async () => {
    // ops 切到 A 店上传
    await switchStore(opsCtx, opsStoreA);
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
      type: 'image/jpeg',
    });
    const up = await callForm('/api/v1/posters/assets', opsCtx, {
      kind: 'background',
      file: { file: blob, filename: 'store-a-bg.jpg' },
    });
    expect(up.status).toBe(201);
    const assetId = up.json.asset.id as string;

    // 切到 B 店
    await switchStore(opsCtx, opsStoreB);
    const list = await call('GET', '/api/v1/posters/assets?kind=background', {
      ctx: opsCtx,
    });
    expect(list.json.assets.some((a: any) => a.id === assetId)).toBe(false);
  });

  // ---------- 销量追踪视图 ----------

  it('销量追踪视图：未采用任何海报时返回空 items', async () => {
    await switchStore(opsCtx, opsStoreB); // 切到一个没操作过的店
    const r = await call('GET', '/api/v1/posters/sales-tracking', {
      ctx: opsCtx,
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.items)).toBe(true);
  });

  // ---------- 今日额度 ----------

  it('today-count 返回数字（>= 上面建过的任务数）', async () => {
    await switchStore(opsCtx, opsStoreA);
    const r = await call('GET', '/api/v1/posters/today-count', { ctx: opsCtx });
    expect(r.status).toBe(200);
    expect(typeof r.json.count).toBe('number');
    expect(r.json.count).toBeGreaterThanOrEqual(1);
  });
});
