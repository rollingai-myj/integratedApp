-- V015 seed 的 image_model 写的就是 google/gemini-3.1-flash-image-preview，
-- 这条迁移是兜底：万一手动改成过别的值，再统一规范回来。
-- nano-banana 系列里 OpenRouter 当前两个可用别名：
--   google/gemini-3.1-flash-image-preview  ← 文生图/图编辑，默认
--   google/gemini-2.5-flash-image          ← 旧一代，备用
-- 注意 google/gemini-2.5-flash-image-preview 是不存在的别名，写错了会 404。

UPDATE app_settings
   SET value = 'google/gemini-3.1-flash-image-preview',
       updated_at = now()
 WHERE key = 'image_model'
   AND value <> 'google/gemini-3.1-flash-image-preview';
