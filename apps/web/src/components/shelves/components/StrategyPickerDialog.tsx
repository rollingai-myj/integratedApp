import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChevronDown, Sparkles, TrendingUp } from "lucide-react";
import { cn } from "@/components/shelves/lib/utils";
import type { Strategy } from "@/components/shelves/contexts/AppContext";

import { isRemoveAction, actionBadgeClass, classifyAction, type StrategyActionKind } from "@/components/shelves/lib/strategyAction";
import { SkuThumbnail } from "@/components/shelves/components/SkuThumbnail";
import { SkuImageLightbox } from "@/components/shelves/components/SkuImageLightbox";

const ACTION_SORT_ORDER: Record<StrategyActionKind, number> = {
  remove: 0,
  observe: 1,
  push: 2,
};

interface StrategyPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strategies: Strategy[];
  onApply: (index: number) => void;
}

export const StrategyPickerDialog = ({ open, onOpenChange, strategies, onApply }: StrategyPickerDialogProps) => {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(strategies.length === 1 ? 0 : null);
  const [lightboxSku, setLightboxSku] = useState<{ code: string; name: string } | null>(null);

  // Calculate volume growth potential for each strategy
  const volumePotentials = useMemo(() => {
    return strategies.map(strategy => {
      let removedVolume = 0;
      let pushedVolume = 0;
      strategy.skus.forEach(sku => {
        const volume = parseFloat(sku.salesVolume30d || "0") || 0;
        if (sku.action.includes("下架")) removedVolume += volume;
        else if (sku.action.includes("陈列") || sku.action.includes("推") || sku.action.includes("力推") || sku.action.includes("上架")) pushedVolume += volume;
      });
      return parseFloat(((pushedVolume - removedVolume) / 90 * 30).toFixed(1));
    });
  }, [strategies]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto p-0">
        <DialogHeader className="p-4 pb-2 sticky top-0 bg-background z-10 border-b">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg ai-gradient flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <DialogTitle className="text-base">AI 优化策略</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                {strategies.length === 1 ? "AI 优化建议，确认后应用" : `已生成 ${strategies.length} 条优化策略，请选择一条应用`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-4 pt-3 space-y-3">
          {strategies.map((strategy, idx) => (
            <Collapsible
              key={idx}
              open={expandedIdx === idx}
              onOpenChange={(open) => setExpandedIdx(open ? idx : null)}
            >
              <Card className="overflow-hidden border">
                <CollapsibleTrigger className="w-full">
                  <div className="py-3 px-4 flex items-start justify-between gap-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="w-7 h-7 rounded-lg ai-gradient flex items-center justify-center text-white text-sm font-bold shrink-0 mt-0.5">
                        {idx + 1}
                      </div>
                      <div className="text-left min-w-0 flex-1">
                        <p className="text-sm font-semibold break-words leading-snug">{strategy.name}</p>
                        {strategy.description && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 break-words">{strategy.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary" className="text-[10px]">{strategy.skus.length} 个SKU</Badge>
                        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", expandedIdx === idx && "rotate-180")} />
                      </div>
                      <div className={cn(
                        "flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded",
                        volumePotentials[idx] >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                      )}>
                        <TrendingUp className="w-3 h-3" />
                        {volumePotentials[idx] >= 0 ? "+" : ""}{volumePotentials[idx]}件/月
                      </div>
                    </div>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 pb-3 space-y-2 border-t pt-3">
                    {[...strategy.skus].sort((a, b) => ACTION_SORT_ORDER[classifyAction(a.action)] - ACTION_SORT_ORDER[classifyAction(b.action)]).map((sku, si) => (
                      <div key={si} className="flex items-start gap-2 text-xs p-2 bg-muted/40 rounded-lg">
                        <SkuThumbnail
                          skuCode={sku.skuCode}
                          skuName={sku.skuName}
                          size={32}
                          onClick={(e) => { e.stopPropagation(); setLightboxSku({ code: sku.skuCode, name: sku.skuName }); }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{sku.skuName}{sku.spec ? <span className="font-normal text-muted-foreground"> | {sku.spec}</span> : null}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{sku.reason}</p>
                        </div>
                        <Badge className={cn(
                          "text-[9px] shrink-0",
                          actionBadgeClass(sku.action)
                        )}>
                          {sku.action}
                        </Badge>
                      </div>
                    ))}
                    <Button
                      className="w-full mt-2 ai-gradient text-white"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onApply(idx);
                      }}
                    >
                      应用此策略
                    </Button>
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ))}
        </div>
      </DialogContent>
      <SkuImageLightbox
        skuCode={lightboxSku?.code ?? null}
        skuName={lightboxSku?.name}
        open={!!lightboxSku}
        onOpenChange={(o) => { if (!o) setLightboxSku(null); }}
      />
    </Dialog>
  );
};
