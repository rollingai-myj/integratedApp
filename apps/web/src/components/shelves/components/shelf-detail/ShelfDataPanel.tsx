/**
 * 右侧数据面板 - 货架概览、AI优化、策略、预测
 */
import { useState, useCallback, useRef } from "react";
import { useNavigate } from "@/components/shelves/lib/router-shim";
import { type ShelfCategoryMapping } from "@/components/shelves/data/shelfConfig";
import { type SkuRow } from "@/components/shelves/data/skuData";
import { type Strategy } from "@/components/shelves/contexts/AppContext";
import { AiThinkingAnimation } from "@/components/shelves/components/AiThinkingAnimation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sparkles, ChevronDown, Check, BarChart3 } from "lucide-react";
import { cn } from "@/components/shelves/lib/utils";
import { analyzeSelection, isDifyConfigured } from "@/components/shelves/services/difyApi";
import { actionBadgeClass } from "@/components/shelves/lib/strategyAction";
import { useAppContext } from "@/components/shelves/contexts/AppContext";

interface Props {
  shelves: ShelfCategoryMapping[];
  skus: SkuRow[];
  totalSkuCount: number;
  totalSales: number;
  totalSalesVolume: number;
  strategyKey: string;
  strategies: Strategy[];
  setStrategiesForSub: (key: string, strategies: Strategy[]) => void;
  toggleStrategy: (key: string, idx: number) => void;
  comparisonMode: "after" | "before" | "compare";
  onComparisonModeChange: (m: "after" | "before" | "compare") => void;
}

const analysisSteps = [
  "1. 正在查看货架商品数据",
  "2. 正在分析销售表现",
  "3. 正在对比优质店数据",
  "4. 正在生成选品建议",
];

const generateMockStrategies = (skus: SkuRow[], label: string): Strategy[] => {
  const sorted = [...skus].sort((a, b) => parseFloat(b.sales30d || "0") - parseFloat(a.sales30d || "0"));
  const highSales = sorted.slice(0, 5);
  const lowSales = sorted.slice(-5).reverse();
  const midStart = Math.max(5, Math.floor(sorted.length / 2) - 2);
  const midSales = sorted.slice(midStart, midStart + 4);
  const strategies: Strategy[] = [];
  if (highSales.length > 0) {
    strategies.push({
      name: "🔥 核心畅销扶持",
      description: `${label} 高销品力推`,
      skus: highSales.map(s => ({
        skuCode: s.skuCode, skuName: s.skuName, spec: s.spec,
        action: "力推", reason: `销售额¥${s.sales30d}，表现突出`, sales30d: s.sales30d,
      })),
      applied: false,
    });
  }
  if (midSales.length > 0) {
    strategies.push({
      name: "👀 保留观察",
      description: `${label} 中销品暂不调整，持续跟踪`,
      skus: midSales.map(s => ({
        skuCode: s.skuCode, skuName: s.skuName, spec: s.spec,
        action: "保留观察", reason: `销售表现中等（¥${s.sales30d}），持续跟踪`, sales30d: s.sales30d,
      })),
      applied: false,
    });
  }
  if (lowSales.length > 0) {
    strategies.push({
      name: "🧹 清理滞销",
      description: `${label} 低销品下架`,
      skus: lowSales.map(s => ({
        skuCode: s.skuCode, skuName: s.skuName, spec: s.spec,
        action: "建议下架", reason: `销售额仅¥${s.sales30d}`, sales30d: s.sales30d,
      })),
      applied: false,
    });
  }
  const dupes = skus.filter(s => skus.some(o => o.skuCode !== s.skuCode && o.skuName.slice(0, 4) === s.skuName.slice(0, 4))).slice(0, 2);
  if (dupes.length > 0) {
    strategies.push({
      name: "🔄 规格冗余整合",
      description: `${label} 存在同品牌多规格，建议整合`,
      skus: dupes.map((s, i) => ({
        skuCode: s.skuCode, skuName: s.skuName, spec: s.spec,
        action: i === 0 ? "建议下架" : "力推", reason: i === 0 ? "同品牌冗余规格" : "保留核心规格",
        sales30d: s.sales30d,
      })),
      applied: false,
    });
  }
  return strategies;
};

