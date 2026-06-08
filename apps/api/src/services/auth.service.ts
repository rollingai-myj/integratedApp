/**
 * 鉴权业务层
 *
 * 覆盖 M1-PR1 的三个动作：
 *   - loginWithPassword：账号 + 密码（兜底）登录，颁发会话
 *   - getMe：根据 token 装配 MeResponse
 *   - logout：撤销会话
 *
 * D1：super_admin 不需要在 user_stores 表里有记录也能看到所有门店
 * D2：legacy_password_hash 兜底校验（详见 lib/password.ts）
 */
import { query, withTransaction } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { verifyLegacyPassword } from '../lib/password.js';
import { hashToken, issueToken } from '../lib/session.js';
import { config } from '../config/env.js';
import type {
  AuthenticatedUser,
  MeResponse,
  StoreRef,
} from '../types/api.js';

interface UserRow {
  id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  legacy_password_hash: string | null;
  status: 'active' | 'disabled';
}

interface SessionRow {
  id: string;
  user_id: string;
  active_store_id: string | null;
  expires_at: Date;
  revoked_at: Date | null;
}

interface StoreRow {
  id: string;
  store_code: string;
  store_name: string;
  is_primary: boolean;
}

const MODULES_BY_ROLE: Record<string, string[]> = {
  super_admin: ['shelves', 'prices', 'posters', 'admin'],
  store_owner: ['shelves', 'prices', 'posters'],
  analyst: ['shelves', 'prices'],
  account_manager: ['shelves', 'prices'],
};

/**
 * 账号+密码登录。匹配 users.legacy_account，校验 legacy_password_hash。
 *
 * 返回值含明文 token；调用方负责种到 cookie。
 */
export async function loginWithPassword(args: {
  account: string;
  password: string;
  userAgent: string | null;
  ip: string | null;
}): Promise<{ token: string; expiresAt: Date; user: AuthenticatedUser }> {
  const account = args.account.trim();
  if (!account || !args.password) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, '账号或密码不能为空');
  }

  const userRes = await query<UserRow>(
    `SELECT id, display_name, email, avatar_url, legacy_password_hash, status
     FROM users
     WHERE legacy_account = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [account],
  );
  const user = userRes.rows[0];

  if (!user) {
    // 用户不存在和密码错给同一种错，避免被枚举
    throw new AppError(401, ErrorCodes.UNAUTHENTICATED, '账号或密码不正确');
  }
  if (user.status !== 'active') {
    throw new AppError(403, ErrorCodes.ACCOUNT_DISABLED, '账号已停用');
  }

  const passwordOk = await verifyLegacyPassword(
    args.password,
    user.legacy_password_hash,
  );
  if (!passwordOk) {
    throw new AppError(401, ErrorCodes.UNAUTHENTICATED, '账号或密码不正确');
  }

  // 取出主店作为默认 active_store
  const primaryStoreRes = await query<{ store_id: string }>(
    `SELECT store_id FROM user_stores
     WHERE user_id = $1 AND is_primary = TRUE
     LIMIT 1`,
    [user.id],
  );
  const activeStoreId = primaryStoreRes.rows[0]?.store_id ?? null;

  const { token, tokenHash } = issueToken();
  const ttlSec = config.SESSION_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttlSec * 1000);

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO auth_sessions
        (user_id, token_hash, auth_method, client_type, active_store_id, user_agent, ip, expires_at)
       VALUES ($1, $2, 'legacy_password', 'browser', $3, $4, $5::inet, $6)`,
      [user.id, tokenHash, activeStoreId, args.userAgent, args.ip, expiresAt],
    );
    await client.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [
      user.id,
    ]);
  });

  const roles = await loadRoles(user.id);

  return {
    token,
    expiresAt,
    user: {
      id: user.id,
      name: user.display_name,
      email: user.email ?? undefined,
      avatarUrl: user.avatar_url ?? undefined,
      roles,
    },
  };
}

/**
 * 根据 token 装配 MeResponse。token 无效/过期返回未登录态。
 */
