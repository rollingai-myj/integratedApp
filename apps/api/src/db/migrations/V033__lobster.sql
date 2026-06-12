-- =============================================================================
-- V033__lobster.sql
-- 域:美宜佳龙虾(门店 AI 对话助手,实验模块)
--
-- 设计:
--   - lobster_conversations  一次连续聊天(按 user + store 隔离)
--   - lobster_messages       消息流水;content 用 JSONB 存(文本/工具调用/工具结果),
--                            回放与续聊都从这里取
--   - last_photo_data_url    店长最近一次上传的照片(data URL)。海报技能生成时引用;
--                            不进模型历史(避免每轮重发几 MB),只在上传当轮给模型看一次
--   - app_settings.lobster_model  对话模型(OpenRouter slug),后台可切换,与海报
--                            image_model 同范式
-- =============================================================================

CREATE TABLE lobster_conversations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  store_id             UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title                TEXT,                          -- 首条用户消息截断生成
  last_photo_data_url  TEXT,                          -- 最近上传照片(data URL,可能几 MB)
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lobster_conv_user_store
  ON lobster_conversations (user_id, store_id, updated_at DESC);

CREATE TABLE lobster_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES lobster_conversations(id) ON DELETE CASCADE,
  -- 'user' / 'assistant' / 'tool_call' / 'tool_result'
  -- (tool_* 两类只用于续聊时还原上下文,前端历史回放只取 user/assistant)
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool_call', 'tool_result')),
  -- user:        {"text": "...", "hasPhoto": true?}
  -- assistant:   {"text": "...", "posterUrl": "..."?}
  -- tool_call:   {"calls": [{"id","name","arguments"}]}
  -- tool_result: {"toolCallId": "...", "name": "...", "result": "..."}
  content          JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lobster_msg_conv ON lobster_messages (conversation_id, created_at);

-- 对话模型配置(与 image_model 同范式,后台可改)
INSERT INTO app_settings (key, value, value_type, description, category)
VALUES ('lobster_model', 'anthropic/claude-sonnet-4.6', 'string',
        '美宜佳龙虾对话模型(OpenRouter slug)', 'ai')
ON CONFLICT (key) DO NOTHING;
