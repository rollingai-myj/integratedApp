/**
 * 海报业务层（Phase 5 新模型）
 *
 * 表：
 *   store_poster_tasks          稳定业务意图（mode/template/copy/底图/多商品锚点）
 *   store_poster_task_products  multi_product 模式下任务关联的商品
 *   store_poster_generations    同任务的多次尝试，重新生成 = 新 attempt
 *   store_poster_assets         素材库（按店隔离 · 软删）
 *   v_poster_product_sales      已采用海报的前后销量对比视图
 *
 * 关键约束：
 *   - 每任务至多一条已采用（UNIQUE INDEX … WHERE is_adopted）
 *   - 每任务 attempt_no 唯一
 *   - tasks.store_id NOT NULL（写入永远显式带 currentStoreId）
 */
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  openRouterService,
  type PosterGenerateInput,
} from './openrouter.service.js';
import { ossService } from './oss.service.js';

// ============================================================================
// 类型
// ============================================================================

export type PosterTemplate = 'vibrant' | 'premium' | 'minimal' | 'custom';
export type PosterMode = 'photo_compose' | 'official_bg_only' | 'multi_product';
export type PosterGenerationStatus =
  | 'queued'
  | 'claimed'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export interface PosterTaskProductIn {
  skuCode: string;
  displayOrder?: number;
}

export interface PosterTaskCreate {
  mode: PosterMode;
  template: PosterTemplate;
  copyText: string;
  sourcePhotoUrl?: string;
  productImageUrl?: string;
  customStyleDescription?: string;
  /** 单 SKU 模式（photo_compose / official_bg_only）下使用，会自动写入一行 task_products */
  skuCode?: string;
  /** multi_product 模式下用 */
  products?: PosterTaskProductIn[];
  categoryName?: string;
  /** 透传给 worker 的扩展入参（productImageUrls 之类） */
  extras?: Record<string, unknown>;
}

export interface PosterTaskProduct {
  productId: string;
  skuCode: string;
  displayOrder: number;
}

export interface PosterTask {
  id: string;
  batchId: string;
  userId: string;
  storeId: string;
  mode: PosterMode;
  template: PosterTemplate;
  copyText: string;
  sourcePhotoUrl: string | null;
  productImageUrl: string | null;
  customStyleDescription: string | null;
  products: PosterTaskProduct[];
  createdAt: string;
  updatedAt: string;
  /** 列表场景下附带最近一次生成（供 UI 直接渲染缩略图与状态） */
  latestGeneration?: PosterGeneration | null;
}

