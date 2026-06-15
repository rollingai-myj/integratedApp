-- V021: 移除 hq_promo_sku_texts 表
--
-- 该表原计划用于选品页商品旁的促销标语（与海报促销批次独立的体系），
-- 但端到端从未启用：
--   - 后端 listScenePromoTexts / GET /scenes/:scene/promo-texts 已在本期同步删除（前端 0 调用方）
--   - 始终缺写接口（INSERT/UPDATE/DELETE 在服务层 / 路由层均不存在）
--   - 仅 dev-seed.sql 灌种子数据存活
--
-- 等"商品旁标语"产品决策落地后，可参考 V005 中本表的原 DDL 重建。

BEGIN;

DROP TABLE IF EXISTS hq_promo_sku_texts;

COMMIT;
