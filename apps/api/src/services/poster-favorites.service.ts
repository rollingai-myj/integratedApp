/**
 * 海报收藏业务层
 *
 * 表：store_poster_favorites (V035)
 * 语义：用户主动收藏的 generation。
 *      生成记录 = 自动（store_poster_tasks 全量，近 30 天）
 *      收藏     = 手动（这张表，永久）
 */
import { query } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

export interface PosterFavorite {
  id: string;
  generationId: string;
  taskId: string;
  batchId: string;
  posterImageUrl: string | null;
  thumbnailUrl: string | null;
  copyText: string;
  template: string;
  skuCode: string | null;
  createdAt: string;
}

interface FavoriteRow {
  id: string;
  generation_id: string;
  task_id: string;
  batch_id: string;
  poster_image_url: string | null;
  thumbnail_url: string | null;
  copy_text: string;
  template: string;
  sku_code: string | null;
  created_at: string;
}

function rowToFavorite(r: FavoriteRow): PosterFavorite {
  return {
    id: r.id,
    generationId: r.generation_id,
    taskId: r.task_id,
    batchId: r.batch_id,
    posterImageUrl: r.poster_image_url,
    thumbnailUrl: r.thumbnail_url,
    copyText: r.copy_text,
    template: r.template,
    skuCode: r.sku_code,
    createdAt: r.created_at,
  };
}

/**
 * 列出当前用户「当前门店」的收藏。
 *
 * 门店隔离:店长可能管多家门店,在 A 店不应看到自己在 B 店收藏的海报。
 * 关联到 task.store_id 上过滤(favorites 表本身没 store_id,但 generation→task 链上有)。
 */
export async function listFavorites(
  userId: string,
  storeId: string,
): Promise<PosterFavorite[]> {
  const res = await query<FavoriteRow>(
    `SELECT f.id,
            f.generation_id,
            g.task_id,
            t.batch_id,
            g.poster_image_url,
            g.thumbnail_url,
            t.copy_text,
            t.template::text,
            (SELECT sku_code FROM store_poster_task_products
              WHERE task_id = t.id
              ORDER BY display_order LIMIT 1) AS sku_code,
            f.created_at
       FROM store_poster_favorites f
       JOIN store_poster_generations g ON g.id = f.generation_id
       JOIN store_poster_tasks t ON t.id = g.task_id
      WHERE f.user_id = $1 AND t.store_id = $2
      ORDER BY f.created_at DESC`,
    [userId, storeId],
  );
  return res.rows.map(rowToFavorite);
}

export async function addFavorite(
  userId: string,
  generationId: string,
  storeId: string,
): Promise<PosterFavorite> {
  // 校验 generation 存在 + 属于本人 + 来自当前门店(防止从历史里把别店的 generation 加进本店收藏)
  const ownerCheck = await query<{ user_id: string; store_id: string }>(
    `SELECT t.user_id, t.store_id
       FROM store_poster_generations g
       JOIN store_poster_tasks t ON t.id = g.task_id
      WHERE g.id = $1`,
    [generationId],
  );
  if (ownerCheck.rows.length === 0) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'generation 不存在');
  }
  if (ownerCheck.rows[0]!.user_id !== userId) {
    throw new AppError(403, ErrorCodes.FORBIDDEN, '无权收藏该 generation');
  }
  if (ownerCheck.rows[0]!.store_id !== storeId) {
    throw new AppError(403, ErrorCodes.FORBIDDEN, '该 generation 不属于当前门店');
  }

  // ON CONFLICT DO NOTHING：重复收藏静默 idempotent
  await query(
    `INSERT INTO store_poster_favorites (user_id, generation_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, generation_id) DO NOTHING`,
    [userId, generationId],
  );

  // 回查（无论是否新插入都返回当前记录）
  const res = await query<FavoriteRow>(
    `SELECT f.id,
            f.generation_id,
            g.task_id,
            t.batch_id,
            g.poster_image_url,
            g.thumbnail_url,
            t.copy_text,
            t.template::text,
            (SELECT sku_code FROM store_poster_task_products
              WHERE task_id = t.id
              ORDER BY display_order LIMIT 1) AS sku_code,
            f.created_at
       FROM store_poster_favorites f
       JOIN store_poster_generations g ON g.id = f.generation_id
       JOIN store_poster_tasks t ON t.id = g.task_id
      WHERE f.user_id = $1 AND f.generation_id = $2`,
    [userId, generationId],
  );
  return rowToFavorite(res.rows[0]!);
}

export async function removeFavorite(
  userId: string,
  generationId: string,
): Promise<void> {
  // 静默 idempotent：删不存在的也算成功
  await query(
    `DELETE FROM store_poster_favorites
      WHERE user_id = $1 AND generation_id = $2`,
    [userId, generationId],
  );
}
