import * as React from 'react';
import { createPortal } from 'react-dom';
import { useGuide, GUIDE_STEPS } from './GuideContext';
import { useIOSDeviceZoom } from '@/components/IOSDevice';

const ACCENT = '#E11D2A';

/**
 * 蒙版式新手引导：暗色覆盖整个 phone frame，只在当前 data-guide 目标位置"挖洞"露出，
 * 旁边显示气泡（"下一步 / 跳过"）。目标 DOM 不在时自动等待；目标消失但下一步目标出现时
 * 自动 advance（用于跨屏续接）。
 *
 * ⚠️ 整合到统一应用后 GuideOverlay 通过 portal 渲染到 document.body：
 *   - 原 repo 直接挂在 .poster-phone 里，DOM 上跟 ScreenHome 同级
 *   - 统一应用的 IOSDevice 用 `zoom: viewportW/390` 把 390 设计稿放大到撑满视口宽
 *   - 如果还把 overlay 放在 zoom 容器里，style.top:100 会被解释成 100 设计 px → 100×zoom 视觉
 *     px，跟 getBoundingClientRect 返回的视觉 px 对不上 → 气泡飞到视口下面
 *   - 同时 scrollIntoView 会把 .poster-phone 内的 scrollTop 拉走，连带 overlay 一起 offset
 *   所以全用 portal + position:fixed + 视觉 px 坐标，跳过 zoom，跟视口对齐。
 */
export function GuideOverlay() {
  const { step, isActive, next, skip } = useGuide();
  const zoom = useIOSDeviceZoom()?.zoom ?? 1;
  const [rect, setRect] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [suppressed, setSuppressed] = React.useState(false);
  const [startBtnExists, setStartBtnExists] = React.useState(false);
  const [box, setBox] = React.useState<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 0, h: 0 });

  // 实测的 tooltip 设计 px 高度（中文文案折行后 150~200 之间浮动）
  const tooltipRef = React.useRef<HTMLDivElement | null>(null);
  const [ttH, setTtH] = React.useState(180);
  React.useLayoutEffect(() => {
    if (!tooltipRef.current) return;
    const h = tooltipRef.current.getBoundingClientRect().height / zoom;  // 视觉 → 设计
    if (h > 0 && Math.abs(h - ttH) > 1) setTtH(h);
  });

  // step 切换时把目标 scroll 进视口；用 block:'nearest' 避免把 .poster-phone 也带着滚。
  React.useEffect(() => {
    if (!isActive) return;
    const cur = GUIDE_STEPS[step];
    if (!cur) return;
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-guide="${cur.id}"]`) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }, 60);
    return () => clearTimeout(t);
  }, [step, isActive]);

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

      // phone frame 视觉边界（视口坐标系）—— 套 portal 时用这个定位 fixed 容器
      const phone = (document.querySelector('.poster-phone') as HTMLElement | null);
      const pr = phone?.getBoundingClientRect();
      const Wv = pr?.width ?? window.innerWidth;
      const Hv = pr?.height ?? window.innerHeight;
      const X = pr?.left ?? 0;
      const Y = pr?.top ?? 0;
      // box 里的 w/h 存设计 px（除以 zoom），跟 rect 同一坐标系；外层 fixed 容器再按视觉 px 放置。
      setBox({ x: X, y: Y, w: Wv / zoom, h: Hv / zoom });

      if (curEl && pr) {
        const r = curEl.getBoundingClientRect();
        // 视口里看到的视觉 px → 设计 px（除以 zoom）。
        // 这样在 zoom 容器里写 style top/left/width/height 就和现实位置一一对应。
        setRect({
          x: (r.left - pr.left) / zoom,
          y: (r.top - pr.top) / zoom,
          w: r.width / zoom,
          h: r.height / zoom,
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

  const { x: PX, y: PY, w: W, h: H } = box;
  const dark = 'rgba(0,0,0,0.72)';

  // 4 个暗色条围住高亮区
  const strips: Array<{ left: number; top: number; width: number; height: number }> = cut ? [
    { left: 0, top: 0, width: W, height: cut.y },
    { left: 0, top: cut.y + cut.h, width: W, height: Math.max(0, H - (cut.y + cut.h)) },
    { left: 0, top: cut.y, width: cut.x, height: cut.h },
    { left: cut.x + cut.w, top: cut.y, width: Math.max(0, W - (cut.x + cut.w)), height: cut.h },
  ] : [{ left: 0, top: 0, width: W, height: H }];

  // 气泡位置：优先 prefer 方向；不够就翻；两边都不够就贴边并允许遮挡 cut
  const TT_GAP = 14;
  const SAFE = 14;
  const ttMaxH = Math.max(140, H - SAFE * 2);
  let ttTop: number;
  if (cut) {
    const naturalBelow = cut.y + cut.h + TT_GAP;
    const naturalAbove = cut.y - ttH - TT_GAP;
    const fitsBelow = naturalBelow + ttH <= H - SAFE;
    const fitsAbove = naturalAbove >= SAFE;
    const preferBelow = (cur?.prefer ?? 'bottom') === 'bottom';
    if (preferBelow && fitsBelow) ttTop = naturalBelow;
    else if (!preferBelow && fitsAbove) ttTop = naturalAbove;
    else if (fitsBelow) ttTop = naturalBelow;
    else if (fitsAbove) ttTop = naturalAbove;
    else ttTop = Math.max(SAFE, Math.min(H - ttH - SAFE, naturalBelow));
  } else {
    ttTop = Math.max(SAFE, H / 2 - ttH / 2);
  }

  const isLast = step === GUIDE_STEPS.length - 1;

  // SSR / 初次 mount 时 document 可能没渲染好，做个 guard
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div style={{
      position: 'fixed', left: PX, top: PY, width: W * zoom, height: H * zoom,
      zIndex: 9999, pointerEvents: 'none',
    }}>
      <div style={{ width: W, height: H, zoom, position: 'relative' }}>
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

      <div ref={tooltipRef} style={{
        position: 'absolute',
        left: 14, right: 14, top: ttTop,
        maxHeight: ttMaxH,
        overflowY: 'auto',
        background: '#fff', borderRadius: 14,
        padding: '14px 16px 12px',
        boxShadow: '0 14px 36px rgba(0,0,0,0.35)',
        pointerEvents: 'auto',
        animation: 'guideFadeIn 0.22s ease',
        boxSizing: 'border-box',
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
    </div>,
    document.body,
  );
}
