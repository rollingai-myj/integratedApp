-- =============================================================================
-- V032__poster_image_model_corelays.sql
-- 海报生图从 OpenRouter (google/gemini-2.5-flash-image) 切到 Corelays
-- (/proxy/openai/v1, gemini-3.1-pro-preview)。
--
-- 只覆盖原始默认值;若管理员已通过 PUT /admin/settings/image-model 手改过模型,
-- 保留管理员选择。
-- =============================================================================

UPDATE sys_settings
   SET value = 'gemini-3.1-pro-preview',
       updated_at = now()
 WHERE key = 'poster_image_model'
   AND value = 'google/gemini-2.5-flash-image';
