/**
 * 模块 9：后台管理（超管）
 *
 * 覆盖统一接口规划文档：
 *   - 账号列表（合并 SK-A2 + PO-F5）
 *   - 创建账号（合并 SK-A3 + PO-F6）
 *   - 重置密码 PO-F7
 *   - 删除账号 PO-F8
 *   - 绑定 / 解绑门店（新增）
 *   - 修改角色（新增）
 *   - 登录事件列表 PO-F1
 *   - 海报列表 PO-F2
 *   - 操作日志 / 审计事件查询（合并 SK-M2 + PO-F1/F2）
 *   - 用户使用时长 PO-F3
 *   - 门店综合统计 PO-F4
 *   - 实时统计 PO-F9
 *   - 查询 AI 模型设置 PO-F10
 *   - 切换 AI 模型 PO-F11
 *   - AI 压力测试 PO-F12
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import { writeAuditEvent, type AuditEventKind } from '../services/audit.service.js';
import {
  listAccounts,
  createAccount,
  resetPassword,
  deleteAccount,
  setAccountStores,
  setAccountRoles,
} from '../services/admin-accounts.service.js';
import {
  listLoginEvents,
  listAuditEvents,
  getUsageStats,
  getStoreStats,
  getRealtimeStats,
  getImageModel,
  setImageModel,
} from '../services/admin-stats.service.js';
import {
  getDashboardKpis,
  getAdjustmentTrend,
  getTopActiveStores,
  getSceneDistribution,
} from '../services/admin-dashboard.service.js';
import {
  listChanges,
  getChangeDetail,
  listStoreOptions,
  listSceneOptions,
  exportChangesCsv,
} from '../services/admin-changes.service.js';
import {
  uploadAndStage,
  listBatches,
  getBatchDetail,
  deleteStagedBatch,
} from '../services/admin-uploads/service.js';
import {
  templateOf,
  allSpecs,
  type UploadKind,
} from '../services/admin-uploads/schemas.js';
import { createTasks as createPosterTasks } from '../services/posters.service.js';

export const adminRouter = Router();

// 该模块所有接口都要求 super_admin
adminRouter.use(requireAuth, requireRole('super_admin'));

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

function auditAdmin(
  req: Request,
  kind: AuditEventKind,
  summary: string,
  targetId: string | null,
  payload: Record<string, unknown> = {},
): void {
  void writeAuditEvent({
    eventKind: kind,
    actorUserId: req.user!.id,
    actorRole: req.user!.roles[0] ?? null,
    actorDisplayName: req.user!.name,
    targetType: 'user',
    targetId,
    summary,
    payload,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  }).catch(() => { /* 审计失败静默 */ });
}

// 账号管理 --------------------------------------------------------------

/** 账号列表（含角色 / 门店绑定 / 飞书绑定状态） */
adminRouter.get(
  '/accounts',
  asyncHandler(async (_req, res) => {
    res.json(await listAccounts());
  }),
);

const createAccountSchema = z.object({
  account: z.string().min(2).max(64),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(64),
  email: z.string().email().optional(),
  roles: z.array(z.string()).optional(),
  storeIds: z.array(z.string().uuid()).optional(),
});

/** 创建账号 */
adminRouter.post(
  '/accounts',
  asyncHandler(async (req, res) => {
    const body = parseBody(createAccountSchema, req);
    const result = await createAccount(body);
    auditAdmin(req, 'user_create', `创建账号 ${body.account}`, result.id, {
      account: body.account,
      roles: body.roles ?? ['store_owner'],
      storeCount: body.storeIds?.length ?? 0,
    });
    res.status(201).json(result);
  }),
);

const resetPasswordSchema = z.object({ password: z.string().min(8).max(128) });

/** 重置某账号密码（同时撤销其全部会话） */
adminRouter.post(
  '/accounts/:userId/reset-password',
  asyncHandler(async (req, res) => {
    const userId = parseUuidParam(req, 'userId');
    const body = parseBody(resetPasswordSchema, req);
    await resetPassword(userId, body.password);
    auditAdmin(req, 'user_password_reset', '重置账号密码', userId);
    res.status(200).json({ ok: true });
  }),
);

