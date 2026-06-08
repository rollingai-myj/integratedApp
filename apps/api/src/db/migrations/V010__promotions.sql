-- =============================================================================
-- V010__promotions.sql
-- 域：海报模块的促销批次 / 商品 / 可混搭组（与 V009 选品 SKU 级文案并存）
--
-- 决策 D6：选品 promo_groups（V009）与海报 promotion_uploads/product_promotions
--          /promotion_groups（本文件）两套并存，不强行合并。
--
-- 内容：
--   - promotion_uploads      促销批次（超管每次上传 Excel = 一条）
--   - product_promotions     批次内的单品促销
--   - promotion_groups       可混搭促销组（同一 mix_group_code 的多 SKU 聚合）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 促销批次
--   - 全局唯一一条 is_active=TRUE（用部分唯一索引保证）
--   - 删除批次会 CASCADE 删除 product_promotions 与 promotion_groups
-- -----------------------------------------------------------------------------
CREATE TABLE promotion_uploads (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name            TEXT NOT NULL,                          -- 用户上传的 Excel 文件名
  source_file_url      TEXT,                                   -- OSS 上保留的原始 Excel（可选）
  uploaded_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  -- 解析统计
  row_total            INT NOT NULL DEFAULT 0,                 -- 总行数
  product_count        INT NOT NULL DEFAULT 0,                 -- 入库的 product_promotions 行数
  group_count          INT NOT NULL DEFAULT 0,                 -- 解析出的 mix_group 数量
  parse_warnings       JSONB NOT NULL DEFAULT '[]'::jsonb,     -- 解析过程中的警告（缺字段、价格异常等）
  -- 激活状态
  is_active            BOOLEAN NOT NULL DEFAULT FALSE,
  activated_at         TIMESTAMPTZ,
  deactivated_at       TIMESTAMPTZ,
  -- 备注与元信息
  notes                TEXT,
  attributes           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX        idx_promotion_uploads_active     ON promotion_uploads (is_active) WHERE is_active = TRUE;
CREATE INDEX        idx_promotion_uploads_created    ON promotion_uploads (created_at DESC);
-- 全局唯一一条 active 批次
CREATE UNIQUE INDEX uq_promotion_uploads_one_active  ON promotion_uploads ((TRUE)) WHERE is_active = TRUE;

-- -----------------------------------------------------------------------------
-- 批次内的单品促销
--   - sku_code 不强制 FK 到 dim_product，因为 Excel 可能含未入库的新 SKU
--   - product_id 是延迟匹配的引用，匹配上则可查官方图（决策 D8）
-- -----------------------------------------------------------------------------
CREATE TABLE product_promotions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id               UUID NOT NULL REFERENCES promotion_uploads(id) ON DELETE CASCADE,
  row_index               INT NOT NULL,                        -- Excel 原始行号（便于审计）
  -- 商品信息（来自 Excel）
  sku_code                VARCHAR(64) NOT NULL,
  product_name            TEXT NOT NULL,
  unit                    TEXT,                                -- "瓶"、"包"、"盒"
  category_name           TEXT,                                -- Excel 原始品类名
  original_price          NUMERIC(12, 2),                      -- 原价
  -- 延迟匹配的 dim_product 引用（解析后异步填充）
  product_id              UUID REFERENCES dim_product(id) ON DELETE SET NULL,
  -- 最优促销方案（用于排序、卡片首屏）
  best_label              TEXT,                                -- "买二送一"、"会员价"等
  best_required_qty       INT,                                 -- 需购买数量
  best_total_price        NUMERIC(12, 2),                      -- 总价
  best_effective_unit_price NUMERIC(12, 2),                    -- 折算单价
  best_saving_percent     NUMERIC(6, 2),                       -- 节省百分比（0~100）
  -- 全部可选方案（叠券、组合、第二件半价等）
  all_options             JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- 有效期
  valid_from              DATE,
  valid_to                DATE,
  valid_dates             DATE[],                              -- 指定日期（如周六周日）
  -- 可混搭组（如有）
  mix_group_code          TEXT,                                -- 同 code 的多 SKU 可一起出海报
  -- 海报生成相关
  display_text            TEXT,                                -- 海报上的标准文案
  attributes              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_product_promotions_row    ON product_promotions (upload_id, row_index);
CREATE INDEX        idx_product_promotions_sku   ON product_promotions (sku_code);
CREATE INDEX        idx_product_promotions_up    ON product_promotions (upload_id);
CREATE INDEX        idx_product_promotions_cat   ON product_promotions (category_name);
CREATE INDEX        idx_product_promotions_mix   ON product_promotions (mix_group_code) WHERE mix_group_code IS NOT NULL;
CREATE INDEX        idx_product_promotions_valid ON product_promotions (valid_from, valid_to);
CREATE INDEX        idx_product_promotions_save  ON product_promotions (best_saving_percent DESC);

-- -----------------------------------------------------------------------------
-- 可混搭促销组（同一 mix_group_code 的 SKU 聚合）
--   - 上传完 product_promotions 后由后端聚合生成
--   - 用于海报"多商品混排"模式
-- -----------------------------------------------------------------------------
CREATE TABLE promotion_groups (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id                UUID NOT NULL REFERENCES promotion_uploads(id) ON DELETE CASCADE,
  mix_group_code           TEXT NOT NULL,                      -- 同 code 聚合
  display_name             TEXT,                               -- "可口可乐 330ml 系列"
  category_name            TEXT,
  sku_codes                TEXT[] NOT NULL DEFAULT '{}',       -- 组内全部 SKU
  product_count            INT NOT NULL DEFAULT 0,
  best_label               TEXT,
  best_total_price         NUMERIC(12, 2),
  best_saving_percent      NUMERIC(6, 2),
  representative_image_url TEXT,                               -- 组内代表图（用于海报合成）
  attributes               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_promotion_groups_code ON promotion_groups (upload_id, mix_group_code);
CREATE INDEX        idx_promotion_groups_up  ON promotion_groups (upload_id);
