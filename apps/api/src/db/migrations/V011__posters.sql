-- =============================================================================
-- V011__posters.sql
-- 域：海报记录 + 海报队列
--
-- 决策 D5：批次是独立实体
--   - poster_jobs.batch_id：同一次提交的多个任务共享 batch_id
--   - posters.job_id：从任务生成的海报关联到任务（单张同步生成时 job_id 为 NULL）
--
-- 决策 D6（失败任务换参重新生成 PO-D6）：通过 poster_jobs.parent_job_id 自引用
--
-- 决策 D7（业务表 + 统一审计）：本文件只建业务表，所有海报生成 / 入队 / 完成
-- 同时写一份到 audit_events（V012）。
--
-- 内容：
--   - poster_jobs   海报队列任务（批量 / 异步生成）
--   - posters       海报记录（生成成功的最终产物）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 海报队列任务
--   - 单张同步生成（PO-C1）不进队列，直接写 posters
--   - 批量入队（PO-D1）每张写一条 poster_jobs；店长端通过 PO-D2 认领并处理
--   - 重新生成（PO-D6）写一条新 job，parent_job_id 指向旧 job
-- -----------------------------------------------------------------------------
CREATE TABLE poster_jobs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 决策 D5：批次实体
  batch_id                 UUID NOT NULL,                       -- 同一次入队共享 batch_id
  parent_job_id            UUID REFERENCES poster_jobs(id) ON DELETE SET NULL,  -- PO-D6 重做时指向旧任务
  -- 归属
  user_id                  UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  store_id                 UUID REFERENCES stores(id)          ON DELETE SET NULL,
  -- 入参（来自 PO-D1）
  source_photo_url         TEXT,                                -- 拍摄照片或店内背景图
  product_image_url        TEXT,                                -- mode=official_bg_only 时的官方图
  template                 poster_template NOT NULL,            -- 模板（决策 D9 写在代码，此处只存 enum 值）
  mode                     poster_mode NOT NULL,                -- 决策 D5
  custom_style_description TEXT,                                -- mode=multi_product 或 custom 时的额外描述
  copy_text                TEXT NOT NULL,                       -- 海报文案
  sku_code                 VARCHAR(64),                         -- 关联 SKU（可选）
  category_name            TEXT,                                -- 品类
  inputs                   JSONB NOT NULL DEFAULT '{}'::jsonb,  -- 其它原始入参（PO-D1 完整 body）
  -- 处理状态机
  status                   poster_job_status NOT NULL DEFAULT 'queued',
  claim_token              TEXT,                                -- 认领令牌（PO-D2 原子认领时写入）
  claimed_at               TIMESTAMPTZ,                         -- 进入 claimed 的时间
  started_at               TIMESTAMPTZ,                         -- 进入 processing 的时间
  finished_at              TIMESTAMPTZ,                         -- 进入 succeeded / failed / canceled
  retry_count              INT NOT NULL DEFAULT 0,
  reset_count              INT NOT NULL DEFAULT 0,              -- PO-D5 卡死重置次数
  -- 结果
  poster_image_url         TEXT,                                -- 成功后的海报图地址
  ai_model                 TEXT,                                -- 实际使用的 OpenRouter 模型名
  ai_prompt                TEXT,                                -- 实际拼接的 prompt（决策 D11：关键 AI 调用落库）
  ai_response              JSONB,                               -- AI 原始返回（可选，便于排查）
  generation_ms            INT,                                 -- 耗时
  -- 错误
  error_code               TEXT,
  error_message            TEXT,
  -- 时间戳
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 队列高频查询
CREATE INDEX idx_poster_jobs_queue
  ON poster_jobs (created_at)
  WHERE status = 'queued';

CREATE INDEX idx_poster_jobs_user_recent
  ON poster_jobs (user_id, created_at DESC);

CREATE INDEX idx_poster_jobs_batch
  ON poster_jobs (batch_id);

-- 活跃任务（PO-D3 「列出我的活跃任务」）
CREATE INDEX idx_poster_jobs_active_by_user
  ON poster_jobs (user_id, status, updated_at DESC)
  WHERE status IN ('queued', 'claimed', 'processing');

-- 卡死检测（PO-D5）
CREATE INDEX idx_poster_jobs_stuck
  ON poster_jobs (status, started_at)
  WHERE status = 'processing';

CREATE INDEX idx_poster_jobs_store
  ON poster_jobs (store_id, created_at DESC) WHERE store_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 海报记录
--   - 队列模式生成成功 → job_id 指向 poster_jobs
--   - 单张同步生成 → job_id 为 NULL
--   - 用于后台「海报列表」（PO-F2）、店长「我的历史海报」、按品类做个性化推荐（PO-E4）
-- -----------------------------------------------------------------------------
CREATE TABLE posters (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 决策 D5：可选 job_id 关联到队列任务
  job_id                   UUID REFERENCES poster_jobs(id) ON DELETE SET NULL,
  -- 归属
  user_id                  UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  store_id                 UUID REFERENCES stores(id)          ON DELETE SET NULL,
  -- 入参快照（即使原始 job / promotion 被删，海报记录依然完整）
  source_photo_url         TEXT,
  product_image_url        TEXT,
  template                 poster_template NOT NULL,
  mode                     poster_mode NOT NULL,
  custom_style_description TEXT,
  copy_text                TEXT NOT NULL,
  sku_code                 VARCHAR(64),
  category_name            TEXT,                                -- 用于 PO-E4 个性化推荐统计
  -- 产物
  poster_image_url         TEXT NOT NULL,                       -- OSS 海报地址（必有）
  thumbnail_url            TEXT,                                -- 缩略图（可选）
  -- AI 信息（决策 D11：关键 AI 调用落库）
  ai_model                 TEXT,                                -- 当时使用的 OpenRouter 模型
  ai_prompt                TEXT,                                -- 实际 prompt
  generation_ms            INT,
  -- 标签 / 备注
  attributes               JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 时间戳
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_posters_user_time     ON posters (user_id, created_at DESC);
CREATE INDEX idx_posters_store_time    ON posters (store_id, created_at DESC) WHERE store_id IS NOT NULL;
CREATE INDEX idx_posters_job           ON posters (job_id) WHERE job_id IS NOT NULL;
-- 个性化推荐（PO-E4）按品类聚合最近 N 天
CREATE INDEX idx_posters_user_category ON posters (user_id, category_name, created_at DESC);
-- 按 SKU 查询某 SKU 历史海报
CREATE INDEX idx_posters_sku           ON posters (sku_code, created_at DESC) WHERE sku_code IS NOT NULL;
