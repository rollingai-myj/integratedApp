import * as React from 'react';
import { TOKENS } from '../tokens';
import { Icon } from '../icons';
import { PrimaryBtn } from '../ui';

export function ScreenWelcome({ accent, onDone }: { accent: string; onDone: () => void }) {
  const [step, setStep] = React.useState(0);
  const [dragX, setDragX] = React.useState(0);
  const [isDragging, setIsDragging] = React.useState(false);
  const dragRef = React.useRef<HTMLDivElement>(null);
  const pointerState = React.useRef<{
    id: number;
    startX: number;
    startY: number;
    axis: 'none' | 'x' | 'y';
    width: number;
  } | null>(null);

  const steps = [
    {
      title: '选活动',
      sub: '促销和文案都已经写好了',
      desc: '打开就能看到这周在推的活动，勾几个想做海报的，文案不用自己想',
      art: (
        <div style={{ position: 'relative', width: 220, height: 200 }}>
          {/* 三张层叠的活动卡 */}
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              position: 'absolute',
              top: 20 + i * 14, left: 30 + i * 14,
              width: 140, height: 150,
              background: '#fff', borderRadius: 14,
              boxShadow: '0 8px 22px rgba(0,0,0,0.08)',
              border: `1px solid ${TOKENS.lineSoft}`,
              padding: 14, display: 'flex', flexDirection: 'column', gap: 8,
              opacity: i === 2 ? 1 : 0.7,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: i === 2 ? accent : `${accent}55`,
              }} />
              <div style={{ height: 6, background: '#eee', borderRadius: 3, width: '85%' }} />
              <div style={{ height: 6, background: '#eee', borderRadius: 3, width: '60%' }} />
              <div style={{ marginTop: 'auto', height: 8, background: TOKENS.yellow, borderRadius: 3, width: '50%' }} />
            </div>
          ))}
          {/* 最上面那张的 ✓ 勾选标记 */}
          <div style={{
            position: 'absolute', top: 42, left: 150,
            width: 26, height: 26, borderRadius: '50%',
            background: accent, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 4px 12px ${accent}66`,
          }}>
            <Icon.Check size={16} color="#fff" />
          </div>
          <div style={{ position: 'absolute', top: 0, right: 0, color: accent }}>
            <Icon.Sparkles size={22} color={accent} />
          </div>
        </div>
      ),
    },
    {
      title: '拍商品',
      sub: '一张张拍，或只拍一次桌面都行',
      desc: '想真实就每个商品拍一张；偷懒就拍一张店里的台面，AI 自动把商品摆上去',
      art: (
        <div style={{ position: 'relative', width: 260, height: 200 }}>
          {/* 左：单张商品照 */}
          <div style={{
            position: 'absolute', left: 0, top: 20,
            width: 110, height: 140,
            background: '#fff', borderRadius: 14,
            boxShadow: '0 8px 20px rgba(0,0,0,0.08)',
            border: `2px solid ${accent}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 8,
          }}>
            <div style={{
              width: 44, height: 60, borderRadius: '8px 8px 4px 4px',
              background: `linear-gradient(180deg, #f5f0e6, #e6dcc8)`,
              borderTop: `6px solid ${accent}`,
            }} />
            <div style={{ fontSize: 10, color: TOKENS.inkSoft, fontWeight: 600 }}>一张一张拍</div>
          </div>

          {/* 中间箭头/或 */}
          <div style={{
            position: 'absolute', left: 118, top: 86,
            fontSize: 11, color: TOKENS.inkMuted, fontWeight: 700,
          }}>或</div>

          {/* 右：店内桌面 + AI 摆 */}
          <div style={{
            position: 'absolute', right: 0, top: 20,
            width: 120, height: 140,
            background: '#fff', borderRadius: 14,
            boxShadow: '0 8px 20px rgba(0,0,0,0.08)',
            border: `1px solid ${TOKENS.line}`,
            overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* 桌面背景 */}
            <div style={{
              flex: 1,
              background: `linear-gradient(180deg, #f4ede2 0%, #d9c8a8 100%)`,
              position: 'relative',
            }}>
              {/* AI 摆上去的三个商品 */}
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  position: 'absolute',
                  bottom: 14, left: 12 + i * 32,
                  width: 24, height: 36, borderRadius: '4px 4px 2px 2px',
                  background: ['#f5f0e6', '#e8d4a0', '#f5d5d5'][i],
                  borderTop: `4px solid ${accent}`,
                  boxShadow: '0 4px 8px rgba(0,0,0,0.15)',
                }} />
              ))}
              {/* sparkle */}
              <div style={{ position: 'absolute', top: 8, right: 6, color: accent }}>
                <Icon.Sparkles size={16} color={accent} />
              </div>
            </div>
            <div style={{
              padding: '4px 0', textAlign: 'center',
              fontSize: 10, color: TOKENS.inkSoft, fontWeight: 600,
              background: '#fff',
            }}>AI 自动摆</div>
          </div>
        </div>
      ),
    },
    {
      title: '一键发圈',
      sub: 'AI 帮你一次做好几张',
      desc: '后台跑 1-2 分钟，每张都能下载到相册，或者复制直接发朋友圈、微信群',
      art: (
        <div style={{ position: 'relative', width: 220, height: 200 }}>
          <div style={{
            position: 'absolute', inset: '6% 22%',
            background: '#fff', borderRadius: 14,
            boxShadow: '0 10px 28px rgba(0,0,0,0.12)',
            overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ flex: 1, background: `linear-gradient(135deg, ${accent}, #FF6470)`, position: 'relative' }}>
              <div style={{
                position: 'absolute', top: 14, left: 12,
                fontSize: 11, fontWeight: 700, padding: '3px 8px',
                background: TOKENS.yellow, color: TOKENS.ink, borderRadius: 8,
              }}>HOT</div>
              <div style={{
                position: 'absolute', bottom: 14, left: 12, right: 12,
                color: '#fff', fontSize: 18, fontWeight: 900, lineHeight: 1.2,
              }}>¥5.9<div style={{ fontSize: 9, fontWeight: 500, opacity: 0.9 }}>原味酸奶</div></div>
            </div>
            <div style={{ height: 22, background: '#fff' }} />
          </div>
          {/* ×3 角标 体现一次做多张 */}
          <div style={{
            position: 'absolute', top: 6, right: 28,
            background: TOKENS.ink, color: '#fff',
            fontSize: 12, fontWeight: 800, padding: '4px 9px', borderRadius: 10,
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          }}>× 多张</div>
          <div style={{
            position: 'absolute', bottom: -2, right: 22,
            width: 44, height: 44, borderRadius: '50%',
            background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 8px 20px ${accent}55`,
          }}>
            <Icon.Download size={22} color="#fff" />
          </div>
        </div>
      ),
    },
  ];

  const s = steps[step];
  const lastIdx = steps.length - 1;

  const containerWidth = pointerState.current?.width || (typeof window !== 'undefined' ? window.innerWidth : 390);
  // progress: -1..+1, negative = dragging left (towards next), positive = right (towards prev)
  const rawProgress = dragX / containerWidth;
  const atLeftEdge = step === 0 && dragX > 0;
  const atRightEdge = step === lastIdx && dragX < 0;
  const isElastic = atLeftEdge || atRightEdge;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerState.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      axis: 'none',
      width: dragRef.current?.offsetWidth || window.innerWidth,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ps = pointerState.current;
    if (!ps || ps.id !== e.pointerId) return;
    const dx = e.clientX - ps.startX;
    const dy = e.clientY - ps.startY;
    if (ps.axis === 'none') {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        ps.axis = 'x';
        try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch {}
        setIsDragging(true);
      } else {
        ps.axis = 'y';
        return;
      }
    }
    if (ps.axis !== 'x') return;
    // elastic resistance at edges
    const elastic = (step === 0 && dx > 0) || (step === lastIdx && dx < 0);
    setDragX(elastic ? dx * 0.35 : dx);
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const ps = pointerState.current;
    if (!ps || ps.id !== e.pointerId) return;
    const wasX = ps.axis === 'x';
    pointerState.current = null;
    if (!wasX) {
      setDragX(0);
      setIsDragging(false);
      return;
    }
    const threshold = 50;
    if (dragX <= -threshold && step < lastIdx) {
      setStep(step + 1);
    } else if (dragX >= threshold && step > 0) {
      setStep(step - 1);
    }
    setDragX(0);
    setIsDragging(false);
  };

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: TOKENS.bg,
      display: 'flex', flexDirection: 'column',
      touchAction: 'pan-y',
    }}>
      <div style={{ position: 'absolute', top: 60, right: 20, zIndex: 5 }}>
        <button onClick={onDone} style={{
          appearance: 'none', border: 0, background: 'transparent',
          color: TOKENS.inkSoft, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
        }}>跳过</button>
      </div>

      <div
        ref={dragRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        style={{
          flex: 1,
          display: 'flex', flexDirection: 'column',
          paddingTop: 60,
          touchAction: 'pan-y',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
        }}
      >
        <div style={{
          flex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transform: `translateX(${dragX}px)`,
          transition: isDragging ? 'none' : 'transform 0.3s ease',
          willChange: 'transform',
        }}>
          <div key={step} style={{ animation: isDragging ? undefined : 'wfadeIn 0.45s ease both' }}>
            {s.art}
          </div>
        </div>

        <div style={{ padding: '0 32px 16px', textAlign: 'center',
          transform: `translateX(${dragX * 0.5}px)`,
          transition: isDragging ? 'none' : 'transform 0.3s ease',
        }}>
          <div style={{ color: accent, fontSize: 13, fontWeight: 600, letterSpacing: 4, marginBottom: 10 }}>
            第 {step + 1} 步  ·  共 {steps.length} 步
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: TOKENS.ink, marginBottom: 10, letterSpacing: 1 }}>
            {s.title}
          </div>
          <div style={{ fontSize: 18, color: TOKENS.ink, marginBottom: 12, fontWeight: 500 }}>
            {s.sub}
          </div>
          <div style={{ fontSize: 14, color: TOKENS.inkSoft, lineHeight: 1.6, maxWidth: 280, margin: '0 auto' }}>
            {s.desc}
          </div>
        </div>
      </div>

      <div style={{ padding: '20px 32px 44px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
          {steps.map((_, i) => {
            // dragging towards next step: rawProgress < 0 (dx negative), target = step+1
            // dragging towards prev step: rawProgress > 0, target = step-1
            const p = isElastic ? 0 : Math.min(1, Math.abs(rawProgress) * 1.6);
            const dir = rawProgress < 0 ? 1 : -1;
            const target = step + dir;
            let width = 8;
            let bgOpacity = 0; // overlay accent opacity on top of gray
            if (i === step) {
              width = 24 - 16 * p;
              bgOpacity = 1 - p;
            } else if (i === target && target >= 0 && target <= lastIdx) {
              width = 8 + 16 * p;
              bgOpacity = p;
            }
            return (
              <div key={i} style={{
                position: 'relative',
                width, height: 8, borderRadius: 4,
                background: 'rgba(0,0,0,0.12)',
                transition: isDragging ? 'none' : 'width 0.3s, background 0.3s',
                overflow: 'hidden',
              }}>
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: 4,
                  background: accent,
                  opacity: bgOpacity,
                  transition: isDragging ? 'none' : 'opacity 0.3s',
                }} />
              </div>
            );
          })}
        </div>
        <PrimaryBtn
          accent={accent}
          onClick={() => step < steps.length - 1 ? setStep(step + 1) : onDone()}
        >
          {step < steps.length - 1 ? '下一步' : '开始使用'}
        </PrimaryBtn>
      </div>

      <style>{`
        @keyframes wfadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
