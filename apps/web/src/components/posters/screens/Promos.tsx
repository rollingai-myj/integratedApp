import * as React from 'react';
import { TOKENS } from '../tokens';
import { Icon } from '../icons';
import { AppBar } from '../ui';
import { CATEGORIES, PROMOS, type Promo } from '../data';

export function ScreenPromos({ accent, onBack, onSelect, cardStyle = 'visual' }: {
  accent: string; onBack: () => void; onSelect: (p: Promo) => void; cardStyle?: string;
}) {
  const [cat, setCat] = React.useState('all');
  const [q, setQ] = React.useState('');

  const filtered = PROMOS.filter(p =>
    (cat === 'all' || p.cat === cat) &&
    (q === '' || p.name.includes(q))
  );

  return (
    <div style={{
      position: 'absolute', inset: 0, background: TOKENS.bg,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <AppBar title="选一个促销活动" accent={accent} onBack={onBack} />

      <div style={{ padding: '14px 16px 0' }}>
        <div style={{
          background: '#fff', borderRadius: 14, padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: TOKENS.shadow1,
        }}>
          <Icon.Search size={18} color={TOKENS.inkMuted} />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="搜索商品名…"
            style={{
              flex: 1, border: 0, outline: 0, background: 'transparent',
              fontSize: 15, color: TOKENS.ink, fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      <div style={{
        padding: '14px 16px 4px',
        display: 'flex', gap: 8, overflowX: 'auto',
        scrollbarWidth: 'none',
      }}>
        {CATEGORIES.map(c => (
          <button key={c.id} onClick={() => setCat(c.id)} style={{
            appearance: 'none', border: 0, cursor: 'pointer',
            padding: '8px 14px', borderRadius: 16,
            background: cat === c.id ? accent : '#fff',
            color: cat === c.id ? '#fff' : TOKENS.ink,
            fontSize: 14, fontWeight: cat === c.id ? 700 : 500,
            fontFamily: 'inherit',
            flexShrink: 0,
            boxShadow: cat === c.id ? `0 4px 12px ${accent}40` : TOKENS.shadow1,
            transition: 'all 0.2s',
          }}>
            {c.name}
          </button>
        ))}
      </div>

      <div style={{
        padding: '12px 20px 6px',
        fontSize: 12, color: TOKENS.inkSoft,
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>共 {filtered.length} 个活动 · 点一下卡片就开始生成</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 24px' }}>
        {cardStyle === 'visual' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {filtered.map(p => <VisualCard key={p.id} p={p} accent={accent} onClick={() => onSelect(p)}/>)}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map(p => <ListCard key={p.id} p={p} accent={accent} onClick={() => onSelect(p)}/>)}
          </div>
        )}
      </div>
    </div>
  );
}

function VisualCard({ p, accent, onClick }: { p: Promo; accent: string; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{
      background: '#fff', borderRadius: 16, overflow: 'hidden',
      boxShadow: TOKENS.shadow1, cursor: 'pointer',
      position: 'relative',
      border: p.hot ? `1.5px solid ${accent}` : '1px solid rgba(0,0,0,0.04)',
    }}>
      <div style={{
        aspectRatio: '1/1',
        background: `repeating-linear-gradient(45deg, #f4f1ed 0 10px, #fbf9f5 10px 20px)`,
        position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontSize: 11, color: '#b8a99a', fontFamily: 'ui-monospace, monospace' }}>{p.name}</div>
        {p.hot && (
          <div style={{
            position: 'absolute', top: 8, left: 8,
            background: accent, color: '#fff',
            padding: '3px 8px', borderRadius: 8,
            fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
          }}>HOT</div>
        )}
      </div>
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: TOKENS.ink,
          marginBottom: 2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{p.name}</div>
        <div style={{ fontSize: 11, color: TOKENS.inkMuted, marginBottom: 6 }}>{p.spec}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 10, color: accent, fontWeight: 600 }}>券后</span>
          <span style={{ fontSize: 18, fontWeight: 900, color: accent, letterSpacing: -0.5 }}>
            ¥{p.couponPrice}
          </span>
          <span style={{ fontSize: 11, color: TOKENS.inkMuted, textDecoration: 'line-through' }}>¥{p.origPrice}</span>
        </div>
      </div>
    </div>
  );
}

function ListCard({ p, accent, onClick }: { p: Promo; accent: string; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{
      background: '#fff', borderRadius: 14, padding: 12,
      boxShadow: TOKENS.shadow1, cursor: 'pointer',
      display: 'flex', gap: 12,
      border: p.hot ? `1.5px solid ${accent}` : '1px solid rgba(0,0,0,0.04)',
    }}>
      <div style={{
        width: 72, height: 72, flexShrink: 0,
        borderRadius: 10,
        background: `repeating-linear-gradient(45deg, #f4f1ed 0 8px, #fbf9f5 8px 16px)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, color: '#b8a99a', fontFamily: 'ui-monospace, monospace',
      }}>
        商品
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: TOKENS.ink }}>{p.name}</span>
            {p.hot && (
              <span style={{
                background: accent, color: '#fff',
                padding: '1px 6px', borderRadius: 5,
                fontSize: 9, fontWeight: 800,
              }}>HOT</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: TOKENS.inkMuted }}>{p.spec}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 11, color: accent, fontWeight: 600 }}>券后</span>
          <span style={{ fontSize: 20, fontWeight: 900, color: accent, letterSpacing: -0.5 }}>
            ¥{p.couponPrice}
          </span>
          <span style={{ fontSize: 12, color: TOKENS.inkMuted, textDecoration: 'line-through' }}>¥{p.origPrice}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', color: TOKENS.inkMuted, transform: 'rotate(180deg)' }}>
        <Icon.Back size={16} color={TOKENS.inkMuted} />
      </div>
    </div>
  );
}
