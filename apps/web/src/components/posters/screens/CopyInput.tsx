import * as React from 'react';
import { TOKENS } from '../tokens';
import { AppBar, PrimaryBtn } from '../ui';

const PRESETS = [
  '甄稀酸奶 限时优惠 10元2杯 到店领券',
  '原味酸奶 券后5.9元 到店即享',
  '冰红茶 2.8元/瓶 爆款热卖中',
  '辣条经典 3.2元 一袋管够',
];

export function ScreenCopyInput({ accent, value, onBack, onNext }: {
  accent: string; value: string; onBack: () => void; onNext: (text: string) => void;
}) {
  const [text, setText] = React.useState(value);

  return (
    <div style={{
      position: 'absolute', inset: 0, background: TOKENS.bg,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <AppBar title="第 2 步 · 写文案" accent={accent} onBack={onBack} />

      <div style={{ flex: 1, padding: '20px 20px 0', overflowY: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: TOKENS.ink, marginBottom: 6 }}>
          想让海报上写什么？
        </div>
        <div style={{ fontSize: 13, color: TOKENS.inkSoft, marginBottom: 14 }}>
          商品名、价格、活动力度，怎么口语化怎么写
        </div>

        <textarea
          value={text}
          onChange={e => setText(e.target.value.slice(0, 200))}
          placeholder="例：甄稀酸奶 10元2杯 到店领券"
          rows={5}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#fff', border: `1.5px solid ${TOKENS.line}`,
            borderRadius: 14, padding: '14px 14px',
            fontSize: 16, color: TOKENS.ink, fontFamily: 'inherit',
            resize: 'none', outline: 'none', lineHeight: 1.5,
          }}
          onFocus={e => e.currentTarget.style.borderColor = accent}
          onBlur={e => e.currentTarget.style.borderColor = TOKENS.line}
        />
        <div style={{
          fontSize: 11, color: TOKENS.inkMuted, textAlign: 'right', marginTop: 4,
        }}>{text.length}/200</div>

        <div style={{
          marginTop: 18, fontSize: 13, fontWeight: 600, color: TOKENS.inkSoft, marginBottom: 8,
        }}>常用模板（点一下填进去）</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PRESETS.map((p, i) => (
            <button key={i} onClick={() => setText(p)} style={{
              appearance: 'none', cursor: 'pointer', textAlign: 'left',
              background: '#fff', border: `1px solid ${TOKENS.lineSoft}`,
              borderRadius: 12, padding: '12px 14px',
              fontSize: 14, color: TOKENS.ink, fontFamily: 'inherit',
              boxShadow: TOKENS.shadow1,
            }}>{p}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 20px 32px' }}>
        <PrimaryBtn accent={accent} onClick={() => onNext(text.trim())} disabled={text.trim().length < 2}>
          下一步：选风格
        </PrimaryBtn>
      </div>
    </div>
  );
}
