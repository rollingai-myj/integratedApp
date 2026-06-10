/**
 * 单品明细表 - 基于图片识别对齐结果 + 对应小类单品列表
 */
import { useState, useMemo, useEffect } from "react";
import { type SkuRow } from "@/components/shelves/data/skuData";
import { type Strategy } from "@/components/shelves/contexts/AppContext";
import { isStaleSku } from "@/components/shelves/lib/staleSku";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search } from "lucide-react";
import { cn } from "@/components/shelves/lib/utils";
import { useIsMobile } from "@/components/shelves/hooks/use-mobile";
import { SkuThumbnail } from "@/components/shelves/components/SkuThumbnail";

interface Props {
  skus: SkuRow[];
  selectedSKUs: Set<string>;
  toggleSKU: (code: string) => void;
  hoveredSkuCode: string | null;
  onHoverSku: (code: string | null) => void;
  strategies: Strategy[];
  comparisonMode: "after" | "before" | "compare";
  highlightedSkuCodes?: Set<string> | null;
  alignedSubCategories?: string[] | null;
  initialSort?: "sales30d" | "psd" | "salesChange30d" | null;
  initialSortDir?: "desc" | "asc";
  initialPreset?: "lowSales" | "stale" | "highDrop" | null;
  initialPresetTick?: number;
  focusedSkuCode?: string | null;
  onRowClick?: (sku: SkuRow) => void;
}

interface DisplayRow extends SkuRow {
  isAligned: boolean;
}

type SortKey = "sales30d" | "psd" | "salesChange30d";
type SortDir = "desc" | "asc";
type QuickPreset = "lowSales" | "stale" | "highDrop";

const PRESETS: { key: QuickPreset; label: string }[] = [
  { key: "lowSales", label: "低销额单品" },
  { key: "stale", label: "滞销单品" },
  { key: "highDrop", label: "高降幅单品" },
];

const SortIcon = ({ active, direction }: { active: boolean; direction: SortDir | null }) => (
  <span className="inline-flex ml-1 align-middle text-[10px]">
    {!active ? (
      <span className="text-gray-400">↕</span>
    ) : direction === "desc" ? (
      <span className="text-green-500">↓</span>
    ) : (
      <span className="text-red-500">↑</span>
    )}
  </span>
);


