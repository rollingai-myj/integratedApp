/**
 * 按货架选品 — 左右两栏布局
 */
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "@/components/shelves/lib/router-shim";
import { useQuery } from "@tanstack/react-query";
import { getCategoryColor, type ShelfCategoryMapping } from "@/components/shelves/data/shelfConfig";
import { getStoreSkuData } from "@/components/shelves/data/skuDataByStore";
import { type SkuRow } from "@/components/shelves/data/skuData";
import { useAppContext, Strategy } from "@/components/shelves/contexts/AppContext";
import { AiThinkingAnimation } from "@/components/shelves/components/AiThinkingAnimation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShelfDotGridWithDivider } from "@/components/shelves/components/ShelfDotGrid";
import { MapPin, Sparkles, ChevronDown, Check, Eye, CheckCircle2, AlertCircle, Ban } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/components/shelves/lib/utils";
import { analyzeSelection, isDifyConfigured } from "@/components/shelves/services/difyApi";
import { actionBadgeClass } from "@/components/shelves/lib/strategyAction";
import { apiFetch } from "@/components/shelves/lib/api-client";

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
      name: "🔥 核心畅销扶持", description: `${label} 高销品力推`,
      skus: highSales.map(s => ({
        skuCode: s.skuCode, skuName: s.skuName, spec: s.spec,
        action: "力推", reason: `销售额¥${s.sales30d}，表现突出`, sales30d: s.sales30d,
      })),
      applied: false,
    });
  }
  if (midSales.length > 0) {
    strategies.push({
      name: "👀 保留观察", description: `${label} 中销品暂不调整，持续跟踪`,
      skus: midSales.map(s => ({
        skuCode: s.skuCode, skuName: s.skuName, spec: s.spec,
        action: "保留观察", reason: `销售表现中等（¥${s.sales30d}），持续跟踪`, sales30d: s.sales30d,
      })),
      applied: false,
    });
  }
  if (lowSales.length > 0) {
    strategies.push({
      name: "🧹 清理滞销", description: `${label} 低销品下架`,
      skus: lowSales.map(s => ({
        skuCode: s.skuCode, skuName: s.skuName, spec: s.spec,
        action: "建议下架", reason: `销售额仅¥${s.sales30d}`, sales30d: s.sales30d,
      })),
      applied: false,
    });
  }
  return strategies;
};

const getPositionGroups = (shelfCategoryMappings: ShelfCategoryMapping[]) => {
  const posMap = new Map<string, ShelfCategoryMapping[]>();
  shelfCategoryMappings.forEach(m => {
    const pos = m.position || "其他";
    if (!posMap.has(pos)) posMap.set(pos, []);
    posMap.get(pos)!.push(m);
  });
  const groups: { position: string; shelves: ShelfCategoryMapping[] }[] = [];
  for (const [pos, shelves] of posMap) {
    groups.push({ position: pos, shelves });
  }
  return groups;
};

