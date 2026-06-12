-- 龙虾长期记忆:跨会话沉淀的事实(店长偏好/经营决定/门店特征)
--
-- 写入:每轮对话结束后,由 LLM 从对话中提炼(见 lobster.service.ts
--       extractMemories),自动去重;过时的记忆由提炼器主动删除。
-- 读取:每次新对话开始,按 store 维度取最近 N 条注入系统提示词。
--
-- 作用域选 store 而非 user:经营决定("五连包暂停补货")属于门店,
-- 换店长接班也应该继承;user_id 仅作溯源。

CREATE TABLE lobster_memory (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                 UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id                  UUID REFERENCES users(id) ON DELETE SET NULL,
  kind                     TEXT NOT NULL CHECK (kind IN ('preference', 'decision', 'fact')),
  content                  TEXT NOT NULL,
  source_conversation_id   UUID REFERENCES lobster_conversations(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lobster_memory_store ON lobster_memory (store_id, created_at DESC);
