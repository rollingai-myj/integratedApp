/**
 * 选品模块图标 —— 与设计稿一致的描边 SVG（1.8 描边，圆角端点）
 */
import type { ReactNode } from 'react';

function svg(paths: string[], { size = 22, color = 'currentColor' } = {}): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block', flexShrink: 0 }}>
      {paths.map((d, i) => (
        <path key={i} d={d} stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ))}
    </svg>
  );
}

type IconProps = { size?: number; color?: string };

export const I = {
  Back: (p?: IconProps) => svg(['M15 5l-7 7 7 7'], p),
  ChevronR: (p?: IconProps) => svg(['M9 5l7 7-7 7'], p),
  ChevronD: (p?: IconProps) => svg(['M5 9l7 7 7-7'], p),
  Check: (p?: IconProps) => svg(['M4.5 12.5l5 5 10-11'], p),
  Plus: (p?: IconProps) => svg(['M12 5v14M5 12h14'], p),
  Minus: (p?: IconProps) => svg(['M5 12h14'], p),
  Close: (p?: IconProps) => svg(['M6 6l12 12M18 6L6 18'], p),
  Camera: (p?: IconProps) => svg(['M4 8h3l2-2.5h6L17 8h3v11H4z', 'M12 16.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z'], p),
  Sparkles: (p?: IconProps) => svg(['M12 4l1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7z'], p),
  Clock: (p?: IconProps) => svg(['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 7.5V12l3 2'], p),
  History: (p?: IconProps) => svg(['M3 12a9 9 0 109-9 9 9 0 00-7.5 4M3 4v4h4', 'M12 7v5l3 2'], p),
  Gear: (p?: IconProps) => svg(['M12 15.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z', 'M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 005.4 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 002 1.2l.4 2.6h4l.4-2.6a7 7 0 002-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z'], p),
  Shelf: (p?: IconProps) => svg(['M4 4h16M4 12h16M4 20h16', 'M6.5 8.8V12M11 7v5M15.5 9.5V12M8 16.5V20M13.5 15.5V20'], p),
  Trash: (p?: IconProps) => svg(['M5 7h14M9.5 7V4.5h5V7M7 7l1 13h8l1-13'], p),
  TrendUp: (p?: IconProps) => svg(['M4 17l5.5-5.5 3.5 3.5L20 8', 'M14.5 8H20v5.5'], p),
  TrendDown: (p?: IconProps) => svg(['M4 8l5.5 5.5L13 10l7 7', 'M14.5 17H20v-5.5'], p),
  Eye: (p?: IconProps) => svg(['M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z', 'M12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z'], p),
  Alert: (p?: IconProps) => svg(['M12 4l9 16H3z', 'M12 10.5v3.5', 'M12 17.2v.1'], p),
  Doc: (p?: IconProps) => svg(['M6 3.5h8.5L19 8v12.5H6z', 'M14 3.5V8.5h5', 'M9 12.5h6M9 16h6'], p),
  Store: (p?: IconProps) => svg(['M4 9.5L5.5 4h13L20 9.5', 'M5.5 12v8h13v-8', 'M9.5 20v-5h5v5'], p),
  ArrowR: (p?: IconProps) => svg(['M5 12h14M13 6l6 6-6 6'], p),
  Question: (p?: IconProps) => svg(['M9.2 9a3 3 0 115 2.2c-.9.8-2.2 1.3-2.2 2.8', 'M12 17.4v.1'], p),
  Send: (p?: IconProps) => svg(['M20 4L4 11.5l6.5 2 2 6.5z', 'M20 4l-9.5 9.5'], p),
  Chat: (p?: IconProps) => svg(['M4 5h16v11H9l-4.5 3.5V5z'], p),
};
