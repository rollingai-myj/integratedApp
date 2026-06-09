import { useState, useMemo, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingDown, TrendingUp, Star, Eye, ListChecks, RefreshCw, Sparkles, CheckSquare, Square } from "lucide-react";
import { cn } from "@/components/shelves/lib/utils";
import type { Strategy } from "@/components/shelves/contexts/AppContext";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StrategyPickerDialog } from "@/components/shelves/components/StrategyPickerDialog";
import { classifyAction, actionBadgeClass, type StrategyActionKind } from "@/components/shelves/lib/strategyAction";
import { SkuBarcodeDialog } from "@/components/shelves/components/SkuBarcodeDialog";
import { SkuThumbnail } from "@/components/shelves/components/SkuThumbnail";
import { SkuCorrectionDialog } from "@/components/shelves/components/SkuCorrectionDialog";
import { listCorrectionsByStore, type SkuCorrection } from "@/components/shelves/services/skuCorrections";

type StrategySku = Strategy["skus"][number];

function useStrategyMetrics(strategy: Strategy) {
  return useMemo(() => {
    let removedCount = 0;
    let pushedCount = 0;
    let observeCount = 0;
    let removedSales = 0;
    let pushedSales = 0;
    let removedVolume = 0;
    let pushedVolume = 0;
    let removeLabel = "下架商品";
    let pushLabel = "上架商品";
    let observeLabel = "保留观察";
    let removeLabelSet = false;
    let pushLabelSet = false;
    let observeLabelSet = false;

    strategy.skus.forEach((sku) => {
      const a = sku.action || "";
      const kind = classifyAction(a);
      const sales = parseFloat(sku.sales30d || "0") || 0;
      const volume = parseFloat(sku.salesVolume30d || "0") || 0;
      if (kind === "remove") {
        removedCount++;
        removedSales += sales;
        removedVolume += volume;
        if (!removeLabelSet && a) { removeLabel = a; removeLabelSet = true; }
      } else if (kind === "observe") {
        observeCount++;
        if (!observeLabelSet && a) { observeLabel = a; observeLabelSet = true; }
      } else if (a) {
        pushedCount++;
        pushedSales += sales;
        pushedVolume += volume;
        if (!pushLabelSet) { pushLabel = a; pushLabelSet = true; }
      }
    });

    const salesGrowth = parseFloat((pushedSales - removedSales).toFixed(2));
    const volumeGrowth = parseFloat((pushedVolume - removedVolume).toFixed(2));
    return { removedCount, pushedCount, observeCount, salesGrowth, volumeGrowth, removeLabel, pushLabel, observeLabel };
  }, [strategy]);
}

/** 解析规格字符串中的数值 (ml/g/kg) */
function parseSpec(spec: string | undefined): number | null {
  if (!spec) return null;
  const m = spec.match(/(\d+(?:\.\d+)?)\s*(ml|毫升|g|克|kg|千克|L|升)/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === "kg" || unit === "千克" || unit === "l" || unit === "升") return v * 1000;
  return v;
}

/** 根据规格返回进货档位与推荐进货量 */
export function getPurchaseSpec(spec: string | undefined): { stepUnit: number; recommended: number } {
  const v = parseSpec(spec);
  if (v === null) return { stepUnit: 1, recommended: 4 };
  if (v <= 100) return { stepUnit: 2, recommended: 8 };
  if (v <= 250) return { stepUnit: 1, recommended: 2 };
  if (v <= 500) return { stepUnit: 1, recommended: 3 };
  return { stepUnit: 1, recommended: 4 };
}

