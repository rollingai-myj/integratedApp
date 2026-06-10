/**
 * 飞书身份解析 + 本地账号 upsert
 *
 * 业务规则（由用户在 2026-06-08 拍板）：
 *   规则 A（超管识别）：任一部门"完整路径名 + 叶子名"包含 "Rolling Digital" → super_admin
 *   规则 B（门店识别）：所有 department_name.name 都作为"门店号候选"，在 stores.store_code 里查匹配
 *
 * 关键考量：
 *   - 门店号格式不固定（粤+5位、4位数字、可能带其他文字），不做正则校验，全靠 DB 查找
 *   - 一个用户的 department_path 可能有多条（一条职能 + 一条门店）
 *   - 店长 + 没匹配到门店 ≠ 不让登录；返回 notice 让前端友好提示
 *   - 飞书首次登录时：优先按 open_id 找绑定；找不到再按邮箱找老账号；都没有就建新 user
 */
import { withTransaction, query } from '../db/index.js';
import type { PoolClient } from 'pg';
import type {
  FeishuDeptPathItem,
  FeishuUserContact,
} from './feishu.service.js';
import { logger } from '../lib/logger.js';

const SUPER_ADMIN_MARKER = 'Rolling Digital';

export interface ParsedFeishuIdentity {
  isSuperAdmin: boolean;
  /** 所有部门叶子名（去重）—— 用来去 stores 表查匹配 */
  leafCandidates: string[];
  /** 完整调试视图：每条部门的 (leaf, pathName, fullText) */
  debugTrace: Array<{ leaf: string; pathName: string; fullText: string }>;
}

export interface MatchedStore {
  id: string;
  storeCode: string;
  storeName: string;
}

export interface FeishuLoginNotice {
  code: 'NO_STORE_MATCHED';
  message: string;
  unmatchedCandidates: string[];
}

export interface UpsertFeishuUserResult {
  userId: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  isNewUser: boolean;
  matchedStores: MatchedStore[];
  notice: FeishuLoginNotice | null;
  /** 实际生效的会话默认门店（is_primary 或第一条匹配；超管可为 null） */
  defaultStoreId: string | null;
}

// ---------------------------------------------------------------------------
// 解析：纯函数，方便单测
// ---------------------------------------------------------------------------

export function parseFeishuIdentity(
  deptPath: FeishuDeptPathItem[] | undefined | null,
): ParsedFeishuIdentity {
  let isSuperAdmin = false;
  const candidates = new Set<string>();
  const trace: Array<{ leaf: string; pathName: string; fullText: string }> = [];

  for (const dept of deptPath ?? []) {
    const leaf = dept?.department_name?.name?.trim() ?? '';
    const pathName =
      dept?.department_path?.department_path_name?.name?.trim() ?? '';
    const fullText = `${pathName}/${leaf}`;

    if (fullText.includes(SUPER_ADMIN_MARKER)) {
      isSuperAdmin = true;
    }
    if (leaf) candidates.add(leaf);
    trace.push({ leaf, pathName, fullText });
  }

  return {
    isSuperAdmin,
    leafCandidates: Array.from(candidates),
    debugTrace: trace,
  };
}

// ---------------------------------------------------------------------------
// 门店匹配：candidates → stores 表
// ---------------------------------------------------------------------------

export async function resolveMatchedStores(
  candidates: string[],
): Promise<MatchedStore[]> {
  if (candidates.length === 0) return [];
  const res = await query<{ id: string; store_code: string; store_name: string }>(
    `SELECT id, store_code, store_name
       FROM stores
      WHERE store_code = ANY($1::text[])
        AND deleted_at IS NULL
        AND status = 'active'
      ORDER BY store_code`,
    [candidates],
  );
  return res.rows.map((r) => ({
    id: r.id,
    storeCode: r.store_code,
    storeName: r.store_name,
  }));
}

// ---------------------------------------------------------------------------
// upsert：飞书登录后写库
// ---------------------------------------------------------------------------

