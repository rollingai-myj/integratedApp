import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Strategy } from "@/components/shelves/contexts/AppContext";
import { getSkuImageUrl } from "@/components/shelves/lib/virtualShelfLayout";
import { getSkuBarcodeUrl } from "@/components/shelves/lib/preloadSkuAssets";

type StrategySku = Strategy["skus"][number];

interface Props {
  sku: StrategySku | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/50 last:border-b-0">
    <span className="text-xs text-muted-foreground shrink-0">{label}</span>
    <span className="text-xs text-foreground text-right break-all">{children}</span>
  </div>
);

export const SkuBarcodeDialog = ({ sku, open, onOpenChange }: Props) => {
  const [imgError, setImgError] = useState(false);
  const [productImgError, setProductImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
    setProductImgError(false);
  }, [sku?.skuCode]);

  if (!sku) return null;

  const barcodeUrl = getSkuBarcodeUrl(sku.skuCode)!;
  const productUrl = getSkuImageUrl(sku.skuCode);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base pr-6 break-all">{sku.skuName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-white p-3 flex items-center justify-center h-[200px]">
            {productUrl && !productImgError ? (
              <img
                src={productUrl}
                alt={sku.skuName}
                className="max-w-full max-h-full object-contain"
                onError={() => setProductImgError(true)}
              />
            ) : (
              <span className="text-xs text-muted-foreground">暂无商品图</span>
            )}
          </div>
          <div className="space-y-0">
            <Row label="商品名称">{sku.skuName}</Row>
            <Row label="规格">{sku.spec || "—"}</Row>
            <Row label="商品代码">{sku.skuCode}</Row>
          </div>
          <div className="rounded-md border bg-white p-3 flex items-center justify-center min-h-[120px]">
            {imgError ? (
              <span className="text-xs text-muted-foreground">暂无条码图片</span>
            ) : (
              <img
                src={barcodeUrl}
                alt={`${sku.skuName} 条码`}
                className="max-w-full h-auto"
                onError={() => setImgError(true)}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
