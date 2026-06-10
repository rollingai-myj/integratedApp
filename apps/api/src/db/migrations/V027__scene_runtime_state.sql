-- =============================================================================
-- V027__scene_runtime_state.sql
-- 域：货盘选品 · 场景级运行时状态（独立于"货架级 shelf_runtime_state"）
-- 起因：
--   原 skuSelection repo 的 v2 流程把"场景级"的拍照草稿、检测结果、虚拟货架
--   生成状态、上一次完整调改快照都塞在 shelf_runtime_state(shelf_id TEXT)，
--   通过合成 ID "pos-{sceneId}" 索引。整合 app 的 shelf_runtime_state.shelf_id
--   是 UUID FK，装不下"pos-0"这种字符串。
--
--   原 PR #29 偷工把这层数据塞 localStorage —— 跨设备草稿丢失、超管无法回看
--   上次调改快照。本迁移把场景级 runtime 升级为独立表。
--
--   注：V024 在 shelf_runtime_state 加的 last_snapshot 列也是为这事临时补的，
--   但那张表是"货架级"语义，挂"场景级"快照在概念上错位。本迁移把 last_snapshot
--   迁到本表的对应位置，但保留 V024 的列不删 —— 删列要 cascade 业务代码改动
--   且无迁移数据需要保护（V024 列还没被任何代码读写过）。后续可单独清理。
--
-- 唯一性：(store_id, scene_position_code) 每店每场景一行（upsert 模型）。
-- =============================================================================

CREATE TABLE IF NOT EXISTS scene_runtime_state (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  scene_position_code     SMALLINT NOT NULL,                          -- 即 plan_position_mapping.position_code
  -- 拍照草稿：[{ url, matches?: DetectMatch[] }]
  photos                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- 商品识别结果（最近一次，可与 photos 分离存）
  detection_data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 虚拟货架异步任务状态：idle / processing / completed / failed
  virtual_shelf_status    TEXT NOT NULL DEFAULT 'idle',
  virtual_shelf_raw_outputs JSONB,
  virtual_shelf_context   JSONB,
  -- 上一次完整调改的快照（替代 V024 加在 shelf_runtime_state 的 last_snapshot 列）
  -- 结构：{ at, summary, photos, diagnosis, strategy, virtual_shelf_raw_outputs?, virtual_shelf_context? }
  last_snapshot           JSONB,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by              UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_scene_runtime_store_scene
  ON scene_runtime_state (store_id, scene_position_code);

CREATE INDEX IF NOT EXISTS idx_scene_runtime_store
  ON scene_runtime_state (store_id);

CREATE INDEX IF NOT EXISTS idx_scene_runtime_vs_status
  ON scene_runtime_state (virtual_shelf_status)
  WHERE virtual_shelf_status IN ('processing', 'failed');

COMMENT ON TABLE scene_runtime_state IS '场景级运行时（拍照草稿 / 检测结果 / 虚拟货架状态 / 上次快照）—— V027 新表，独立于货架级 shelf_runtime_state';
COMMENT ON COLUMN scene_runtime_state.last_snapshot IS '最近一次完成调改的快照，供 LastRecordPage 跨设备回看';
