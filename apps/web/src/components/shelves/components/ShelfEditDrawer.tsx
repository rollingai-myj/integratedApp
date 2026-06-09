import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Save, X, Plus, Trash2, Minus, Info, Loader2, ChevronDown } from "lucide-react";
import { toast, toastSuccess } from "@/components/ui/sonner";
import { categoryColors, getCategoryColor, type ShelfWidth } from "@/components/shelves/data/shelfConfig";
import { ShelfSpecPicker } from "@/components/shelves/components/ShelfSpecPicker";
import { getSpecsByType } from "@/components/shelves/data/shelfSpecs";
import { apiFetch } from "@/components/shelves/lib/api-client";

const ALL_CATEGORIES = Object.keys(categoryColors);

const SHELF_TYPES = ["标准货架", "冷柜", "端架", "收银台旁", "烘焙架"] as const;
const SHELF_WIDTHS: ShelfWidth[] = ["60cm", "75cm", "90cm"];

interface PlanPosition {
  position_code: number;
  position_name: string;
  categories: string[];
}

export interface ShelfEditData {
  shelfId: string;
  shelfType: string;
  shelfWidth: ShelfWidth;
  shelfLayers: number;
  categories: { category: string; ratio: number }[];
  groupName: string;
  displayLabel?: string | null;
}

interface ShelfEditDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ShelfEditData | null;
  onSave: (data: ShelfEditData) => void;
  onDelete?: (shelfId: string) => void;
  groupNames?: string[];
  displayName?: string;
  siblings?: { shelf_id: string; categories: { category: string }[]; display_label?: string | null }[];
  readOnly?: boolean;
}

/** Reverse-lookup: given a set of categories, find the plan position that contains them all */
function findPlanPosition(
  categories: string[],
  planPositions: PlanPosition[],
): PlanPosition | undefined {
  if (categories.length === 0) return undefined;
  const catSet = new Set(categories);
  // Find exact match: all categories are contained and no extra ones
  return planPositions.find((p) => {
    const pSet = new Set(p.categories);
    return pSet.size === catSet.size && [...pSet].every((c) => catSet.has(c));
  });
}

