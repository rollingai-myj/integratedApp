import * as React from 'react';

/**
 * 灰色小问号 — 点击展开"叠券规则"说明。
 * 受控显隐，点击外部 / Esc 关闭。
 */
export function StackRuleHint({ size = 16 }: { size?: number }) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        aria-label="叠券规则说明"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        style={{
          width: size, height: size, borderRadius: '50%',
          border: 0, padding: 0, cursor: 'pointer',
          background: open ? '#888' : '#c8c8c8',
          color: '#fff', fontSize: Math.round(size * 0.7), fontWeight: 700,
          lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.15s',
        }}
      >?</button>

      {open && (
        <div
          role="tooltip"
          style={{
            position: 'absolute', top: size + 6, right: 0, zIndex: 1000,
            width: 250, padding: '10px 12px',
            background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10,
            boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
            fontSize: 12, lineHeight: 1.55, color: '#333',
            textAlign: 'left', fontWeight: 400,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#111' }}>叠券规则</div>
          <div>• <b>可与会员价叠加</b>：满减券、百分比折扣券（含会员日 N% 券）</div>
          <div style={{ marginTop: 4 }}>• <b>不可叠加</b>：会员日固定领券价、X 元抢、N 件特价、抖音团购、周末 3 送 1</div>
          <div style={{ marginTop: 4 }}>• 同一档促销只能用一种</div>
        </div>
      )}
    </div>
  );
}
