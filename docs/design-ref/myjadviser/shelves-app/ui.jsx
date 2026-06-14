// 共享 UI —— 完全采用海报模块（posters）的设计语言
// tokens 与 apps/web/src/components/posters/tokens.ts 一致
const TOKENS = {
  red: '#E11D2A',
  redDark: '#B8121F',
  redSoft: '#FEE8E9',
  redInk: '#5C0A11',

  yellow: '#FFD400',
  yellowDark: '#E8B900',

  green: '#0a7d3a',
  greenSoft: '#e6f6ec',
  amber: '#8a5a00',
  amberSoft: '#fff4e6',

  ink: '#1A1714',
  inkSoft: '#5C544D',
  inkMuted: '#9A9189',
  line: 'rgba(0,0,0,0.08)',
  lineSoft: 'rgba(0,0,0,0.05)',
  bg: '#FAF7F2',
  bgWarm: '#F4EFE7',
  card: '#FFFFFF',

  shadow1: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
  shadow2: '0 4px 16px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.05)',
};

// ---------------------------------------------------------------- 图标（与海报模块同款笔触：1.8 描边、圆角端点）
function svg(paths, { size = 22, color = 'currentColor', vb = 24, fillNone = true } = {}) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} fill="none" style={{ display: 'block', flexShrink: 0 }}>
      {paths.map((d, i) =>
        typeof d === 'string'
          ? <path key={i} d={d} stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill={fillNone ? 'none' : color} />
          : d
      )}
    </svg>
  );
}

const I = {
  Back: (p) => svg(['M15 5l-7 7 7 7'], p),
  ChevronR: (p) => svg(['M9 5l7 7-7 7'], p),
  ChevronD: (p) => svg(['M5 9l7 7 7-7'], p),
  Check: (p) => svg(['M4.5 12.5l5 5 10-11'], p),
  Plus: (p) => svg(['M12 5v14M5 12h14'], p),
  Minus: (p) => svg(['M5 12h14'], p),
  Close: (p) => svg(['M6 6l12 12M18 6L6 18'], p),
  Camera: (p) => svg(['M4 8h3l2-2.5h6L17 8h3v11H4z', 'M12 16.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z'], p),
  Photo: (p) => svg(['M4 5h16v14H4z', 'M4 15.5l4.5-4.5 4 4 3-3 4.5 4.5', 'M9.5 9.8a0.9 0.9 0 100-1.8 0.9 0.9 0 000 1.8z'], p),
  Sparkles: (p) => svg(['M12 4l1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7z', 'M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z'], p),
  Clock: (p) => svg(['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 7.5V12l3 2'], p),
  History: (p) => svg(['M3 12a9 9 0 109-9 9 9 0 00-7.5 4M3 4v4h4', 'M12 7v5l3 2'], p),
  Gear: (p) => svg(['M12 15.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z', 'M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 005.4 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 002 1.2l.4 2.6h4l.4-2.6a7 7 0 002-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z'], p),
  Shelf: (p) => svg(['M4 4h16M4 12h16M4 20h16', 'M6.5 8.8V12M11 7v5M15.5 9.5V12M8 16.5V20M13.5 15.5V20'], p),
  Trash: (p) => svg(['M5 7h14M9.5 7V4.5h5V7M7 7l1 13h8l1-13', 'M10.2 10.5v6M13.8 10.5v6'], p),
  TrendUp: (p) => svg(['M4 17l5.5-5.5 3.5 3.5L20 8', 'M14.5 8H20v5.5'], p),
  TrendDown: (p) => svg(['M4 8l5.5 5.5L13 10l7 7', 'M14.5 17H20v-5.5'], p),
  Eye: (p) => svg(['M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z', 'M12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z'], p),
  Alert: (p) => svg(['M12 4l9 16H3z', 'M12 10.5v3.5', 'M12 17.2v.1'], p),
  Doc: (p) => svg(['M6 3.5h8.5L19 8v12.5H6z', 'M14 3.5V8.5h5', 'M9 12.5h6M9 16h6'], p),
  Store: (p) => svg(['M4 9.5L5.5 4h13L20 9.5', 'M4 9.5a2.6 2.6 0 005.3 0 2.65 2.65 0 005.4 0 2.6 2.6 0 005.3 0', 'M5.5 12v8h13v-8', 'M9.5 20v-5h5v5'], p),
  Box: (p) => svg(['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M4 7.5l8 4.5 8-4.5', 'M12 12v9'], p),
  Edit: (p) => svg(['M5 19h14', 'M7 15.5l8.5-8.5 2.5 2.5L9.5 18 6.5 18.5z'], p),
  ArrowR: (p) => svg(['M5 12h14M13 6l6 6-6 6'], p),
  Tag: (p) => svg(['M4 4h7l9 9-7 7-9-9z', 'M8.5 8.6a0.9 0.9 0 100-1.8 0.9 0.9 0 000 1.8z'], p),
  Question: (p) => svg(['M9.2 9a3 3 0 115 2.2c-.9.8-2.2 1.3-2.2 2.8', 'M12 17.4v.1'], p),
  Mic: (p) => svg(['M12 3.5a2.8 2.8 0 012.8 2.8v5.4a2.8 2.8 0 11-5.6 0V6.3A2.8 2.8 0 0112 3.5z', 'M6 11.7a6 6 0 0012 0', 'M12 17.7v2.8'], p),
  Send: (p) => svg(['M20 4L4 11.5l6.5 2 2 6.5z', 'M20 4l-9.5 9.5'], p),
  Chat: (p) => svg(['M4 5h16v11H9l-4.5 3.5V5z', 'M8.5 10.5h7'], p),
};

