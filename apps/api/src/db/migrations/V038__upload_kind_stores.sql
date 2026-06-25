-- =============================================================================
-- V038__upload_kind_stores.sql
-- upload_kind enum 增加 'stores'(配合 admin 上传页"门店信息"入口)
-- =============================================================================

ALTER TYPE upload_kind ADD VALUE IF NOT EXISTS 'stores';