// ============= Module A: Header + cards =============
export const StrategyHeaderSection = ({
  strategy, strategies, onSwitchStrategy, onReoptimize, isReoptimizing,
}: {
  strategy: Strategy;
  strategies: Strategy[];
  onSwitchStrategy: (idx: number) => void;
  onReoptimize?: () => void;
  isReoptimizing?: boolean;
}) => {
  const [showPicker, setShowPicker] = useState(false);
  const metrics = useStrategyMetrics(strategy);

  const showObserve = metrics.observeCount > 0;
  const actionCards = [
    { icon: TrendingDown, label: metrics.removeLabel, value: metrics.removedCount, unit: "个", color: "text-red-500", bg: "bg-red-50", iconBg: "bg-red-100", description: "释放货架空间，优化商品结构" },
    ...(showObserve ? [{ icon: Eye, label: metrics.observeLabel, value: metrics.observeCount, unit: "个", color: "text-amber-600", bg: "bg-amber-50", iconBg: "bg-amber-100", description: "暂不调整，持续跟踪表现" }] : []),
    { icon: Star, label: metrics.pushLabel, value: metrics.pushedCount, unit: "个", color: "text-green-600", bg: "bg-green-50", iconBg: "bg-green-100", description: "增加陈列面和曝光度" },
  ];
  const growthCards = [
    { icon: metrics.salesGrowth >= 0 ? TrendingUp : TrendingDown, label: "月均销售额预期增长潜力", value: metrics.salesGrowth, unit: "元", color: metrics.salesGrowth >= 0 ? "text-green-600" : "text-red-500", bg: metrics.salesGrowth >= 0 ? "bg-green-50" : "bg-red-50", iconBg: metrics.salesGrowth >= 0 ? "bg-green-100" : "bg-red-100", description: "基于上架与下架商品的月均销售额差" },
    { icon: metrics.volumeGrowth >= 0 ? TrendingUp : TrendingDown, label: "月均销量预期增长潜力", value: metrics.volumeGrowth, unit: "件", color: metrics.volumeGrowth >= 0 ? "text-green-600" : "text-red-500", bg: metrics.volumeGrowth >= 0 ? "bg-green-50" : "bg-red-50", iconBg: metrics.volumeGrowth >= 0 ? "bg-green-100" : "bg-red-100", description: "基于上架与下架商品的月均销量差" },
  ];

  return (
    <div className="space-y-4">
      <StrategyPickerDialog
        open={showPicker}
        onOpenChange={setShowPicker}
        strategies={strategies}
        onApply={(idx) => { setShowPicker(false); onSwitchStrategy(idx); }}
      />

      <div className="text-center space-y-1">
        <h2 className="text-base font-bold flex items-center justify-center gap-2">
          <span className="w-1.5 h-6 rounded-full ai-gradient inline-block" />
          {strategy.name}
        </h2>
        {strategy.description && (
          <p className="text-xs text-muted-foreground">{strategy.description}</p>
        )}
      </div>

      {(() => {
        const renderCard = (card: typeof actionCards[number], i: number) => {
          const Icon = card.icon;
          return (
            <Card key={i} className={cn(card.bg, "border-none shadow-sm overflow-hidden")}>
              <CardContent className="p-2.5 text-center space-y-1.5">
                <div className={cn("inline-flex items-center justify-center w-8 h-8 rounded-xl", card.iconBg)}>
                  <Icon className={cn("w-4 h-4", card.color)} />
                </div>
                <div>
                  <div className={cn("text-xl font-black tracking-tight flex items-center justify-center", card.color)}>
                    {card.value}
                    <span className="text-xs ml-0.5 font-bold">{card.unit}</span>
                  </div>
                  <p className="text-[10px] font-semibold text-foreground mt-0.5">{card.label}</p>
                  <p className="text-[9px] text-muted-foreground mt-0.5">{card.description}</p>
                </div>
              </CardContent>
            </Card>
          );
        };
        return (
          <div className="space-y-2">
            <div className={cn("grid gap-2", showObserve ? "grid-cols-3" : "grid-cols-2")}>
              {actionCards.map(renderCard)}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {growthCards.map(renderCard)}
            </div>
          </div>
        );
      })()}

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setShowPicker(true)} className="flex-1 h-9 text-xs">
          <ListChecks className="w-3.5 h-3.5 mr-1.5" />
          其他优化建议
        </Button>
        {onReoptimize && (
          <Button
            variant="outline"
            onClick={onReoptimize}
            disabled={isReoptimizing}
            className="flex-1 h-9 text-xs border-primary/30 text-primary hover:bg-primary/5"
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", isReoptimizing && "animate-spin")} />
            重新优化
          </Button>
        )}
      </div>
    </div>
  );
};

/** 裸按钮：查看优化后陈列 */
export const ViewVirtualShelfButton = ({
  onClick, hasVirtualShelf, isGeneratingVirtualShelf,
}: {
  onClick: () => void;
  hasVirtualShelf?: boolean;
  isGeneratingVirtualShelf?: boolean;
}) => {
  if (hasVirtualShelf || isGeneratingVirtualShelf) return null;
  return (
    <Button
      onClick={onClick}
      className="w-full h-10 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
    >
      <Sparkles className="w-3.5 h-3.5 mr-1.5" /> 查看优化后陈列
    </Button>
  );
};

/** 模块B: 商品调整列表（按操作类型排序，行可点击查看条码） */
const ACTION_SORT_ORDER: Record<StrategyActionKind, number> = {
  remove: 0,
  observe: 1,
  push: 2,
};

