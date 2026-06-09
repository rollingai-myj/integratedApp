/**
 * 单品详情弹窗 - 展示与单品明细表一致的字段
 */
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type SkuRow } from "@/components/shelves/data/skuData";
import { isStaleSku } from "@/components/shelves/lib/staleSku";
import { cn } from "@/components/shelves/lib/utils";
import { getSkuImageUrl } from "@/components/shelves/lib/virtualShelfLayout";

interface Props {
  sku: SkuRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/50 last:border-b-0">
    <span className="text-xs text-muted-foreground shrink-0">{label}</span>
    <span className="text-xs text-foreground text-right break-all">{children}</span>
  </div>
);

export const SkuDetailDialog = ({ sku, open, onOpenChange }: Props) => {
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [sku?.skuCode]);

  if (!sku) return null;
  const productUrl = getSkuImageUrl(sku.skuCode);

  const vol30 = parseFloat(sku.salesVolume30d || "0").toFixed(1);
  const sales30 = parseFloat(sku.sales30d || "0").toFixed(1);
  const stale = isStaleSku(sku);

  const renderPsdChange = () => {
    const raw = sku.salesChange30d;
    if (!raw || raw === "NULL") return <span className="text-muted-foreground">—</span>;
    const val = parseFloat(raw);
    if (isNaN(val)) return <span className="text-muted-foreground">—</span>;
    const pct = (val * 100).toFixed(1);
    if (val > 0.5) return <span>🔥 {pct}%</span>;
    if (val < -0.2)
      return <span className="bg-red-50 text-red-600 rounded px-1.5">{pct}%</span>;
    return <span>{pct}%</span>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2 pr-6">
            <span className="truncate">{sku.skuName}</span>
            {stale && (
              <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-700 font-medium">
                滞销
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="rounded-md border bg-white p-3 flex items-center justify-center aspect-square mb-3">
          {productUrl && !imgError ? (
            <img
              src={productUrl}
              alt={sku.skuName}
              className="max-w-full max-h-full object-contain"
              onError={() => setImgError(true)}
            />
          ) : (
            <span className="text-xs text-muted-foreground">暂无商品图</span>
          )}
        </div>
        <div className="space-y-0">
          <Row label="商品代码">{sku.skuCode}</Row>
          <Row label="商品规格">{sku.spec || "—"}</Row>
          <Row label="小类">{sku.subCategory}</Row>
          <Row label="30日销量">{vol30}</Row>
          <Row label="30日销售额">¥{sales30}</Row>
          <Row label="销售额环比">{renderPsdChange()}</Row>
        </div>
      </DialogContent>
    </Dialog>
  );
};
