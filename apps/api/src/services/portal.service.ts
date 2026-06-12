/**
 * 门户业务层（模块 2）
 *
 * 共享 auth.service 的角色 / 门店派生逻辑，但接口风格更适合"门户首页"消费：
 *   - listModules(roles)：4 张卡片各自 enabled 状态 + 禁用原因
 *   - listStores(userId, isSuperAdmin)：可见门店清单 + total
 *   - switchActiveStore(userId, sessionToken, storeId)：换 active_store_id；校验门店属于该用户
 */
import { query } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { hashToken } from '../lib/session.js';
import type {
  ModuleKey,
  PortalModulesResponse,
  PortalStoresResponse,
  StoreRef,
  SwitchStoreResponse,
} from '../types/api.js';

const MODULE_DEFS: Array<{ key: ModuleKey; label: string }> = [
  { key: 'shelves', label: '货盘选品' },
  { key: 'prices', label: '价盘管理' },
  { key: 'posters', label: '活动海报' },
  { key: 'lobster', label: '美宜佳龙虾' },
  { key: 'admin', label: '后台管理' },
];

const ROLE_MODULES: Record<string, ModuleKey[]> = {
  super_admin: ['shelves', 'prices', 'posters', 'lobster', 'admin'],
  store_owner: ['shelves', 'prices', 'posters', 'lobster'],
  analyst: ['shelves', 'prices'],
  account_manager: ['shelves', 'prices'],
};

export function listModulesForRoles(roles: string[]): PortalModulesResponse {
  const enabled = new Set<ModuleKey>();
  for (const role of roles) {
    for (const m of ROLE_MODULES[role] ?? []) enabled.add(m);
  }
  return {
    modules: MODULE_DEFS.map((def) => ({
      key: def.key,
      label: def.label,
      enabled: enabled.has(def.key),
      disabledReason: enabled.has(def.key)
        ? null
        : '当前角色无权限。如需开通请联系超管。',
    })),
  };
}

export async function listStoresForUser(
  userId: string,
  isSuperAdmin: boolean,
): Promise<PortalStoresResponse> {
  // latitude/longitude/address：选品的"周边商圈洞察"调高德 v5 around 必填，
  // 前端 storeCoordinates 在进模块时 build 出 code → "lng,lat" 的 cache，
  // 让 useShelfQuestions / useEnvironmentInsight 同步取。numeric → string 在
  // JS 端拼，这里只给原值。
  let stores: StoreRef[];
  if (isSuperAdmin) {
    const res = await query<{
      id: string;
      store_code: string;
      store_name: string;
      latitude: string | null;
      longitude: string | null;
      address: string | null;
    }>(
      `SELECT id, store_code, store_name, latitude, longitude, address
         FROM stores
        WHERE deleted_at IS NULL AND status = 'active'
        ORDER BY store_code`,
    );
    stores = res.rows.map((r) => ({
      id: r.id,
      code: r.store_code,
      name: r.store_name,
      latitude: r.latitude == null ? null : Number(r.latitude),
      longitude: r.longitude == null ? null : Number(r.longitude),
      address: r.address,
    }));
  } else {
    const res = await query<{
      id: string;
      store_code: string;
      store_name: string;
      is_primary: boolean;
      latitude: string | null;
      longitude: string | null;
      address: string | null;
    }>(
      `SELECT s.id, s.store_code, s.store_name, us.is_primary,
              s.latitude, s.longitude, s.address
         FROM user_stores us
         JOIN stores s ON s.id = us.store_id
        WHERE us.user_id = $1
          AND s.deleted_at IS NULL
          AND s.status = 'active'
        ORDER BY us.is_primary DESC, s.store_code`,
      [userId],
    );
    stores = res.rows.map((r) => ({
      id: r.id,
      code: r.store_code,
      name: r.store_name,
      isPrimary: r.is_primary,
      latitude: r.latitude == null ? null : Number(r.latitude),
      longitude: r.longitude == null ? null : Number(r.longitude),
      address: r.address,
    }));
  }
  return { stores, total: stores.length };
}

/**
 * 切换当前会话的激活门店。
 *
 * 安全：
 *   - 超管可切到任意 active 门店
 *   - 店长只能切到自己 user_stores 关联的门店
 *   - 找不到匹配 → 403 FORBIDDEN
 *
 * 不改 user_stores.is_primary（那是"长期默认"，由后台账号管理改）；
 * 只改 auth_sessions.active_store_id（当前会话的"现在用哪家"）。
 */
export async function switchActiveStore(
  userId: string,
  sessionToken: string,
  storeId: string,
  isSuperAdmin: boolean,
): Promise<SwitchStoreResponse> {
  // 校验目标门店存在且 active
  const storeRes = await query<{
    id: string;
    store_code: string;
    store_name: string;
  }>(
    `SELECT id, store_code, store_name
       FROM stores
      WHERE id = $1 AND deleted_at IS NULL AND status = 'active'
      LIMIT 1`,
    [storeId],
  );
  const store = storeRes.rows[0];
  if (!store) {
    throw new AppError(404, ErrorCodes.STORE_NOT_FOUND, '门店不存在或已停用');
  }

  // 非超管：校验是否在该用户的 user_stores 里
  if (!isSuperAdmin) {
    const allowed = await query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM user_stores
          WHERE user_id = $1 AND store_id = $2
       ) AS exists`,
      [userId, storeId],
    );
    if (!allowed.rows[0]?.exists) {
      throw new AppError(
        403,
        ErrorCodes.FORBIDDEN,
        '您没有该门店的访问权限',
      );
    }
  }

  // 更新当前会话的 active_store_id
  const tokenHash = hashToken(sessionToken);
  await query(
    `UPDATE auth_sessions
        SET active_store_id = $1, last_seen_at = now()
      WHERE token_hash = $2`,
    [storeId, tokenHash],
  );

  return {
    currentStore: {
      id: store.id,
      code: store.store_code,
      name: store.store_name,
    },
  };
}