export interface PosterGeneration {
  id: string;
  taskId: string;
  attemptNo: number;
  status: PosterGenerationStatus;
  posterImageUrl: string | null;
  thumbnailUrl: string | null;
  aiModel: string | null;
  generationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  isAdopted: boolean;
  adoptedAt: string | null;
  downloadCount: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface PosterAsset {
  id: string;
  storeId: string;
  kind: 'background' | 'product_photo';
  imageUrl: string;
  uploadedBy: string | null;
  createdAt: string;
}

export interface PosterSalesItem {
  taskId: string;
  generationId: string;
  productId: string;
  skuCode: string;
  adoptedAt: string;
  beforeSnapshotDate: string | null;
  beforeSalesQty30d: number | null;
  afterSnapshotDate: string | null;
  afterSalesQty30d: number | null;
  qtyDeltaPercent: number | null;
}

// ============================================================================
// Row → DTO 适配
// ============================================================================

interface TaskRow {
  id: string;
  batch_id: string;
  user_id: string;
  store_id: string;
  mode: PosterMode;
  template: PosterTemplate;
  custom_style_description: string | null;
  copy_text: string;
  source_photo_url: string | null;
  product_image_url: string | null;
  inputs: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function rowToTask(
  r: TaskRow,
  products: PosterTaskProduct[],
  latestGeneration: PosterGeneration | null = null,
): PosterTask {
  return {
    id: r.id,
    batchId: r.batch_id,
    userId: r.user_id,
    storeId: r.store_id,
    mode: r.mode,
    template: r.template,
    copyText: r.copy_text,
    sourcePhotoUrl: r.source_photo_url,
    productImageUrl: r.product_image_url,
    customStyleDescription: r.custom_style_description,
    products,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    latestGeneration,
  };
}

interface GenerationRow {
  id: string;
  task_id: string;
  attempt_no: number;
  status: PosterGenerationStatus;
  poster_image_url: string | null;
  thumbnail_url: string | null;
  ai_model: string | null;
  generation_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  is_adopted: boolean;
  adopted_at: string | null;
  download_count: number;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

function rowToGeneration(r: GenerationRow): PosterGeneration {
  return {
    id: r.id,
    taskId: r.task_id,
    attemptNo: r.attempt_no,
    status: r.status,
    posterImageUrl: r.poster_image_url,
    thumbnailUrl: r.thumbnail_url,
    aiModel: r.ai_model,
    generationMs: r.generation_ms,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    isAdopted: r.is_adopted,
    adoptedAt: r.adopted_at,
    downloadCount: r.download_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    finishedAt: r.finished_at,
  };
}

// ============================================================================
// 任务创建（PO-D1 批量 / PO-C1 单条）
// ============================================================================

export async function createTasks(
  args: { tasks: PosterTaskCreate[] },
  userId: string,
  storeId: string,
): Promise<{ batchId: string; tasks: PosterTask[] }> {
  if (args.tasks.length === 0) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'tasks 至少一条');
  }
  if (args.tasks.length > 20) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '一次最多 20 条任务');
  }

  const batchId = randomUUID();

  return withTransaction(async (client) => {
    const created: PosterTask[] = [];

    for (const t of args.tasks) {
      // 解析商品锚点：multi_product 用 t.products；单 SKU 模式用 t.skuCode 派生
      const skuCodes = (() => {
        if (t.mode === 'multi_product') {
          return (t.products ?? []).map((p) => p.skuCode);
        }
        return t.skuCode ? [t.skuCode] : [];
      })();

      // 查 product_id（task_products 表强引用 hq_products.id）
      const productLookup = skuCodes.length
        ? await client.query<{ id: string; sku_code: string }>(
            `SELECT id, sku_code FROM hq_products WHERE sku_code = ANY($1)`,
            [skuCodes],
          )
        : { rows: [] as Array<{ id: string; sku_code: string }> };

      const productIdBySkuCode = new Map(
        productLookup.rows.map((r) => [r.sku_code, r.id]),
      );
      for (const code of skuCodes) {
        if (!productIdBySkuCode.has(code)) {
          throw new AppError(
            404,
            ErrorCodes.NOT_FOUND,
            `SKU ${code} 不存在，无法建任务`,
          );
        }
      }

      // 插 task（inputs 存 worker 重放所需完整入参）
      const inputs: Record<string, unknown> = {
        copyText: t.copyText,
        template: t.template,
        mode: t.mode,
        sourcePhotoUrl: t.sourcePhotoUrl ?? null,
        productImageUrl: t.productImageUrl ?? null,
        customStyleDescription: t.customStyleDescription ?? null,
        skuCode: t.skuCode ?? null,
        categoryName: t.categoryName ?? null,
        ...t.extras,
      };

      const taskRes = await client.query<TaskRow>(
        `INSERT INTO store_poster_tasks
           (batch_id, user_id, store_id, mode, template,
            custom_style_description, copy_text, source_photo_url,
            product_image_url, inputs)
         VALUES ($1, $2, $3, $4::poster_mode, $5::poster_template,
                 $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          batchId,
          userId,
          storeId,
          t.mode,
          t.template,
          t.customStyleDescription ?? null,
          t.copyText,
          t.sourcePhotoUrl ?? null,
          t.productImageUrl ?? null,
          JSON.stringify(inputs),
        ],
      );
      const taskRow = taskRes.rows[0]!;

      // 插 task_products
      const products: PosterTaskProduct[] = [];
      let orderCounter = 0;
      if (t.mode === 'multi_product') {
        for (const p of t.products ?? []) {
          const productId = productIdBySkuCode.get(p.skuCode)!;
          const order = p.displayOrder ?? orderCounter++;
          await client.query(
            `INSERT INTO store_poster_task_products
               (task_id, product_id, sku_code, display_order)
             VALUES ($1, $2, $3, $4)`,
            [taskRow.id, productId, p.skuCode, order],
          );
          products.push({ productId, skuCode: p.skuCode, displayOrder: order });
        }
      } else if (t.skuCode) {
        const productId = productIdBySkuCode.get(t.skuCode)!;
        await client.query(
          `INSERT INTO store_poster_task_products
             (task_id, product_id, sku_code, display_order)
           VALUES ($1, $2, $3, 0)`,
          [taskRow.id, productId, t.skuCode],
        );
        products.push({ productId, skuCode: t.skuCode, displayOrder: 0 });
      }

      // 插 generation #1（queued，等 worker 认领）
      const genRes = await client.query<GenerationRow>(
        `INSERT INTO store_poster_generations
           (task_id, attempt_no, status)
         VALUES ($1, 1, 'queued')
         RETURNING *`,
        [taskRow.id],
      );

      created.push(rowToTask(taskRow, products, rowToGeneration(genRes.rows[0]!)));
    }

    return { batchId, tasks: created };
  });
}

// ============================================================================
// 任务查询
// ============================================================================

export async function listTasks(filter: {
  userId?: string;
  storeId?: string;
  status?: 'active' | 'done' | 'failed';
  batchId?: string;
  limit?: number;
}): Promise<PosterTask[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.userId) {
    params.push(filter.userId);
    where.push(`t.user_id = $${params.length}`);
  }
  if (filter.storeId) {
    params.push(filter.storeId);
    where.push(`t.store_id = $${params.length}`);
  }
  if (filter.batchId) {
    params.push(filter.batchId);
    where.push(`t.batch_id = $${params.length}`);
  }
  if (filter.status === 'active') {
    where.push(`latest.status IN ('queued','claimed','processing')`);
  } else if (filter.status === 'done') {
    where.push(`latest.status = 'succeeded'`);
  } else if (filter.status === 'failed') {
    where.push(`latest.status IN ('failed','canceled')`);
  }

  const limit = filter.limit ?? 100;
  params.push(limit);

  const sql = `
    WITH latest_per_task AS (
      SELECT DISTINCT ON (task_id)
             id, task_id, attempt_no, status, poster_image_url, thumbnail_url,
             ai_model, generation_ms, error_code, error_message,
             is_adopted, adopted_at, download_count,
             created_at, updated_at, finished_at
        FROM store_poster_generations
       ORDER BY task_id, attempt_no DESC
    )
    SELECT t.*, row_to_json(latest) AS latest_gen
      FROM store_poster_tasks t
      LEFT JOIN latest_per_task latest ON latest.task_id = t.id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.created_at DESC
     LIMIT $${params.length}
  `;

  const res = await query<TaskRow & { latest_gen: GenerationRow | null }>(sql, params);
  const taskIds = res.rows.map((r) => r.id);
  const productsByTask = await loadProducts(taskIds);

  return res.rows.map((r) =>
    rowToTask(
      r,
      productsByTask.get(r.id) ?? [],
      r.latest_gen ? rowToGeneration(r.latest_gen) : null,
    ),
  );
}

/** 反查 generation 所属 task + batch（shim 把 generationId 当 jobId 时回查用） */
export async function getGenerationWithTaskRef(
  generationId: string,
): Promise<{
  generation: PosterGeneration;
  taskId: string;
  batchId: string;
  storeId: string;
  userId: string;
} | null> {
  const res = await query<GenerationRow & {
    t_id: string;
    t_batch_id: string;
    t_store_id: string;
    t_user_id: string;
  }>(
    `SELECT g.*,
            t.id AS t_id, t.batch_id AS t_batch_id,
            t.store_id AS t_store_id, t.user_id AS t_user_id
       FROM store_poster_generations g
       JOIN store_poster_tasks t ON t.id = g.task_id
      WHERE g.id = $1`,
    [generationId],
  );
  if (!res.rows.length) return null;
  const r = res.rows[0]!;
  return {
    generation: rowToGeneration(r),
    taskId: r.t_id,
    batchId: r.t_batch_id,
    storeId: r.t_store_id,
    userId: r.t_user_id,
  };
}

export async function getTask(taskId: string): Promise<{
  task: PosterTask;
  generations: PosterGeneration[];
}> {
  const taskRes = await query<TaskRow>(
    `SELECT * FROM store_poster_tasks WHERE id = $1`,
    [taskId],
  );
  if (!taskRes.rows.length) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, '任务不存在');
  }
  const taskRow = taskRes.rows[0]!;
  const productsMap = await loadProducts([taskId]);
  const gensRes = await query<GenerationRow>(
    `SELECT * FROM store_poster_generations
      WHERE task_id = $1 ORDER BY attempt_no ASC`,
    [taskId],
  );
  const generations = gensRes.rows.map(rowToGeneration);
  return {
    task: rowToTask(taskRow, productsMap.get(taskId) ?? [], generations.at(-1) ?? null),
    generations,
  };
}

async function loadProducts(
  taskIds: string[],
): Promise<Map<string, PosterTaskProduct[]>> {
  if (!taskIds.length) return new Map();
  const res = await query<{
    task_id: string;
    product_id: string;
    sku_code: string;
    display_order: number;
  }>(
    `SELECT task_id, product_id, sku_code, display_order
       FROM store_poster_task_products
      WHERE task_id = ANY($1)
      ORDER BY task_id, display_order, sku_code`,
    [taskIds],
  );
  const m = new Map<string, PosterTaskProduct[]>();
  for (const r of res.rows) {
    const list = m.get(r.task_id) ?? [];
    list.push({
      productId: r.product_id,
      skuCode: r.sku_code,
      displayOrder: r.display_order,
    });
    m.set(r.task_id, list);
  }
  return m;
}

// ============================================================================
// 整批取消（cancel queued/claimed/processing 的 generation）
// ============================================================================

export async function cancelBatch(
  batchId: string,
  userId: string,
): Promise<{ canceled: number }> {
  const res = await query<{ id: string }>(
    `UPDATE store_poster_generations g
        SET status = 'canceled', updated_at = now()
       FROM store_poster_tasks t
      WHERE g.task_id = t.id
        AND t.batch_id = $1
        AND t.user_id = $2
        AND g.status IN ('queued','claimed','processing')
      RETURNING g.id`,
    [batchId, userId],
  );
  return { canceled: res.rowCount ?? 0 };
}

// ============================================================================
// 重新生成（新 attempt）
// ============================================================================

export async function regenerateTask(
  taskId: string,
  userId: string,
): Promise<PosterGeneration> {
  return withTransaction(async (client) => {
    const tRes = await client.query<TaskRow>(
      `SELECT * FROM store_poster_tasks WHERE id = $1 AND user_id = $2`,
      [taskId, userId],
    );
    if (!tRes.rows.length) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, '任务不存在或无权访问');
    }

    // 如果该任务还有 queued/claimed/processing 的 generation，先取消
    await client.query(
      `UPDATE store_poster_generations
          SET status = 'canceled', updated_at = now()
        WHERE task_id = $1
          AND status IN ('queued','claimed','processing')`,
      [taskId],
    );

    const nextRes = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(attempt_no), 0) + 1 AS next
         FROM store_poster_generations WHERE task_id = $1`,
      [taskId],
    );
    const next = nextRes.rows[0]!.next;

    const insRes = await client.query<GenerationRow>(
      `INSERT INTO store_poster_generations (task_id, attempt_no, status)
       VALUES ($1, $2, 'queued')
       RETURNING *`,
      [taskId, next],
    );
    return rowToGeneration(insRes.rows[0]!);
  });
}

