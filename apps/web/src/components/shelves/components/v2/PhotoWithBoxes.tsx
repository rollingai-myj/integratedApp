import { useRef, useState } from "react";
import type { DetectMatch } from "@/components/shelves/services/scenes";

interface Props {
  src: string;
  matches?: DetectMatch[];
  /** 命中问题单品的 skuid 集合（红框） */
  problemSkuIds?: Set<string>;
}

/** 在图片上按 bbox 叠加检测框：仅问题单品红框 */
export const PhotoWithBoxes = ({ src, matches, problemSkuIds }: Props) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [nat, setNat] = useState({ w: 0, h: 0 });

  const boxes = (matches ?? []).filter(
    (m) => m.matched_sku_id && problemSkuIds?.has(m.matched_sku_id),
  );

  const sw = nat.w > 0 ? Math.max(3, nat.w / 300) : 3;

  return (
    <div className="relative inline-block max-w-full">
      <img
        ref={imgRef}
        src={src}
        onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        className="max-w-full block rounded-lg"
        alt="货架"
      />
      {nat.w > 0 && boxes.length > 0 && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox={`0 0 ${nat.w} ${nat.h}`}
          preserveAspectRatio="none"
        >
          {boxes.map((m, i) => {
            const [x1, y1, x2, y2] = m.bbox;
            const w = Math.max(0, x2 - x1);
            const h = Math.max(0, y2 - y1);
            return (
              <g key={i}>
                {/* 半透明填充增强可见性 */}
                <rect x={x1} y={y1} width={w} height={h} fill="rgba(255,59,48,0.15)" />
                <rect x={x1} y={y1} width={w} height={h} fill="none" stroke="#FF3B30" strokeWidth={sw} />
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
};