/** 删除账号（软删 + 全会话下线） */
adminRouter.delete(
  '/accounts/:userId',
  asyncHandler(async (req, res) => {
    const userId = parseUuidParam(req, 'userId');
    await deleteAccount(userId, req.user!.id);
    auditAdmin(req, 'user_delete', '删除账号', userId);
    res.status(204).end();
  }),
);

const setStoresSchema = z.object({
  storeIds: z.array(z.string().uuid()),
  primaryStoreId: z.string().uuid().optional(),
});

/** 重置账号的门店绑定（整体替换） */
adminRouter.put(
  '/accounts/:userId/stores',
  asyncHandler(async (req, res) => {
    const userId = parseUuidParam(req, 'userId');
    const body = parseBody(setStoresSchema, req);
    await setAccountStores(userId, body.storeIds, body.primaryStoreId ?? null);
    auditAdmin(req, 'user_store_bind', `重置门店绑定（${body.storeIds.length} 家）`, userId, {
      storeIds: body.storeIds,
    });
    res.status(200).json({ ok: true });
  }),
);

const setRolesSchema = z.object({ roles: z.array(z.string()).min(1) });

/** 重置账号角色（整体替换） */
adminRouter.put(
  '/accounts/:userId/roles',
  asyncHandler(async (req, res) => {
    const userId = parseUuidParam(req, 'userId');
    const body = parseBody(setRolesSchema, req);
    await setAccountRoles(userId, body.roles, req.user!.id);
    auditAdmin(req, 'user_role_change', `重置角色为 ${body.roles.join(',')}`, userId, {
      roles: body.roles,
    });
    res.status(200).json({ ok: true });
  }),
);

// -- 解析辅助 -------------------------------------------------------------

function parseBody<T>(schema: z.ZodType<T>, req: Request): T {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(
      400,
      ErrorCodes.VALIDATION_ERROR,
      parsed.error.issues[0]?.message ?? '请求体不合法',
      parsed.error.issues,
    );
  }
  return parsed.data;
}

function parseUuidParam(req: Request, name: string): string {
  const parsed = z.string().uuid().safeParse(req.params[name]);
  if (!parsed.success) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `${name} 必须是 UUID`);
  }
  return parsed.data;
}

// 审计 / 列表 ------------------------------------------------------------

const listEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  userId: z.string().uuid().optional(),
});

/** 登录事件列表（v_login_events） */
adminRouter.get(
  '/login-events',
  asyncHandler(async (req, res) => {
    const q = listEventsQuerySchema.parse(req.query);
    const events = await listLoginEvents(q);
    res.json({ events });
  }),
);

const auditQuerySchema = z.object({
  kind: z.string().optional(),
  storeId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

/** 审计事件查询（sys_audit_events） */
adminRouter.get(
  '/audit-events',
  asyncHandler(async (req, res) => {
    const q = auditQuerySchema.parse(req.query);
    const events = await listAuditEvents(q);
    res.json({ events });
  }),
);

// 统计 ------------------------------------------------------------------

/** 使用时长统计（今日 / 本周 / 本月 / 累计 + 在线人数） */
adminRouter.get(
  '/usage-stats',
  asyncHandler(async (_req, res) => {
    res.json(await getUsageStats());
  }),
);

/** 门店综合统计 */
adminRouter.get(
  '/store-stats',
  asyncHandler(async (_req, res) => {
    const stores = await getStoreStats();
    res.json({ stores });
  }),
);

/** 实时大屏（5 分钟 / 1 小时 / 今日 + 在线） */
adminRouter.get(
  '/realtime-stats',
  asyncHandler(async (_req, res) => {
    res.json(await getRealtimeStats());
  }),
);

// Dashboard 聚合(admin-web)----------------------------------------------

const dashboardQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(180).optional(),
});

const topStoresQuerySchema = dashboardQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

