/**
 * 用户行为日志（V028 之后真正写入 audit_events）
 *
 * Backend：`POST /api/v1/sessions/audit-events`
 *   payload `{ module: 'shelves', actionType: 'diagnose' | ..., actionLabel, ... }`
 *   service 内查表把 actionType → AuditEventKind enum，落 audit_events 表。
 *
 * 写入失败时 console.warn 但不抛 —— 埋点不能阻塞业务流。
 */
import { apiFetch } from '@/components/shelves/lib/api-client';

export type UsageActionType =
  | 'diagnose'
  | 're_diagnose'
  | 'reupload'
  | 'optimize_selection'
  | 'apply_strategy'
  | 'generate_layout'
  | 're_generate_layout';

export interface UsageLogRow {
  id: string;
  store_id: string;
  account: string;
  is_admin_account: boolean;
  shelf_id: string | null;
  action_type: string;
  action_label: string | null;
  created_at: string;
}

interface LogParams {
  storeId: string;
  shelfId?: string | null;
  actionType: UsageActionType | string;
  actionLabel?: string;
}

export async function logUsage(params: LogParams): Promise<void> {
  if (!params.actionType) return;
  try {
    await apiFetch('/sessions/audit-events', {
      method: 'POST',
      body: JSON.stringify({
        module: 'shelves',
        actionType: params.actionType,
        actionLabel: params.actionLabel ?? null,
        targetType: 'shelf',
        targetId: params.shelfId ?? null,
        // 一些 actionType 是 AI 调用（diagnose / optimize_selection / generate_layout），
        // 但具体的 ai_workflow / ai_model / latency 不在调用方手上 —— 这些应该由
        // 后端服务直接写一次审计（更准确）。本路径仅记录 UI 触发埋点。
      }),
    });
  } catch (err) {
    console.warn('[shelves/usageLogs] failed', err);
  }
}

/**
 * fetchUsageLogs：原 repo 超管侧查询接口；当前未对接（统一后台用 audit_events
 * 查询会暴露成 /admin/audit-events，由 admin 模块负责）。
 * 这里返回空数组保留签名兼容。
 */
export async function fetchUsageLogs(_fromIso: string, _toIso: string): Promise<UsageLogRow[]> {
  return [];
}
