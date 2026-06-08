-- =============================================================================
-- V001__extensions.sql
-- 域：基础扩展
-- 内容：启用 pgcrypto（gen_random_uuid / crypt）、pg_trgm（模糊匹配）、unaccent（去重音搜索）
-- =============================================================================

-- pgcrypto：提供 gen_random_uuid()、crypt()、digest() 等
-- gen_random_uuid() 用作所有 UUID 主键的默认值
-- crypt() 用于 V015 初始化超管密码哈希
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pg_trgm：trigram 索引，支持商品名、门店名的模糊检索（ILIKE '%...%'）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent：去除变音符号，搭配 to_tsvector 提升中英混排检索体验（后续视图层可能用到）
CREATE EXTENSION IF NOT EXISTS unaccent;
