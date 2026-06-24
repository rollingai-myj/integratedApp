-- V036 — admin-web 数据上传批次表
--
-- 三类上传(活动 / 产品主数据 / 销售快照)共用同一张批次表。
-- 工作流:
--   1. 用户上传 CSV → 服务端解析 + 行级校验 → 落 staged 批次(状态 staged)
--   2. 用户在批次列表里看错误清单,确认无误后点「应用」(下个 PR)
--      → 落到对应业务表,状态变 applied
--   3. (未来)回滚:状态变 rolled_back,业务表恢复 before-snapshot
--
-- staging_data 直接 jsonb 存解析成功的行(简化方案)。
-- 单批次 < 5 万行,jsonb 50 MB 内可控;超大文件未来再切到每行一行的 staging 表。

CREATE TYPE upload_kind   AS ENUM ('promotions', 'products', 'snapshots');
CREATE TYPE upload_status AS ENUM ('staged', 'applied', 'failed', 'rolled_back');

CREATE TABLE upload_batches (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            upload_kind    NOT NULL,
  file_name       text           NOT NULL,
  uploaded_by     uuid           REFERENCES users(id),
  status          upload_status  NOT NULL DEFAULT 'staged',
  total_rows      integer        NOT NULL DEFAULT 0,
  valid_rows      integer        NOT NULL DEFAULT 0,
  error_rows      integer        NOT NULL DEFAULT 0,
  /** 行级错误清单:[{row: 5, col: 'price', msg: '不是数字', raw: '...'}]
   *  最多前 200 条,避免 jsonb 膨胀 */
  parse_errors    jsonb          NOT NULL DEFAULT '[]'::jsonb,
  /** 解析成功的行(已做类型转换 + FK lookup),apply 阶段直接消费 */
  staging_data    jsonb          NOT NULL DEFAULT '[]'::jsonb,
  applied_at      timestamptz,
  applied_by      uuid           REFERENCES users(id),
  /** apply 后填:{inserted: N, updated: M, skipped: K} */
  apply_summary   jsonb          NOT NULL DEFAULT '{}'::jsonb,
  notes           text,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX upload_batches_kind_created_idx
  ON upload_batches (kind, created_at DESC);

COMMENT ON TABLE upload_batches IS
  'admin-web 数据上传批次(promotions/products/snapshots 共用)';
COMMENT ON COLUMN upload_batches.updated_at IS
  '由 service 层在 UPDATE 时显式 SET updated_at = now(),仓库没有通用 set_updated_at trigger 函数';