export const SelectionShelfShelfView = () => {
  const navigate = useNavigate();
  const { strategiesMap, setStrategiesForSub, toggleStrategy, shelfMappingsFromConfig, selectedStore } = useAppContext();
  const shelfCategoryMappings = shelfMappingsFromConfig;
  const [checkedShelves, setCheckedShelves] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const difyCallRef = useRef<Promise<Strategy[] | null> | null>(null);
  const lastClickTime = useRef<Record<string, number>>({});

  const storeId = selectedStore.replace("粤", "");
  const storeSkus = useMemo(() => getStoreSkuData(selectedStore), [selectedStore]);
  const positionGroups = useMemo(() => getPositionGroups(shelfCategoryMappings), [shelfCategoryMappings]);

  // Query ALL alignment results for the store (not just checked ones)
  const allAlignmentQuery = useQuery({
    queryKey: ["shelf_alignment_results_all", storeId],
    queryFn: async () => {
      const res = await apiFetch(`/api/shelves/runtime?storeId=${encodeURIComponent(storeId)}`);
      return ((await res.json()) || []) as { shelf_id: string; aligned_sub_categories: string[] | null }[];
    },
  });

  const alignedShelfIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of (allAlignmentQuery.data || [])) {
      if (row.aligned_sub_categories && row.aligned_sub_categories.length > 0) {
        ids.add(row.shelf_id);
      }
    }
    return ids;
  }, [allAlignmentQuery.data]);

  // Keep a filtered version for SKU aggregation (only checked & aligned)
  const alignmentQuery = useMemo(() => ({
    data: (allAlignmentQuery.data || []).filter(r => checkedShelves.has(r.shelf_id)),
  }), [allAlignmentQuery.data, checkedShelves]);

  const isShelfConfigured = useCallback((mapping: ShelfCategoryMapping) => {
    return mapping.afterSegments.length > 0 && mapping.afterSegments.some(s => s.category && s.category.trim() !== "");
  }, []);

  const canSelectShelf = useCallback((shelfId: string): { ok: boolean; reason?: string } => {
    const mapping = shelfCategoryMappings.find(m => m.shelfId === shelfId);
    if (!mapping || !isShelfConfigured(mapping)) {
      return { ok: false, reason: "请先配置货架品类" };
    }
    if (!alignedShelfIds.has(shelfId)) {
      return { ok: false, reason: "请先上传照片对齐货架" };
    }
    return { ok: true };
  }, [shelfCategoryMappings, alignedShelfIds, isShelfConfigured]);

  const toggleShelf = useCallback((shelfId: string) => {
    // Allow unchecking always
    if (checkedShelves.has(shelfId)) {
      setCheckedShelves(prev => { const next = new Set(prev); next.delete(shelfId); return next; });
      return;
    }
    const check = canSelectShelf(shelfId);
    if (!check.ok) { toast.error(check.reason); return; }
    setCheckedShelves(prev => { const next = new Set(prev); next.add(shelfId); return next; });
  }, [checkedShelves, canSelectShelf]);

  const handleCardClick = useCallback((shelfId: string) => {
    const now = Date.now();
    const last = lastClickTime.current[shelfId] || 0;
    lastClickTime.current[shelfId] = now;
    if (now - last < 400) {
      navigate(`/shelf-detail?shelf=${shelfId}`);
    } else {
      toggleShelf(shelfId);
    }
  }, [navigate, toggleShelf]);

  const checkedCategories = useMemo(() => {
    const cats = new Set<string>();
    shelfCategoryMappings.filter(m => checkedShelves.has(m.shelfId))
      .forEach(m => m.afterSegments.forEach(s => cats.add(s.category)));
    return cats;
  }, [checkedShelves, shelfCategoryMappings]);

  // SKU list: only show SKUs matching recognized sub-categories from photos
  const aggregatedSkus = useMemo(() => {
    if (checkedShelves.size === 0) return [];
    const alignmentData = alignmentQuery.data || [];
    // If no shelves have alignment results, return empty
    if (alignmentData.length === 0) return [];
    // Collect all recognized sub-categories
    const recognizedSubCats = new Set<string>();
    for (const row of alignmentData) {
      for (const sub of (row.aligned_sub_categories || [])) {
        recognizedSubCats.add(sub.trim());
      }
    }
    if (recognizedSubCats.size === 0) return [];
    // Filter SKUs by recognized sub-categories, dedup by skuCode
    const seen = new Set<string>();
    return storeSkus.filter(s => {
      if (!recognizedSubCats.has(s.subCategory?.trim() || "")) return false;
      if (seen.has(s.skuCode)) return false;
      seen.add(s.skuCode);
      return true;
    });
  }, [checkedShelves, alignmentQuery.data, storeSkus]);

  const strategyKey = `batch:${[...checkedShelves].sort().join(",")}`;
  const currentStrategies = strategiesMap[strategyKey] || [];

  const handleStartAnalysis = useCallback(() => {
    if (checkedShelves.size === 0) return;
    if (isDifyConfigured.selection()) {
      const skuSummary = aggregatedSkus.slice(0, 200).map(s =>
        `${s.skuCode}|${s.skuName}|${s.spec || ""}|${s.majorCategory}|${s.subCategory}|30日销售额:${s.sales30d}|30日销量:${s.salesVolume30d}|销售额环比:${s.salesChange30d}|保质期:${s.shelfLifeDays ?? "-"}天`
      ).join("\n");
      difyCallRef.current = analyzeSelection(skuSummary, "", "全部", undefined, undefined, undefined, undefined, undefined, undefined)
        .then(r => r.map(s => ({ ...s, applied: false }))).catch(() => null);
    }
    setAnalyzing(true);
  }, [checkedShelves, aggregatedSkus]);

  const handleAnalysisComplete = useCallback(async () => {
    const label = [...checkedShelves].join("·");
    let results: Strategy[];
    if (difyCallRef.current) {
      const r = await difyCallRef.current;
      difyCallRef.current = null;
      results = r && r.length > 0 ? r : generateMockStrategies(aggregatedSkus, label);
    } else {
      results = generateMockStrategies(aggregatedSkus, label);
    }
    setStrategiesForSub(strategyKey, results);
    setAnalyzing(false);
  }, [checkedShelves, aggregatedSkus, strategyKey, setStrategiesForSub]);

  const selectAll = () => {
    const selectable = shelfCategoryMappings.filter(m => isShelfConfigured(m) && alignedShelfIds.has(m.shelfId));
    setCheckedShelves(new Set(selectable.map(m => m.shelfId)));
  };
  const clearAll = () => setCheckedShelves(new Set());

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0 space-y-3">
        {positionGroups.map(group => (
          <div key={group.position}>
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-bold text-foreground">{group.position}</span>
              <div className="flex-1 border-t border-border ml-2" />
            </div>
            <div className="flex flex-wrap gap-2">
              {group.shelves.map(mapping => {
                const isChecked = checkedShelves.has(mapping.shelfId);
                const segLabel = mapping.afterSegments.map(s => s.category).join("/");
                const configured = isShelfConfigured(mapping);
                const aligned = alignedShelfIds.has(mapping.shelfId);
                return (
                  <div
                    key={mapping.shelfId}
                    onClick={() => handleCardClick(mapping.shelfId)}
                    className={cn(
                      "flex flex-col border rounded-lg bg-card p-1.5 cursor-pointer transition-all select-none w-[80px]",
                      isChecked
                        ? "border-primary shadow-md ring-1 ring-primary/30"
                        : !configured
                          ? "border-border opacity-60"
                          : "border-border hover:border-primary/30 hover:shadow-sm"
                    )}
                  >
                    <div className="flex items-center gap-1 mb-1">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggleShelf(mapping.shelfId)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-3 h-3"
                        disabled={!configured || !aligned}
                      />
                      <span className="text-[8px] font-semibold leading-tight truncate">
                        {mapping.shelfId}
                      </span>
                      {!configured ? (
                        <Ban className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                      ) : aligned ? (
                        <CheckCircle2 className="w-2.5 h-2.5 text-green-600 shrink-0" />
                      ) : (
                        <AlertCircle className="w-2.5 h-2.5 text-amber-500 shrink-0" />
                      )}
                    </div>
                    {!configured ? (
                      <div className="text-[7px] text-muted-foreground truncate mb-1 text-center">未配置</div>
                    ) : (
                      <div className="text-[7px] text-muted-foreground truncate mb-1 text-center">{segLabel}</div>
                    )}
                    <div className="flex-1 min-h-0">
                      <ShelfDotGridWithDivider segments={mapping.afterSegments} />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[8px] text-muted-foreground hover:text-primary px-1 py-0 mt-0.5 gap-0.5 w-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/shelf-detail?shelf=${mapping.shelfId}`);
                      }}
                    >
                      <Eye className="w-2.5 h-2.5" />
                      查看详情
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="border border-border rounded-lg bg-card overflow-hidden">
          <div className="px-4 py-2 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold">已选货架单品明细</span>
            {aggregatedSkus.length > 0 && <Badge variant="secondary" className="text-xs">{aggregatedSkus.length} 个单品</Badge>}
          </div>
          {aggregatedSkus.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {checkedShelves.size === 0
                ? "请先选择货架"
                : "请先上传货架照片并完成识别，才能查看单品明细"}
            </div>
          ) : (
            <div className="max-h-[350px] overflow-auto">
              <Table wrapperClassName="overflow-visible">
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="text-xs">
                    <TableHead className="bg-card">商品代码</TableHead>
                    <TableHead className="bg-card">商品名称</TableHead>
                    <TableHead className="bg-card">商品规格</TableHead>
                    <TableHead className="bg-card">所在货架</TableHead>
                    <TableHead className="text-right bg-card">销售额</TableHead>
                    <TableHead className="text-right bg-card">销量</TableHead>
                    <TableHead className="text-right bg-card">销售额环比</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aggregatedSkus.slice(0, 100).map((sku, i) => {
                    const shelfId = shelfCategoryMappings.find(m =>
                      checkedShelves.has(m.shelfId) && m.afterSegments.some(s => s.category === sku.majorCategory)
                    )?.shelfId || "—";
                    return (
                      <TableRow key={i} className="text-xs">
                        <TableCell className="font-mono text-muted-foreground">{sku.skuCode}</TableCell>
                        <TableCell className="max-w-[160px] truncate font-medium">{sku.skuName}</TableCell>
                        <TableCell className="text-muted-foreground">{sku.spec || "—"}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[9px]">{shelfId}</Badge></TableCell>
                        <TableCell className="text-right">¥{parseFloat(sku.sales30d || "0").toFixed(0)}</TableCell>
                        <TableCell className="text-right">{sku.salesVolume30d || "0"}</TableCell>
                        <TableCell className="text-right">{sku.salesChange30d ? `${(parseFloat(sku.salesChange30d) * 100).toFixed(1)}%` : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      <div className="w-full lg:w-[350px] lg:shrink-0">
        <div className="lg:sticky lg:top-20 space-y-3 lg:max-h-[calc(100vh-200px)] lg:overflow-auto">
          {checkedShelves.size === 0 ? (
            <Card>
              <CardContent className="p-6 text-center space-y-3">
                <div className="w-16 h-16 rounded-full bg-muted mx-auto flex items-center justify-center">
                  <MapPin className="w-8 h-8 text-muted-foreground/40" />
                </div>
                <p className="text-sm text-muted-foreground">单击选择货架，双击查看详情</p>
                <Button disabled className="w-full opacity-50">
                  <Sparkles className="w-4 h-4 mr-1" /> 🚀 AI批量优化
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">已选 {checkedShelves.size} 组货架</span>
                    <Badge variant="secondary" className="text-xs">{aggregatedSkus.length} 个单品</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {[...checkedShelves].map(id => (
                      <Badge key={id} variant="outline" className="text-[10px]">{id}</Badge>
                    ))}
                  </div>

                  {!analyzing && currentStrategies.length === 0 && (
                    <Button onClick={handleStartAnalysis} className="w-full ai-gradient text-white mt-2" size="lg">
                      <Sparkles className="w-4 h-4 mr-1" /> 🚀 AI批量优化
                    </Button>
                  )}

                  {analyzing && (
                    <div className="mt-2">
                      <AiThinkingAnimation steps={analysisSteps} onComplete={handleAnalysisComplete} isRunning={analyzing} stepIntervals={[2000, 2000, 3000, 5000]} />
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-xs pt-1">
                    <button onClick={selectAll} className="text-primary hover:underline">全选</button>
                    <button onClick={clearAll} className="text-muted-foreground hover:text-foreground">清空选择</button>
                  </div>
                </CardContent>
              </Card>

              {currentStrategies.map((strategy, idx) => (
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

              {currentStrategies.length > 0 && currentStrategies.some(s => !s.applied) && (
                <Button className="w-full ai-gradient text-white"
                  onClick={() => currentStrategies.forEach((_, i) => { if (!currentStrategies[i].applied) toggleStrategy(strategyKey, i); })}>
                  应用全部策略
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
