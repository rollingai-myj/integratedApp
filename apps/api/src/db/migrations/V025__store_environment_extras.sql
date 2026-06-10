-- =============================================================================
-- V025__store_environment_extras.sql
-- 域：基础数据 · 门店周边环境洞察
-- 起因：
--   原 skuSelection repo 的 StoreEnvironmentInsight 形态需要 6 个新字段
--   （category / crowd_source_analysis / competitor_analysis / top_competitors[] /
--    questions[] / report_markdown）。M5-PR1 时 store_environment_insights 只建了
--   city / main_demographic / consumption_level / competitor_count / population_density
--   + 兜底 insight_data JSONB —— 原 repo 业务字段无 1:1 列，被迫塞 localStorage。
--
--   现在补回数据库一类公民，让超管能跨设备审计 / 全店汇总分析这些洞察。
--
-- 字段对应：
--   category               TEXT    商圈类型（住宅区 / 商业街 / 学校 / 工业…）
--   crowd_source_analysis  TEXT    AI 生成的客群构成与消费习惯分析（长文）
--   competitor_analysis    TEXT    AI 生成的竞争格局分析（长文）
--   top_competitors        JSONB   字符串数组，前 N 名竞品名
--   questions              JSONB   InsightQuestion[]，Dify questions 工作流生成
--   report_markdown        TEXT    AI 完整报告 markdown
-- =============================================================================

ALTER TABLE store_environment_insights
  ADD COLUMN IF NOT EXISTS category                TEXT,
  ADD COLUMN IF NOT EXISTS crowd_source_analysis   TEXT,
  ADD COLUMN IF NOT EXISTS competitor_analysis     TEXT,
  ADD COLUMN IF NOT EXISTS top_competitors         JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS questions               JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS report_markdown         TEXT;

COMMENT ON COLUMN store_environment_insights.category              IS '商圈类型（住宅区 / 商业街 / 学校 / 工业 ...）';
COMMENT ON COLUMN store_environment_insights.crowd_source_analysis IS 'AI 客群分析长文';
COMMENT ON COLUMN store_environment_insights.competitor_analysis   IS 'AI 竞争格局分析长文';
COMMENT ON COLUMN store_environment_insights.top_competitors       IS '字符串数组：前 N 名竞品商家名';
COMMENT ON COLUMN store_environment_insights.questions             IS 'InsightQuestion[]：调研问卷题目（Dify 生成）';
COMMENT ON COLUMN store_environment_insights.report_markdown       IS 'AI 报告完整 markdown';
