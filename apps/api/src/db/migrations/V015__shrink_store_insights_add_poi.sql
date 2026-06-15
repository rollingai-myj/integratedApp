-- =============================================================================
-- V015__shrink_store_insights_add_poi.sql
-- 精简 store_insights：仅保留 AI 工作流当前真实输出的 4 个字段
--   (category / crowd_source_analysis / competitor_analysis / top_competitors)
-- 新增 poi_data JSONB：缓存高德 POI 检索结果，店级一次性获取后复用
--
-- 删除的列均为「Dify 已不再输出」+「前端无任何引用」（grep 已确认）
-- =============================================================================

ALTER TABLE store_insights
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS main_demographic,
  DROP COLUMN IF EXISTS consumption_level,
  DROP COLUMN IF EXISTS population_density,
  DROP COLUMN IF EXISTS report_markdown,
  DROP COLUMN IF EXISTS insight_data,
  DROP COLUMN IF EXISTS generated_at,
  DROP COLUMN IF EXISTS generated_by,
  DROP COLUMN IF EXISTS source;

ALTER TABLE store_insights
  ADD COLUMN IF NOT EXISTS poi_data JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN store_insights.poi_data IS
  '高德 POI 检索原始结果缓存：{ competitor: AmapPoi[], crowdSource: AmapPoi[], fetchedAt: ISO }；店级一次性获取，问卷/洞察工作流都从此读，不再每次现调高德';
