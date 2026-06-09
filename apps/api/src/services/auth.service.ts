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
import { feishuService } from './feishu.service.js';
import { upsertUserFromFeishu } from './feishu-identity.service.js';
import type {
  AuthenticatedUser,
  AuthNotice,
  MeResponse,
  ModuleKey,
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

const MODULES_BY_ROLE: Record<string, ModuleKey[]> = {
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
 * 飞书 OAuth code 登录：code → user_token → 用户信息 → upsert → session
 *
 * 返回：颁发的 session token（明文，调用方种 cookie）+ 用户 + notice
 */
export async function loginWithFeishu(args: {
  code: string;
  clientType: 'feishu_h5' | 'feishu_pc' | 'browser';
  userAgent: string | null;
  ip: string | null;
}): Promise<{
  token: string;
  expiresAt: Date;
  user: AuthenticatedUser;
  notice: AuthNotice | null;
}> {
  // 1. code → user_access_token + open_id
  const tokenInfo = await feishuService.exchangeCodeForUserToken(args.code);

  // 2. user_access_token + open_id → 通讯录完整信息（含 department_path）
  const feishuUser = await feishuService.fetchUserContact(
    tokenInfo.open_id,
    tokenInfo.access_token,
  );

  // 3. 解析身份 + 匹配门店 + upsert 本地账号
  const upsert = await upsertUserFromFeishu(
    feishuUser,
    tokenInfo.access_token,
    tokenInfo.expires_in,
  );

  // 4. 颁发会话
  const { token, tokenHash } = issueToken();
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_SECONDS * 1000);

  const authMethod =
    args.clientType === 'feishu_h5' || args.clientType === 'feishu_pc'
      ? 'feishu_h5'
      : 'feishu_qr';

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO auth_sessions
        (user_id, token_hash, auth_method, client_type, active_store_id, user_agent, ip, expires_at)
       VALUES ($1, $2, $3::auth_method, $4::feishu_client_type, $5, $6, $7::inet, $8)`,
      [
        upsert.userId,
        tokenHash,
        authMethod,
        args.clientType,
        upsert.defaultStoreId,
        args.userAgent,
        args.ip,
        expiresAt,
      ],
    );
    await client.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [
      upsert.userId,
    ]);
  });

  const roles = await loadRoles(upsert.userId);

  return {
    token,
    expiresAt,
    user: {
      id: upsert.userId,
      name: upsert.displayName,
      email: upsert.email ?? undefined,
      avatarUrl: upsert.avatarUrl ?? undefined,
      roles,
    },
    notice: upsert.notice,
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

  const feishuRes = await query<{ user_id: string }>(
    `SELECT user_id FROM user_feishu_identities WHERE user_id = $1 LIMIT 1`,
    [user.id],
  );
  const feishuLinked = feishuRes.rows.length > 0;

  // notice 合成规则：飞书绑定 + 非超管 + 0 门店 → 提示部门指向的门店未登记
  // （首次登录时 loginWithFeishu 已带 notice；这里是后续 /auth/me 的兜底合成）
  const notice: AuthNotice | null =
    feishuLinked && !isSuperAdmin && stores.length === 0
      ? {
          code: 'NO_STORE_MATCHED',
          message:
            '您的飞书账号没有匹配到任何门店。请联系超管核对您的部门归属，或在系统中开通对应门店。',
        }
      : null;

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
    feishuLinked,
    modules,
    notice,
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
  // 只回退到 primary：保证普通账号（user_stores 里有 is_primary 记录）登录后默认进自家门店。
  // 不再 fallback 到 stores[0]：超管所有门店都是 isPrimary=false，登录后 currentStore 保持 null，
  // 前端据此跳到 /select-store 选店页。
  return stores.find((s) => s.isPrimary) ?? null;
}

function computeModules(roles: string[]): ModuleKey[] {
  const set = new Set<ModuleKey>();
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
