/**
 * Phase 2 集成测试：认证 / 门户 / 账号管理（HTTP 级，打真实 DB）
 *
 * 跑前提：
 *   1) DB_NAME=myj_test bash apps/api/scripts/db-reset.sh   （建测试库 + 种子）
 *   2) INTEGRATION_DB=1 DATABASE_URL=postgresql://...:5432/myj_test npx vitest run src/routes/portal-auth.integration.test.ts
 *
 * 覆盖（refactor-plan.md Phase 2 自测项）：
 *   未登录 401 / 错密码 401 / admin 与 ops 登录 / me 装配 /
 *   切店正反例（403 越权）/ admin 端点角色门槛 403 /
 *   账号建-重密-删全链路 / usage start+heartbeat / 登出失效 / 审计落库
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
): Promise<{ status: number; json: any; setCookie: string | null }> {
  const res = await fetch(`${base}${path}`, {
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
  if (text) {
    try { json = JSON.parse(text); } catch { json = text; }
  }
  return { status: res.status, json, setCookie };
}

function cookieOf(setCookie: string | null): Ctx {
  expect(setCookie).toBeTruthy();
  const m = /sso_token=([^;]+)/.exec(setCookie!);
  expect(m).toBeTruthy();
  return { cookie: `sso_token=${m![1]}` };
}

async function login(account: string, password: string) {
  return call('POST', '/api/v1/auth/login', { body: { account, password } });
}

d('Phase 2 · auth / portal / admin accounts (integration)', () => {
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

  // ---- 认证 ----------------------------------------------------------------

  it('未登录访问受保护端点 → 401', async () => {
    expect((await call('GET', '/api/v1/portal/stores')).status).toBe(401);
    expect((await call('POST', '/api/v1/portal/usage:start')).status).toBe(401);
  });

  it('错误密码 → 401，同样文案防枚举', async () => {
    const bad1 = await login('admin', 'wrong-password');
    const bad2 = await login('no-such-user', 'whatever123');
    expect(bad1.status).toBe(401);
    expect(bad2.status).toBe(401);
    expect(bad1.json.error.message).toBe(bad2.json.error.message);
  });

  it('admin 登录 → 角色 super_admin、可见 3 店、多店不自动选店', async () => {
    const res = await login('admin', 'Admin@1234');
    expect(res.status).toBe(200);
    expect(res.json.user.roles).toContain('super_admin');
    const ctx = cookieOf(res.setCookie);

    const me = await call('GET', '/api/v1/auth/me', { ctx });
    expect(me.json.user.name).toBe('超级管理员');
    expect(me.json.stores).toHaveLength(3);
    expect(me.json.currentStore).toBeNull();
    expect(me.json.modules).toContain('admin');
  });

  it('ops 登录 → 仅 2 店、无 admin 模块；切未授权店 403、切授权店生效', async () => {
    const res = await login('ops', 'Ops@1234');
    expect(res.status).toBe(200);
    const ctx = cookieOf(res.setCookie);

    const me = await call('GET', '/api/v1/auth/me', { ctx });
    expect(me.json.stores).toHaveLength(2);
    expect(me.json.modules).not.toContain('admin');

    // 越权：切到不在绑定内的 粤29790
    const forbidden = await query<{ id: string }>(
      `SELECT id FROM stores WHERE store_code = '粤29790'`,
    );
    const r403 = await call('POST', '/api/v1/portal/active-store', {
      ctx, body: { storeId: forbidden.rows[0]!.id },
    });
    expect(r403.status).toBe(403);

    // 正常：切到 粤37893
    const allowed = me.json.stores.find((s: any) => s.code === '粤37893');
    const rOk = await call('POST', '/api/v1/portal/active-store', {
      ctx, body: { storeId: allowed.id },
    });
    expect(rOk.status).toBe(200);
    expect(rOk.json.currentStore.code).toBe('粤37893');

    const me2 = await call('GET', '/api/v1/auth/me', { ctx });
    expect(me2.json.currentStore.code).toBe('粤37893');
  });

  it('ops 访问 admin 端点 → 403', async () => {
    const ctx = cookieOf((await login('ops', 'Ops@1234')).setCookie);
    expect((await call('GET', '/api/v1/admin/accounts', { ctx })).status).toBe(403);
  });

  // ---- 账号管理全链路 --------------------------------------------------------

  it('admin 账号管理：建号 → 重复 409 → 新号登录 → 重置密码 → 旧密码失效 → 删号 → 登录 401', async () => {
    const ctx = cookieOf((await login('admin', 'Admin@1234')).setCookie);

    const storeRow = await query<{ id: string }>(
      `SELECT id FROM stores WHERE store_code = '粤29790'`,
    );
    const created = await call('POST', '/api/v1/admin/accounts', {
      ctx,
      body: {
        account: 'test-ops2', password: 'Test@12345', displayName: '测试运营2',
        roles: ['store_owner'], storeIds: [storeRow.rows[0]!.id],
      },
    });
    expect(created.status).toBe(201);
    const newUserId = created.json.id;

    // 重复创建 → 409
    const dup = await call('POST', '/api/v1/admin/accounts', {
      ctx, body: { account: 'test-ops2', password: 'Test@12345', displayName: 'x' },
    });
    expect(dup.status).toBe(409);

    // 新号能登录，单店自动选店
    const newLogin = await login('test-ops2', 'Test@12345');
    expect(newLogin.status).toBe(200);
    const newCtx = cookieOf(newLogin.setCookie);
    const newMe = await call('GET', '/api/v1/auth/me', { ctx: newCtx });
    expect(newMe.json.currentStore?.code).toBe('粤29790');

    // 重置密码 → 旧 cookie 全下线 + 旧密码失效
    const reset = await call('POST', `/api/v1/admin/accounts/${newUserId}/reset-password`, {
      ctx, body: { password: 'Newpass@123' },
    });
    expect(reset.status).toBe(200);
    const oldCookieMe = await call('GET', '/api/v1/auth/me', { ctx: newCtx });
    expect(oldCookieMe.json.user).toBeNull();
    expect((await login('test-ops2', 'Test@12345')).status).toBe(401);
    expect((await login('test-ops2', 'Newpass@123')).status).toBe(200);

    // 不能摘自己的 super_admin
    const meAdmin = await call('GET', '/api/v1/auth/me', { ctx });
    const selfDemote = await call('PUT', `/api/v1/admin/accounts/${meAdmin.json.user.id}/roles`, {
      ctx, body: { roles: ['store_owner'] },
    });
    expect(selfDemote.status).toBe(400);

    // 删号 → 该号登录失效
    expect((await call('DELETE', `/api/v1/admin/accounts/${newUserId}`, { ctx })).status).toBe(204);
    expect((await login('test-ops2', 'Newpass@123')).status).toBe(401);
  });

  // ---- usage 会话 ------------------------------------------------------------

  it('usage：start 返回 id，heartbeat 204，伪造 id 404', async () => {
    const ctx = cookieOf((await login('ops', 'Ops@1234')).setCookie);
    const started = await call('POST', '/api/v1/portal/usage:start', { ctx, body: {} });
    expect(started.status).toBe(201);
    expect(started.json.id).toBeTruthy();

    const hb = await call('POST', `/api/v1/portal/usage/${started.json.id}/heartbeat`, { ctx });
    expect(hb.status).toBe(204);

    const fake = await call(
      'POST', '/api/v1/portal/usage/00000000-0000-4000-8000-00000000dead/heartbeat', { ctx },
    );
    expect(fake.status).toBe(404);
  });

  // ---- 登出与审计 ------------------------------------------------------------

  it('登出 → cookie 失效；登录/登出有审计', async () => {
    const ctx = cookieOf((await login('ops', 'Ops@1234')).setCookie);
    expect((await call('POST', '/api/v1/auth/logout', { ctx })).status).toBe(204);
    const me = await call('GET', '/api/v1/auth/me', { ctx });
    expect(me.json.user).toBeNull();

    const audits = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sys_audit_events WHERE event_kind IN ('user_login', 'user_logout')`,
    );
    expect(Number(audits.rows[0]!.n)).toBeGreaterThan(0);
  });
});