// ============================================================================
// Worker 认领并处理（PO-D2）
// ============================================================================

/** 10 分钟过期锁 */
const CLAIM_TTL_MS = 10 * 60 * 1000;

export async function claimAndProcess(
  workerId: string,
  /**
   * 可选：精确认领某一条 generation。
   * - 不传：worker 模式（"下一条 queued"），与 OpenAPI POST /posters/generations:claim 默认一致
   * - 传值：sync-shim 用，让客户端建任务后直接处理自己刚建的 generation
   *   （仅当该 generation 当前 status=queued 时生效；否则返回 null）
   */
  targetGenerationId?: string,
): Promise<{ generation: PosterGeneration | null }> {
  // 第一步：原子认领（FOR UPDATE SKIP LOCKED）；同时清掉过期 claim
  const claim = await withTransaction(async (client) => {
    // 回收过期 claim 到 queued
    await client.query(
      `UPDATE store_poster_generations
          SET status = 'queued', claim_token = NULL,
              claim_expires_at = NULL, claimed_at = NULL,
              updated_at = now()
        WHERE status = 'claimed'
          AND claim_expires_at IS NOT NULL
          AND claim_expires_at < now()`,
    );

    const pick = targetGenerationId
      ? await client.query<GenerationRow>(
          `SELECT * FROM store_poster_generations
            WHERE id = $1 AND status = 'queued'
            FOR UPDATE SKIP LOCKED`,
          [targetGenerationId],
        )
      : await client.query<GenerationRow>(
          `SELECT * FROM store_poster_generations
            WHERE status = 'queued'
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED`,
        );
    if (!pick.rows.length) return null;

    const g = pick.rows[0]!;
    const token = randomUUID();
    const expires = new Date(Date.now() + CLAIM_TTL_MS).toISOString();
    await client.query(
      `UPDATE store_poster_generations
          SET status = 'claimed',
              claim_token = $1, claim_expires_at = $2,
              claimed_at = now(), updated_at = now()
        WHERE id = $3`,
      [token, expires, g.id],
    );
    return { ...g, status: 'claimed' as const, claim_token: token };
  });

  if (!claim) return { generation: null };

  // 第二步：拿 task inputs 调 openRouter（事务外，避免长事务）
  const tRes = await query<TaskRow>(
    `SELECT * FROM store_poster_tasks WHERE id = $1`,
    [claim.task_id],
  );
  const task = tRes.rows[0]!;
  const inputs = (task.inputs ?? {}) as Record<string, unknown>;
  const aiInput: PosterGenerateInput = {
    template: task.template,
    mode: task.mode,
    copyText: task.copy_text,
    sourcePhotoUrl: task.source_photo_url ?? undefined,
    productImageUrl: task.product_image_url ?? undefined,
    customStyleDescription: task.custom_style_description ?? undefined,
    productImageUrls: Array.isArray(inputs.productImageUrls)
      ? (inputs.productImageUrls as string[])
      : undefined,
    skuCode: typeof inputs.skuCode === 'string' ? inputs.skuCode : undefined,
    categoryName:
      typeof inputs.categoryName === 'string' ? inputs.categoryName : undefined,
  };

  // 标记 processing
  await query(
    `UPDATE store_poster_generations
        SET status = 'processing', started_at = now(), updated_at = now()
      WHERE id = $1`,
    [claim.id],
  );

  try {
    const out = await openRouterService.generatePoster(aiInput);
    // Gemini 走 OpenRouter 回的是 data:image/...;base64,... → 转存 OSS
    // 否则 DB 会塞 1-2MB/张大字符串 + iOS Safari 渲染大 base64 img 失败显示纯黑。
    let posterUrl = out.posterUrl;
    if (posterUrl.startsWith('data:')) {
      const uploaded = await ossService.uploadDataUrl(posterUrl, {
        purpose: 'poster-output',
        storeId: task.store_id,
        filenameHint: `${claim.id}.png`,
      });
      posterUrl = uploaded.url;
      logger.info(
        { generationId: claim.id, bytes: uploaded.size, url: posterUrl },
        'poster image transferred from data-url to OSS',
      );
    }
    const r = await query<GenerationRow>(
      `UPDATE store_poster_generations
          SET status = 'succeeded',
              poster_image_url = $1, thumbnail_url = $2,
              ai_model = $3, ai_prompt = $4,
              generation_ms = $5, finished_at = now(),
              updated_at = now()
        WHERE id = $6
        RETURNING *`,
      [
        posterUrl,
        out.thumbnailUrl ?? null,
        out.modelUsed,
        out.promptUsed,
        out.generationMs,
        claim.id,
      ],
    );
    logger.info({ workerId, taskId: claim.task_id, generationId: claim.id }, 'poster generated');
    return { generation: rowToGeneration(r.rows[0]!) };
  } catch (e) {
    const err = e as Error;
    const r = await query<GenerationRow>(
      `UPDATE store_poster_generations
          SET status = 'failed',
              error_code = $1, error_message = $2,
              finished_at = now(), updated_at = now()
        WHERE id = $3
        RETURNING *`,
      ['openrouter_error', err.message.slice(0, 500), claim.id],
    );
    logger.warn(
      { workerId, taskId: claim.task_id, generationId: claim.id, err: err.message },
      'poster generation failed',
    );
    return { generation: rowToGeneration(r.rows[0]!) };
  }
}