export const ShelfEditDrawer = ({ open, onOpenChange, data, onSave, onDelete, displayName, siblings, readOnly = false }: ShelfEditDrawerProps) => {
  const [editData, setEditData] = useState<ShelfEditData | null>(null);
  const [planPositions, setPlanPositions] = useState<PlanPosition[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [positionKey, setPositionKey] = useState<string>(""); // "code|name"
  const [pickerOpen, setPickerOpen] = useState(false);
  const sheetContentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (data && open) setEditData({ ...data, categories: [...data.categories] });
  }, [data, open]);

  // Fetch plan positions when drawer opens
  useEffect(() => {
    if (!open) return;
    setPositionsLoading(true);
    apiFetch("/api/config/plan-positions")
      .then((res) => res.json())
      .then((positions: PlanPosition[]) => {
        setPlanPositions(positions);
      })
      .catch(() => {})
      .finally(() => setPositionsLoading(false));
  }, [open]);

  // Map existing categories → plan position
  useEffect(() => {
    if (!editData || planPositions.length === 0) return;
    const cats = editData.categories.map((c) => c.category);
    const pp = findPlanPosition(cats, planPositions);
    if (pp) {
      setPositionKey(`${pp.position_code}|${pp.position_name}`);
    }
  }, [editData, planPositions]);

  // Smart defaults: category drives shelfType
  useEffect(() => {
    if (!editData || planPositions.length === 0) return;
    const cats = editData.categories.map((c) => c.category);
    const hasChilled = cats.includes("冷藏品");
    const hasBakery = cats.includes("烘焙糕点");
    if (hasChilled && editData.shelfType === "标准货架") {
      setEditData((prev) => (prev ? { ...prev, shelfType: "冷柜" } : prev));
    } else if (hasBakery && editData.shelfType === "标准货架") {
      setEditData((prev) => (prev ? { ...prev, shelfType: "烘焙架" } : prev));
    }
  }, [editData?.categories, planPositions]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!editData) return null;

  const selected = planPositions.find(
    (p) => `${p.position_code}|${p.position_name}` === positionKey,
  );
  const selectedCategories = editData.categories.map((c) => c.category);
  const primaryCategory = selectedCategories[0] || "";

  const pickPosition = (key: string) => {
    setPositionKey(key);
    const pp = planPositions.find((p) => `${p.position_code}|${p.position_name}` === key);
    if (pp) {
      setEditData({
        ...editData,
        categories: pp.categories.map((cat) => ({ category: cat, ratio: 1 })),
      });
    }
    setPickerOpen(false);
  };

  const handleSave = () => {
    if (editData.categories.length === 0) {
      toast.error("请选择规划位");
      return;
    }
    // Uniqueness validation
    const labelTrimmed = (editData.displayLabel || "").trim();
    if (labelTrimmed && siblings && siblings.length > 0) {
      const myCats = new Set(editData.categories.map((c) => c.category));
      const dup = siblings.some((s) => {
        const sCats = new Set(s.categories.map((c) => c.category));
        const overlap = [...sCats].some((c) => myCats.has(c));
        return (
          s.shelf_id !== editData.shelfId &&
          overlap &&
          (s.display_label || "").trim() === labelTrimmed
        );
      });
      if (dup) {
        toast.error("同品类下已存在编号「" + labelTrimmed + "」");
        return;
      }
    }
    onSave({ ...editData, displayLabel: labelTrimmed || null });
    onOpenChange(false);
    toastSuccess("货架配置已保存");
  };

  const positionLabel = selected
    ? `${selected.position_name} (规划位 ${selected.position_code})`
    : "未选择";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={sheetContentRef}
        className="w-[360px] sm:w-[400px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle className="text-base">
            {readOnly ? "查看货架" : "编辑货架"}{displayName ? ` — ${displayName}` : ""}
          </SheetTitle>
        </SheetHeader>

        {readOnly && (
          <div className="mt-3 flex items-start gap-1.5 text-[11px] text-primary bg-primary/10 border border-primary/20 rounded-md px-2.5 py-1.5">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            <span>历史记录模式：仅展示当时的货架属性，不可编辑</span>
          </div>
        )}

        <fieldset disabled={readOnly} className="mt-6 space-y-5 disabled:opacity-90">
          {/* Plan position / Category display */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              货架规划位 <span className="text-destructive">*</span>
            </label>

            {positionsLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                加载规划位…
              </div>
            ) : selected ? (
              <div className="flex items-center gap-2 bg-card border rounded-lg px-3 py-2">
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getCategoryColor(primaryCategory) }}
                />
                <span className="text-sm flex-1">{positionLabel}</span>
                {!readOnly && (
                  <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)} className="h-6 text-xs">
                    更换
                  </Button>
                )}
              </div>
            ) : selectedCategories.length > 0 ? (
              <div className="flex items-center gap-2 bg-card border rounded-lg px-3 py-2">
                <span className="text-sm flex-1">
                  {selectedCategories.join("、")}
                  <span className="text-[10px] text-muted-foreground ml-1">（无对应规划位）</span>
                </span>
                {!readOnly && (
                  <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)} className="h-6 text-xs">
                    更换
                  </Button>
                )}
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full h-8 text-xs gap-1 border-dashed"
                onClick={() => setPickerOpen(true)}
              >
                <Plus className="w-3 h-3" />
                选择规划位
              </Button>
            )}

            {pickerOpen && !readOnly && planPositions.length > 0 && (
              <div className="border rounded-lg overflow-hidden bg-card">
                <div className="max-h-[240px] overflow-y-auto">
                  {(() => {
                    const grouped = new Map<number, PlanPosition[]>();
                    for (const p of planPositions) {
                      if (!grouped.has(p.position_code)) grouped.set(p.position_code, []);
                      grouped.get(p.position_code)!.push(p);
                    }
                    return Array.from(grouped.entries()).map(([code, positions]) => (
                      <div key={code}>
                        <div className="text-[10px] text-muted-foreground/70 px-3 py-1.5 font-medium bg-muted/30">
                          规划位 {code}
                        </div>
                        {positions.map((p) => {
                          const key = `${p.position_code}|${p.position_name}`;
                          const isSelected = key === positionKey;
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => pickPosition(key)}
                              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-accent transition-colors text-left"
                              style={{ background: isSelected ? "var(--accent)" : "transparent" }}
                            >
                              <span
                                className="w-3 h-3 rounded-full flex-shrink-0"
                                style={{ backgroundColor: getCategoryColor(p.categories[0]) }}
                              />
                              <span className="flex-1">{p.position_name}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {p.categories.length} 品类
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}

            {selectedCategories.length > 1 && (
              <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground bg-muted/50 rounded-md px-2.5 py-1.5">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                <span>包含品类：{selectedCategories.join("、")}</span>
              </div>
            )}
          </div>

          {/* Display label */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">货架编号</label>
            <Input
              value={editData.displayLabel ?? ""}
              onChange={(e) => setEditData({ ...editData, displayLabel: e.target.value })}
              placeholder="如 01、靠门第一排"
              className="h-9"
            />
            <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground bg-muted/50 rounded-md px-2.5 py-1.5">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              <span>同品类下编号不可重复；可填写任意文字（如「靠门第一排」）</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">货架类型</label>
            <Select
              value={editData.shelfType || "标准货架"}
              onValueChange={(v) => setEditData({ ...editData, shelfType: v })}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHELF_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">货架规格</label>
            {getSpecsByType(editData.shelfType).length > 0 ? (
              <ShelfSpecPicker
                shelfType={editData.shelfType}
                selectedWidth={parseInt(editData.shelfWidth) || 0}
                onSelect={(spec) =>
                  setEditData({ ...editData, shelfWidth: `${spec.width}cm` as ShelfWidth })
                }
              />
            ) : (
              <>
                <div className="flex items-center justify-center gap-4">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    disabled={parseInt(editData.shelfWidth) <= 30}
                    onClick={() => {
                      const cur = parseInt(editData.shelfWidth) || 75;
                      setEditData({ ...editData, shelfWidth: `${Math.max(30, cur - 15)}cm` as ShelfWidth });
                    }}
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                  <span className="text-lg font-bold min-w-[80px] text-center">
                    {parseInt(editData.shelfWidth) || 75} cm
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    disabled={parseInt(editData.shelfWidth) >= 300}
                    onClick={() => {
                      const cur = parseInt(editData.shelfWidth) || 75;
                      setEditData({ ...editData, shelfWidth: `${Math.min(300, cur + 15)}cm` as ShelfWidth });
                    }}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground bg-muted/50 rounded-md px-2.5 py-1.5">
                  <Info className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>若为多个货架拼接，请选择拼接后的总宽度（如两个75cm=150cm）</span>
                </div>
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {primaryCategory || "货架"} 所占货架层数
            </label>
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                disabled={editData.shelfLayers <= 1}
                onClick={() => setEditData({ ...editData, shelfLayers: Math.max(1, editData.shelfLayers - 1) })}
              >
                <Minus className="w-4 h-4" />
              </Button>
              <Input
                type="text"
                inputMode="numeric"
                value={editData.shelfLayers}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  if (!isNaN(v) && v >= 1 && v <= 20) setEditData({ ...editData, shelfLayers: v });
                }}
                className="h-9 w-[80px] text-center text-lg font-bold"
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                disabled={editData.shelfLayers >= 20}
                onClick={() => setEditData({ ...editData, shelfLayers: Math.min(20, editData.shelfLayers + 1) })}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {!readOnly && (
            <Button onClick={handleSave} className="w-full gap-1">
              <Save className="w-4 h-4" />
              保存
            </Button>
          )}

          {!readOnly && onDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full gap-1 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10"
                >
                  <Trash2 className="w-4 h-4" />
                  删除该货架
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认删除货架</AlertDialogTitle>
                  <AlertDialogDescription>确定要删除该货架吗？此操作不可撤销。</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => {
                      onDelete(editData.shelfId);
                      onOpenChange(false);
                      toastSuccess("货架已删除");
                    }}
                  >
                    确认删除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </fieldset>
      </SheetContent>
    </Sheet>
  );
};
