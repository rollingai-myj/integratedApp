/**
 * Square SKU thumbnail. Letterbox/pillarbox non-square images on white background.
 * Shows a small purple "活动" badge in the top-left when the SKU is in promo_skus.
 */
import { useEffect, useState } from "react";
import { getSkuImageUrl } from "@/components/shelves/lib/virtualShelfLayout";
import { cn } from "@/components/shelves/lib/utils";
import { useIsPromoSku } from "@/components/shelves/hooks/usePromoSkus";
import { preloadSkuAssets } from "@/components/shelves/lib/preloadSkuAssets";

interface Props {
  skuCode: string;
  skuName?: string;
  size?: number; // px, default 32
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  /** Hide the promo badge even if the SKU is on promotion. */
  hidePromoBadge?: boolean;
}

export const SkuThumbnail = ({ skuCode, skuName, size = 32, className, onClick, hidePromoBadge }: Props) => {
  const [failed, setFailed] = useState(false);
  const url = getSkuImageUrl(skuCode);
  const isPromo = useIsPromoSku(skuCode);
  // Warm browser cache for product image + barcode so dialogs open instantly.
  useEffect(() => { preloadSkuAssets(skuCode); }, [skuCode]);
  // Scale badge proportionally; ensure total width ≤ 2/3 of thumbnail.
  const badgeFontPx = Math.max(6, Math.min(9, Math.round(size * 0.22)));
  const badgePadX = 1;
  return (
    <div
      className={cn(
        "relative shrink-0 rounded border border-border bg-white overflow-hidden flex items-center justify-center",
        onClick && "cursor-zoom-in hover:ring-2 hover:ring-primary/40 transition",
        className,
      )}
      style={{ width: size, height: size }}
      onClick={onClick}
    >
      {url && !failed ? (
        <img
          src={url}
          alt={skuName || skuCode}
          className="max-w-full max-h-full object-contain"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-[8px] text-muted-foreground">无图</span>
      )}
      {isPromo && !hidePromoBadge && (
        <span
          className="absolute top-0 left-0 bg-purple-600 text-white font-bold leading-none rounded-br-[2px] pointer-events-none"
          style={{
            fontSize: `${badgeFontPx}px`,
            paddingLeft: `${badgePadX}px`,
            paddingRight: `${badgePadX}px`,
            paddingTop: "1px",
            paddingBottom: "1px",
            maxWidth: `${Math.floor((size * 2) / 3)}px`,
          }}
        >
          活动
        </span>
      )}
    </div>
  );
};
