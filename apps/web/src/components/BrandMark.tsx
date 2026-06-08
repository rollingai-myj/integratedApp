interface Props {
  size?: number;
  /** background color of the rounded tile */
  bg?: string;
  /** color of the house glyph */
  fg?: string;
}

/** 美宜佳 门店助手 logo — small house in a rounded square tile. */
export function BrandMark({ size = 40, bg = "var(--primary)", fg = "#fff" }: Props) {
  return (
    <div
      style={{
        width: size,
        height: size,
        background: bg,
        borderRadius: size * 0.26,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 2px 6px -1px rgba(0,0,0,0.12)",
      }}
    >
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none">
        {/* roof */}
        <path d="M3 11.5L12 4l9 7.5" stroke={fg} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {/* body */}
        <path d="M5 10.5V19a1 1 0 001 1h12a1 1 0 001-1v-8.5" stroke={fg} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {/* door */}
        <rect x="10" y="13" width="4" height="7" rx="0.4" fill={fg} />
      </svg>
    </div>
  );
}
