/**
 * 选品 · 聊一聊
 *
 * 设计稿：5 轮左右的对话式问答；每店每场景只做一次，回答永久保存。
 *
 * 数据链路（按用户要求："实际调用 Dify 出题 + 落库"）：
 *  1. 进入页面先 GET /insights/surveys/questions?scene=N
 *     - 有题 + 全部已答 → 不该路由到本页（WorkspacePage 用 qaDone 判断），
 *       兜底直接跳工作台
 *     - 有题但未答完 → 沿用已有题继续作答（"续作"场景）
 *  2. 无题 → POST /insights/surveys/questions/ai?scene=N 触发 Dify questions 工作流，
 *     readWorkflowFinished 收到 workflow_finished 后 extractQuestions 归一化，
 *     PUT /insights/surveys/questions?scene=N&source=ai 落库
 *  3. 用户逐题作答（单选/多选/其他自输）→ 全部答完后 PUT /insights/surveys/answers
 *     落到 store_survey_answers；同时 invalidate scenes/overview 让 qaDone 变 true
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppBar, PrimaryBtn, ScreenWrap, Spin } from '../ui/primitives';
import { TOKENS } from '../ui/tokens';
import { I } from '../ui/icons';
import { insightsApi, scenesApi, type SurveyQuestion } from '../api';
import { readWorkflowFinished, extractQuestions, type QaQuestion } from '../sse';

interface Msg { role: 'bot' | 'user'; text: string }

/** SurveyQuestion → QaQuestion（统一交互结构） */
function toQa(q: SurveyQuestion): QaQuestion {
  return {
    questionText: q.questionText,
    multi: q.questionKind === 'multi',
    options: (q.options ?? []).map((x) => String(x)),
  };
}

