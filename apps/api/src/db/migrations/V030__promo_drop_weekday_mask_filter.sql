-- V030: 把 weekday mask 检查从 v_active_offers 摘掉
--
-- 之前 v_active_offers 在 SQL 层就用 (mask & (1<<(7-ISODOW))) 把今天 mask 不命中的
-- offer 全部剔除。结果:周二会员日(mask=32)/周末啤酒日(mask=7)这类在非生效 weekday
-- 的日子里前端完全拿不到数据,UI 上的「今明」toggle 也就没东西可过滤。
--
-- 改成:只按 valid_from/valid_to 日期窗口过滤 + 批次未作废。weekday mask 透传给前端,
-- 由前端决定:
--   * 「今明」选中 → 仅展示 mask 命中今/明的 offer
--   * 「今明」未选 → 展示所有在有效期内的 offer(含 mask 不命中当前的)
--   * 黄色标签 → 「今日有效」/「明日有效」/「周二会员日」/「周末啤酒日」按 mask 命中日决定

DROP VIEW IF EXISTS v_active_offers;

CREATE VIEW v_active_offers AS
SELECT o.id, o.raw_item_id, o.batch_id, o.activity_type, o.sku_code, o.mechanic,
       o.mechanic_params, o.pool_label, o.original_price, o.valid_weekday_mask,
       o.valid_from, o.valid_to, o.is_stackable, o.parse_note, o.created_at
  FROM hq_promo_offers o
  JOIN hq_promo_batches b ON b.id = o.batch_id
 WHERE b.is_voided = false
   AND current_date BETWEEN o.valid_from AND o.valid_to;
