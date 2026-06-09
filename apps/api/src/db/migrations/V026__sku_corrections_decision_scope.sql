-- =============================================================================
-- V026__sku_corrections_decision_scope.sql
-- 域：货盘选品 · SKU 勘误
-- 起因：
--   sku_corrections.correction_kind enum 现在是识别误差视角 ('missed' /
--   'false_positive')；原 skuSelection repo 还有"选品决策勘误"语义 —— 店长不
--   同意 AI 的撤场/上架建议，理由有 stopped_purchase / vip_preferred /
--   started_purchase / verified_low_sales。
--
--   这两组 enum 不能互换 —— 一个是识别系统的勘误，一个是选品决策的反馈。
--   原 PR #29 把 decision 维度的勘误塞 localStorage，超管无法审计、不能做
--   "店长普遍质疑 AI 撤场建议 → 重训 prompt"这类全公司洞察。现在补回数据库。
--
-- 方案：
--   - 新增 correction_scope 字段：'detection' | 'decision'
--   - 扩 sku_correction_kind enum 加 'remove' / 'add'（决策维度的两种）
--   - 扩 sku_correction_reason enum 加 4 个决策维度的理由码
--   - CHECK 约束 scope 与 kind 强对应，避免误填
--
-- 不破坏现有数据：default scope='detection'，已有的 missed/false_positive
-- 行天然落在该 scope 下。
-- =============================================================================

-- 1) scope enum
CREATE TYPE sku_correction_scope AS ENUM ('detection', 'decision');

-- 2) kind enum 扩 2 个值（PostgreSQL 不允许在事务内 ALTER TYPE ADD VALUE，
--    所以拆出 COMMIT；这里用 IF NOT EXISTS 防重跑）
ALTER TYPE sku_correction_kind ADD VALUE IF NOT EXISTS 'remove';
ALTER TYPE sku_correction_kind ADD VALUE IF NOT EXISTS 'add';

-- 3) reason enum 扩 4 个值
ALTER TYPE sku_correction_reason ADD VALUE IF NOT EXISTS 'stopped_purchase';
ALTER TYPE sku_correction_reason ADD VALUE IF NOT EXISTS 'vip_preferred';
ALTER TYPE sku_correction_reason ADD VALUE IF NOT EXISTS 'started_purchase';
ALTER TYPE sku_correction_reason ADD VALUE IF NOT EXISTS 'verified_low_sales';

-- 4) 加列
ALTER TABLE sku_corrections
  ADD COLUMN IF NOT EXISTS correction_scope sku_correction_scope NOT NULL DEFAULT 'detection';

COMMENT ON COLUMN sku_corrections.correction_scope IS
  'detection: 识别勘误（missed/false_positive）；decision: 选品决策勘误（remove/add）';

CREATE INDEX IF NOT EXISTS idx_sku_corrections_scope ON sku_corrections (correction_scope, submitted_at DESC);

-- 5) CHECK：scope 与 kind 必须强对应。CHECK 不能直接引用 enum 字面量名（必须 cast），
--    所以用 ::text 比较字符串值。
ALTER TABLE sku_corrections
  ADD CONSTRAINT chk_correction_scope_kind CHECK (
       (correction_scope = 'detection'::sku_correction_scope
        AND correction_kind::text IN ('missed', 'false_positive'))
    OR (correction_scope = 'decision'::sku_correction_scope
        AND correction_kind::text IN ('remove', 'add'))
  );
