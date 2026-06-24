-- =============================================================================
-- V035__poster_favorites.sql
-- 海报收藏：用户主动收藏的 generation（区别于「生成记录」= 全部 task 流水）
--
-- 起因：
--   旧设计「保存到历史」(sessionHistory localStorage) 把"留住一组海报"的能力
--   绑死在浏览器上 —— 关 tab / 换设备就丢。改后端表后语义对齐：
--     生成记录 = 后端 store_poster_tasks 全量（近 30 天，自动）
--     收藏     = 用户挑出来的 generation（永久，跨端）
--   旧 sessionHistory / recent localStorage 配套删除。
-- =============================================================================

CREATE TABLE store_poster_favorites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation_id UUID NOT NULL REFERENCES store_poster_generations(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, generation_id)
);

CREATE INDEX store_poster_favorites_user_idx
  ON store_poster_favorites (user_id, created_at DESC);

COMMENT ON TABLE store_poster_favorites IS
  '用户海报收藏：主动收藏的 generation。生成记录是自动的（store_poster_tasks 全量），收藏是用户挑出来的。';