export const StrategyTableSection = ({
  strategy,
  storeId,
  shelfId,
  readOnly,
}: {
  strategy: Strategy;
  storeId?: string;
  shelfId?: string | null;
  readOnly?: boolean;
}) => {
  const [selectedSku, setSelectedSku] = useState<StrategySku | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<{ sku: StrategySku; kind: "remove" | "add" } | null>(null);
  const [corrections, setCorrections] = useState<SkuCorrection[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!storeId) { setCorrections([]); return; }
    let cancelled = false;
    listCorrectionsByStore(storeId).then((rows) => { if (!cancelled) setCorrections(rows); });
    return () => { cancelled = true; };
  }, [storeId, reloadKey]);

  const correctionMap = useMemo(() => {
    const map = new Map<string, SkuCorrection>();
    for (const c of corrections) map.set(`${c.correction_kind}:${c.sku_code}`, c);
    return map;
  }, [corrections]);

  const showCorrection = !readOnly && !!storeId;

  const sortedSkus = useMemo(() => {
    return [...strategy.skus].sort((a, b) => {
      const oa = ACTION_SORT_ORDER[classifyAction(a.action)];
      const ob = ACTION_SORT_ORDER[classifyAction(b.action)];
      return oa - ob;
    });
  }, [strategy]);


  return (
    <div className="space-y-3 min-w-0">
      <Card className="min-w-0">
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold shrink-0">商品调整列表</span>
              <span className="text-[10px] text-muted-foreground truncate">点击商品查看条码</span>
            </div>
            <Badge variant="secondary" className="text-[10px] shrink-0">{strategy.skus.length} 个商品</Badge>
          </div>
          <Table wrapperClassName="overflow-x-hidden" className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs px-2">商品名称</TableHead>
                <TableHead className="text-xs w-[96px] text-center px-1">标签 &amp; 操作</TableHead>
                {showCorrection && (
                  <TableHead className="text-xs w-[44px] text-center px-1">勘误</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedSkus.map((sku, i) => {
                const kind = classifyAction(sku.action);
                const correctionKind: "remove" | "add" | null =
                  kind === "remove" ? "remove" : kind === "push" ? "add" : null;
                const existing = correctionKind
                  ? correctionMap.get(`${correctionKind}:${sku.skuCode}`)
                  : undefined;
                return (
                  <TableRow
                    key={`${sku.skuCode}-${i}`}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setSelectedSku(sku)}
                  >
                    <TableCell className="py-2 px-2">
                      <div className="flex items-start gap-2 min-w-0">
                        <SkuThumbnail skuCode={sku.skuCode} skuName={sku.skuName} size={32} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">
                            {sku.skuName}
                            {sku.spec ? <span className="text-muted-foreground font-normal"> | {sku.spec}</span> : null}
                          </p>
                          {sku.reason && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{sku.reason}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-2 text-center align-middle w-[96px] px-1">
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        {Array.isArray(sku.tags) && sku.tags.map((tag, ti) => (
                          <span key={ti} className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground whitespace-nowrap">{tag}</span>
                        ))}
                        <Badge className={cn(
                          "text-[9px] shrink-0 inline-flex items-center justify-center whitespace-nowrap px-1.5 py-1 rounded-full",
                          actionBadgeClass(sku.action)
                        )}>
                          {sku.action}
                        </Badge>
                      </div>
                    </TableCell>
                    {showCorrection && (
                      <TableCell className="py-2 text-center align-middle w-[44px] px-1">
                        {correctionKind ? (
                          <button
                            type="button"
                            className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-muted transition-colors"
                            onClick={(e) => { e.stopPropagation(); setCorrectionTarget({ sku, kind: correctionKind }); }}
                          >
                            {existing
                              ? <Square className="w-4 h-4 text-muted-foreground" />
                              : <CheckSquare className="w-4 h-4 text-primary" />}
                          </button>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <SkuBarcodeDialog
        sku={selectedSku}
        open={!!selectedSku}
        onOpenChange={(o) => { if (!o) setSelectedSku(null); }}
      />
      {correctionTarget && storeId && (
        <SkuCorrectionDialog
          open={!!correctionTarget}
          onOpenChange={(o) => { if (!o) setCorrectionTarget(null); }}
          kind={correctionTarget.kind}
          skuCode={correctionTarget.sku.skuCode}
          skuName={correctionTarget.sku.skuName}
          storeId={storeId}
          shelfId={shelfId ?? null}
          existing={correctionMap.get(`${correctionTarget.kind}:${correctionTarget.sku.skuCode}`) ?? null}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
};


/** 裸按钮：跳转至商品管理（保留导出供 ShelfVisualization 使用） */
export const JumpToProductButton = () => null;

interface Props {
  strategy: Strategy;
  strategies: Strategy[];
  onSwitchStrategy: (index: number) => void;
  onReoptimize?: () => void;
  isReoptimizing?: boolean;
  onGenerateVirtualShelf?: () => void;
  hasVirtualShelf?: boolean;
  isGeneratingVirtualShelf?: boolean;
  storeId?: string;
  shelfId?: string | null;
  readOnly?: boolean;
}

/** 向后兼容：组合所有子段 */
export const StrategyResultInline = ({
  strategy, strategies, onSwitchStrategy, onReoptimize, isReoptimizing,
  onGenerateVirtualShelf, hasVirtualShelf, isGeneratingVirtualShelf,
  storeId, shelfId, readOnly,
}: Props) => {
  return (
    <div className="space-y-4">
      <StrategyHeaderSection
        strategy={strategy}
        strategies={strategies}
        onSwitchStrategy={onSwitchStrategy}
        onReoptimize={onReoptimize}
        isReoptimizing={isReoptimizing}
      />
      {onGenerateVirtualShelf && (
        <ViewVirtualShelfButton
          onClick={onGenerateVirtualShelf}
          hasVirtualShelf={hasVirtualShelf}
          isGeneratingVirtualShelf={isGeneratingVirtualShelf}
        />
      )}
      <StrategyTableSection strategy={strategy} storeId={storeId} shelfId={shelfId ?? null} readOnly={readOnly} />
    </div>
  );
};
