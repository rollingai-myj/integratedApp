import * as React from 'react';
import { TOKENS } from '../tokens';
import { AppBar, PrimaryBtn } from '../ui';
import type { PosterStyleId } from '../ai';

const STYLES: Array<{ id: Exclude<PosterStyleId, 'custom'>; name: string; sub: string; img: string }> = [
  { id: 'vibrant', name: '活力风格', sub: '红黄爆炸 / 高能量 / 抢眼',           img: '/style-refs/vibrant.webp' },
  { id: 'premium', name: '高端风格', sub: '欧式花纹 / 留白 / 精致感',           img: '/style-refs/premium.webp' },
  { id: 'minimal', name: '简约风格', sub: '大字号 / 黑红描边 / 直给',           img: '/style-refs/minimal.webp' },
];

export function ScreenStyleSelect({
  accent, value, customValue, onBack, onConfirm,
}: {
  accent: string;
  value: PosterStyleId | null;
  customValue: string;
  onBack: () => void;
  onConfirm: (styleId: PosterStyleId, customStyle: string) => void;
}) {
  const [picked, setPicked] = React.useState<PosterStyleId | null>(value);
  const [customText, setCustomText] = React.useState(customValue);

  const canGo = picked !== null && (picked !== 'custom' || customText.trim().length >= 2);

  return (
    <div style={{
      position: 'absolute', inset: 0, background: TOKENS.bg,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <AppBar title="第 3 步 · 选风格" accent={accent} onBack={onBack} />

      <div style={{ flex: 1, padding: '16px 16px 0', overflowY: 'auto' }}>
        <div style={{ fontSize: 13, color: TOKENS.inkSoft, padding: '0 4px 12px' }}>
          挑一张你喜欢的样子，AI 会按这个风格做
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {STYLES.map(s => {
            const active = picked === s.id;
            return (
              <button key={s.id} onClick={() => setPicked(s.id)} style={{
                appearance: 'none', cursor: 'pointer', padding: 0,
                borderRadius: 16, overflow: 'hidden', textAlign: 'left',
                background: '#fff',
                border: active ? `2.5px solid ${accent}` : `1px solid ${TOKENS.line}`,
                boxShadow: active ? `0 8px 24px ${accent}40` : TOKENS.shadow1,
                transition: 'all 0.18s',
                fontFamily: 'inherit',
              }}>
                <div style={{ aspectRatio: '3/4', overflow: 'hidden', background: '#eee', position: 'relative' }}>
                  <img src={s.img} alt={s.name} style={{
                    width: '100%', height: '100%', objectFit: 'cover',
                  }}/>
                  {active && (
                    <div style={{
                      position: 'absolute', top: 8, right: 8,
                      width: 24, height: 24, borderRadius: 12, background: accent,
                      color: '#fff', fontSize: 14, fontWeight: 800,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>✓</div>
                  )}
                </div>
                <div style={{ padding: '10px 12px 12px' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: TOKENS.ink }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: TOKENS.inkMuted, marginTop: 2 }}>{s.sub}</div>
                </div>
              </button>
            );
          })}

          {/* Custom style card spans 2 cols */}
          <button
            onClick={() => setPicked('custom')}
            style={{
              gridColumn: '1 / -1',
              appearance: 'none', cursor: 'pointer', padding: '14px 14px',
              borderRadius: 16, textAlign: 'left',
              background: picked === 'custom' ? '#fff' : TOKENS.bgWarm,
              border: picked === 'custom' ? `2.5px solid ${accent}` : `1.5px dashed ${TOKENS.line}`,
              boxShadow: picked === 'custom' ? `0 8px 24px ${accent}40` : 'none',
              transition: 'all 0.18s', fontFamily: 'inherit',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: TOKENS.ink }}>自由风格</div>
                <div style={{ fontSize: 11, color: TOKENS.inkMuted, marginTop: 2 }}>
                  不喜欢？自己描述想要的样子
                </div>
              </div>
              {picked === 'custom' && (
                <div style={{
                  width: 24, height: 24, borderRadius: 12, background: accent,
                  color: '#fff', fontSize: 14, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>✓</div>
              )}
            </div>
          </button>

          {picked === 'custom' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <textarea
                value={customText}
                onChange={e => setCustomText(e.target.value.slice(0, 200))}
                placeholder="比如：日系清新风、ins 风的奶油色、少女心粉色、复古港风…"
                rows={3}
                autoFocus
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#fff', border: `1.5px solid ${accent}`,
                  borderRadius: 12, padding: '12px 14px',
                  fontSize: 14, color: TOKENS.ink, fontFamily: 'inherit',
                  resize: 'none', outline: 'none', lineHeight: 1.5,
                }}
              />
              <div style={{
                fontSize: 11, color: TOKENS.inkMuted, textAlign: 'right', marginTop: 4,
              }}>{customText.length}/200</div>
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '16px 20px 32px' }}>
        <PrimaryBtn accent={accent} disabled={!canGo}
          onClick={() => picked && onConfirm(picked, customText.trim())}>
          AI 生成海报
        </PrimaryBtn>
      </div>
    </div>
  );
}
