/**
 * Design tokens — PC 版超管控制台
 *
 * 视觉沿用手机端品牌色(美宜佳红 + 暖白底),但放大尺寸 / 间距以适应桌面阅读距离。
 */
export const TOKENS = {
  // 品牌色(与 apps/web 一致)
  red: '#E11D2A',
  redDark: '#B8121F',
  redSoft: '#FEE8E9',
  redInk: '#5C0A11',

  // 中性色
  ink: '#1A1714',
  inkSoft: '#5C544D',
  inkMuted: '#9A9189',
  inkDisabled: '#C9C2BA',
  line: 'rgba(0,0,0,0.08)',
  lineSoft: 'rgba(0,0,0,0.05)',

  // 背景
  bg: '#FAF7F2',
  bgWarm: '#F4EFE7',
  card: '#FFFFFF',

  // 强调
  success: '#10B981',
  warn: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',

  shadow1: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
  shadow2: '0 4px 16px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.05)',
  shadow3: '0 12px 32px rgba(225,29,42,0.18), 0 4px 12px rgba(225,29,42,0.12)',

  // 半径
  r1: 6, r2: 8, r3: 10, r4: 12, r5: 16, r6: 20,

  // 字号 — 桌面端比手机大一号
  fXs: 12, fSm: 13, fBase: 14, fMd: 15, fLg: 17, fXl: 20, f2xl: 24, f3xl: 30, f4xl: 36,
} as const;

export const SIDEBAR_WIDTH = 240;
export const TOPBAR_HEIGHT = 56;
export const CONTENT_MAX_WIDTH = 1440;
