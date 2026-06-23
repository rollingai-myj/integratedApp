/**
 * 后台运维统计服务（Phase 6）
 *
 * 投影来源：
 *   sys_audit_events / v_login_events     登录事件 / 审计
 *   sys_usage_sessions                    使用时长
 *   stores / hq_products / store_sku_snapshots / store_price_changes / store_poster_tasks
 *                                         门店综合统计 / 实时大屏
 *   sys_settings                          运营开关（如海报 AI 模型）
 */
import { query } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

// ============================================================================
// 登录事件 / 审计
// ============================================================================

export interface LoginEventRow {
  id: string;
  actorUserId: string | null;
  actorDisplayName: string | null;
  eventKind: string;
  ip: string | null;
  userAgent: string | null;
  clientType: string | null;
  requestId: string | null;
  createdAt: string;
  summary: string | null;
}

export async function listLoginEvents(args: {
  limit?: number;
  userId?: string;
}): Promise<LoginEventRow[]> {
  // v_login_events 视图只投影了基础字段；直接从 sys_audit_events 查
  // WHERE event_kind = 'user_login' 拿到完整 event_kind / summary / request_id。
  const where: string[] = [`event_kind = 'user_login'`];
  const params: unknown[] = [];
  if (args.userId) {
    params.push(args.userId);
    where.push(`actor_user_id = $${params.length}`);
  }
  params.push(Math.min(args.limit ?? 100, 1000));
  const res = await query<{
    id: string;
    actor_user_id: string | null;
    actor_display_name: string | null;
    event_kind: string;
    ip: string | null;
    user_agent: string | null;
    client_type: string | null;
    request_id: string | null;
    created_at: string;
    summary: string | null;
  }>(
    `SELECT id, actor_user_id, actor_display_name, event_kind::text AS event_kind,
            ip::text AS ip, user_agent, client_type::text AS client_type,
            request_id, created_at, summary
       FROM sys_audit_events
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return res.rows.map((r) => ({
    id: r.id,
    actorUserId: r.actor_user_id,
    actorDisplayName: r.actor_display_name,
    eventKind: r.event_kind,
    ip: r.ip,
    userAgent: r.user_agent,
    clientType: r.client_type,
    requestId: r.request_id,
    createdAt: r.created_at,
    summary: r.summary,
  }));
}

export interface AuditEventRow {
  id: string;
  eventKind: string;
  actorUserId: string | null;
  actorDisplayName: string | null;
  actorRole: string | null;
  targetStoreId: string | null;
  targetStoreLabel: string | null;
  targetType: string | null;
  targetId: string | null;
  summary: string | null;
  payload: unknown;
  isAiCall: boolean;
  aiWorkflow: string | null;
  aiModel: string | null;
  aiLatencyMs: number | null;
  aiStatus: string | null;
  requestId: string | null;
  createdAt: string;
}

export async function listAuditEvents(args: {
  kind?: string;
  storeId?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<AuditEventRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (args.kind) {
    // 用 text 比较，避免传入已废弃枚举值时 cast 失败 500
    params.push(args.kind);
    where.push(`event_kind::text = $${params.length}`);
  }
  if (args.storeId) {
    params.push(args.storeId);
    where.push(`target_store_id = $${params.length}`);
  }
  if (args.from) {
    params.push(args.from);
    where.push(`created_at >= $${params.length}::date`);
  }
  if (args.to) {
    params.push(args.to);
    where.push(`created_at < $${params.length}::date + interval '1 day'`);
  }
  params.push(Math.min(args.limit ?? 100, 1000));
  const res = await query<{
    id: string;
    event_kind: string;
    actor_user_id: string | null;
    actor_display_name: string | null;
    actor_role: string | null;
    target_store_id: string | null;
    target_store_label: string | null;
    target_type: string | null;
    target_id: string | null;
    summary: string | null;
    payload: unknown;
    is_ai_call: boolean;
    ai_workflow: string | null;
    ai_model: string | null;
    ai_latency_ms: number | null;
    ai_status: string | null;
    request_id: string | null;
    created_at: string;
  }>(
    `SELECT id, event_kind::text AS event_kind, actor_user_id, actor_display_name,
            actor_role, target_store_id, target_store_label, target_type, target_id,
            summary, payload, is_ai_call, ai_workflow, ai_model, ai_latency_ms,
            ai_status, request_id, created_at
       FROM sys_audit_events
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return res.rows.map((r) => ({
    id: r.id,
    eventKind: r.event_kind,
    actorUserId: r.actor_user_id,
    actorDisplayName: r.actor_display_name,
    actorRole: r.actor_role,
    targetStoreId: r.target_store_id,
    targetStoreLabel: r.target_store_label,
    targetType: r.target_type,
    targetId: r.target_id,
    summary: r.summary,
    payload: r.payload,
    isAiCall: r.is_ai_call,
    aiWorkflow: r.ai_workflow,
    aiModel: r.ai_model,
    aiLatencyMs: r.ai_latency_ms,
    aiStatus: r.ai_status,
    requestId: r.request_id,
    createdAt: r.created_at,
  }));
}

// ============================================================================
// 使用时长（今日 / 本周 / 本月 / 累计）
// ============================================================================

export interface UsageStats {
  windowSeconds: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    total: number;
  };
  activeUsersNow: number;
}