export const ShelfSkuTable = ({
  skus, selectedSKUs, toggleSKU, hoveredSkuCode, onHoverSku, strategies, comparisonMode, highlightedSkuCodes, alignedSubCategories, initialSort, initialSortDir = "desc", initialPreset, initialPresetTick, focusedSkuCode, onRowClick,
}: Props) => {
  const isMobile = useIsMobile();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSubCat, setSelectedSubCat] = useState("全部");
  const [sortKey, setSortKey] = useState<SortKey | null>(initialSort || null);
  const [sortDir, setSortDir] = useState<SortDir | null>(initialSort ? initialSortDir : null);
  const [quickPreset, setQuickPreset] = useState<QuickPreset | null>(initialPreset || null);

  useEffect(() => {
    if (initialSort) {
      setSortKey(initialSort);
      setSortDir(initialSortDir);
      setQuickPreset(null);
    }
  }, [initialSort, initialSortDir]);

  useEffect(() => {
    if (initialPreset) {
      setQuickPreset(initialPreset);
      setSortKey(null);
      setSortDir(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPreset, initialPresetTick]);

  const handleSort = (key: SortKey) => {
    setQuickPreset(null);
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("desc");
    } else if (sortDir === "desc") {
      setSortDir("asc");
    } else {
      setSortKey(null);
      setSortDir(null);
    }
  };

  const togglePreset = (key: QuickPreset) => {
    if (quickPreset === key) {
      setQuickPreset(null);
    } else {
      setQuickPreset(key);
      setSortKey(null);
      setSortDir(null);
    }
  };

  const subCategories = useMemo(() => {
    // 排除空 subCategory：当 SKU 的 category_id 仅指 L1 或为 NULL 时 splitCategory
    // 会给出空字符串；Radix Select 禁止 <SelectItem value="">（空串保留给 placeholder），
    // 喂进去会 throw "must have a value prop that is not an empty string"。
    const alignedSet = alignedSubCategories ? new Set(alignedSubCategories) : null;
    const seen = new Set<string>();
    const aligned: string[] = [];
    const rest: string[] = [];
    for (const sku of skus) {
      const sub = sku.subCategory;
      if (!sub) continue;
      if (!seen.has(sub)) {
        seen.add(sub);
        if (alignedSet && alignedSet.has(sub)) aligned.push(sub);
        else rest.push(sub);
      }
    }
    return [...aligned, ...rest];
  }, [skus, alignedSubCategories]);

  const displayRows = useMemo(() => {
    const rows: DisplayRow[] = [];
    const addedCodes = new Set<string>();
    const alignedSet = alignedSubCategories ? new Set(alignedSubCategories) : null;
    if (alignedSet && alignedSet.size > 0) {
      for (const sku of skus) {
        if (alignedSet.has(sku.subCategory) && !addedCodes.has(sku.skuCode)) {
          addedCodes.add(sku.skuCode);
          rows.push({ ...sku, isAligned: true });
        }
      }
    }
    for (const sku of skus) {
      if (!addedCodes.has(sku.skuCode)) {
        addedCodes.add(sku.skuCode);
        rows.push({ ...sku, isAligned: false });
      }
    }
    return rows;
  }, [skus, alignedSubCategories]);

  const filtered = useMemo(() => {
    let result = displayRows;
    if (selectedSubCat !== "全部") {
      result = result.filter(s => s.subCategory === selectedSubCat);
    }
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      result = result.filter(s => s.skuName.toLowerCase().includes(t) || s.skuCode.includes(t) || s.subCategory.toLowerCase().includes(t));
    }
    if (quickPreset) {
      if (quickPreset === "lowSales") {
        result = [...result].sort(
          (a, b) => parseFloat(a.sales30d || "0") - parseFloat(b.sales30d || "0"),
        );
      } else if (quickPreset === "stale") {
        result = [...result].sort((a, b) => {
          const sa = isStaleSku(a) ? 0 : 1;
          const sb = isStaleSku(b) ? 0 : 1;
          if (sa !== sb) return sa - sb;
          return parseFloat(a.salesVolume30d || "0") - parseFloat(b.salesVolume30d || "0");
        });
      } else if (quickPreset === "highDrop") {
        result = [...result].sort((a, b) => {
          const ra = a.salesChange30d;
          const rb = b.salesChange30d;
          const va = ra && ra !== "NULL" ? parseFloat(ra) : 0;
          const vb = rb && rb !== "NULL" ? parseFloat(rb) : 0;
          return va - vb;
        });
      }
    } else if (sortKey && sortDir) {
      const mult = sortDir === "desc" ? -1 : 1;
      result = [...result].sort((a, b) => {
        let va = 0, vb = 0;
        if (sortKey === "sales30d") {
          va = parseFloat(a.sales30d || "0") / 30;
          vb = parseFloat(b.sales30d || "0") / 30;
        } else if (sortKey === "psd") {
          va = parseFloat(a.salesVolume30d || "0") / 30;
          vb = parseFloat(b.salesVolume30d || "0") / 30;
        } else if (sortKey === "salesChange30d") {
          const ra = a.salesChange30d;
          va = (ra && ra !== "NULL") ? parseFloat(ra) : 0;
          const rb = b.salesChange30d;
          vb = (rb && rb !== "NULL") ? parseFloat(rb) : 0;
        }
        return (va - vb) * mult;
      });
    }
    return result;
  }, [displayRows, searchTerm, selectedSubCat, sortKey, sortDir, quickPreset]);

  const sortableHeader = (label: string, key: SortKey) => {
    const isActive = sortKey === key;
    const widthClass = isMobile
      ? (key === "sales30d" ? "w-[96px]" : key === "psd" ? "w-[78px]" : "w-[92px]")
      : (key === "sales30d" ? "w-[96px]" : key === "psd" ? "w-[78px]" : "w-[100px]");
    return (
      <TableHead
        className={cn(
          "text-xs text-right cursor-pointer hover:bg-gray-50 transition-colors select-none whitespace-nowrap sticky top-0 z-10 bg-card",
          widthClass,
          isActive && sortDir === "desc" && "text-green-600 font-semibold",
          isActive && sortDir === "asc" && "text-red-600 font-semibold",
          !isActive && "text-gray-500 font-normal"
        )}
        onClick={() => handleSort(key)}
      >
        {label}
        <SortIcon active={isActive} direction={sortDir} />
      </TableHead>
    );
  };

  return (
    <div className="bg-card overflow-hidden">
      <div className="px-4 py-2 border-b border-border space-y-2">

        <div className="flex items-center gap-2">
          <Select value={selectedSubCat} onValueChange={setSelectedSubCat}>
            <SelectTrigger className="h-8 text-xs flex-1 min-w-0">
              <SelectValue placeholder="筛选小类" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="全部">全部小类</SelectItem>
              {subCategories.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="搜索商品..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-8 h-8 text-xs" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((p) => {
            const active = quickPreset === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => togglePreset(p.key)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-[11px] border transition-all",
                  active
                    ? "border-primary text-primary bg-primary/5"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>

      </div>

      <div>
        <Table className="table-fixed w-full" wrapperClassName="max-h-[400px] overflow-auto">
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs w-[80px] sticky top-0 z-10 bg-card">商品代码</TableHead>
              <TableHead className="text-xs w-[180px] sticky top-0 z-10 bg-card">商品名称</TableHead>
              <TableHead className={cn("text-xs w-[80px] sticky top-0 z-10 bg-card", isMobile && "hidden")}>商品规格</TableHead>
              <TableHead className={cn("text-xs w-[60px] sticky top-0 z-10 bg-card", isMobile && "hidden")}>小类</TableHead>
              {sortableHeader("30日销量", "psd")}
              {sortableHeader("30日销售额", "sales30d")}
              {sortableHeader("销售额环比", "salesChange30d")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, 100).map(sku => {
              const isHovered = hoveredSkuCode === sku.skuCode;
              let strategyRowBg = "";
              for (const s of strategies) {
                const match = s.skus.find(sk => sk.skuCode === sku.skuCode);
                if (match) {
                  if (match.action.includes("下架")) { strategyRowBg = "bg-red-50/60 dark:bg-red-900/10"; break; }
                  if (/保留观察|观察|保留/.test(match.action)) { strategyRowBg = "bg-amber-50/60 dark:bg-amber-900/10"; break; }
                  if (match.action.includes("力推")) { strategyRowBg = "bg-green-50/60 dark:bg-green-900/10"; break; }
                }
              }
              return (
                <TableRow
                  key={sku.skuCode}
                  data-sku-row={sku.skuCode}
                  className={cn(
                    "cursor-pointer transition-colors",
                    isHovered && "bg-primary/5",
                    strategyRowBg,
                    highlightedSkuCodes && highlightedSkuCodes.has(sku.skuCode) && "bg-yellow-50 dark:bg-yellow-900/20",
                    focusedSkuCode === sku.skuCode && "bg-orange-100 dark:bg-orange-900/30 ring-2 ring-orange-400 animate-pulse",
                  )}
                  onMouseEnter={() => onHoverSku(sku.skuCode)}
                  onMouseLeave={() => onHoverSku(null)}
                  onClick={() => onRowClick?.(sku)}
                >
                  <TableCell className="text-xs text-muted-foreground">{sku.skuCode}</TableCell>
                  <TableCell className="text-xs font-medium max-w-[180px]">
                    <div className="flex items-center gap-2">
                      <SkuThumbnail skuCode={sku.skuCode} skuName={sku.skuName} size={28} />
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="truncate">{sku.skuName}</span>
                        {isStaleSku(sku) && (
                          <span className="shrink-0 px-1 py-0.5 rounded text-[9px] bg-red-100 text-red-700 font-medium">滞销</span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={cn("text-xs text-muted-foreground", isMobile && "hidden")}>{sku.spec || "—"}</TableCell>
                  <TableCell className={cn("text-xs text-muted-foreground", isMobile && "hidden")}>{sku.subCategory}</TableCell>
                  <TableCell className="text-xs text-right">{(parseFloat(sku.salesVolume30d || "0") / 30).toFixed(1)}</TableCell>
                  <TableCell className="text-xs text-right">¥{(parseFloat(sku.sales30d || "0") / 30).toFixed(1)}</TableCell>
                  <TableCell className="text-xs text-right">{(() => {
                    const raw = sku.salesChange30d;
                    if (!raw || raw === "NULL") return "—";
                    const val = parseFloat(raw);
                    if (isNaN(val)) return "—";
                    const pct = (val * 100).toFixed(1);
                    if (val > 0.5) return <span>🔥 {pct}%</span>;
                    if (val < -0.2) return <span className="bg-red-50 text-red-600 rounded px-1.5">{pct}%</span>;
                    return `${pct}%`;
                  })()}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
