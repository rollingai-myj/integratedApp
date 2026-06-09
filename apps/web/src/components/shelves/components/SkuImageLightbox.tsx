/**
 * Large product image lightbox.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getSkuImageUrl } from "@/components/shelves/lib/virtualShelfLayout";

interface Props {
  skuCode: string | null;
  skuName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SkuImageLightbox = ({ skuCode, skuName, open, onOpenChange }: Props) => {
  const [failed, setFailed] = useState(false);
  const url = skuCode ? getSkuImageUrl(skuCode) : null;
  return (
    <Dialog open={open} onOpenChange={(o) => { setFailed(false); onOpenChange(o); }}>
      <DialogContent className="max-w-md p-4">
        <DialogTitle className="text-sm pr-6 break-all">{skuName || skuCode}</DialogTitle>
        <div className="rounded-md border bg-white p-3 flex items-center justify-center aspect-square">
          {url && !failed ? (
            <img
              src={url}
              alt={skuName || skuCode || ""}
              className="max-w-full max-h-full object-contain"
              onError={() => setFailed(true)}
            />
          ) : (
            <span className="text-xs text-muted-foreground">暂无商品图</span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