export async function getUsageStats(): Promise<UsageStats> {
  const res = await query<{
    today_s: string | null;
    week_s: string | null;
    month_s: string | null;
    total_s: string | null;
    active_now: string;
  }>(
    `SELECT
       COALESCE(SUM(duration_seconds)
                FILTER (WHERE started_at >= date_trunc('day', now())), 0)::text AS today_s,
       COALESCE(SUM(duration_seconds)
                FILTER (WHERE started_at >= date_trunc('week', now())), 0)::text AS week_s,
       COALESCE(SUM(duration_seconds)
                FILTER (WHERE started_at >= date_trunc('month', now())), 0)::text AS month_s,
       COALESCE(SUM(duration_seconds), 0)::text AS total_s,
       COUNT(*) FILTER (WHERE status = 'active' AND last_heartbeat_at >= now() - interval '5 minutes')::text AS active_now
       FROM sys_usage_sessions`,
  );
  const r = res.rows[0]!;
  return {
    windowSeconds: {
      today: Number(r.today_s),
      thisWeek: Number(r.week_s),
      thisMonth: Number(r.month_s),
      total: Number(r.total_s),
    },
    activeUsersNow: Number(r.active_now),
  };
}

// ============================================================================
// 门店综合统计（每店）
// ============================================================================

export interface StoreStatsRow {
  storeId: string;
  storeName: string;
  skuCount: number;
  snapshotDates: number;
  posterTasks30d: number;
  priceChanges30d: number;
}

export async function getStoreStats(): Promise<StoreStatsRow[]> {
  const res = await query<{
    store_id: string;
    store_name: string;
    sku_count: string;
    snapshot_dates: string;
    poster_tasks_30d: string;
    price_changes_30d: string;
  }>(
    `SELECT s.id AS store_id, s.store_name,
            COALESCE((SELECT count(DISTINCT product_id) FROM store_sku_snapshots WHERE store_id = s.id), 0)::text AS sku_count,
            COALESCE((SELECT count(DISTINCT snapshot_date) FROM store_sku_snapshots WHERE store_id = s.id), 0)::text AS snapshot_dates,
            COALESCE((SELECT count(*) FROM store_poster_tasks WHERE store_id = s.id AND created_at >= now() - interval '30 days'), 0)::text AS poster_tasks_30d,
            COALESCE((SELECT count(*) FROM store_price_changes WHERE store_id = s.id AND created_at >= now() - interval '30 days'), 0)::text AS price_changes_30d
       FROM stores s
      WHERE s.status = 'active'
      ORDER BY s.store_name`,
  );
  return res.rows.map((r) => ({
    storeId: r.store_id,
    storeName: r.store_name,
    skuCount: Number(r.sku_count),
    snapshotDates: Number(r.snapshot_dates),
    posterTasks30d: Number(r.poster_tasks_30d),
    priceChanges30d: Number(r.price_changes_30d),
  }));
}

