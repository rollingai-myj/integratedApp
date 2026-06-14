/**
 * 通用 UI 元件 —— 来自设计稿 ui.jsx，转写成 React + TypeScript。
 * 仅用于选品模块（features/shelves）。
 */
import type { CSSProperties, ReactNode } from 'react';
import { TOKENS } from './tokens';
import { I } from './icons';

// ---- 全局 keyframes（首次挂载注入） --------------------------------------

let _keyframesInjected = false;
export function ensureKeyframes() {
  if (_keyframesInjected || typeof document === 'undefined') return;
  _keyframesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes shv-spin { to { transform: rotate(360deg); } }
    @keyframes shv-scan { 0% { top: -34%; } 100% { top: 100%; } }
    @keyframes shv-fadein { from { opacity: 0; } to { opacity: 1; } }
    @keyframes shv-pop { from { transform: scale(0.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    @keyframes shv-progress { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }
    @keyframes shv-dot { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
    @keyframes shv-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    @keyframes shv-card-in { from { opacity: 0; transform: translateX(26px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes shv-sheet-up { from { transform: translateY(40%); } to { transform: translateY(0); } }
  `;
  document.head.appendChild(style);
}

export function ScreenWrap({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  ensureKeyframes();
  return (
    <div style={{
      position: 'absolute', inset: 0, background: TOKENS.bg,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      ...style,
    }}>{children}</div>
  );
}

// ---- AppBar：保留现有应用顶部条习惯（红底白字 + 返回 + 标题） -----------

interface AppBarProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}

export function AppBar({ title, subtitle, onBack, right }: AppBarProps) {
  return (
    <div style={{
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)',
      paddingBottom: 14, paddingLeft: 12, paddingRight: 12,
      background: TOKENS.red, color: '#fff',
      display: 'flex', alignItems: 'center', position: 'relative', flexShrink: 0, zIndex: 10,
    }}>
      {onBack ? (
        <button onClick={onBack} aria-label="返回" style={{
          appearance: 'none', border: 0, background: 'transparent', color: '#fff',
          padding: 8, marginLeft: -4, cursor: 'pointer', borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {I.Back({ size: 22, color: '#fff' })}
        </button>
      ) : <div style={{ width: 30 }} />}
      <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, opacity: 0.85, marginTop: 1 }}>{subtitle}</div>}
      </div>
      <div style={{ minWidth: 30, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', whiteSpace: 'nowrap' }}>{right}</div>
    </div>
  );
}

interface BtnProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
  icon?: ReactNode;
  accent?: string;
}

export function PrimaryBtn({ children, onClick, disabled, style, icon, accent = TOKENS.red }: BtnProps) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      appearance: 'none', border: 0,
      width: '100%', height: 54, borderRadius: 27,
      background: disabled ? '#ddd' : accent,
      color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
      boxShadow: disabled ? 'none' : `0 8px 24px ${accent}40, 0 2px 6px ${accent}30`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      fontFamily: 'inherit', flexShrink: 0,
      ...style,
    }}>
      {icon}{children}
    </button>
  );
}

export function GhostBtn({ children, onClick, style, icon, accent = TOKENS.red }: BtnProps) {
  return (
    <button onClick={onClick} style={{
      appearance: 'none',
      width: '100%', height: 50, borderRadius: 25,
      background: '#fff', color: accent, fontSize: 16, fontWeight: 600,
      border: `1.5px solid ${accent}`, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      fontFamily: 'inherit', flexShrink: 0,
      ...style,
    }}>{icon}{children}</button>
  );
}

export function Card({
  children, onClick, style, pad = 14,
}: { children: ReactNode; onClick?: () => void; style?: CSSProperties; pad?: number }) {
  return (
    <div onClick={onClick} style={{
      background: '#fff', borderRadius: 16, padding: pad,
      boxShadow: TOKENS.shadow1,
      cursor: onClick ? 'pointer' : 'default',
      ...style,
    }}>{children}</div>
  );
}

type Tone = 'green' | 'amber' | 'orange' | 'red' | 'gray' | 'ink';

const TONES: Record<Tone, { color: string; background: string }> = {
  green: { color: TOKENS.green, background: TOKENS.greenSoft },
  amber: { color: TOKENS.amber, background: TOKENS.amberSoft },
  orange: { color: '#fff', background: TOKENS.orange },
  red: { color: TOKENS.red, background: TOKENS.redSoft },
  gray: { color: TOKENS.inkMuted, background: '#f0ede8' },
  ink: { color: '#fff', background: TOKENS.ink },
};

export function Chip({ tone = 'gray', children, style }: { tone?: Tone; children: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{
      fontSize: 10.5, padding: '2.5px 7px', borderRadius: 8, fontWeight: 700,
      display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap',
      ...TONES[tone], ...style,
    }}>{children}</span>
  );
}

export function Spin({ size = 18, color = TOKENS.red }: { size?: number; color?: string }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      border: `2.5px solid ${color}22`, borderTopColor: color,
      animation: 'shv-spin 0.8s linear infinite',
    }} />
  );
}

export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      padding: '14px 16px calc(env(safe-area-inset-bottom, 0px) + 16px)',
      background: 'linear-gradient(180deg, rgba(250,247,242,0) 0%, rgba(250,247,242,0.95) 35%, #faf7f2 100%)',
      display: 'flex', gap: 10, alignItems: 'center', zIndex: 50,
    }}>{children}</div>
  );
}

export function FlowSteps({ current, steps }: { current: number; steps: string[] }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 0, padding: '14px 18px 4px', flexShrink: 0,
    }}>
      {steps.map((label, i) => {
        const stDone = i < current;
        const stActive = i === current;
        return (
          <FlowStepFrag key={label} index={i} label={label} done={stDone} active={stActive} current={current} />
        );
      })}
    </div>
  );
}
function FlowStepFrag({
  index, label, done, active, current,
}: { index: number; label: string; done: boolean; active: boolean; current: number }) {
  return (
    <>
      {index > 0 && (
        <div style={{
          flex: 1, height: 2, margin: '0 6px', marginBottom: 18, borderRadius: 1,
          background: index <= current ? TOKENS.red : '#e5dfd6',
          transition: 'background 0.3s',
        }} />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
        <div style={{
          width: 26, height: 26, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: done || active ? TOKENS.red : '#fff',
          border: done || active ? `2px solid ${TOKENS.red}` : '2px solid #e5dfd6',
          color: '#fff', fontSize: 12.5, fontWeight: 800,
          boxShadow: active ? `0 4px 10px ${TOKENS.red}40` : 'none',
          transition: 'all 0.3s',
        }}>
          {done ? I.Check({ size: 14, color: '#fff' }) : <span style={{ color: active ? '#fff' : TOKENS.inkMuted }}>{index + 1}</span>}
        </div>
        <div style={{
          fontSize: 11, fontWeight: active ? 800 : 600,
          color: active ? TOKENS.red : done ? TOKENS.ink : TOKENS.inkMuted,
          whiteSpace: 'nowrap',
        }}>{label}</div>
      </div>
    </>
  );
}

export function ListRow({
  icon, label, hint, onClick, badge,
}: { icon: ReactNode; label: string; hint?: string; onClick?: () => void; badge?: ReactNode }) {
  return (
    <button onClick={onClick} style={{
      appearance: 'none', border: 0, width: '100%', textAlign: 'left',
      background: '#fff', borderRadius: 14, padding: '13px 14px',
      boxShadow: TOKENS.shadow1, cursor: 'pointer', fontFamily: 'inherit',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 12, flexShrink: 0,
        background: TOKENS.redSoft,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: TOKENS.ink, display: 'flex', alignItems: 'center', gap: 6 }}>
          {label}{badge}
        </div>
        {hint && <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 2 }}>{hint}</div>}
      </div>
      {I.ChevronR({ size: 17, color: TOKENS.inkMuted })}
    </button>
  );
}

export function NumStepper({
  value, onChange, min = 1, max = 9, unit = '',
}: { value: number; onChange: (v: number) => void; min?: number; max?: number; unit?: string }) {
  const btnStyle = (dis: boolean): CSSProperties => ({
    appearance: 'none', border: `1.5px solid ${dis ? '#e5dfd6' : TOKENS.red}`,
    width: 46, height: 46, borderRadius: 14, background: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: dis ? 'not-allowed' : 'pointer', flexShrink: 0,
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'center' }}>
      <button style={btnStyle(value <= min)} onClick={() => value > min && onChange(value - 1)}>
        {I.Minus({ size: 20, color: value <= min ? '#d8d2c8' : TOKENS.red })}
      </button>
      <div style={{ minWidth: 76, textAlign: 'center' }}>
        <span style={{ fontSize: 34, fontWeight: 800, color: TOKENS.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        {unit && <span style={{ fontSize: 14, color: TOKENS.inkSoft, marginLeft: 3 }}>{unit}</span>}
      </div>
      <button style={btnStyle(value >= max)} onClick={() => value < max && onChange(value + 1)}>
        {I.Plus({ size: 20, color: value >= max ? '#d8d2c8' : TOKENS.red })}
      </button>
    </div>
  );
}

export function BigOption({
  selected, title, hint, onClick,
}: { selected: boolean; title: string; hint?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{
      appearance: 'none', textAlign: 'left', width: '100%',
      background: '#fff', borderRadius: 16, padding: '15px 16px',
      border: selected ? `2px solid ${TOKENS.red}` : '2px solid transparent',
      boxShadow: selected ? `0 4px 14px ${TOKENS.red}22` : TOKENS.shadow1,
      cursor: 'pointer', fontFamily: 'inherit',
      display: 'flex', alignItems: 'center', gap: 12,
      transition: 'border-color 0.15s, box-shadow 0.15s',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15.5, fontWeight: 700, color: TOKENS.ink }}>{title}</div>
        {hint && <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{
        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
        background: selected ? TOKENS.red : '#fff',
        border: selected ? `2px solid ${TOKENS.red}` : `1.5px solid ${TOKENS.line}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{selected && I.Check({ size: 14, color: '#fff' })}</div>
    </button>
  );
}

export function PhotoPlaceholder({
  label = '货架照片', h = 190, seed = 0, style,
}: { label?: string; h?: number; seed?: number; style?: CSSProperties }) {
  const hues = ['#efe9df', '#ece5e0', '#e9e9df'];
  const base = hues[seed % hues.length];
  return (
    <div style={{
      height: h, borderRadius: 14, position: 'relative', overflow: 'hidden',
      background: `repeating-linear-gradient(135deg, ${base} 0 10px, #f6f2ec 10px 20px)`,
      border: `1px solid ${TOKENS.line}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      ...style,
    }}>
      <div style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11.5, color: TOKENS.inkMuted, background: 'rgba(255,255,255,0.85)',
        padding: '4px 10px', borderRadius: 8, letterSpacing: 1,
      }}>{label}</div>
    </div>
  );
}
