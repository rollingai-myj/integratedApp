/**
 * 用户行为日志（shim）—— no-op
 *
 * 原 repo 在每个关键动作（拍照/诊断/应用/虚拟货架）后落库一次。整合 app 的
 * /sessions 模块已记录登录/页面级事件，更细粒度的"动作埋点"暂未对齐。
 * 这里直接吞掉，控制台 debug 一行，避免上游每步都 try/catch。
 */
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
  if (import.meta.env.DEV) {
    console.debug('[shelves/usageLogs]', params.actionType, params.actionLabel ?? '');
  }
}

export async function fetchUsageLogs(_fromIso: string, _toIso: string): Promise<UsageLogRow[]> {
  return [];
}