export function QAPage() {
  const { scene: sceneStr } = useParams({ from: '/shelves/scene/$scene/qa' });
  const scene = Number(sceneStr);
  const navigate = useNavigate();
  const qc = useQueryClient();

  // 1. 拉历史题
  const historyQ = useQuery({
    queryKey: ['scenes', scene, 'survey', 'questions'],
    queryFn: () => insightsApi.questions(scene),
  });

  // 顶部标题用「{场景名}选品调改」；scenes list 已被 HomePage 缓存，命中 RQ cache
  const scenesQ = useQuery({ queryKey: ['scenes', 'list'], queryFn: scenesApi.list });
  const sceneName = scenesQ.data?.scenes.find((s) => s.scene === scene)?.name ?? '';

  // 2. 历史无题 → 调 AI 出题 + 落库
  //    AbortController：QAPage unmount 时取消流式调用，防止"用户退出后 mutation 仍在跑、
  //    回来时与新一次 mutation race 卡住加载"。
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const genMutation = useMutation({
    mutationFn: async (): Promise<QaQuestion[]> => {
      abortRef.current = new AbortController();
      const resp = await insightsApi.streamQuestions(scene, abortRef.current.signal);
      const outputs = await readWorkflowFinished(resp);
      const qs = extractQuestions(outputs);
      if (qs.length === 0) throw new Error('AI 未返回有效题目');
      // 落库
      const persistRes = await insightsApi.replaceQuestions(
        scene,
        qs.map((q) => ({
          questionText: q.questionText,
          questionKind: q.multi ? 'multi' : 'single',
          options: q.options,
        })),
        'ai',
      );
      void qc.invalidateQueries({ queryKey: ['scenes', scene, 'survey', 'questions'] });
      return persistRes.questions.map(toQa);
    },
  });

  // 拼出"最终展示题目"：优先用 mutation 刚生成的，没有就用历史
  const questions: QaQuestion[] =
    genMutation.data ??
    (historyQ.data?.questions.length ? historyQ.data.questions.map(toQa) : []);

  // 历史为空 + 没在 background refetch + 未在生成中 → 自动触发一次生成
  // `!historyQ.isFetching` 是关键：避免 cache 命中但 refetch 还在跑时基于陈旧的空数组
  // 误触发二次 mutation；等 refetch 完成后再判断。
  const needGenerate =
    historyQ.isSuccess &&
    !historyQ.isFetching &&
    historyQ.data!.questions.length === 0 &&
    !genMutation.isPending &&
    !genMutation.isSuccess &&
    !genMutation.isError;

  useEffect(() => {
    if (needGenerate) genMutation.mutate();
  }, [needGenerate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 对话流转 ----------------------------------------------------------

  const [messages, setMessages] = useState<Msg[]>([]);
  const [round, setRound] = useState(-1);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState('');
  const [finished, setFinished] = useState(false);
  const [answers, setAnswers] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // 之前用 useRef 守卫，重新进入页面后偶发"卡在三个点"。改用 useState 让守卫与
  // 组件生命周期严格对齐：每次 mount 都重置为 false，effect dep 包含它本身，
  // 确保"只启动一次"语义在任何重入场景下都成立。
  const [conversationStarted, setConversationStarted] = useState(false);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  // 题目就绪后才启动对话
  useEffect(() => {
    if (conversationStarted || questions.length === 0 || finished) return;
    setConversationStarted(true);
    setTyping(true);
    timers.current.push(setTimeout(() => {
      setTyping(false);
      setMessages([{
        role: 'bot',
        text: '在调改之前，能否和您聊几句，以了解门店的情况？',
      }]);
      timers.current.push(setTimeout(() => askRound(0), 800));
    }, 500));
  }, [conversationStarted, questions.length, finished]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing, round, finished]);

  const askRound = (i: number) => {
    setTyping(true);
    timers.current.push(setTimeout(() => {
      const q = questions[i];
      if (!q) { setTyping(false); return; }   // 题目在 timer 触发瞬间被清空时安全降级
      setMessages((m) => [...m, { role: 'bot', text: q.questionText }]);
      setRound(i);
      setTyping(false);
    }, 600));
  };

  const cur = round >= 0 ? questions[round] : null;
  const isSelected = (opt: string) => input.split('、').map((s) => s.trim()).includes(opt);
  const toggleOption = (opt: string) => {
    if (!cur) return;
    if (isSelected(opt)) {
      setInput((v) => v.split('、').map((s) => s.trim()).filter((s) => s !== opt && s !== '').join('、'));
    } else if (!cur.multi) {
      setInput(opt);
    } else {
      setInput((v) => v.trim() ? `${v}、${opt}` : opt);
    }
  };

  // 3. 答完 → 一次性提交答案
  const submitMutation = useMutation({
    mutationFn: async (finalAnswers: string[]) => {
      const list = historyQ.data?.questions ?? [];
      if (list.length === 0) throw new Error('题目尚未落库');
      const body = list
        .slice()
        .sort((a, b) => a.questionNo - b.questionNo)
        .slice(0, finalAnswers.length)
        .map((q, idx) => ({ questionId: q.id, value: finalAnswers[idx] }));
      await insightsApi.submitAnswers(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scenes', 'overview'] });
      void qc.invalidateQueries({ queryKey: ['scenes', scene, 'survey', 'questions'] });
    },
  });

  const send = () => {
    const text = input.trim();
    if (!text || round < 0 || finished) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    const nextAnswers = [...answers, text];
    setAnswers(nextAnswers);
    setInput('');
    if (round + 1 < questions.length) {
      askRound(round + 1);
    } else {
      setTyping(true);
      timers.current.push(setTimeout(() => {
        setTyping(false);
        setMessages((m) => [...m, {
          role: 'bot',
          text: '好了，情况我都记下了！之后每次拍照调改，AI 都会参考这些回答，不用再填一遍。',
        }]);
        setFinished(true);
        submitMutation.mutate(nextAnswers);
      }, 600));
    }
  };

  const finish = (goFlow: boolean) => {
    if (goFlow) void navigate({ to: '/shelves/scene/$scene/flow', params: { scene: sceneStr } });
    else void navigate({ to: '/shelves/scene/$scene', params: { scene: sceneStr } });
  };

  const canType = round >= 0 && !finished && questions.length > 0;

  // ---- 渲染 -------------------------------------------------------------

  return (
    <ScreenWrap>
      <AppBar title={sceneName ? `${sceneName}选品调改` : '选品调改'} onBack={() => finish(false)} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* 出题阶段的占位 */}
          {historyQ.isPending && (
            <BotBubble>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Spin size={14} /> 准备问题…
              </span>
            </BotBubble>
          )}
          {genMutation.isPending && (
            <BotBubble>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Spin size={14} /> 请稍后，正在洞察门店周边环境
              </span>
            </BotBubble>
          )}
          {genMutation.isError && (
            <BotBubble>
              <div style={{ color: TOKENS.red, fontSize: 13 }}>
                问题生成失败：{(genMutation.error as Error).message}
              </div>
              <button onClick={() => genMutation.mutate()} style={{
                appearance: 'none', border: 0, marginTop: 8, padding: '6px 12px',
                background: TOKENS.redSoft, color: TOKENS.red, borderRadius: 14,
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>重试</button>
            </BotBubble>
          )}

          {/* 对话消息 */}
          {messages.map((m, i) => (
            <div key={i} style={{
              display: 'flex', gap: 8,
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              animation: 'shv-fadein 0.25s ease',
            }}>
              {m.role === 'bot' && (
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                  background: `linear-gradient(135deg, ${TOKENS.red}, ${TOKENS.redDark})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{I.Sparkles({ size: 17, color: '#fff' })}</div>
              )}
              <div style={{
                maxWidth: '76%', padding: '10px 13px', fontSize: 14, lineHeight: 1.65,
                background: m.role === 'user' ? TOKENS.red : '#fff',
                color: m.role === 'user' ? '#fff' : TOKENS.ink,
                borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
                boxShadow: TOKENS.shadow1,
              }}>{m.text}</div>
            </div>
          ))}

          {typing && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: `linear-gradient(135deg, ${TOKENS.red}, ${TOKENS.redDark})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{I.Sparkles({ size: 17, color: '#fff' })}</div>
              <div style={{
                padding: '13px 15px', background: '#fff', borderRadius: '4px 16px 16px 16px',
                boxShadow: TOKENS.shadow1, display: 'flex', gap: 4,
              }}>
                {[0, 1, 2].map((d) => (
                  <span key={d} style={{
                    width: 6, height: 6, borderRadius: '50%', background: TOKENS.inkMuted,
                    animation: `shv-dot 1.1s ${d * 0.18}s infinite`,
                  }} />
                ))}
              </div>
            </div>
          )}

          {canType && !typing && cur && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingLeft: 40, animation: 'shv-fadein 0.3s ease' }}>
              {cur.options.map((opt) => {
                const sel = isSelected(opt);
                return (
                  <button key={opt} onClick={() => toggleOption(opt)} style={{
                    appearance: 'none', fontFamily: 'inherit', cursor: 'pointer',
                    padding: '9px 14px', borderRadius: 18, fontSize: 13.5, fontWeight: 600,
                    border: sel ? `1.5px solid ${TOKENS.red}` : `1.5px solid ${TOKENS.line}`,
                    background: sel ? TOKENS.redSoft : '#fff',
                    color: sel ? TOKENS.red : TOKENS.inkSoft,
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                    {sel && I.Check({ size: 13, color: TOKENS.red })}
                    {opt}
                  </button>
                );
              })}
              <button onClick={() => inputRef.current?.focus()} style={{
                appearance: 'none', fontFamily: 'inherit', cursor: 'pointer',
                padding: '9px 14px', borderRadius: 18, fontSize: 13.5, fontWeight: 600,
                border: `1.5px dashed ${TOKENS.inkMuted}66`, background: 'transparent', color: TOKENS.inkMuted,
              }}>其他，自己输入</button>
            </div>
          )}

          {finished && (
            <div style={{ paddingLeft: 40, paddingTop: 4, animation: 'shv-fadein 0.3s ease' }}>
              {submitMutation.isPending ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: TOKENS.inkMuted, fontSize: 13 }}>
                  <Spin size={14} /> 正在保存…
                </div>
              ) : submitMutation.isError ? (
                <div style={{ color: TOKENS.red, fontSize: 13 }}>保存失败，请稍后重试</div>
              ) : (
                <>
                  <PrimaryBtn onClick={() => finish(true)} icon={I.Camera({ size: 20, color: '#fff' })} style={{ height: 50 }}>
                    现在就拍照调改
                  </PrimaryBtn>
                  <button onClick={() => finish(false)} style={{
                    appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer',
                    width: '100%', marginTop: 10, padding: 6,
                    fontSize: 13, color: TOKENS.inkMuted, textDecoration: 'underline',
                  }}>先不拍，回工作台</button>
                </>
              )}
            </div>
          )}
        </div>

        <div style={{
          flexShrink: 0, padding: '10px 12px calc(env(safe-area-inset-bottom, 0px) + 12px)',
          background: '#fff', borderTop: `1px solid ${TOKENS.lineSoft}`,
          display: 'flex', alignItems: 'flex-end', gap: 8,
        }}>
          <textarea
            ref={inputRef}
            value={input}
            disabled={!canType}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={canType ? '点上面的选项，或在这里输入…' : ' '}
            rows={1}
            style={{
              flex: 1, resize: 'none', minHeight: 44, maxHeight: 96, boxSizing: 'border-box',
              border: `1.5px solid ${TOKENS.line}`, borderRadius: 22, padding: '11px 15px',
              fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5, color: TOKENS.ink,
              background: TOKENS.bg, outline: 'none',
            }}
          />
          <button onClick={send} aria-label="发送" disabled={!input.trim() || !canType} style={{
            appearance: 'none', border: 0, flexShrink: 0,
            width: 44, height: 44, borderRadius: '50%',
            background: input.trim() && canType ? TOKENS.red : '#ddd6cc',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: input.trim() && canType ? 'pointer' : 'not-allowed',
            boxShadow: input.trim() && canType ? `0 4px 12px ${TOKENS.red}40` : 'none',
          }}>{I.Send({ size: 20, color: '#fff' })}</button>
        </div>
      </div>
    </ScreenWrap>
  );
}

function BotBubble({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%', flexShrink: 0, marginTop: 2,
        background: `linear-gradient(135deg, ${TOKENS.red}, ${TOKENS.redDark})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{I.Sparkles({ size: 17, color: '#fff' })}</div>
      <div style={{
        maxWidth: '76%', padding: '10px 13px', fontSize: 14, lineHeight: 1.65,
        background: '#fff', color: TOKENS.ink,
        borderRadius: '4px 16px 16px 16px', boxShadow: TOKENS.shadow1,
      }}>{children}</div>
    </div>
  );
}