export async function getMeByToken(token: string | null): Promise<MeResponse> {
  if (!token) return emptyMe();

  const tokenHash = hashToken(token);
  const sessionRes = await query<SessionRow>(
    `SELECT id, user_id, active_store_id, expires_at, revoked_at
     FROM auth_sessions
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash],
  );
  const session = sessionRes.rows[0];
  if (!session) return emptyMe();
  if (session.revoked_at) return emptyMe();
  if (session.expires_at.getTime() < Date.now()) return emptyMe();

  const userRes = await query<UserRow>(
    `SELECT id, display_name, email, avatar_url, legacy_password_hash, status
     FROM users
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [session.user_id],
  );
  const user = userRes.rows[0];
  if (!user || user.status !== 'active') return emptyMe();

  const roles = await loadRoles(user.id);
  const isSuperAdmin = roles.includes('super_admin');
  const stores = await loadVisibleStores(user.id, isSuperAdmin);

  const currentStore =
    pickCurrentStore(stores, session.active_store_id) ?? null;

  const modules = computeModules(roles);

  // 顺手 touch 最近活跃时间（不 await，业务上无影响）
  void query(
    `UPDATE auth_sessions SET last_seen_at = now() WHERE id = $1`,
    [session.id],
  ).catch(() => {
    /* 静默：心跳更新失败不影响读取 */
  });

  // 飞书绑定（M1-PR2 实际写入；这里查一下，没绑就是 false）
  const feishuRes = await query<{ user_id: string }>(
    `SELECT user_id FROM user_feishu_identities WHERE user_id = $1 LIMIT 1`,
    [user.id],
  );

  return {
    user: {
      id: user.id,
      name: user.display_name,
      email: user.email ?? undefined,
      avatarUrl: user.avatar_url ?? undefined,
      roles,
    },
    currentStore,
    stores,
    feishuLinked: feishuRes.rows.length > 0,
    modules,
  };
}

/**
 * 撤销会话。token 不存在视为已成功，避免泄露登录态。
 */
export async function logoutByToken(token: string | null): Promise<void> {
  if (!token) return;
  const tokenHash = hashToken(token);
  await query(
    `UPDATE auth_sessions
     SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );
}

// -- internals ---------------------------------------------------------------

async function loadRoles(userId: string): Promise<string[]> {
  const res = await query<{ role: string }>(
    `SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role`,
    [userId],
  );
  return res.rows.map((r) => r.role);
}

async function loadVisibleStores(
  userId: string,
  isSuperAdmin: boolean,
): Promise<StoreRef[]> {
  if (isSuperAdmin) {
    // D1：超管不需要在 user_stores 里有条目，直接看全部
    const res = await query<StoreRow>(
      `SELECT id, store_code, store_name, FALSE AS is_primary
       FROM stores
       WHERE deleted_at IS NULL AND status = 'active'
       ORDER BY store_code`,
    );
    return res.rows.map(toStoreRef);
  }

  const res = await query<StoreRow>(
    `SELECT s.id, s.store_code, s.store_name, us.is_primary
     FROM user_stores us
     JOIN stores s ON s.id = us.store_id
     WHERE us.user_id = $1
       AND s.deleted_at IS NULL
       AND s.status = 'active'
     ORDER BY us.is_primary DESC, s.store_code`,
    [userId],
  );
  return res.rows.map(toStoreRef);
}

function toStoreRef(r: StoreRow): StoreRef {
  return {
    id: r.id,
    code: r.store_code,
    name: r.store_name,
    isPrimary: r.is_primary,
  };
}

function pickCurrentStore(
  stores: StoreRef[],
  sessionStoreId: string | null,
): StoreRef | null {
  if (sessionStoreId) {
    const match = stores.find((s) => s.id === sessionStoreId);
    if (match) return match;
  }
  const primary = stores.find((s) => s.isPrimary);
  return primary ?? stores[0] ?? null;
}

function computeModules(roles: string[]): string[] {
  const set = new Set<string>();
  for (const role of roles) {
    for (const m of MODULES_BY_ROLE[role] ?? []) set.add(m);
  }
  return Array.from(set);
}

function emptyMe(): MeResponse {
  return {
    user: null,
    currentStore: null,
    stores: [],
    feishuLinked: false,
    modules: [],
  };
}