// ---------------------------------------------------------------- 基础组件
function AppBar({ title, subtitle, onBack, right = null }) {
  return (
    <div style={{
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)', paddingBottom: 14, paddingLeft: 12, paddingRight: 12,
      background: TOKENS.red, color: '#fff',
      display: 'flex', alignItems: 'center', position: 'relative', flexShrink: 0, zIndex: 10,
    }}>
      {onBack ? (
        <button onClick={onBack} aria-label="返回" style={{
          appearance: 'none', border: 0, background: 'transparent', color: '#fff',
          padding: 8, marginLeft: -4, cursor: 'pointer', borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <I.Back size={22} color="#fff" />
        </button>
      ) : <div style={{ width: 30 }}></div>}
      <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, opacity: 0.85, marginTop: 1 }}>{subtitle}</div>}
      </div>
      <div style={{ minWidth: 30, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', whiteSpace: 'nowrap' }}>{right}</div>
    </div>
  );
}

function PrimaryBtn({ children, onClick, accent = TOKENS.red, disabled = false, style = {}, icon = null }) {
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
      {icon}
      {children}
    </button>
  );
}

function GhostBtn({ children, onClick, accent = TOKENS.red, style = {}, icon = null }) {
  return (
    <button onClick={onClick} style={{
      appearance: 'none',
      width: '100%', height: 50, borderRadius: 25,
      background: '#fff',
      color: accent, fontSize: 16, fontWeight: 600,
      border: `1.5px solid ${accent}`,
      cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      fontFamily: 'inherit', flexShrink: 0,
      ...style,
    }}>
      {icon}
      {children}
    </button>
  );
}

function Card({ children, onClick, style = {}, pad = 14 }) {
  return (
    <div onClick={onClick} style={{
      background: '#fff', borderRadius: 16, padding: pad,
      boxShadow: TOKENS.shadow1,
      cursor: onClick ? 'pointer' : 'default',
      ...style,
    }}>{children}</div>
  );
}

// 状态小徽标（绿/橙/灰/红）
function Chip({ tone = 'gray', children, style = {} }) {
  const tones = {
    green: { color: TOKENS.green, background: TOKENS.greenSoft },
    amber: { color: TOKENS.amber, background: TOKENS.amberSoft },
    orange: { color: '#fff', background: '#ff8c1a' },
    red: { color: TOKENS.red, background: TOKENS.redSoft },
    gray: { color: TOKENS.inkMuted, background: '#f0ede8' },
    ink: { color: '#fff', background: TOKENS.ink },
  };
  return (
    <span style={{
      fontSize: 10.5, padding: '2.5px 7px', borderRadius: 8, fontWeight: 700,
      display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap',
      ...tones[tone], ...style,
    }}>{children}</span>
  );
}

function Spin({ size = 18, color = TOKENS.red }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      border: `2.5px solid ${color}22`, borderTopColor: color,
      animation: 'shv-spin 0.8s linear infinite',
    }}></div>
  );
}

function Toast({ visible, text, icon = null }) {
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
      pointerEvents: 'none', zIndex: 200,
      whiteSpace: 'nowrap',
    }}>
      {icon}
      {text}
    </div>
  );
}

