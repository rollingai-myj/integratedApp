import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingDown, TrendingUp, Star, Image as ImageIcon, Sparkles, Loader2, ListChecks } from "lucide-react";
import { cn } from "@/components/shelves/lib/utils";
import type { Strategy } from "@/components/shelves/contexts/AppContext";
import { StrategyPickerDialog } from "@/components/shelves/components/StrategyPickerDialog";
import { StrategyTableSection } from "@/components/shelves/components/StrategyResultInline";
import { useMemo } from "react";

interface StrategyResultPageProps {
  strategy: Strategy;
  strategies: Strategy[];
  onClose: () => void;
  onGenerateVirtualShelf: () => void;
  hasVirtualShelf?: boolean;
  onViewVirtualShelf?: () => void;
  isGeneratingVirtualShelf?: boolean;
  onSwitchStrategy: (index: number) => void;
  storeId?: string;
  shelfId?: string | null;
  readOnly?: boolean;
}

export const StrategyResultPage = ({ strategy, strategies, onClose, onGenerateVirtualShelf, hasVirtualShelf, onViewVirtualShelf, isGeneratingVirtualShelf, onSwitchStrategy, storeId, shelfId, readOnly }: StrategyResultPageProps) => {
  const [showPicker, setShowPicker] = useState(false);

  const isRemoveAction = (a: string) => /下架|停止|清退|淘汰/.test(a);

  const metrics = useMemo(() => {
    let removedCount = 0;
    let pushedCount = 0;
    let removedSales = 0;
    let pushedSales = 0;
    let removedVolume = 0;
    let pushedVolume = 0;
    let removeLabel = "下架商品";
    let pushLabel = "上架商品";
    let removeLabelSet = false;
    let pushLabelSet = false;

    strategy.skus.forEach((sku) => {
      const a = sku.action || "";
      const sales = parseFloat(sku.sales30d || "0") || 0;
      const volume = parseFloat(sku.salesVolume30d || "0") || 0;
      if (isRemoveAction(a)) {
        removedCount++;
        removedSales += sales;
        removedVolume += volume;
        if (!removeLabelSet && a) { removeLabel = a; removeLabelSet = true; }
      } else if (a) {
        pushedCount++;
        pushedSales += sales;
        pushedVolume += volume;
        if (!pushLabelSet) { pushLabel = a; pushLabelSet = true; }
      }
    });

    const salesGrowth = parseFloat(((pushedSales - removedSales) / 90 * 30).toFixed(2));
    const volumeGrowth = parseFloat(((pushedVolume - removedVolume) / 90 * 30).toFixed(2));
    return { removedCount, pushedCount, salesGrowth, volumeGrowth, removeLabel, pushLabel };
  }, [strategy]);

  const cards = [
    { icon: TrendingDown, label: metrics.removeLabel, value: metrics.removedCount, unit: "个", color: "text-red-500", bg: "bg-red-50", iconBg: "bg-red-100", description: "释放货架空间，优化商品结构" },
    { icon: Star, label: metrics.pushLabel, value: metrics.pushedCount, unit: "个", color: "text-green-600", bg: "bg-green-50", iconBg: "bg-green-100", description: "增加陈列面和曝光度" },
    { icon: metrics.salesGrowth >= 0 ? TrendingUp : TrendingDown, label: "月均销售额预期增长潜力", value: metrics.salesGrowth, unit: "元", color: metrics.salesGrowth >= 0 ? "text-green-600" : "text-red-500", bg: metrics.salesGrowth >= 0 ? "bg-green-50" : "bg-red-50", iconBg: metrics.salesGrowth >= 0 ? "bg-green-100" : "bg-red-100", description: "基于上架与下架商品的月均销售额差" },
    { icon: metrics.volumeGrowth >= 0 ? TrendingUp : TrendingDown, label: "月均销量预期增长潜力", value: metrics.volumeGrowth, unit: "件", color: metrics.volumeGrowth >= 0 ? "text-green-600" : "text-red-500", bg: metrics.volumeGrowth >= 0 ? "bg-green-50" : "bg-red-50", iconBg: metrics.volumeGrowth >= 0 ? "bg-green-100" : "bg-red-100", description: "基于上架与下架商品的月均销量差" },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center justify-between">
        <button onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
          返回货架详情
        </button>
        <span />
      </div>

      <StrategyPickerDialog
        open={showPicker}
        onOpenChange={setShowPicker}
        strategies={strategies}
        onApply={(idx) => {
          setShowPicker(false);
          onSwitchStrategy(idx);
        }}
      />

      <div className="max-w-3xl mx-auto p-4 space-y-6 pb-12">
        <div className="text-center space-y-1">
          <h2 className="text-xl font-bold flex items-center justify-center gap-2">
            <span className="w-1.5 h-7 rounded-full ai-gradient inline-block" />
            {strategy.name}
          </h2>
          {strategy.description && (
            <p className="text-sm text-muted-foreground">{strategy.description}</p>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {cards.map((card, i) => {
            const Icon = card.icon;
            return (
              <Card key={i} className={cn(card.bg, "border-none shadow-sm overflow-hidden")}>
                <CardContent className="p-3 text-center space-y-2">
                  <div className={cn("inline-flex items-center justify-center w-9 h-9 rounded-xl", card.iconBg)}>
                    <Icon className={cn("w-4 h-4", card.color)} />
                  </div>
                  <div>
                    <div className={cn("text-2xl font-black tracking-tight flex items-center justify-center", card.color)}>
                      {card.value}
                      <span className="text-sm ml-0.5 font-bold">{card.unit}</span>
                    </div>
                    <p className="text-[11px] font-semibold text-foreground mt-1">{card.label}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">{card.description}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="space-y-2">
          <div>
            {isGeneratingVirtualShelf ? (
              <Button disabled className="w-full h-11 text-sm font-semibold shadow-md">
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                生成中...
              </Button>
            ) : hasVirtualShelf ? (
              <Button onClick={onViewVirtualShelf} className="w-full h-11 text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md">
                <ImageIcon className="w-4 h-4 mr-1.5" />
                查看优化后如何陈列
              </Button>
            ) : (
              <Button onClick={onGenerateVirtualShelf} className="w-full h-11 text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md">
                <Sparkles className="w-4 h-4 mr-1.5" />
                查看优化后如何陈列
              </Button>
            )}
          </div>
          <Button variant="outline" onClick={() => setShowPicker(true)} className="w-full h-10 text-sm">
            <ListChecks className="w-4 h-4 mr-1.5" />
            其他优化建议
          </Button>
        </div>

        <StrategyTableSection strategy={strategy} storeId={storeId} shelfId={shelfId ?? null} readOnly={readOnly} />
      </div>
    </div>
  );
};