// ============================================================================
// 实时大屏：5 分钟 / 1 小时 / 今日 + 当前在线
// ============================================================================

export interface RealtimeStats {
  posterTasks: { last5m: number; last1h: number; today: number };
  priceChanges: { last5m: number; last1h: number; today: number };
  loginsToday: number;
  onlineUsersNow: number;
}

export async function getRealtimeStats(): Promise<RealtimeStats> {
  const res = await query<{
    p5: string; p1h: string; pd: string;
    c5: string; c1h: string; cd: string;
    logins_today: string;
    online_now: string;
  }>(
    `SELECT
       (SELECT count(*) FROM store_poster_tasks WHERE created_at >= now() - interval '5 minutes')::text AS p5,
       (SELECT count(*) FROM store_poster_tasks WHERE created_at >= now() - interval '1 hour')::text   AS p1h,
       (SELECT count(*) FROM store_poster_tasks WHERE created_at >= date_trunc('day', now()))::text   AS pd,
       (SELECT count(*) FROM store_price_changes WHERE created_at >= now() - interval '5 minutes')::text AS c5,
       (SELECT count(*) FROM store_price_changes WHERE created_at >= now() - interval '1 hour')::text   AS c1h,
       (SELECT count(*) FROM store_price_changes WHERE created_at >= date_trunc('day', now()))::text   AS cd,
       (SELECT count(*) FROM v_login_events WHERE created_at >= date_trunc('day', now()))::text       AS logins_today,
       (SELECT count(*) FROM sys_usage_sessions WHERE status = 'active' AND last_heartbeat_at >= now() - interval '5 minutes')::text AS online_now`,
  );
  const r = res.rows[0]!;
  return {
    posterTasks: { last5m: Number(r.p5), last1h: Number(r.p1h), today: Number(r.pd) },
    priceChanges: { last5m: Number(r.c5), last1h: Number(r.c1h), today: Number(r.cd) },
    loginsToday: Number(r.logins_today),
    onlineUsersNow: Number(r.online_now),
  };
}

// ============================================================================
// AI 模型设置（sys_settings）
// ============================================================================

const SETTING_KEY = 'poster_image_model';
const DEFAULT_MODEL = 'gemini-3.1-flash-image';

export interface ImageModelSetting {
  key: string;
  value: string;
  description: string | null;
  updatedAt: string | null;
}

export async function getImageModel(): Promise<ImageModelSetting> {
  const res = await query<{
    key: string;
    value: string;
    description: string | null;
    updated_at: string | null;
  }>(
    `SELECT key, value, description, updated_at FROM sys_settings WHERE key = $1`,
    [SETTING_KEY],
  );
  if (!res.rows.length) {
    return { key: SETTING_KEY, value: DEFAULT_MODEL, description: null, updatedAt: null };
  }
  const r = res.rows[0]!;
  return {
    key: r.key,
    value: r.value,
    description: r.description,
    updatedAt: r.updated_at,
  };
}

export async function setImageModel(
  value: string,
  updatedBy: string,
): Promise<ImageModelSetting> {
  if (!value || value.length > 256) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'value 必填且 ≤ 256 字');
  }
  const res = await query<{
    key: string;
    value: string;
    description: string | null;
    updated_at: string;
  }>(
    `INSERT INTO sys_settings (key, value, value_type, description, category, updated_by)
     VALUES ($1, $2, 'string', '海报生成默认模型', 'poster', $3)
     ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING key, value, description, updated_at`,
    [SETTING_KEY, value, updatedBy],
  );
  const r = res.rows[0]!;
  return {
    key: r.key,
    value: r.value,
    description: r.description,
    updatedAt: r.updated_at,
  };
}
