/**
 * 海报业务层：单张同步 + 队列 + 历史
 *
 * 表：
 *   poster_jobs    队列任务（批量入队 / 认领 / 处理 / 卡死重置 / 失败重生成）
 *   posters        最终海报记录
 *
 * 决策 D5：batch_id 串联同一次提交；parent_job_id 串联失败重生成
 */
import { query, withTransaction } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { randomBytes } from 'node:crypto';
import {
  openRouterService,
  type PosterGenerateInput,
} from './openrouter.service.js';

// ---- 类型 -----------------------------------------------------------------

export interface PosterJob {
  id: string;
  batchId: string;
  parentJobId: string | null;
  userId: string;
  storeId: string | null;
  template: 'vibrant' | 'premium' | 'minimal' | 'custom';
  mode: 'photo_compose' | 'official_bg_only' | 'multi_product';
  copyText: string;
  skuCode: string | null;
  categoryName: string | null;
  status:
    | 'queued'
    | 'claimed'
    | 'processing'
    | 'succeeded'
    | 'failed'
    | 'canceled';
  posterImageUrl: string | null;
  errorMessage: string | null;
  retryCount: number;
  resetCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PosterRecord {
  id: string;
  jobId: string | null;
  userId: string;
  storeId: string | null;
  template: 'vibrant' | 'premium' | 'minimal' | 'custom';
  mode: 'photo_compose' | 'official_bg_only' | 'multi_product';
  copyText: string;
  skuCode: string | null;
  categoryName: string | null;
  posterImageUrl: string;
  thumbnailUrl: string | null;
  aiModel: string | null;
  aiPrompt: string | null;
  generationMs: number | null;
  createdAt: string;
}

// ---- PO-C1 单张同步生成 ---------------------------------------------------

export async function generatePosterSync(
  args: PosterGenerateInput,
  userId: string,
  storeId: string | null,
): Promise<PosterRecord> {
  const out = await openRouterService.generatePoster(args);

  const res = await query<PosterDbRow>(
    `INSERT INTO posters
       (user_id, store_id, source_photo_url, product_image_url, template, mode,
        custom_style_description, copy_text, sku_code, category_name,
        poster_image_url, ai_model, ai_prompt, generation_ms)
     VALUES ($1, $2, $3, $4, $5::poster_template, $6::poster_mode,
             $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id, job_id, user_id, store_id, template, mode, copy_text,
               sku_code, category_name, poster_image_url, thumbnail_url,
               ai_model, ai_prompt, generation_ms, created_at`,
    [
      userId,
      storeId,
      args.sourcePhotoUrl ?? null,
      args.productImageUrl ?? null,
      args.template,
      args.mode,
      args.customStyleDescription ?? null,
      args.copyText,
      args.skuCode ?? null,
      args.categoryName ?? null,
      out.posterUrl,
      out.modelUsed,
      out.promptUsed,
      out.generationMs,
    ],
  );
  return mapPoster(res.rows[0]!);
}

interface PosterDbRow {
  id: string;
  job_id: string | null;
  user_id: string;
  store_id: string | null;
  template: PosterRecord['template'];
  mode: PosterRecord['mode'];
  copy_text: string;
  sku_code: string | null;
  category_name: string | null;
  poster_image_url: string;
  thumbnail_url: string | null;
  ai_model: string | null;
  ai_prompt: string | null;
  generation_ms: number | null;
  created_at: string;
}

function mapPoster(r: PosterDbRow): PosterRecord {
  return {
    id: r.id,
    jobId: r.job_id,
    userId: r.user_id,
    storeId: r.store_id,
    template: r.template,
    mode: r.mode,
    copyText: r.copy_text,
    skuCode: r.sku_code,
    categoryName: r.category_name,
    posterImageUrl: r.poster_image_url,
    thumbnailUrl: r.thumbnail_url,
    aiModel: r.ai_model,
    aiPrompt: r.ai_prompt,
    generationMs: r.generation_ms,
    createdAt: r.created_at,
  };
}

// ---- PO-D1 批量入队 -------------------------------------------------------

export async function enqueueBatch(
  jobs: PosterGenerateInput[],
  userId: string,
  storeId: string | null,
): Promise<{ batchId: string; jobIds: string[] }> {
  if (jobs.length === 0) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, 'jobs 不能为空');
  }
  if (jobs.length > 10) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, '单次入队最多 10 张');
  }
  const batchId = crypto.randomUUID();
  const jobIds: string[] = [];

  await withTransaction(async (client) => {
    for (const j of jobs) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO poster_jobs
           (batch_id, user_id, store_id, source_photo_url, product_image_url,
            template, mode, custom_style_description, copy_text, sku_code,
            category_name, inputs, status)
         VALUES ($1, $2, $3, $4, $5, $6::poster_template, $7::poster_mode,
                 $8, $9, $10, $11, $12::jsonb, 'queued')
         RETURNING id`,
        [
          batchId,
          userId,
          storeId,
          j.sourcePhotoUrl ?? null,
          j.productImageUrl ?? null,
          j.template,
          j.mode,
          j.customStyleDescription ?? null,
          j.copyText,
          j.skuCode ?? null,
          j.categoryName ?? null,
          JSON.stringify(j),
        ],
      );
      jobIds.push(r.rows[0]!.id);
    }
  });

  return { batchId, jobIds };
}

// ---- PO-D2 认领并处理 ----------------------------------------------------

export interface ProcessResult {
  job: PosterJob;
  poster?: PosterRecord;
}

export async function claimAndProcess(
  jobId: string | null,
  userId: string,
): Promise<ProcessResult> {
  const claimToken = randomBytes(16).toString('hex');

  // 原子认领：要么从队列里拿指定 jobId，要么取一条 queued 的
  const claimRes = await query<{
    id: string;
    inputs: PosterGenerateInput;
    store_id: string | null;
  }>(
    jobId
      ? `UPDATE poster_jobs
            SET status = 'claimed', claim_token = $2, claimed_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'queued' AND user_id = $3
      RETURNING id, inputs, store_id`
      : `UPDATE poster_jobs
            SET status = 'claimed', claim_token = $2, claimed_at = now(), updated_at = now()
          WHERE id = (
            SELECT id FROM poster_jobs
             WHERE status = 'queued' AND user_id = $3
          ORDER BY created_at
             FOR UPDATE SKIP LOCKED
             LIMIT 1
          )
      RETURNING id, inputs, store_id`,
    jobId ? [jobId, claimToken, userId] : [null, claimToken, userId],
  );

  const claimed = claimRes.rows[0];
  if (!claimed) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, '没有可认领的任务');
  }

  // 标记 processing
  await query(
    `UPDATE poster_jobs SET status = 'processing', started_at = now(), updated_at = now() WHERE id = $1`,
    [claimed.id],
  );

  // 调 OpenRouter
  try {
    const out = await openRouterService.generatePoster(claimed.inputs);

    // 落 posters
    const posterRes = await query<PosterDbRow>(
      `INSERT INTO posters
         (job_id, user_id, store_id, source_photo_url, product_image_url, template, mode,
          custom_style_description, copy_text, sku_code, category_name,
          poster_image_url, ai_model, ai_prompt, generation_ms)
       VALUES ($1, $2, $3, $4, $5, $6::poster_template, $7::poster_mode, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, job_id, user_id, store_id, template, mode, copy_text,
                 sku_code, category_name, poster_image_url, thumbnail_url,
                 ai_model, ai_prompt, generation_ms, created_at`,
      [
        claimed.id,
        userId,
        claimed.store_id,
        claimed.inputs.sourcePhotoUrl ?? null,
        claimed.inputs.productImageUrl ?? null,
        claimed.inputs.template,
        claimed.inputs.mode,
        claimed.inputs.customStyleDescription ?? null,
        claimed.inputs.copyText,
        claimed.inputs.skuCode ?? null,
        claimed.inputs.categoryName ?? null,
        out.posterUrl,
        out.modelUsed,
        out.promptUsed,
        out.generationMs,
      ],
    );

    // 标 succeeded
    const jobRes = await query<PosterJobDbRow>(
      `UPDATE poster_jobs
          SET status = 'succeeded', poster_image_url = $2, ai_model = $3,
              ai_prompt = $4, generation_ms = $5, finished_at = now(), updated_at = now()
        WHERE id = $1
    RETURNING id, batch_id, parent_job_id, user_id, store_id, template, mode,
              copy_text, sku_code, category_name, status, poster_image_url,
              error_message, retry_count, reset_count, created_at, updated_at`,
      [claimed.id, out.posterUrl, out.modelUsed, out.promptUsed, out.generationMs],
    );

    return {
      job: mapJob(jobRes.rows[0]!),
      poster: mapPoster(posterRes.rows[0]!),
    };
  } catch (err) {
    const jobRes = await query<PosterJobDbRow>(
      `UPDATE poster_jobs
          SET status = 'failed', error_code = $2, error_message = $3,
              finished_at = now(), updated_at = now()
        WHERE id = $1
    RETURNING id, batch_id, parent_job_id, user_id, store_id, template, mode,
              copy_text, sku_code, category_name, status, poster_image_url,
              error_message, retry_count, reset_count, created_at, updated_at`,
      [
        claimed.id,
        err instanceof AppError ? err.code : 'GENERATE_FAILED',
        (err as Error).message ?? 'unknown',
      ],
    );
    return { job: mapJob(jobRes.rows[0]!) };
  }
}

interface PosterJobDbRow {
  id: string;
  batch_id: string;
  parent_job_id: string | null;
  user_id: string;
  store_id: string | null;
  template: PosterJob['template'];
  mode: PosterJob['mode'];
  copy_text: string;
  sku_code: string | null;
  category_name: string | null;
  status: PosterJob['status'];
  poster_image_url: string | null;
  error_message: string | null;
  retry_count: number;
  reset_count: number;
  created_at: string;
  updated_at: string;
}

function mapJob(r: PosterJobDbRow): PosterJob {
  return {
    id: r.id,
    batchId: r.batch_id,
    parentJobId: r.parent_job_id,
    userId: r.user_id,
    storeId: r.store_id,
    template: r.template,
    mode: r.mode,
    copyText: r.copy_text,
    skuCode: r.sku_code,
    categoryName: r.category_name,
    status: r.status,
    posterImageUrl: r.poster_image_url,
    errorMessage: r.error_message,
    retryCount: r.retry_count,
    resetCount: r.reset_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---- PO-D3 列出活跃任务（最近 2 小时） ----------------------------------

export async function listActiveJobs(userId: string): Promise<PosterJob[]> {
  const res = await query<PosterJobDbRow>(
    `SELECT id, batch_id, parent_job_id, user_id, store_id, template, mode,
            copy_text, sku_code, category_name, status, poster_image_url,
            error_message, retry_count, reset_count, created_at, updated_at
       FROM poster_jobs
      WHERE user_id = $1
        AND created_at >= now() - INTERVAL '2 hours'
   ORDER BY created_at DESC`,
    [userId],
  );
  return res.rows.map(mapJob);
}

// ---- PO-D4 移除整批 ------------------------------------------------------

export async function cancelBatch(
  batchId: string,
  userId: string,
): Promise<{ canceled: number }> {
  const res = await query(
    `UPDATE poster_jobs
        SET status = 'canceled', finished_at = now(), updated_at = now()
      WHERE batch_id = $1 AND user_id = $2
        AND status IN ('queued', 'claimed', 'processing')`,
    [batchId, userId],
  );
  return { canceled: res.rowCount ?? 0 };
}

// ---- PO-D5 重置卡死任务 --------------------------------------------------

export async function resetStuckJob(
  jobId: string,
  userId: string,
): Promise<{ job: PosterJob }> {
  const res = await query<PosterJobDbRow>(
    `UPDATE poster_jobs
        SET status = 'queued', claim_token = NULL, claimed_at = NULL,
            started_at = NULL, reset_count = reset_count + 1, updated_at = now()
      WHERE id = $1 AND user_id = $2
        AND (status = 'processing' OR status = 'claimed')
        AND (started_at IS NULL OR started_at < now() - INTERVAL '60 seconds')
  RETURNING id, batch_id, parent_job_id, user_id, store_id, template, mode,
            copy_text, sku_code, category_name, status, poster_image_url,
            error_message, retry_count, reset_count, created_at, updated_at`,
    [jobId, userId],
  );
  if (res.rows.length === 0) {
    throw new AppError(409, ErrorCodes.BAD_REQUEST, '任务不在可重置状态');
  }
  return { job: mapJob(res.rows[0]!) };
}

// ---- PO-D6 失败任务换参数重做 --------------------------------------------

export async function retryFailedJob(
  jobId: string,
  patch: Partial<PosterGenerateInput>,
  userId: string,
): Promise<{ batchId: string; newJobId: string }> {
  const old = await query<{
    batch_id: string;
    store_id: string | null;
    inputs: PosterGenerateInput;
    status: PosterJob['status'];
  }>(
    `SELECT batch_id, store_id, inputs, status
       FROM poster_jobs
      WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [jobId, userId],
  );
  const oldRow = old.rows[0];
  if (!oldRow) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, '任务不存在');
  }
  if (oldRow.status !== 'failed') {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, '只能重生成 failed 任务');
  }

  const mergedInputs: PosterGenerateInput = { ...oldRow.inputs, ...patch };
  const batchId = crypto.randomUUID();
  const ins = await query<{ id: string }>(
    `INSERT INTO poster_jobs
       (batch_id, parent_job_id, user_id, store_id, source_photo_url, product_image_url,
        template, mode, custom_style_description, copy_text, sku_code, category_name,
        inputs, status, retry_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7::poster_template, $8::poster_mode,
             $9, $10, $11, $12, $13::jsonb, 'queued', 1)
     RETURNING id`,
    [
      batchId,
      jobId,
      userId,
      oldRow.store_id,
      mergedInputs.sourcePhotoUrl ?? null,
      mergedInputs.productImageUrl ?? null,
      mergedInputs.template,
      mergedInputs.mode,
      mergedInputs.customStyleDescription ?? null,
      mergedInputs.copyText,
      mergedInputs.skuCode ?? null,
      mergedInputs.categoryName ?? null,
      JSON.stringify(mergedInputs),
    ],
  );
  return { batchId, newJobId: ins.rows[0]!.id };
}

// ---- 历史海报列表（PO-F2 给超管 + 店长的"我的历史"） --------------------

export async function listPosters(args: {
  userId?: string;
  storeId?: string;
  limit?: number;
}): Promise<PosterRecord[]> {
  const params: unknown[] = [];
  const filters: string[] = [];
  if (args.userId) {
    params.push(args.userId);
    filters.push(`user_id = $${params.length}`);
  }
  if (args.storeId) {
    params.push(args.storeId);
    filters.push(`store_id = $${params.length}`);
  }
  params.push(Math.min(args.limit ?? 100, 500));
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const res = await query<PosterDbRow>(
    `SELECT id, job_id, user_id, store_id, template, mode, copy_text,
            sku_code, category_name, poster_image_url, thumbnail_url,
            ai_model, ai_prompt, generation_ms, created_at
       FROM posters
       ${where}
   ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return res.rows.map(mapPoster);
}