/** 4 张 KPI 卡(活跃门店 / 调改 SKU / 海报生成 / 价格调整,含上一窗口环比) */
adminRouter.get(
  '/dashboard/kpis',
  asyncHandler(async (req, res) => {
    const q = dashboardQuerySchema.parse(req.query);
    res.json(await getDashboardKpis(q.days ?? 30));
  }),
);

/** 调改趋势(按天 added/removed,空天补 0) */
adminRouter.get(
  '/dashboard/trend',
  asyncHandler(async (req, res) => {
    const q = dashboardQuerySchema.parse(req.query);
    const points = await getAdjustmentTrend(q.days ?? 30);
    res.json({ points });
  }),
);

/** Top N 活跃门店(按窗口期内调改总数排序) */
adminRouter.get(
  '/dashboard/top-stores',
  asyncHandler(async (req, res) => {
    const q = topStoresQuerySchema.parse(req.query);
    const stores = await getTopActiveStores(q.days ?? 30, q.limit ?? 5);
    res.json({ stores });
  }),
);

/** 场景占比(调改 SKU 在各场景下的分布) */
adminRouter.get(
  '/dashboard/scenes',
  asyncHandler(async (req, res) => {
    const q = dashboardQuerySchema.parse(req.query);
    const scenes = await getSceneDistribution(q.days ?? 30);
    res.json({ scenes });
  }),
);

// 调改记录(admin-web 表格)----------------------------------------------

const changesQuerySchema = z.object({
  storeId: z.string().uuid().optional(),
  scene: z.coerce.number().int().optional(),
  action: z.enum(['add', 'remove']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  sortBy: z.enum(['created_at', 'effective_date']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

/** 分页 + 筛选 + 排序拉调改记录 */
adminRouter.get(
  '/changes',
  asyncHandler(async (req, res) => {
    const q = changesQuerySchema.parse(req.query);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const result = await listChanges({
      storeId: q.storeId,
      scene: q.scene,
      action: q.action,
      from: q.from,
      to: q.to,
      search: q.search,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      sortBy: q.sortBy,
      sortDir: q.sortDir,
    });
    res.json({ ...result, page, pageSize });
  }),
);

/** 单条详情(行展开拿 ai_diagnosis 完整 JSON 用) */
adminRouter.get(
  '/changes/:id',
  asyncHandler(async (req, res) => {
    if (!req.params.id) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'id 缺失');
    }
    const detail = await getChangeDetail(req.params.id);
    if (!detail) throw new AppError(404, ErrorCodes.NOT_FOUND, '记录不存在');
    res.json(detail);
  }),
);

/** CSV 导出(同一组筛选,不分页) */
adminRouter.get(
  '/changes.csv',
  asyncHandler(async (req, res) => {
    const q = changesQuerySchema.parse(req.query);
    const csv = await exportChangesCsv({
      storeId: q.storeId,
      scene: q.scene,
      action: q.action,
      from: q.from,
      to: q.to,
      search: q.search,
      sortBy: q.sortBy,
      sortDir: q.sortDir,
    });
    const filename = `assortment-changes-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }),
);

/** 筛选下拉:门店列表 */
adminRouter.get(
  '/changes-filters/stores',
  asyncHandler(async (_req, res) => {
    const stores = await listStoreOptions();
    res.json({ stores });
  }),
);

/** 筛选下拉:场景列表 */
adminRouter.get(
  '/changes-filters/scenes',
  asyncHandler(async (_req, res) => {
    const scenes = await listSceneOptions();
    res.json({ scenes });
  }),
);

// 数据上传(admin-web 上传页)-------------------------------------------

const uploadKindSchema = z.enum(['promotions', 'products', 'snapshots']);
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

/** 列出所有上传类型的列定义(给前端展示字段说明用) */
adminRouter.get(
  '/uploads/specs',
  asyncHandler(async (_req, res) => {
    res.json({ specs: allSpecs() });
  }),
);

/** CSV 模板下载(BOM + 表头 + 一行示例) */
adminRouter.get(
  '/uploads/:kind/template',
  asyncHandler(async (req, res) => {
    const kind = uploadKindSchema.parse(req.params.kind);
    const csv = templateOf(kind);
    const filename = `${kind}-template.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }),
);

/** 上传 CSV → 解析 → 落 staging。multipart/form-data,字段名 'file' */
adminRouter.post(
  '/uploads/:kind',
  csvUpload.single('file'),
  asyncHandler(async (req, res) => {
    const kind = uploadKindSchema.parse(req.params.kind);
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, '缺少上传文件 (field name: file)');
    }
    const result = await uploadAndStage({
      kind: kind as UploadKind,
      fileName: file.originalname || `${kind}.csv`,
      buffer: file.buffer,
      uploadedBy: req.user!.id,
    });
    auditAdmin(
      req,
      'app_setting_change',
      `上传 ${kind} CSV (${file.originalname || 'unnamed'}, ${result.validRows}/${result.totalRows} 行有效)`,
      result.batchId,
      { kind, fileName: file.originalname, ...result },
    );
    res.status(201).json(result);
  }),
);

