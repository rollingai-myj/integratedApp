import * as React from 'react';
import { useGuide, GUIDE_STEPS } from './GuideContext';

const ACCENT = '#E11D2A';

/**
 * 蒙版式新手引导：暗色覆盖整个 phone frame，只在当前 data-guide 目标位置"挖洞"露出，
 * 旁边显示气泡（"下一步 / 跳过"）。目标 DOM 不在时自动等待；目标消失但下一步目标出现时
 * 自动 advance（用于跨屏续接）。
 */
export function GuideOverlay() {
  const { step, isActive, next, skip } = useGuide();
  const [rect, setRect] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [suppressed, setSuppressed] = React.useState(false);
  const [startBtnExists, setStartBtnExists] = React.useState(false);

  const [box, setBox] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 });

  React.useEffect(() => {
    if (!isActive) { setRect(null); return; }
    let raf = 0;
    const tick = () => {
      const isSuppressed = !!document.querySelector('[data-guide-suppress]');
      setSuppressed(isSuppressed);
      if (isSuppressed) {
        setRect(null);
        raf = requestAnimationFrame(tick);
        return;
      }
      const cur = GUIDE_STEPS[step];
      const nx = GUIDE_STEPS[step + 1];
      const curEl = cur ? (document.querySelector(`[data-guide="${cur.id}"]`) as HTMLElement | null) : null;
      const nextEl = nx ? (document.querySelector(`[data-guide="${nx.id}"]`) as HTMLElement | null) : null;

      // 跨屏续接：当前 target 消失但下一步 target 已出现 → 自动 advance
      if (!curEl && nextEl) { next(); return; }

      // 探测红色"开始做海报"按钮（用于 step 3 的下一步按钮启用判断）
      setStartBtnExists(!!document.querySelector('[data-guide="start-batch-btn"]'));


      // 找 phone frame 容器作为相对坐标基准
      const root = (document.querySelector('.poster-phone') as HTMLElement | null);
      const rootR = root?.getBoundingClientRect();
      const W = rootR?.width ?? window.innerWidth;
      const H = rootR?.height ?? window.innerHeight;
      setBox({ w: W, h: H });

      if (curEl && rootR) {
        const r = curEl.getBoundingClientRect();
        setRect({
          x: r.left - rootR.left,
          y: r.top - rootR.top,
          w: r.width,
          h: r.height,
        });
      } else {
        setRect(null);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, isActive, next]);

  if (!isActive || suppressed) return null;
  const cur = GUIDE_STEPS[step];
  const pad = 6;
  const cut = rect ? {
    x: Math.max(0, rect.x - pad),
    y: Math.max(0, rect.y - pad),
    w: rect.w + pad * 2,
    h: rect.h + pad * 2,
  } : null;

  const { w: W, h: H } = box;
  const dark = 'rgba(0,0,0,0.72)';

  // 4 个暗色条围住高亮区，pointer-events: auto 拦截外部点击；高亮区本身没条覆盖，可以点穿到真实按钮。
  const strips: Array<{ left: number; top: number; width: number; height: number }> = cut ? [
    { left: 0, top: 0, width: W, height: cut.y },
    { left: 0, top: cut.y + cut.h, width: W, height: Math.max(0, H - (cut.y + cut.h)) },
    { left: 0, top: cut.y, width: cut.x, height: cut.h },
    { left: cut.x + cut.w, top: cut.y, width: Math.max(0, W - (cut.x + cut.w)), height: cut.h },
  ] : [{ left: 0, top: 0, width: W, height: H }];

  // 气泡位置：优先放在 prefer 方向；不够空间则翻转
  const TT_H_EST = 150;
  const TT_GAP = 14;
  let ttBelow = (cur?.prefer ?? 'bottom') === 'bottom';
  if (cut) {
    const spaceBelow = H - (cut.y + cut.h);
    const spaceAbove = cut.y;
    if (ttBelow && spaceBelow < TT_H_EST && spaceAbove > spaceBelow) ttBelow = false;
    if (!ttBelow && spaceAbove < TT_H_EST && spaceBelow > spaceAbove) ttBelow = true;
  }
  const ttTop = cut
    ? (ttBelow ? cut.y + cut.h + TT_GAP : Math.max(20, cut.y - TT_H_EST - TT_GAP))
    : Math.max(20, H / 2 - TT_H_EST / 2);

  const isLast = step === GUIDE_STEPS.length - 1;

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 9999, pointerEvents: 'none' }}>
      {strips.map((s, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: s.left, top: s.top, width: s.width, height: s.height,
          background: dark,
          pointerEvents: 'auto',
          transition: 'all 0.25s ease',
        }} />
      ))}

      {cut && (
        <div style={{
          position: 'absolute',
          left: cut.x, top: cut.y, width: cut.w, height: cut.h,
          borderRadius: 12,
          boxShadow: `0 0 0 2px ${ACCENT}, 0 0 0 6px rgba(225,29,42,0.25)`,
          pointerEvents: 'none',
          transition: 'all 0.25s ease',
        }} />
      )}

      {/* tooltip */}
      <div style={{
        position: 'absolute',
        left: 14, right: 14, top: ttTop,
        background: '#fff', borderRadius: 14,
        padding: '14px 16px 12px',
        boxShadow: '0 14px 36px rgba(0,0,0,0.35)',
        pointerEvents: 'auto',
        animation: 'guideFadeIn 0.22s ease',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 11, color: ACCENT, fontWeight: 700, letterSpacing: 1 }}>
            第 {step + 1} / {GUIDE_STEPS.length} 步
          </div>
          <button onClick={skip} style={{
            appearance: 'none', border: 0, background: 'transparent', cursor: 'pointer',
            color: '#888', fontSize: 12, fontFamily: 'inherit', padding: 4,
          }}>跳过</button>
        </div>
        <div style={{ fontSize: 14, color: '#222', lineHeight: 1.55, marginBottom: 12 }}>
          {cur?.action === 'click-target' && !cut
            ? '请先按上一步操作，让按钮出现，再点击它继续。'
            : (cur?.text ?? '准备中…')}
          {cur?.action === 'click-target' && cut && (
            <span style={{ color: ACCENT, fontWeight: 600 }}>（点击高亮按钮继续）</span>
          )}
        </div>
        {cur?.action !== 'click-target' && (() => {
          const gridGate = cur?.id === 'product-grid' && !startBtnExists;
          const disabled = gridGate;
          return (
            <button
              onClick={disabled ? undefined : next}
              disabled={disabled}
              style={{
                appearance: 'none', border: 0, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                width: '100%', height: 40, borderRadius: 20,
                background: disabled ? '#ddd' : ACCENT, color: disabled ? '#888' : '#fff',
                fontSize: 14, fontWeight: 700,
                boxShadow: disabled ? 'none' : `0 6px 16px ${ACCENT}55`,
              }}
            >{disabled ? '先勾选 1 个商品' : (isLast ? '我知道了' : '下一步')}</button>
          );
        })()}
      </div>

      <style>{`
        @keyframes guideFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
