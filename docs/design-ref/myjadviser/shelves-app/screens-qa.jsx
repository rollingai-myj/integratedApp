// 问答环节 —— 登记货架之后只做一次，不是每次调改的流程
// 聊天框形式，4–5 轮；选项点选进发送框，再点取消；支持手输与语音

function ChatQA({ scene, onDone, onLater }) {
  const [messages, setMessages] = React.useState([]);   // {role, text}
  const [round, setRound] = React.useState(-1);          // 当前提问轮次
  const [typing, setTyping] = React.useState(true);
  const [input, setInput] = React.useState('');
  const [recording, setRecording] = React.useState(false);
  const [finished, setFinished] = React.useState(false);
  const listRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const timers = React.useRef([]);

  React.useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // 开场：欢迎语 + 第一问
  React.useEffect(() => {
    timers.current.push(setTimeout(() => {
      setMessages([{ role: 'bot', text: `你好！我是选品助手。开始前先聊几句「${scene.name}」货架的情况，只需要这一次。` }]);
      timers.current.push(setTimeout(() => askRound(0), 900));
    }, 600));
  }, []);

  const askRound = (i) => {
    setTyping(true);
    timers.current.push(setTimeout(() => {
      setMessages((m) => [...m, { role: 'bot', text: QA_ROUNDS[i].q }]);
      setRound(i);
      setTyping(false);
    }, 700));
  };

  // 自动滚到底
  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing, round, finished, recording]);

  const cur = round >= 0 ? QA_ROUNDS[round] : null;

  // ---------- 选项点选：进发送框 / 再点取消 ----------
  const isSelected = (opt) => input.includes(opt);
  const toggleOption = (opt) => {
    if (!cur) return;
    if (isSelected(opt)) {
      // 取消：从发送框移除该选项文字
      setInput((v) => v
        .split('、').map((s) => s.trim()).filter((s) => s !== opt && s !== '')
        .join('、'));
    } else if (!cur.multi) {
      setInput(opt); // 单选：直接替换
    } else {
      setInput((v) => (v.trim() ? `${v}、${opt}` : opt));
    }
  };

  // ---------- 语音输入（原型模拟：识别 1.8 秒后填入文字） ----------
  const startVoice = () => {
    if (recording || finished || round < 0) return;
    setRecording(true);
    timers.current.push(setTimeout(() => {
      setRecording(false);
      const t = cur ? cur.voice : '';
      setInput((v) => (v.trim() ? `${v}、${t}` : t));
    }, 1800));
  };

  // ---------- 发送 ----------
  const send = () => {
    const text = input.trim();
    if (!text || round < 0 || finished) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    setInput('');
    if (round + 1 < QA_ROUNDS.length) {
      askRound(round + 1);
    } else {
      setTyping(true);
      timers.current.push(setTimeout(() => {
        setTyping(false);
        setMessages((m) => [...m, { role: 'bot', text: '好了，情况我都记下了！之后每次拍照调改，AI 都会参考这些回答，不用再填一遍。' }]);
        setFinished(true);
      }, 800));
    }
  };

  const canType = round >= 0 && !finished;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 消息区 */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex', gap: 8,
            justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
            animation: 'shv-fadein 0.25s ease',
          }} onAnimationEnd={clearAnim}>
            {m.role === 'bot' && (
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                background: `linear-gradient(135deg, ${TOKENS.red}, ${TOKENS.redDark})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><I.Sparkles size={17} color="#fff" /></div>
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

        {/* 输入中… */}
        {typing && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: `linear-gradient(135deg, ${TOKENS.red}, ${TOKENS.redDark})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><I.Sparkles size={17} color="#fff" /></div>
            <div style={{
              padding: '13px 15px', background: '#fff', borderRadius: '4px 16px 16px 16px',
              boxShadow: TOKENS.shadow1, display: 'flex', gap: 4,
            }}>
              {[0, 1, 2].map((d) => (
                <span key={d} style={{
                  width: 6, height: 6, borderRadius: '50%', background: TOKENS.inkMuted,
                  animation: `shv-dot 1.1s ${d * 0.18}s infinite`,
                }}></span>
              ))}
            </div>
          </div>
        )}

        {/* 当前问题的选项（点选进发送框，再点取消） */}
        {canType && !typing && cur && (
          <div onAnimationEnd={clearAnim} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingLeft: 40, animation: 'shv-fadein 0.3s ease' }}>
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
                  transition: 'all 0.12s',
                }}>
                  {sel && <I.Check size={13} color={TOKENS.red} />}
                  {opt}
                </button>
              );
            })}
            <button onClick={() => inputRef.current && inputRef.current.focus()} style={{
              appearance: 'none', fontFamily: 'inherit', cursor: 'pointer',
              padding: '9px 14px', borderRadius: 18, fontSize: 13.5, fontWeight: 600,
              border: `1.5px dashed ${TOKENS.inkMuted}66`, background: 'transparent', color: TOKENS.inkMuted,
            }}>其他，自己输入</button>
          </div>
        )}

        {/* 问答完成 → 去拍照 / 先回工作台 */}
        {finished && (
          <div onAnimationEnd={clearAnim} style={{ paddingLeft: 40, paddingTop: 4, animation: 'shv-fadein 0.3s ease' }}>
            <PrimaryBtn onClick={onDone} icon={<I.Camera size={20} color="#fff" />} style={{ height: 50 }}>
              现在就拍照调改
            </PrimaryBtn>
            {onLater && (
              <button onClick={onLater} style={{
                appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer',
                width: '100%', marginTop: 10, padding: 6,
                fontSize: 13, color: TOKENS.inkMuted, textDecoration: 'underline',
              }}>先不拍，回工作台</button>
            )}
          </div>
        )}
      </div>

      {/* 发送框 */}
      <div style={{
        flexShrink: 0, padding: '10px 12px calc(env(safe-area-inset-bottom, 0px) + 12px)',
        background: '#fff', borderTop: `1px solid ${TOKENS.lineSoft}`,
        display: 'flex', alignItems: 'flex-end', gap: 8,
      }}>
        {recording ? (
          <div style={{
            flex: 1, height: 44, borderRadius: 22, background: TOKENS.redSoft,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
          }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: TOKENS.red, animation: 'shv-pulse 0.9s infinite' }}></span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: TOKENS.red }}>正在听你说…</span>
          </div>
        ) : (
          <React.Fragment>
            <button onClick={startVoice} aria-label="语音输入" disabled={!canType} style={{
              appearance: 'none', border: `1.5px solid ${TOKENS.line}`, background: '#fff',
              width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: canType ? 'pointer' : 'not-allowed', opacity: canType ? 1 : 0.4,
            }}><I.Mic size={21} color={TOKENS.inkSoft} /></button>
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
            ></textarea>
          </React.Fragment>
        )}
        <button onClick={send} aria-label="发送" disabled={!input.trim() || !canType} style={{
          appearance: 'none', border: 0, flexShrink: 0,
          width: 44, height: 44, borderRadius: '50%',
          background: input.trim() && canType ? TOKENS.red : '#ddd6cc',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: input.trim() && canType ? 'pointer' : 'not-allowed',
          boxShadow: input.trim() && canType ? `0 4px 12px ${TOKENS.red}40` : 'none',
          transition: 'background 0.15s',
        }}><I.Send size={20} color="#fff" /></button>
      </div>
    </div>
  );
}

Object.assign(window, { ChatQA, QAScreen });

// 独立的「聊一聊」页：登记货架后自动进入；老场景首次调改前补做
function QAScreen({ app, nav, sceneId }) {
  const scene = SCENES[sceneId];
  const finish = (goFlow) => {
    app.patchScene(sceneId, { qaDone: true });
    if (goFlow) nav.replace({ name: 'flow', sceneId });
    else nav.pop();
  };
  return (
    <div style={{ position: 'absolute', inset: 0, background: TOKENS.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppBar title="聊一聊" subtitle={`${scene.emoji} ${scene.name} · 只需要这一次`} onBack={() => nav.pop()} />
      <ChatQA scene={scene} onDone={() => finish(true)} onLater={() => finish(false)} />
    </div>
  );
}
Object.assign(window, { QAScreen });
