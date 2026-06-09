/**
 * 审计事件写入业务层
 *
 * 各业务模块（选品 / 价盘 / 海报）的关键操作都通过这一层写 audit_events。
 * 决策 D7 / D11：AI 关键调用 + 状态变更必须落审计；前端非关键交互可选。
 */
import { query } from '../db/index.js';

/** 与 V002__enum_types.sql 的 audit_event_kind 必须一致 */
export type AuditEventKind =
  | 'user_login' | 'user_logout' | 'user_session_refresh'
  | 'feishu_oauth_success' | 'feishu_oauth_fail'
  | 'user_create' | 'user_update' | 'user_disable' | 'user_delete'
  | 'user_password_reset' | 'user_role_change' | 'user_store_bind' | 'user_store_unbind'
  | 'store_create' | 'store_update' | 'store_insight_update'
  | 'sku_import' | 'competitor_price_import'
  | 'shelf_config_change' | 'shelf_photo_upload' | 'shelf_detect'
  | 'shelf_survey_submit' | 'shelf_assortment_apply'
  | 'shelf_virtual_generate' | 'shelf_ai_diagnose' | 'shelf_ai_selection'
  | 'sku_correction_submit'
  | 'price_change' | 'price_ai_diagnose'
  | 'poster_generate_sync' | 'poster_batch_submit'
  | 'poster_job_complete' | 'poster_job_fail'
  | 'promotion_batch_upload' | 'promotion_batch_activate' | 'promotion_batch_delete'
  | 'super_admin_action' | 'app_setting_change' | 'ai_model_switch' | 'ai_stress_test';

export interface WriteAuditEventInput {
  eventKind: AuditEventKind;
  actorUserId?: string | null;
  actorRole?: string | null;
  actorDisplayName?: string | null;
  targetStoreId?: string | null;
  targetStoreLabel?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  summary?: string | null;
  payload?: Record<string, unknown>;
  isAiCall?: boolean;
  aiWorkflow?: string | null;
  aiModel?: string | null;
  aiInputTokens?: number | null;
  aiOutputTokens?: number | null;
  aiLatencyMs?: number | null;
  aiStatus?: string | null;
  aiError?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export async function writeAuditEvent(input: WriteAuditEventInput): Promise<{ id: string }> {
  const res = await query<{ id: string }>(
    `INSERT INTO audit_events
       (event_kind, actor_user_id, actor_role, actor_display_name,
        target_store_id, target_store_label, target_type, target_id,
        summary, payload,
        is_ai_call, ai_workflow, ai_model, ai_input_tokens, ai_output_tokens,
        ai_latency_ms, ai_status, ai_error,
        ip_address, user_agent, request_id)
     VALUES ($1::audit_event_kind, $2, $3::app_role, $4,
             $5, $6, $7, $8,
             $9, $10::jsonb,
             $11, $12, $13, $14, $15,
             $16, $17, $18,
             $19, $20, $21)
     RETURNING id`,
    [
      input.eventKind,
      input.actorUserId ?? null,
      input.actorRole ?? null,
      input.actorDisplayName ?? null,
      input.targetStoreId ?? null,
      input.targetStoreLabel ?? null,
      input.targetType ?? null,
      input.targetId ?? null,
      input.summary ?? null,
      JSON.stringify(input.payload ?? {}),
      input.isAiCall ?? false,
      input.aiWorkflow ?? null,
      input.aiModel ?? null,
      input.aiInputTokens ?? null,
      input.aiOutputTokens ?? null,
      input.aiLatencyMs ?? null,
      input.aiStatus ?? null,
      input.aiError ?? null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      input.requestId ?? null,
    ],
  );
  return { id: res.rows[0]!.id };
}

/**
 * 选品（shelves）模块的 7 个 frontend action_type → audit_event_kind 映射
 * 见 V028__audit_shelf_extras.sql 的设计说明。
 */
const SHELVES_ACTION_TO_KIND: Record<string, AuditEventKind> = {
  diagnose: 'shelf_ai_diagnose',
  re_diagnose: 'shelf_ai_diagnose',
  reupload: 'shelf_photo_upload',
  upload_photo: 'shelf_photo_upload',
  optimize_selection: 'shelf_ai_selection',
  apply_strategy: 'shelf_assortment_apply',
  generate_layout: 'shelf_virtual_generate',
  re_generate_layout: 'shelf_virtual_generate',
};

export function shelvesActionToEventKind(actionType: string): AuditEventKind | null {
  return SHELVES_ACTION_TO_KIND[actionType] ?? null;
}
