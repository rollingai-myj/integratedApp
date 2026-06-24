// Shared UI primitives — buttons, headers, scaffolding within the phone.
import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { TOKENS } from './tokens';
import { Icon } from './icons';

/**
 * 顶部条交互规则(全站三模块共同遵守):
 *   - 左 ← 返回键:**始终显示**。传 `onBack` 走该回调(回 PosterApp 内上一屏);
 *     不传时默认跳 `/`(直接退出 PosterApp 回功能选择)。
 *   - 右 ⌂ 主页键:**始终显示**,跳 `/`。业务自定义 `right` 槽放主页键左侧。
 *   - 入口屏 ← 与 ⌂ 同趋(都跳 /),但两键始终在 —— 三模块习惯一致。
 *
 * paddingTop 改回 safe-area + 14 —— 之前 56 是为了避让外层浮动玻璃胶囊,
 * 胶囊已经删掉,顶上没东西要让。
 */
export function AppBar({ title, onBack, accent = '#E11D2A', right = null, dark = true }: {
  title: string; onBack?: () => void; accent?: string; right?: React.ReactNode; dark?: boolean;
}) {
  const fg = dark ? '#fff' : TOKENS.ink;
  const navigate = useNavigate();
  const goHome = () => void navigate({ to: '/' });
  const handleBack = onBack ?? goHome;
  return (
    <div style={{
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)',
      paddingBottom: 14, paddingLeft: 12, paddingRight: 12,
      background: accent, color: fg,
      display: 'flex', alignItems: 'center', position: 'relative', flexShrink: 0,
    }}>
      <button onClick={handleBack} aria-label="返回" style={{
        appearance: 'none', border: 0, background: 'transparent', color: fg,
        padding: 8, marginLeft: -4, cursor: 'pointer', borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon.Back size={22} color={fg} />
      </button>
      <div style={{
        flex: 1, textAlign: 'center', fontSize: 17, fontWeight: 600, letterSpacing: 0.5,
      }}>{title}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', whiteSpace: 'nowrap', gap: 4 }}>
        {right}
        <button onClick={goHome} aria-label="回到主页" style={{
          appearance: 'none', border: 0, background: 'transparent', color: fg,
          padding: 8, marginRight: -4, cursor: 'pointer', borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon.Home size={22} color={fg} />
        </button>
      </div>
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