// 流程步骤条：始终可见，解决"不知道进行到哪"
function FlowSteps({ current, steps = ['拍照', 'AI 诊断', '确认方案'] }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 0, padding: '14px 18px 4px', flexShrink: 0,
    }}>
      {steps.map((label, i) => {
        const stDone = i < current;
        const stActive = i === current;
        return (
          <React.Fragment key={label}>
            {i > 0 && (
              <div style={{
                flex: 1, height: 2, margin: '0 6px', marginBottom: 18, borderRadius: 1,
                background: i <= current ? TOKENS.red : '#e5dfd6',
                transition: 'background 0.3s',
              }}></div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: stDone || stActive ? TOKENS.red : '#fff',
                border: stDone || stActive ? `2px solid ${TOKENS.red}` : '2px solid #e5dfd6',
                color: '#fff', fontSize: 12.5, fontWeight: 800,
                boxShadow: stActive ? `0 4px 10px ${TOKENS.red}40` : 'none',
                transition: 'all 0.3s',
              }}>
                {stDone ? <I.Check size={14} color="#fff" /> : <span style={{ color: stActive ? '#fff' : TOKENS.inkMuted }}>{i + 1}</span>}
              </div>
              <div style={{
                fontSize: 11, fontWeight: stActive ? 800 : 600,
                color: stActive ? TOKENS.red : stDone ? TOKENS.ink : TOKENS.inkMuted,
                whiteSpace: 'nowrap',
              }}>{label}</div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// 列表导航行（工作台用）
function ListRow({ icon, label, hint, onClick, badge = null, tone = 'normal' }) {
  return (
    <button onClick={onClick} style={{
      appearance: 'none', border: 0, width: '100%', textAlign: 'left',
      background: '#fff', borderRadius: 14, padding: '13px 14px',
      boxShadow: TOKENS.shadow1, cursor: 'pointer', fontFamily: 'inherit',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 12, flexShrink: 0,
        background: tone === 'accent' ? TOKENS.red : TOKENS.redSoft,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: TOKENS.ink, display: 'flex', alignItems: 'center', gap: 6 }}>
          {label}{badge}
        </div>
        {hint && <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 2 }}>{hint}</div>}
      </div>
      <I.ChevronR size={17} color={TOKENS.inkMuted} />
    </button>
  );
}

// 货架照片占位（原型中代替真实拍照）
function PhotoPh({ label = '货架照片', h = 190, seed = 0, style = {} }) {
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

// 分段控制器（结果页：销售数据 / 诊断结论 / 调改方案）
function SegTabs({ tabs, active, onChange }) {
  return (
    <div style={{
      display: 'flex', padding: 3, borderRadius: 999,
      background: '#eee9e1', border: `1px solid ${TOKENS.line}`, gap: 0,
    }}>
      {tabs.map((t) => {
        const isActive = t.key === active;
        const locked = t.locked;
        return (
          <button key={t.key} onClick={() => !locked && onChange(t.key)} style={{
            appearance: 'none', border: 0, flex: 1, padding: '8px 4px', borderRadius: 999,
            fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
            cursor: locked ? 'not-allowed' : 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
            background: isActive ? '#fff' : 'transparent',
            color: locked ? '#c9c2b8' : isActive ? TOKENS.red : TOKENS.inkSoft,
            boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            transition: 'background 0.15s',
          }}>
            {t.spinning && <Spin size={12} color={isActive ? TOKENS.red : TOKENS.inkMuted} />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// 数字步进器（货架层数等）—— 大按钮，适合不熟悉电子设备的店长
function NumStepper({ value, onChange, min = 1, max = 9, unit = '' }) {
  const btn = (dis) => ({
    appearance: 'none', border: `1.5px solid ${dis ? '#e5dfd6' : TOKENS.red}`,
    width: 46, height: 46, borderRadius: 14, background: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: dis ? 'not-allowed' : 'pointer', flexShrink: 0,
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'center' }}>
      <button style={btn(value <= min)} onClick={() => value > min && onChange(value - 1)}>
        <I.Minus size={20} color={value <= min ? '#d8d2c8' : TOKENS.red} />
      </button>
      <div style={{ minWidth: 76, textAlign: 'center' }}>
        <span style={{ fontSize: 34, fontWeight: 800, color: TOKENS.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        {unit && <span style={{ fontSize: 14, color: TOKENS.inkSoft, marginLeft: 3 }}>{unit}</span>}
      </div>
      <button style={btn(value >= max)} onClick={() => value < max && onChange(value + 1)}>
        <I.Plus size={20} color={value >= max ? '#d8d2c8' : TOKENS.red} />
      </button>
    </div>
  );
}

// 大选项卡（向导用：一屏一个决定，目标区域大）
function BigOption({ selected, title, hint, onClick, emoji = null }) {
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
      {emoji && <div style={{ fontSize: 26, lineHeight: 1 }}>{emoji}</div>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15.5, fontWeight: 700, color: TOKENS.ink }}>{title}</div>
        {hint && <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{
        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
        background: selected ? TOKENS.red : '#fff',
        border: selected ? `2px solid ${TOKENS.red}` : `1.5px solid ${TOKENS.line}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {selected && <I.Check size={14} color="#fff" />}
      </div>
    </button>
  );
}

// 底部固定操作区（带渐隐遮罩）
function BottomBar({ children }) {
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      padding: '14px 16px calc(env(safe-area-inset-bottom, 0px) + 16px)',
      background: 'linear-gradient(180deg, rgba(250,247,242,0) 0%, rgba(250,247,242,0.95) 35%, #faf7f2 100%)',
      display: 'flex', gap: 10, alignItems: 'center', zIndex: 50,
    }}>{children}</div>
  );
}

// 入场动画播完即移除（避免重渲染/截图时卡在第 0 帧）
const clearAnim = (e) => { e.currentTarget.style.animation = 'none'; };

Object.assign(window, {
  TOKENS, I, AppBar, PrimaryBtn, GhostBtn, Card, Chip, Spin, Toast,
  FlowSteps, ListRow, PhotoPh, SegTabs, NumStepper, BigOption, BottomBar, clearAnim,
});
