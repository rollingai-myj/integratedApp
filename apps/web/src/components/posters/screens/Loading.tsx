import * as React from 'react';
import { TOKENS } from '../tokens';
import { Icon } from '../icons';
import { PrimaryBtn, GhostBtn } from '../ui';

export function ScreenLoading({ accent, ready = true, error = null, onDone, onRetry }: {
  accent: string;
  ready?: boolean;
  error?: string | null;
  onDone: () => void;
  onRetry: () => void;
}) {
  const [progress, setProgress] = React.useState(0);
  const [stageIdx, setStageIdx] = React.useState(0);
  const readyRef = React.useRef(ready);
  React.useEffect(() => { readyRef.current = ready; }, [ready]);

  const stages = [
    { t: '正在分析您的商品照片…', emoji: '📷' },
    { t: '正在理解参考风格…',     emoji: '🎨' },
    { t: '正在排版促销文案…',     emoji: '🏷️' },
    { t: 'AI 正在生成海报…',      emoji: '✨' },
    { t: '马上就好…',             emoji: '🎉' },
  ];

  React.useEffect(() => {
    if (error) return;
    const minDuration = 27000; // ~1-2 min, slower progress
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const cap = readyRef.current ? 100 : 92;
      const target = Math.min(cap, (elapsed / minDuration) * 100);
      setProgress(target);
      setStageIdx(Math.min(stages.length - 1, Math.floor((target / 100) * stages.length)));
      if (target >= 100) {
        clearInterval(tick);
        setTimeout(onDone, 320);
      }
    }, 80);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  if (error) {
    return (
      <div style={{
        position: 'absolute', inset: 0,
        background: TOKENS.bg,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '40px 32px',
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: 40, background: TOKENS.redSoft,
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24,
          fontSize: 40,
        }}>😣</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: TOKENS.ink, marginBottom: 10 }}>
          生成失败了
        </div>
        <div style={{
          fontSize: 13, color: TOKENS.inkSoft, textAlign: 'center', marginBottom: 32,
          padding: '0 12px', wordBreak: 'break-word',
        }}>{error}</div>
        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          <GhostBtn accent={accent} onClick={onDone} style={{ flex: 1 }}>返回</GhostBtn>
          <PrimaryBtn accent={accent} onClick={onRetry} style={{ flex: 1.4 }}>重试</PrimaryBtn>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: `linear-gradient(180deg, ${TOKENS.bg} 0%, ${TOKENS.redSoft} 100%)`,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <FloatingEmojis />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 32px 16px', position: 'relative', zIndex: 2 }}>
        <div style={{
          width: 200, height: 240, position: 'relative', marginBottom: 40,
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            background: `linear-gradient(135deg, ${accent}, ${TOKENS.redDark})`,
            borderRadius: 18,
            boxShadow: `0 20px 50px ${accent}40`,
            overflow: 'hidden',
            animation: 'gentleFloat 3s ease-in-out infinite',
          }}>
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.4) 50%, transparent 70%)',
              animation: 'shimmer 2s linear infinite',
            }}/>
          </div>
          <div style={{ position: 'absolute', top: -16, right: -10, animation: 'twinkle 1.4s ease-in-out infinite' }}>
            <Icon.Sparkles size={36} color={TOKENS.yellow} />
          </div>
          <div style={{ position: 'absolute', bottom: -8, left: -14, animation: 'twinkle 1.4s ease-in-out infinite 0.7s' }}>
            <Icon.Sparkles size={24} color={accent} />
          </div>
        </div>

        <div style={{ fontSize: 22, fontWeight: 800, color: TOKENS.ink, marginBottom: 8, textAlign: 'center' }}>
          海报生成中
        </div>
        <div style={{
          fontSize: 14, color: TOKENS.inkSoft, textAlign: 'center', minHeight: 22,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 16 }}>{stages[stageIdx].emoji}</span>
          <span key={stageIdx} style={{ animation: 'fadeStage 0.4s ease both' }}>{stages[stageIdx].t}</span>
        </div>
      </div>

      <div style={{ padding: '0 32px 56px', position: 'relative', zIndex: 2 }}>
        <div style={{
          background: '#fff', borderRadius: 16, padding: '14px 16px',
          boxShadow: TOKENS.shadow1, marginBottom: 24,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8,
          }}>
            <span style={{ fontSize: 12, color: TOKENS.inkSoft, fontWeight: 500 }}>生成进度</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: accent }}>
              {Math.floor(progress)}%
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${progress}%`,
              background: `linear-gradient(90deg, ${accent}, ${TOKENS.redDark})`,
              borderRadius: 3, transition: 'width 0.2s ease',
            }}/>
          </div>
        </div>

        <div style={{ fontSize: 12, color: TOKENS.inkMuted, textAlign: 'center', lineHeight: 1.6 }}>
          💡 AI 作图约需要 1-2 分钟<br/>稍等一会就好
        </div>
      </div>

      <style>{`
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @keyframes gentleFloat { 0%, 100% { transform: translateY(0) rotate(-1deg); } 50% { transform: translateY(-10px) rotate(1deg); } }
        @keyframes twinkle { 0%, 100% { transform: scale(1); opacity: 0.85; } 50% { transform: scale(1.2); opacity: 1; } }
        @keyframes fadeStage { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes drift {
          0% { transform: translateY(110vh) translateX(0); opacity: 0; }
          10% { opacity: 0.6; } 90% { opacity: 0.6; }
          100% { transform: translateY(-20vh) translateX(20px); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function FloatingEmojis() {
  const items = ['🥤','🍪','🍜','🥛','🍫','🧃','🍙','🍡'];
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {items.map((e, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${(i * 13 + 5) % 90}%`,
          fontSize: 22 + (i % 3) * 4,
          opacity: 0.35,
          animation: `drift ${10 + (i % 5) * 2}s linear infinite ${i * 0.8}s`,
        }}>{e}</div>
      ))}
    </div>
  );
}
