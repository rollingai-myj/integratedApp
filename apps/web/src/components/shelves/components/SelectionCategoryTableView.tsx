/**
 * 按大类选品 + 表格视图
 */
import { useState, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "@/components/shelves/lib/router-shim";
import { AiThinkingAnimation } from "@/components/shelves/components/AiThinkingAnimation";
import { getStoreSkuData } from "@/components/shelves/data/skuDataByStore";
import { type SkuRow } from "@/components/shelves/data/skuData";
import { useAppContext, Strategy } from "@/components/shelves/contexts/AppContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Sparkles, ChevronDown, Check, TrendingUp } from "lucide-react";
import { cn } from "@/components/shelves/lib/utils";
import { analyzeSelection, isDifyConfigured } from "@/components/shelves/services/difyApi";
import { actionBadgeClass, classifyAction } from "@/components/shelves/lib/strategyAction";
import { toast, toastSuccess } from "@/components/ui/sonner";

const analysisSteps = [
  "1. 正在查看门店基本信息",
  "2. 正在查看商品销售数据",
  "3. 正在查看竞对数据",
  "4. 开始分析",
  "5. 正在生成策略组",
  "6. 正在生成建议清单",
];

const generateMockStrategies = (skus: SkuRow[], majorCat: string, subCat: string): Strategy[] => {
  const filteredSkus = skus.filter(
    (s) => (majorCat === "全部" || s.majorCategory === majorCat) && (subCat === "全部" || s.subCategory === subCat),
  );
  const sorted = [...filteredSkus].sort((a, b) => parseFloat(b.sales30d || "0") - parseFloat(a.sales30d || "0"));
  const highSales = sorted.slice(0, Math.min(10, Math.ceil(sorted.length * 0.2)));
  const lowSales = sorted.slice(-Math.min(10, Math.ceil(sorted.length * 0.2)));
  const midStart = Math.max(highSales.length, Math.floor(sorted.length / 2) - 3);
  const midSales = sorted.slice(midStart, midStart + Math.min(6, Math.ceil(sorted.length * 0.15)));
  const strategies: Strategy[] = [];

  if (lowSales.length > 0) {
    strategies.push({
      name: "🔻 低销品淘汰策略",
      description: "建议下架销售额极低的商品，释放货架空间",
      skus: lowSales.map((s) => ({
        skuCode: s.skuCode, skuName: s.skuName, spec: s.spec,
        action: "建议下架", reason: `销售额仅¥${s.sales30d}，远低于品类平均`, sales30d: s.sales30d,
      })),
      applied: false,
    });
  }
  if (midSales.length > 0) {
    strategies.push({
      name: "👀 保留观察策略",
      description: "中等销售表现的商品，建议暂不调整，持续跟踪",
      skus: midSales.map((s) => ({
        skuCode: s.skuCode, skuName: s.skuName, spec: s.spec,
        action: "保留观察", reason: `销售额¥${s.sales30d}，表现中等，持续跟踪`, sales30d: s.sales30d,
      })),
      applied: false,
    });
  }
  if (highSales.length > 0) {
    strategies.push({
      name: "🔥 高销品力推策略",
      description: "建议增加高销商品的陈列面，提升动销效率",
      skus: highSales.map((s) => ({
        skuCode: s.skuCode, skuName: s.skuName, spec: s.spec,
        action: "增加陈列", reason: `销售额¥${s.sales30d}，表现突出`, sales30d: s.sales30d,
      })),
      applied: false,
    });
  }
  return strategies;
};

export const SelectionCategoryTableView = () => {
  const navigate = useNavigate();
  const { strategiesMap, setStrategiesForSub, toggleStrategy, selectedStore } = useAppContext();
  const [selectedMajor, setSelectedMajor] = useState("全部");
  const [selectedSub, setSelectedSub] = useState("全部");
  const [analyzingSub, setAnalyzingSub] = useState<string | null>(null);
  const [expandedStrategy, setExpandedStrategy] = useState<number | null>(null);
  const difyCallRef = useRef<Promise<Strategy[] | null> | null>(null);

  const storeSkus = useMemo(() => getStoreSkuData(selectedStore), [selectedStore]);

  const strategyKey = `${selectedMajor}:${selectedSub}`;
  const currentStrategies = strategiesMap[strategyKey] || [];
  const majorCategories = useMemo(() => ["全部", ...Array.from(new Set(storeSkus.map((s) => s.majorCategory)))], [storeSkus]);
  const subCategories = useMemo(() => {
    if (selectedMajor === "全部") return ["全部", ...Array.from(new Set(storeSkus.map((s) => s.subCategory))).slice(0, 20)];
    return ["全部", ...Array.from(new Set(storeSkus.filter((s) => s.majorCategory === selectedMajor).map((s) => s.subCategory)))];
  }, [selectedMajor, storeSkus]);

  const filteredSkus = useMemo(
    () => storeSkus.filter((s) =>
      (selectedMajor === "全部" || s.majorCategory === selectedMajor) &&
      (selectedSub === "全部" || s.subCategory === selectedSub)
    ),
    [selectedMajor, selectedSub, storeSkus],
  );

  const hasAnyStrategies = Object.values(strategiesMap).some((s) => s.length > 0);
  const isAnalyzingCurrent = analyzingSub === strategyKey;

  const startDifySelectionCall = useCallback(() => {
    if (isDifyConfigured.selection()) {
      const skuSummary = filteredSkus.slice(0, 200).map((s) =>
        `${s.skuCode}|${s.skuName}|${s.spec || ""}|${s.majorCategory}|${s.subCategory}|30日销售额:${s.sales30d}|30日销量:${s.salesVolume30d}|销售额环比:${s.salesChange30d}|保质期:${s.shelfLifeDays ?? "-"}天`
      ).join("\n");
      difyCallRef.current = analyzeSelection(skuSummary, selectedMajor, selectedSub, undefined, undefined, undefined, undefined, undefined, undefined)
        .then((results) => results.map((r) => ({
          ...r, applied: false,
          skus: r.skus.map((sku) => {
            const match = storeSkus.find((s) => s.skuCode === sku.skuCode);
            return { ...sku, spec: sku.spec || match?.spec };
          }),
        })))
        .catch(() => null);
    }
  }, [filteredSkus, selectedMajor, selectedSub, storeSkus]);

  const handleAnalysisComplete = useCallback(async () => {
    const key = `${selectedMajor}:${selectedSub}`;
    let results: Strategy[];
    if (difyCallRef.current) {
      const difyResults = await difyCallRef.current;
      difyCallRef.current = null;
      if (difyResults && difyResults.length > 0) {
        results = difyResults;
        toastSuccess(`AI选品分析完成 - ${selectedSub}`);
      } else {
        results = generateMockStrategies(storeSkus, selectedMajor, selectedSub);
        toast.warning("使用本地模拟数据");
      }
    } else {
      results = generateMockStrategies(storeSkus, selectedMajor, selectedSub);
    }
    setStrategiesForSub(key, results);
    setAnalyzingSub(null);
  }, [selectedMajor, selectedSub, setStrategiesForSub, storeSkus]);

  return (
    <>
      <div className="space-y-2">
        <ScrollArea className="w-full whitespace-nowrap">
          <div className="flex gap-2 pb-2">
            {majorCategories.map((cat) => (
              <button key={cat} onClick={() => { setSelectedMajor(cat); setSelectedSub("全部"); setExpandedStrategy(null); }}
                className={cn("px-3 py-1.5 rounded-full text-xs font-medium transition-all shrink-0",
                  selectedMajor === cat ? "ai-gradient text-white shadow-sm" : "bg-muted text-muted-foreground hover:bg-muted/80")}
              >{cat}</button>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        <ScrollArea className="w-full whitespace-nowrap">
          <div className="flex gap-2 pb-2">
            {subCategories.map((cat) => {
              const hasStrategies = (strategiesMap[`${selectedMajor}:${cat}`]?.length || 0) > 0;
              return (
                <button key={cat} onClick={() => { setSelectedSub(cat); setExpandedStrategy(null); }}
                  className={cn("px-3 py-1.5 rounded-full text-xs font-medium transition-all shrink-0 flex items-center gap-1",
                    selectedSub === cat ? "bg-primary/15 text-primary border border-primary/30" : "bg-muted/50 text-muted-foreground hover:bg-muted/80")}
                >{cat}{hasStrategies && <Check className="w-3 h-3 text-green-600" />}</button>
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">单品清单 <Badge variant="secondary" className="ml-2">{filteredSkus.length}个</Badge></CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-auto">
                <Table wrapperClassName="overflow-visible">
                  <TableHeader className="sticky top-0 z-10">
                    <TableRow className="text-xs">
                      <TableHead className="bg-background">商品代码</TableHead>
                      <TableHead className="bg-background">商品名称</TableHead>
                      <TableHead className="bg-background">商品规格</TableHead>
                      <TableHead className="text-right bg-background">销售额</TableHead>
                      <TableHead className="text-right bg-background">销量</TableHead>
                      <TableHead className="text-right bg-background">销售额环比</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSkus.slice(0, 100).map((sku, i) => (
                      <TableRow key={i} className="text-xs">
                        <TableCell className="font-mono">{sku.skuCode}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{sku.skuName}</TableCell>
                        <TableCell className="text-muted-foreground">{sku.spec || "—"}</TableCell>
                        <TableCell className="text-right">¥{parseFloat(sku.sales30d || "0").toFixed(0)}</TableCell>
                        <TableCell className="text-right">{sku.salesVolume30d || "0"}</TableCell>
                        <TableCell className="text-right">{sku.salesChange30d ? `${(parseFloat(sku.salesChange30d) * 100).toFixed(1)}%` : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {!isAnalyzingCurrent && currentStrategies.length === 0 && (
            <button onClick={() => { startDifySelectionCall(); setAnalyzingSub(strategyKey); }}
              className="w-full ai-gradient text-white rounded-2xl p-6 shadow-xl shadow-primary/20 hover:shadow-2xl hover:scale-[1.02] transition-all flex flex-col items-center gap-3">
              <Sparkles className="w-10 h-10" />
              <span className="font-bold text-lg">AI一键分析</span>
              <span className="text-xs text-white/70">智能生成「{selectedMajor === "全部" ? "" : selectedMajor + "："}
                {selectedSub}」选品策略</span>
            </button>
          )}
          {isAnalyzingCurrent && (
            <Card className="p-4">
              <AiThinkingAnimation steps={analysisSteps} onComplete={handleAnalysisComplete} isRunning={isAnalyzingCurrent} stepIntervals={[2000, 2000, 3000, 6000, 8000, 9000]} />
            </Card>
          )}
          {currentStrategies.map((strategy, idx) => (
            <Collapsible key={idx} open={expandedStrategy === idx} onOpenChange={() => setExpandedStrategy(expandedStrategy === idx ? null : idx)}>
              <Card className={cn("overflow-hidden transition-all", strategy.applied && "ring-2 ring-green-500 bg-green-50/50")}>
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                    <div className="text-left"><CardTitle className="text-sm">{strategy.name}</CardTitle></div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">{strategy.skus.length}个单品</Badge>
                      <ChevronDown className={cn("w-4 h-4 transition-transform", expandedStrategy === idx && "rotate-180")} />
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 px-4 pb-3 space-y-2">
                    {[...strategy.skus].sort((a, b) => {
                      const order = { remove: 0, push: 1, observe: 2 } as const;
                      return order[classifyAction(a.action)] - order[classifyAction(b.action)];
                    }).map((sku, si) => (
                      <div key={si} className="flex items-start gap-2 text-xs p-2 bg-muted/50 rounded-lg">
                        <div className="flex-1">
                          <p className="font-medium">{sku.skuName} <span className="text-muted-foreground font-normal">{sku.spec}</span></p>
                          <p className="text-muted-foreground">{sku.reason}</p>
                        </div>
                        <Badge className={cn("text-[10px] shrink-0",
                          actionBadgeClass(sku.action)
                        )}>{sku.action}</Badge>
                      </div>
                    ))}
                    <Button size="sm" onClick={(e) => { e.stopPropagation(); toggleStrategy(strategyKey, idx); }}
                      className={cn("w-full mt-2", strategy.applied ? "bg-green-600 hover:bg-green-700" : "ai-gradient")}>
                      {strategy.applied ? <><Check className="w-4 h-4 mr-1" /> 已应用</> : "应用策略"}
                    </Button>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ))}
          {hasAnyStrategies && (
            <Button onClick={() => navigate("/performance")} className="w-full ai-gradient shadow-lg shadow-primary/20 gap-2">
              <TrendingUp className="w-4 h-4" />业绩预测
            </Button>
          )}
        </div>
      </div>
    </>
  );
};