export async function upsertUserFromFeishu(
  feishuUser: FeishuUserContact,
  userAccessToken: string,
  userTokenExpiresIn: number,
): Promise<UpsertFeishuUserResult> {
  const parsed = parseFeishuIdentity(feishuUser.department_path);
  const matchedStores = await resolveMatchedStores(parsed.leafCandidates);

  // 运维诊断日志：暴露解出的候选 + 解析路径 + 匹配结果。出现"门店未匹配"时
  // 三者对照即可定位是飞书没返路径、叶子名不像店号、还是 stores 表没登记。
  // 不打飞书原始 user 对象（含 mobile/email PII）。
  logger.info(
    {
      openId: feishuUser.open_id,
      parsedCandidates: parsed.leafCandidates,
      parsedIsSuperAdmin: parsed.isSuperAdmin,
      parsedTrace: parsed.debugTrace,
      matchedStoreCodes: matchedStores.map((s) => s.storeCode),
    },
    'feishu-identity: parse + match result',
  );

  // 没匹配 + 不是超管 → 返回 notice（仍允许登录）
  const notice: FeishuLoginNotice | null =
    !parsed.isSuperAdmin && matchedStores.length === 0
      ? {
          code: 'NO_STORE_MATCHED',
          message: buildNoStoreMessage(parsed.leafCandidates),
          unmatchedCandidates: parsed.leafCandidates,
        }
      : null;

  const result = await withTransaction(async (client) => {
    const userId = await findOrCreateUser(client, feishuUser);
    const isNewUser = await wasInsertedJustNow(client, userId);

    await upsertFeishuBinding(client, userId, feishuUser, userAccessToken, userTokenExpiresIn);
    await syncRoles(client, userId, parsed.isSuperAdmin, matchedStores.length > 0);
    const defaultStoreId = await syncStoreBindings(client, userId, matchedStores);

    return { userId, isNewUser, defaultStoreId };
  });

  const email = feishuUser.email ?? feishuUser.enterprise_email ?? null;
  return {
    userId: result.userId,
    displayName: resolveDisplayName(feishuUser, email),
    email,
    avatarUrl: feishuUser.avatar?.avatar_240 ?? feishuUser.avatar?.avatar_72 ?? null,
    isNewUser: result.isNewUser,
    matchedStores,
    notice,
    defaultStoreId: result.defaultStoreId,
  };
}

function buildNoStoreMessage(candidates: string[]): string {
  if (candidates.length === 0) {
    return '您的飞书部门信息中没有可识别的门店号，请联系超管核对您的部门归属。';
  }
  return `您的飞书部门指向 ${candidates.join('、')}，但这些门店尚未在系统中登记。请联系超管开通。`;
}

// -- 内部辅助 ---------------------------------------------------------------

