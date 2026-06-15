-- V020: hq_promo_mix_groups 从 TABLE 改为 VIEW
--
-- 原 TABLE 的所有字段都能从 hq_promo_batch_items 按 mix_group_code GROUP BY 派生，
-- 唯一非派生字段 representative_image_url 始终为 NULL、无写入路径、无消费方（YAGNI）。
-- 改成 VIEW 后：
--   - upload 服务删掉 ~40 行聚合 INSERT 代码，单一事实源
--   - service 层 SELECT 一行不变，前端零感知
--   - 旧 TABLE 内的历史 dummy 数据（2 t-first 批次各 1 行）会随 DROP 一并清掉
--     —— 这些是测试占位，不影响业务

BEGIN;

DROP TABLE IF EXISTS hq_promo_mix_groups;

CREATE VIEW hq_promo_mix_groups AS
SELECT
  md5(batch_id::text || '|' || mix_group_code)::uuid                                  AS id,
  batch_id,
  mix_group_code,
  ((array_agg(category_name) FILTER (WHERE category_name IS NOT NULL))[1]) || ' 系列' AS display_name,
  (array_agg(category_name)  FILTER (WHERE category_name IS NOT NULL))[1]             AS category_name,
  array_agg(sku_code ORDER BY row_index)                                              AS sku_codes,
  COUNT(*)::int                                                                       AS product_count,
  (array_agg(best_label ORDER BY best_saving_percent DESC NULLS LAST))[1]             AS best_label,
  MIN(best_total_price)                                                               AS best_total_price,
  MAX(best_saving_percent)                                                            AS best_saving_percent,
  NULL::text                                                                          AS representative_image_url
FROM hq_promo_batch_items
WHERE mix_group_code IS NOT NULL
GROUP BY batch_id, mix_group_code;

COMMENT ON VIEW hq_promo_mix_groups IS
  '从 hq_promo_batch_items 按 mix_group_code 聚合派生的凑单组视图（V020：从原 TABLE 切换为 VIEW，消除上传期双写漂移风险）';

COMMIT;