// ============================================================================
// 采用 / 下载
// ============================================================================

export async function adoptGeneration(
  generationId: string,
  userId: string,
  storeId: string,
): Promise<{ generation: PosterGeneration }> {
  return withTransaction(async (client) => {
    // 校验 generation 存在 + 任务属于本店本人（防越权采用）
    const gRes = await client.query<GenerationRow & { task_store_id: string; task_user_id: string }>(
      `SELECT g.*, t.store_id AS task_store_id, t.user_id AS task_user_id
         FROM store_poster_generations g
         JOIN store_poster_tasks t ON t.id = g.task_id
        WHERE g.id = $1`,
      [generationId],
    );
    if (!gRes.rows.length) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, '生成记录不存在');
    }
    const row = gRes.rows[0]!;
    if (row.task_store_id !== storeId || row.task_user_id !== userId) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, '不能采用他人海报');
    }
    if (row.status !== 'succeeded') {
      throw new AppError(409, ErrorCodes.CONFLICT, '只有成功的生成可以采用');
    }
    if (row.is_adopted) {
      return { generation: rowToGeneration(row) };
    }

    try {
      const upd = await client.query<GenerationRow>(
        `UPDATE store_poster_generations
            SET is_adopted = true, adopted_at = now(), updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [generationId],
      );
      return { generation: rowToGeneration(upd.rows[0]!) };
    } catch (e) {
      const err = e as { code?: string };
      // store_poster_generations_one_adopted_uq
      if (err.code === '23505') {
        throw new AppError(409, ErrorCodes.CONFLICT, '该任务已有采用记录');
      }
      throw e;
    }
  });
}

export async function recordDownload(
  generationId: string,
  userId: string,
  storeId: string,
): Promise<{ url: string; count: number }> {
  const res = await query<{
    id: string;
    poster_image_url: string | null;
    download_count: number;
    task_store_id: string;
  }>(
    `UPDATE store_poster_generations g
        SET download_count = g.download_count + 1, updated_at = now()
       FROM store_poster_tasks t
      WHERE g.id = $1 AND g.task_id = t.id
        AND t.store_id = $2 AND t.user_id = $3
      RETURNING g.id, g.poster_image_url, g.download_count, t.store_id AS task_store_id`,
    [generationId, storeId, userId],
  );
  if (!res.rows.length) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, '生成记录不存在或无权访问');
  }
  const r = res.rows[0]!;
  if (!r.poster_image_url) {
    throw new AppError(409, ErrorCodes.CONFLICT, '海报尚未生成完成');
  }
  return { url: r.poster_image_url, count: r.download_count };
}

// ============================================================================
// 成品库 / 今日额度
// ============================================================================

export async function listGallery(args: {
  userId?: string;
  storeId?: string;
  adopted?: boolean;
  limit?: number;
}): Promise<PosterGeneration[]> {
  const where: string[] = [`g.status = 'succeeded'`];
  const params: unknown[] = [];
  if (args.userId) {
    params.push(args.userId);
    where.push(`t.user_id = $${params.length}`);
  }
  if (args.storeId) {
    params.push(args.storeId);
    where.push(`t.store_id = $${params.length}`);
  }
  if (args.adopted === true) where.push(`g.is_adopted`);
  if (args.adopted === false) where.push(`NOT g.is_adopted`);

  const limit = args.limit ?? 30;
  params.push(limit);

  const res = await query<GenerationRow>(
    `SELECT g.*
       FROM store_poster_generations g
       JOIN store_poster_tasks t ON t.id = g.task_id
      WHERE ${where.join(' AND ')}
      ORDER BY g.created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return res.rows.map(rowToGeneration);
}

export async function todayCount(storeId: string): Promise<{ count: number }> {
  const res = await query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM store_poster_generations g
       JOIN store_poster_tasks t ON t.id = g.task_id
      WHERE t.store_id = $1
        AND g.created_at >= date_trunc('day', now())`,
    [storeId],
  );
  return { count: Number(res.rows[0]!.count) };
}

// ============================================================================
// 素材库（按店隔离）
// ============================================================================

export async function createAsset(args: {
  storeId: string;
  kind: 'background' | 'product_photo';
  imageUrl: string;
  uploadedBy: string;
}): Promise<PosterAsset> {
  const res = await query<{
    id: string;
    store_id: string;
    kind: 'background' | 'product_photo';
    image_url: string;
    uploaded_by: string | null;
    created_at: string;
  }>(
    `INSERT INTO store_poster_assets (store_id, kind, image_url, uploaded_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, store_id, kind, image_url, uploaded_by, created_at`,
    [args.storeId, args.kind, args.imageUrl, args.uploadedBy],
  );
  const r = res.rows[0]!;
  return {
    id: r.id,
    storeId: r.store_id,
    kind: r.kind,
    imageUrl: r.image_url,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
  };
}

export async function listAssets(
  storeId: string,
  kind?: 'background' | 'product_photo',
): Promise<PosterAsset[]> {
  const where: string[] = ['store_id = $1', 'deleted_at IS NULL'];
  const params: unknown[] = [storeId];
  if (kind) {
    params.push(kind);
    where.push(`kind = $${params.length}`);
  }
  const res = await query<{
    id: string;
    store_id: string;
    kind: 'background' | 'product_photo';
    image_url: string;
    uploaded_by: string | null;
    created_at: string;
  }>(
    `SELECT id, store_id, kind, image_url, uploaded_by, created_at
       FROM store_poster_assets
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC`,
    params,
  );
  return res.rows.map((r) => ({
    id: r.id,
    storeId: r.store_id,
    kind: r.kind,
    imageUrl: r.image_url,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
  }));
}

export async function deleteAsset(
  assetId: string,
  storeId: string,
): Promise<void> {
  const res = await query(
    `UPDATE store_poster_assets
        SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL`,
    [assetId, storeId],
  );
  if ((res.rowCount ?? 0) === 0) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, '素材不存在或已删除');
  }
}

// ============================================================================
// 销量追踪（v_poster_product_sales 视图）
// ============================================================================

export async function listSalesTracking(args: {
  storeId: string;
  days?: number;
}): Promise<PosterSalesItem[]> {
  // 视图本身已计算前后窗口；days 留作未来扩展（如限定 adopted_at 距今 days）
  const params: unknown[] = [args.storeId];
  let cutoff = '';
  if (args.days && args.days > 0) {
    params.push(args.days);
    cutoff = `AND adopted_at >= now() - ($${params.length} || ' days')::interval`;
  }
  const res = await query<{
    task_id: string;
    generation_id: string;
    product_id: string;
    sku_code: string;
    adopted_at: string;
    before_snapshot_date: string | null;
    before_sales_qty_30d: number | null;
    after_snapshot_date: string | null;
    after_sales_qty_30d: number | null;
    qty_delta_percent: string | null;
  }>(
    `SELECT task_id, generation_id, product_id, sku_code, adopted_at,
            before_snapshot_date, before_sales_qty_30d,
            after_snapshot_date, after_sales_qty_30d, qty_delta_percent
       FROM v_poster_product_sales
      WHERE store_id = $1 ${cutoff}
      ORDER BY adopted_at DESC`,
    params,
  );
  return res.rows.map((r) => ({
    taskId: r.task_id,
    generationId: r.generation_id,
    productId: r.product_id,
    skuCode: r.sku_code,
    adoptedAt: r.adopted_at,
    beforeSnapshotDate: r.before_snapshot_date,
    beforeSalesQty30d: r.before_sales_qty_30d,
    afterSnapshotDate: r.after_snapshot_date,
    afterSalesQty30d: r.after_sales_qty_30d,
    qtyDeltaPercent: r.qty_delta_percent !== null ? Number(r.qty_delta_percent) : null,
  }));
}