export const ShelfDataPanel = ({
  shelves, skus, totalSkuCount, totalSales, totalSalesVolume,
  strategyKey, strategies, setStrategiesForSub, toggleStrategy,
  comparisonMode, onComparisonModeChange,
}: Props) => {
  const navigate = useNavigate();
  const { selectedStore } = useAppContext();
  const [analyzing, setAnalyzing] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const difyCallRef = useRef<Promise<Strategy[] | null> | null>(null);

  const shelfLabel = shelves.map(s => s.shelfId).join("·");
  const catLabel = shelves.flatMap(s => s.afterSegments.map(seg => seg.category)).join(" / ");

  const handleStartAnalysis = useCallback(() => {
    if (isDifyConfigured.selection()) {
      const skuSummary = skus.slice(0, 200).map(s =>
        `${s.skuCode}|${s.skuName}|${s.spec || ""}|${s.majorCategory}|${s.subCategory}|30日销售额:${s.sales30d}|30日销量:${s.salesVolume30d}|销售额环比:${s.salesChange30d}|保质期:${s.shelfLifeDays ?? "-"}天`
      ).join("\n");
      difyCallRef.current = analyzeSelection(skuSummary, shelves[0]?.afterSegments[0]?.category || "", "全部", undefined, undefined, undefined, undefined, undefined, undefined)
        .then(r => r.map(s => ({ ...s, applied: false })))
        .catch(() => null);
    }
    setAnalyzing(true);
  }, [skus, shelves, selectedStore]);

  const handleAnalysisComplete = useCallback(async () => {
    let results: Strategy[];
    if (difyCallRef.current) {
      const r = await difyCallRef.current;
      difyCallRef.current = null;
      results = r && r.length > 0 ? r : generateMockStrategies(skus, shelfLabel);
    } else {
      results = generateMockStrategies(skus, shelfLabel);
    }
    setStrategiesForSub(strategyKey, results);
    setAnalyzing(false);
  }, [skus, shelfLabel, strategyKey, setStrategiesForSub]);

  const hasStrategies = strategies.length > 0;
  const appliedCount = strategies.filter(s => s.applied).length;

  const predSales = Math.round(totalSales);
  const predNewSales = Math.round(totalSales * 1.19);

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 space-y-3">
          <div>
            <p className="text-sm font-semibold">{shelfLabel}</p>
            <p className="text-xs text-muted-foreground">{catLabel} · {totalSkuCount} 个单品</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="border border-border rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground">总销售额</p>
              <p className="text-lg font-bold text-foreground">¥{totalSales.toFixed(0)}</p>
            </div>
            <div className="border border-border rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground">总销量</p>
              <p className="text-lg font-bold text-foreground">{totalSalesVolume}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold">AI 选品优化</span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            当前查看: {shelfLabel} · 共 {totalSkuCount} 个单品
          </p>

          {!analyzing && strategies.length === 0 && (
            <Button onClick={handleStartAnalysis} className="w-full ai-gradient text-white" size="lg">
              <Sparkles className="w-4 h-4 mr-1" /> 🚀 AI优化选品
            </Button>
          )}

          {analyzing && (
            <AiThinkingAnimation steps={analysisSteps} onComplete={handleAnalysisComplete} isRunning={analyzing} stepIntervals={[2000, 2000, 3000, 5000]} />
          )}
        </CardContent>
      </Card>

      {strategies.map((strategy, idx) => (
        <Collapsible key={idx} open={expandedIdx === idx} onOpenChange={() => setExpandedIdx(expandedIdx === idx ? null : idx)}>
          <Card className={cn("overflow-hidden transition-all", strategy.applied && "ring-2 ring-green-500 bg-green-50/50")}>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="py-2 px-3 flex flex-row items-center justify-between">
                <CardTitle className="text-xs text-left">{strategy.name}</CardTitle>
                <div className="flex items-center gap-1">
                  <Badge variant="secondary" className="text-[9px]">{strategy.skus.length}个单品</Badge>
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", expandedIdx === idx && "rotate-180")} />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 px-3 pb-2 space-y-1.5">
                {strategy.skus.map((sku, si) => (
                  <div key={si} className="flex items-start gap-2 text-xs p-1.5 bg-muted/50 rounded">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{sku.skuName} <span className="text-muted-foreground">{sku.spec}</span></p>
                      <p className="text-[10px] text-muted-foreground truncate">{sku.reason}</p>
                    </div>
                    <Badge className={cn("text-[9px] shrink-0",
                      actionBadgeClass(sku.action)
                    )}>{sku.action}</Badge>
                  </div>
                ))}
                <Button size="sm" onClick={(e) => { e.stopPropagation(); toggleStrategy(strategyKey, idx); }}
                  className={cn("w-full mt-1 h-7 text-xs", strategy.applied ? "bg-green-600 hover:bg-green-700" : "ai-gradient")}>
                  {strategy.applied ? <><Check className="w-3 h-3 mr-1" /> 已应用</> : "应用策略"}
                </Button>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      ))}

      {hasStrategies && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-1 text-xs font-semibold">
              <BarChart3 className="w-3.5 h-3.5 text-primary" />
              优化预测效果
            </div>
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">总销售额</span>
                <span>¥{predSales} → <span className="text-green-600 font-medium">¥{predNewSales}</span></span>
              </div>
              <div className="flex h-2 rounded overflow-hidden mt-0.5">
                <div className="bg-primary/60" style={{ width: `${(predSales / predNewSales) * 100}%` }} />
                <div className="bg-green-500/60" style={{ width: `${((predNewSales - predSales) / predNewSales) * 100}%` }} />
              </div>
              <p className="text-[10px] text-green-600 text-right">+19%</p>
            </div>
          </CardContent>
        </Card>
      )}

      {hasStrategies && (
        <div className="space-y-2">
          {appliedCount < strategies.length && (
            <Button className="w-full ai-gradient text-white" onClick={() => strategies.forEach((_, i) => { if (!strategies[i].applied) toggleStrategy(strategyKey, i); })}>
              应用全部策略
            </Button>
          )}
          <Button variant="outline" className="w-full" onClick={() => navigate("/performance")}>
            📈 查看业绩预测
          </Button>
        </div>
      )}

      {hasStrategies && (
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          {(["after", "before", "compare"] as const).map(m => (
            <button key={m} onClick={() => onComparisonModeChange(m)}
              className={cn("flex-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all",
                comparisonMode === m ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"
              )}
            >
              {m === "after" ? "优化后" : m === "before" ? "优化前" : "对比"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
