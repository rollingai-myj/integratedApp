-- =============================================================================
-- V033__poster_image_model_gemini_flash.sql
-- gemini-3.1-pro-preview 在 Corelays 订阅里不存在 → 切到实际可用的
-- gemini-3.1-flash-image(走 Gemini 原生 generateContent)。
--
-- 仅在 V032 留下的 'gemini-3.1-pro-preview' 上切换;管理员手改过的值保留。
-- =============================================================================

UPDATE sys_settings
   SET value = 'gemini-3.1-flash-image',
       updated_at = now()
 WHERE key = 'poster_image_model'
   AND value = 'gemini-3.1-pro-preview';