/** 历史批次列表(按 kind) */
adminRouter.get(
  '/uploads/:kind/batches',
  asyncHandler(async (req, res) => {
    const kind = uploadKindSchema.parse(req.params.kind);
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const batches = await listBatches(kind as UploadKind, Number.isFinite(limit) ? limit : 50);
    res.json({ batches });
  }),
);

/** 批次详情(错误清单 + 解析后预览前 20 行) */
adminRouter.get(
  '/uploads/batches/:id',
  asyncHandler(async (req, res) => {
    if (!req.params.id) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'id 缺失');
    }
    const detail = await getBatchDetail(req.params.id);
    if (!detail) throw new AppError(404, ErrorCodes.NOT_FOUND, '批次不存在');
    res.json(detail);
  }),
);

/** 删除 staged/failed 批次(误传清理用;已应用的不能删) */
adminRouter.delete(
  '/uploads/batches/:id',
  asyncHandler(async (req, res) => {
    if (!req.params.id) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'id 缺失');
    }
    await deleteStagedBatch(req.params.id);
    auditAdmin(req, 'app_setting_change', `删除上传批次`, req.params.id, {});
    res.status(204).end();
  }),
);

// 设置：海报 AI 模型 -----------------------------------------------------

adminRouter.get(
  '/settings/image-model',
  asyncHandler(async (_req, res) => {
    res.json(await getImageModel());
  }),
);

const imageModelSchema = z.object({ value: z.string().min(1).max(256) });

adminRouter.put(
  '/settings/image-model',
  asyncHandler(async (req, res) => {
    const body = imageModelSchema.parse(req.body);
    const setting = await setImageModel(body.value, req.user!.id);
    auditAdmin(req, 'app_setting_change', `切换 image-model 为 ${body.value}`, null, {
      key: setting.key,
      value: setting.value,
    });
    res.json(setting);
  }),
);

// 压测 ------------------------------------------------------------------

const loadTestSchema = z.object({
  concurrency: z.number().int().min(1).max(20),
  /** 必须指定一个存在的门店来落 task */
  storeId: z.string().uuid(),
  /** 共用同一个 sku，简化压测 */
  skuCode: z.string().min(1),
  template: z.enum(['vibrant', 'premium', 'minimal', 'custom']).default('minimal'),
});

/** 海报并发压测（创建 N 个 task；不等 worker，立即返回） */
adminRouter.post(
  '/load-test/poster',
  asyncHandler(async (req, res) => {
    const body = loadTestSchema.parse(req.body);
    const startedAt = Date.now();
    const tasks = Array.from({ length: body.concurrency }, (_, i) => ({
      mode: 'photo_compose' as const,
      template: body.template,
      copyText: `loadtest-${i + 1}`,
      sourcePhotoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      skuCode: body.skuCode,
    }));
    const r = await createPosterTasks({ tasks }, req.user!.id, body.storeId);
    const elapsedMs = Date.now() - startedAt;
    auditAdmin(req, 'ai_stress_test', `海报压测并发 ${body.concurrency}`, null, {
      concurrency: body.concurrency,
      batchId: r.batchId,
      elapsedMs,
    });
    res.json({
      batchId: r.batchId,
      created: r.tasks.length,
      elapsedMs,
    });
  }),
);
