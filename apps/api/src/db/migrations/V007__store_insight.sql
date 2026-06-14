-- =============================================================================
-- V007__store_insight.sql
-- S2 门店环境洞察：store_insights / store_survey_questions / store_survey_answers /
--                  store_competitors / store_competitor_products /
--                  store_competitor_price_snapshots
-- =============================================================================

CREATE TABLE store_insights (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id              UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
  city                  TEXT,
  main_demographic      TEXT,
  consumption_level     TEXT,
  population_density    TEXT,
  category              TEXT,
  crowd_source_analysis TEXT,
  competitor_analysis   TEXT,
  top_competitors       JSONB NOT NULL DEFAULT '[]',
  report_markdown       TEXT,
  insight_data          JSONB NOT NULL DEFAULT '{}',
  generated_at          TIMESTAMPTZ,
  generated_by          UUID REFERENCES users(id),
  source                TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE store_insights IS '门店周边商圈报告（AI 生成；竞对数量直接 COUNT store_competitors，不存冗余列）';

CREATE TABLE store_survey_questions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  scene         SMALLINT REFERENCES hq_categories(scene),  -- 空=全店问卷；非空=场景问卷（聊一聊）
  question_no   SMALLINT NOT NULL,
  question_text TEXT NOT NULL,
  question_kind TEXT NOT NULL DEFAULT 'multi'
                  CHECK (question_kind IN ('single', 'multi', 'text')),
  options       JSONB NOT NULL DEFAULT '[]',
  source        TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'manual')),
  generated_at  TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (store_id, scene, question_no)
);

COMMENT ON TABLE store_survey_questions IS 'AI 出给店长的调研问题（聊一聊）；scene 空 = 全店问卷';

CREATE TABLE store_survey_answers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  UUID NOT NULL REFERENCES store_survey_questions(id) ON DELETE CASCADE,
  answer_value JSONB NOT NULL,
  answered_by  UUID REFERENCES users(id),
  answered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX store_survey_answers_question_idx ON store_survey_answers (question_id, answered_at DESC);

COMMENT ON TABLE store_survey_answers IS '店长的回答；同题多答取最新';

CREATE TABLE store_competitors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  competitor_name TEXT NOT NULL,
  kind            competitor_kind NOT NULL DEFAULT 'offline',
  province        TEXT,
  city            TEXT,
  address         TEXT,
  distance_m      INT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  attributes      JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX store_competitors_store_idx ON store_competitors (store_id) WHERE is_active;

COMMENT ON TABLE store_competitors IS '每家门店自己的竞对店（无全局渠道概念）；同一物理竞对被两家店盯 → 各记一条不去重';

CREATE TABLE store_competitor_products (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id     UUID NOT NULL REFERENCES store_competitors(id) ON DELETE CASCADE,
  external_sku      TEXT,
  product_name      TEXT NOT NULL,
  brand             TEXT,
  spec              TEXT,
  mapped_product_id UUID REFERENCES hq_products(id),   -- 映射自家同款用于比价
  product_url       TEXT,
  image_url         TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX store_competitor_products_comp_idx ON store_competitor_products (competitor_id) WHERE is_active;

CREATE TABLE store_competitor_price_snapshots (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_product_id  UUID NOT NULL REFERENCES store_competitor_products(id) ON DELETE CASCADE,
  snapshot_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  retail_price           NUMERIC(12,2) NOT NULL,
  promo_price            NUMERIC(12,2),
  promo_text             TEXT,
  source                 TEXT NOT NULL DEFAULT 'photo'
                           CHECK (source IN ('photo', 'ocr', 'manual')),
  photo_url              TEXT,                          -- 拍照采集的证据照片
  collected_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  collected_by           UUID REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competitor_product_id, snapshot_date)         -- 同日重复采集覆盖更新
);

COMMENT ON TABLE store_competitor_price_snapshots IS '竞品价格快照（拍照/OCR/人工），与自家比价';
