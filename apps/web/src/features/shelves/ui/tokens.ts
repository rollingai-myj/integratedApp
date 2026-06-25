/**
 * 选品模块的设计 tokens。
 *
 * 颜色沿用海报模块的红色系，避免品牌断层；新 token 集独立维护避免与
 * components/shelves 旧版混淆。
 */
export const TOKENS = {
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
  orange: '#ff8c1a',
  orangeSoft: '#fff4e6',

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
} as const;
