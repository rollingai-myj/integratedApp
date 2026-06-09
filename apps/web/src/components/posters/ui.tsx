// Shared UI primitives — buttons, headers, scaffolding within the phone.
import * as React from 'react';
import { TOKENS } from './tokens';
import { Icon } from './icons';

export function AppBar({ title, onBack, accent = '#E11D2A', right = null, dark = true }: {
  title: string; onBack?: () => void; accent?: string; right?: React.ReactNode; dark?: boolean;
}) {
  const fg = dark ? '#fff' : TOKENS.ink;
  return (
    <div style={{
      paddingTop: 56, paddingBottom: 14, paddingLeft: 12, paddingRight: 12,
      background: accent, color: fg,
      display: 'flex', alignItems: 'center', position: 'relative', flexShrink: 0,
    }}>
      {onBack ? (
        <button onClick={onBack} style={{
          appearance: 'none', border: 0, background: 'transparent', color: fg,
          padding: 8, marginLeft: -4, cursor: 'pointer', borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon.Back size={22} color={fg} />
        </button>
      ) : <div style={{ width: 30 }} />}
      <div style={{
        flex: 1, textAlign: 'center', fontSize: 17, fontWeight: 600, letterSpacing: 0.5,
      }}>{title}</div>
      <div style={{ minWidth: 30, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', whiteSpace: 'nowrap' }}>{right}</div>
    </div>
  );
}

export function PrimaryBtn({ children, onClick, accent = TOKENS.red, disabled = false, style = {}, icon = null }: {
  children: React.ReactNode; onClick?: () => void; accent?: string; disabled?: boolean;
  style?: React.CSSProperties; icon?: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      appearance: 'none', border: 0,
      width: '100%', height: 56, borderRadius: 28,
      background: disabled ? '#ddd' : accent,
      color: '#fff', fontSize: 18, fontWeight: 600, letterSpacing: 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
      boxShadow: disabled ? 'none' : `0 8px 24px ${accent}40, 0 2px 6px ${accent}30`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      fontFamily: 'inherit',
      ...style,
    }}>
      {icon}
      {children}
    </button>
  );
}

export function GhostBtn({ children, onClick, accent = TOKENS.red, style = {}, icon = null }: {
  children: React.ReactNode; onClick?: () => void; accent?: string;
  style?: React.CSSProperties; icon?: React.ReactNode;
}) {
  return (
    <button onClick={onClick} style={{
      appearance: 'none',
      width: '100%', height: 52, borderRadius: 26,
      background: '#fff',
      color: accent, fontSize: 17, fontWeight: 600,
      border: `1.5px solid ${accent}`,
      cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      fontFamily: 'inherit',
      ...style,
    }}>
      {icon}
      {children}
    </button>
  );
}

export function Toast({ visible, text, icon = null }: {
  visible: boolean; text: string; icon?: React.ReactNode;
}) {
  return (
    <div style={{
      position: 'absolute', bottom: 110, left: '50%',
      transform: `translateX(-50%) translateY(${visible ? 0 : 20}px)`,
      opacity: visible ? 1 : 0,
      transition: 'all 0.3s ease',
      background: 'rgba(0,0,0,0.82)',
      color: '#fff', padding: '12px 20px', borderRadius: 24,
      fontSize: 15, fontWeight: 500,
      display: 'flex', alignItems: 'center', gap: 8,
      pointerEvents: 'none', zIndex: 100,
      whiteSpace: 'nowrap',
    }}>
      {icon}
      {text}
    </div>
  );
}