async function findOrCreateUser(
  client: PoolClient,
  feishuUser: FeishuUserContact,
): Promise<string> {
  // 1. 按 open_id 查飞书绑定
  const byOpenId = await client.query<{ user_id: string }>(
    `SELECT user_id FROM user_feishu_identities WHERE open_id = $1 LIMIT 1`,
    [feishuUser.open_id],
  );
  if (byOpenId.rows[0]) return byOpenId.rows[0].user_id;

  // 2. 按 union_id 查（可能换了应用范围）
  if (feishuUser.union_id) {
    const byUnion = await client.query<{ user_id: string }>(
      `SELECT user_id FROM user_feishu_identities WHERE union_id = $1 LIMIT 1`,
      [feishuUser.union_id],
    );
    if (byUnion.rows[0]) return byUnion.rows[0].user_id;
  }

  // 3. 按飞书邮箱反查老 users.email（决策 D2 过渡期：把飞书身份绑到已存在的 legacy 账号）
  const email = feishuUser.email ?? feishuUser.enterprise_email;
  if (email) {
    const byEmail = await client.query<{ id: string }>(
      `SELECT id FROM users
         WHERE lower(email) = lower($1)
           AND deleted_at IS NULL
         LIMIT 1`,
      [email],
    );
    if (byEmail.rows[0]) return byEmail.rows[0].id;
  }

  // 4. 都没有 → 建新 user
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO users (display_name, email, avatar_url, status)
     VALUES ($1, $2, $3, 'active')
     RETURNING id`,
    [
      resolveDisplayName(feishuUser, email),
      email ?? null,
      feishuUser.avatar?.avatar_240 ?? feishuUser.avatar?.avatar_72 ?? null,
    ],
  );
  return inserted.rows[0]!.id;
}

/**
 * 兜底 display_name：飞书 name 字段类型是 string，但实际可能返回 null
 * （账号未设中文名 / 仅有英文名 / scope 不全）。users.display_name 是 NOT NULL，
 * 不能直接写空。优先级：中文名 → 英文名 → 邮箱前缀 → 手机后 4 位 → open_id 后 8 位。
 */
function resolveDisplayName(
  feishuUser: FeishuUserContact,
  email: string | null | undefined,
): string {
  const candidates = [
    feishuUser.name?.trim(),
    feishuUser.en_name?.trim(),
    email?.split('@')[0]?.trim(),
    feishuUser.mobile ? `用户${feishuUser.mobile.slice(-4)}` : null,
  ];
  for (const c of candidates) {
    if (c) return c;
  }
  return `飞书用户_${feishuUser.open_id.slice(-8)}`;
}

/**
 * 判定一个 user 是不是这次事务里刚插的（用于 isNewUser 上报）。
 * 简化判定：created_at 在 5 秒内
 */
async function wasInsertedJustNow(
  client: PoolClient,
  userId: string,
): Promise<boolean> {
  const res = await client.query<{ recent: boolean }>(
    `SELECT (now() - created_at < INTERVAL '5 seconds') AS recent FROM users WHERE id = $1`,
    [userId],
  );
  return res.rows[0]?.recent ?? false;
}

async function upsertFeishuBinding(
  client: PoolClient,
  userId: string,
  feishuUser: FeishuUserContact,
  userAccessToken: string,
  expiresIn: number,
): Promise<void> {
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
  await client.query(
    `INSERT INTO user_feishu_identities
       (user_id, open_id, union_id, feishu_email, feishu_mobile, feishu_name,
        feishu_avatar_url, access_token, token_expires_at, last_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (user_id) DO UPDATE
       SET open_id = EXCLUDED.open_id,
           union_id = EXCLUDED.union_id,
           feishu_email = EXCLUDED.feishu_email,
           feishu_mobile = EXCLUDED.feishu_mobile,
           feishu_name = EXCLUDED.feishu_name,
           feishu_avatar_url = EXCLUDED.feishu_avatar_url,
           access_token = EXCLUDED.access_token,
           token_expires_at = EXCLUDED.token_expires_at,
           last_synced_at = now(),
           updated_at = now()`,
    [
      userId,
      feishuUser.open_id,
      feishuUser.union_id ?? null,
      feishuUser.email ?? feishuUser.enterprise_email ?? null,
      feishuUser.mobile ?? null,
      feishuUser.name,
      feishuUser.avatar?.avatar_240 ?? feishuUser.avatar?.avatar_72 ?? null,
      userAccessToken,
      tokenExpiresAt,
    ],
  );
}

async function syncRoles(
  client: PoolClient,
  userId: string,
  shouldBeSuperAdmin: boolean,
  shouldBeStoreOwner: boolean,
): Promise<void> {
  if (shouldBeSuperAdmin) {
    await client.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'super_admin')
       ON CONFLICT (user_id, role) DO NOTHING`,
      [userId],
    );
  }
  if (shouldBeStoreOwner) {
    await client.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'store_owner')
       ON CONFLICT (user_id, role) DO NOTHING`,
      [userId],
    );
  }
  // 不做角色回撤：人工赋予的角色（如 analyst）保留不动
}

/**
 * 同步用户-门店绑定（additive only）：
 *   - 给 matchedStores 里每条都 upsert 一条 user_stores
 *   - 第一条标 is_primary（如果还没人有 primary）—— 仅为保留历史字段语义；
 *     登录后是否自动进店改由 session.active_store_id 决定（见返回值规则）
 *   - 已有的 user_stores 不删（管理员可能手动加过别的店）
 *
 * 返回值（用于 session.active_store_id）：
 *   - matched.length === 0 → null（无店匹配，前端走 notice 提示）
 *   - matched.length === 1 → 该店 id（用户直接进入，不打扰）
 *   - matched.length  >  1 → null（前端检测到 currentStore=null+stores>0 → 跳 /select-store）
 *
 * 设计权衡（2026-06-10）：飞书多店用户每次登录都跳选店页，避免默认进
 * is_primary 后用户不知道还能切其它店；单店用户不打扰。
 */
async function syncStoreBindings(
  client: PoolClient,
  userId: string,
  matched: MatchedStore[],
): Promise<string | null> {
  if (matched.length === 0) return null;

  // 检查用户当前是否已有 primary
  const hasPrimary = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM user_stores WHERE user_id = $1 AND is_primary = TRUE) AS exists`,
    [userId],
  );
  let primaryAssigned = hasPrimary.rows[0]?.exists ?? false;

  for (const store of matched) {
    // 如果尚未有人 primary 且这是当前循环的第一条，就标 primary
    const isPrimary = !primaryAssigned;
    await client.query(
      `INSERT INTO user_stores (user_id, store_id, role, is_primary)
       VALUES ($1, $2, 'manager', $3)
       ON CONFLICT (user_id, store_id) DO NOTHING`,
      [userId, store.id, isPrimary],
    );
    if (isPrimary) primaryAssigned = true;
  }

  if (matched.length === 1) return matched[0]!.id;
  return null;
}
