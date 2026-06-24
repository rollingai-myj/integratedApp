type IconProps = { size?: number; color?: string };

export const Icon = {
  Image: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke={color} strokeWidth="1.8"/>
      <circle cx="9" cy="10" r="1.6" stroke={color} strokeWidth="1.6"/>
      <path d="M4 17l4.5-4.5a1.5 1.5 0 012.1 0L15 17m1-3l1.4-1.4a1.5 1.5 0 012.1 0L20 13" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Camera: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9 4l-2 3H4a1 1 0 00-1 1v11a1 1 0 001 1h16a1 1 0 001-1V8a1 1 0 00-1-1h-3l-2-3H9z" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
      <circle cx="12" cy="13" r="4" stroke={color} strokeWidth="1.8"/>
    </svg>
  ),
  Check: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5 12l4.5 4.5L19 7" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Back: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M15 5l-7 7 7 7" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Home: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 11.5L12 4l9 7.5M5 10.5V20h14V10.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Close: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth="2.2" strokeLinecap="round"/>
    </svg>
  ),
  Download: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 4v12m0 0l-5-5m5 5l5-5" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4 19h16" stroke={color} strokeWidth="2.2" strokeLinecap="round"/>
    </svg>
  ),
  Copy: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="8" y="8" width="12" height="12" rx="2.5" stroke={color} strokeWidth="1.9"/>
      <path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8" stroke={color} strokeWidth="1.9" strokeLinecap="round"/>
    </svg>
  ),
  Refresh: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M20 12a8 8 0 11-2.5-5.8M20 4v4h-4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Sparkles: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" fill={color}/>
      <path d="M19 14l.8 2 2 .8-2 .8L19 20l-.8-2-2-.8 2-.8L19 14z" fill={color} opacity="0.7"/>
    </svg>
  ),
  Sun: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="4" stroke={color} strokeWidth="1.8"/>
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  Store: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 9l1.5-4.5h15L21 9M3 9v10h18V9M3 9h18" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
      <path d="M9 19v-5h6v5" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
    </svg>
  ),
  Tag: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 4h7l9 9-7 7-9-9V4z" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
      <circle cx="8" cy="8" r="1.4" fill={color}/>
    </svg>
  ),
  Search: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke={color} strokeWidth="1.9"/>
      <path d="M16 16l4 4" stroke={color} strokeWidth="1.9" strokeLinecap="round"/>
    </svg>
  ),
  Share: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 3v13m0-13l-4 4m4-4l4 4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M5 13v6a1 1 0 001 1h12a1 1 0 001-1v-6" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
  Flash: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
    </svg>
  ),
  WeChat: ({ size = 24, color = 'currentColor' }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <ellipse cx="9" cy="9.5" rx="6.5" ry="5.5" stroke={color} strokeWidth="1.8"/>
      <circle cx="7" cy="9" r="0.9" fill={color}/>
      <circle cx="11" cy="9" r="0.9" fill={color}/>
      <ellipse cx="16" cy="15" rx="5" ry="4.2" stroke={color} strokeWidth="1.8"/>
      <circle cx="14.5" cy="14.5" r="0.7" fill={color}/>
      <circle cx="17.5" cy="14.5" r="0.7" fill={color}/>
    </svg>
  ),
};
