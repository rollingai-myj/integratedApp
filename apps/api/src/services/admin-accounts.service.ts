/**
 * 后台账号管理（仅超管）
 *
 * 覆盖 api-to-be.md Admin 模块的账号部分：
 *   列表 / 创建 / 重置密码 / 删除（软删）/ 重置门店绑定 / 重置角色
 *
 * 约定：
 *   - "重置"语义：stores / roles 两个 PUT 都是整体替换（不是增量）
 *   - 删除 = 软删 users.deleted_at + 撤销其全部会话
 *   - 自我保护：不能删自己、不能摘掉自己的 super_admin
 */
import { query, withTransaction } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';

const VALID_ROLES = ['super_admin', 'store_owner', 'analyst', 'account_manager'] as const;
export type SystemRole = (typeof VALID_ROLES)[number];

export interface AccountSummary {
  id: string;
  displayName: string;
  account: string | null;
  email: string | null;
  status: 'active' | 'disabled';
  roles: string[];
  stores: Array<{ id: string; code: string; name: string; isPrimary: boolean }>;
  feishuLinked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export async function listAccounts(): Promise<{ accounts: AccountSummary[] }> {
  const res = await query<{
    id: string;
    display_name: string;
    legacy_account: string | null;
    email: string | null;
    status: 'active' | 'disabled';
    last_login_at: Date | null;
    created_at: Date;
    roles: string[] | null;
    feishu_linked: boolean;
    stores: Array<{ id: string; code: string; name: string; isPrimary: boolean }> | null;
  }>(
    `SELECT u.id, u.display_name, u.legacy_account, u.email, u.status,
            u.last_login_at, u.created_at,
            (SELECT array_agg(r.system_role ORDER BY r.system_role)
               FROM user_roles r WHERE r.user_id = u.id) AS roles,
            EXISTS(SELECT 1 FROM user_feishu_identities f WHERE f.user_id = u.id) AS feishu_linked,
            (SELECT json_agg(json_build_object(
                      'id', s.id, 'code', s.store_code, 'name', s.store_name,
                      'isPrimary', us.is_primary) ORDER BY us.is_primary DESC, s.store_code)
               FROM user_stores us JOIN stores s ON s.id = us.store_id
              WHERE us.user_id = u.id AND s.deleted_at IS NULL) AS stores
       FROM users u
      WHERE u.deleted_at IS NULL
      ORDER BY u.created_at`,
  );
  return {
    accounts: res.rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      account: r.legacy_account,
      email: r.email,
      status: r.status,
      roles: r.roles ?? [],
      stores: r.stores ?? [],
      feishuLinked: r.feishu_linked,
      lastLoginAt: r.last_login_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
    })),
  };
}

export async function createAccount(input: {
  account: string;
  password: string;
  displayName: string;
  email?: string | null;
  roles?: string[];
  storeIds?: string[];
}): Promise<{ id: string }> {
  const roles = normalizeRoles(input.roles ?? ['store_owner']);
  if (input.password.length < 8) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '密码至少 8 位');
  }
  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (client) => {
    const dup = await client.query(
      `SELECT 1 FROM users WHERE legacy_account = $1 AND deleted_at IS NULL LIMIT 1`,
      [input.account],
    );
    if (dup.rows.length > 0) {
      throw new AppError(409, ErrorCodes.CONFLICT, '账号名已存在');
    }

    const userRes = await client.query<{ id: string }>(
      `INSERT INTO users (display_name, email, legacy_account, legacy_password_hash, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id`,
      [input.displayName, input.email ?? null, input.account, passwordHash],
    );
    const userId = userRes.rows[0]!.id;

    for (const role of roles) {
      await client.query(
        `INSERT INTO user_roles (user_id, system_role) VALUES ($1, $2::system_role)`,
        [userId, role],
      );
    }
    if (input.storeIds && input.storeIds.length > 0) {
      await bindStores(client, userId, input.storeIds);
    }
    return { id: userId };
  });
}

export async function resetPassword(userId: string, password: string): Promise<void> {
  if (password.length < 8) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '密码至少 8 位');
  }
  const passwordHash = await hashPassword(password);
  const res = await query(
    `UPDATE users SET legacy_password_hash = $2, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL`,
    [userId, passwordHash],
  );
  if ((res.rowCount ?? 0) === 0) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, '账号不存在');
  }
  // 改密后强制下线该用户全部会话
  await query(
    `UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}

export async function deleteAccount(userId: string, actorUserId: string): Promise<void> {
  if (userId === actorUserId) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, '不能删除自己的账号');
  }
  await withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE users SET deleted_at = now(), status = 'disabled', updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if ((res.rowCount ?? 0) === 0) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, '账号不存在');
    }
    await client.query(
      `UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  });
}

/** 重置门店绑定（整体替换）；primaryStoreId 缺省取第一个 */
export async function setAccountStores(
  userId: string,
  storeIds: string[],
  primaryStoreId?: string | null,
): Promise<void> {
  await withTransaction(async (client) => {
    await assertUserExists(client, userId);
    await client.query(`DELETE FROM user_stores WHERE user_id = $1`, [userId]);
    if (storeIds.length > 0) {
      await bindStores(client, userId, storeIds, primaryStoreId ?? storeIds[0]);
    }
  });
}

/** 重置角色（整体替换）；保护：不能摘掉自己的 super_admin */
export async function setAccountRoles(
  userId: string,
  roles: string[],
  actorUserId: string,
): Promise<void> {
  const normalized = normalizeRoles(roles);
  if (userId === actorUserId && !normalized.includes('super_admin')) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, '不能移除自己的超管角色');
  }
  await withTransaction(async (client) => {
    await assertUserExists(client, userId);
    await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
    for (const role of normalized) {
      await client.query(
        `INSERT INTO user_roles (user_id, system_role) VALUES ($1, $2::system_role)`,
        [userId, role],
      );
    }
  });
}

// -- internals ----------------------------------------------------------------

function normalizeRoles(roles: string[]): SystemRole[] {
  const out = new Set<SystemRole>();
  for (const r of roles) {
    if (!(VALID_ROLES as readonly string[]).includes(r)) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `未知角色：${r}`);
    }
    out.add(r as SystemRole);
  }
  if (out.size === 0) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '至少需要一个角色');
  }
  return Array.from(out);
}

type Client = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> };

async function assertUserExists(client: Client, userId: string): Promise<void> {
  const res = await client.query(
    `SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId],
  );
  if (res.rows.length === 0) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, '账号不存在');
  }
}

async function bindStores(
  client: Client,
  userId: string,
  storeIds: string[],
  primaryStoreId?: string,
): Promise<void> {
  const stores = await client.query(
    `SELECT id FROM stores WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [storeIds],
  );
  if (stores.rows.length !== new Set(storeIds).size) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '存在无效的门店 ID');
  }
  const primary = primaryStoreId ?? storeIds[0];
  for (const storeId of new Set(storeIds)) {
    await client.query(
      `INSERT INTO user_stores (user_id, store_id, is_primary)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, store_id) DO UPDATE SET is_primary = EXCLUDED.is_primary`,
      [userId, storeId, storeId === primary],
    );
  }
}
