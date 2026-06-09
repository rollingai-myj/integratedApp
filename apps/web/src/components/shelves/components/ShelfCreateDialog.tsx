/**
 * 货架创建对话框 — 照片上传后弹出,引导用户完成货架配置
 * 1. 选择规划位  2. 设置宽度(步进15cm)  3. 设置层数(步进1)
 */
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Minus, Info, Loader2 } from "lucide-react";
import { getCategoryColor } from "@/components/shelves/data/shelfConfig";
import { ShelfSpecPicker } from "@/components/shelves/components/ShelfSpecPicker";
import { getSpecsByType } from "@/components/shelves/data/shelfSpecs";
import { apiFetch } from "@/components/shelves/lib/api-client";

const SHELF_TYPES = ["标准货架", "冷柜", "端架", "收银台旁", "烘焙架"] as const;
const DEFAULT_POSITION = "面包架【烘焙】";
const DEFAULT_SHELF_TYPE = "冷柜";

interface PlanPosition {
  position_code: number;
  position_name: string;
  categories: string[];
}

export interface ShelfCreateResult {
  categories: { category: string; ratio: number }[];
  width: number;
  layers: number;
  shelfType: string;
}

interface ShelfCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (result: ShelfCreateResult) => void;
}

const MIN_WIDTH = 30;
const MAX_WIDTH = 300;
const WIDTH_STEP = 15;
const DEFAULT_WIDTH = 75;

const clampWidth = (value: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
const snapWidth = (value: number) => clampWidth(Math.round(value / WIDTH_STEP) * WIDTH_STEP);

export const ShelfCreateDialog = ({ open, onOpenChange, onSubmit }: ShelfCreateDialogProps) => {
  const [planPositions, setPlanPositions] = useState<PlanPosition[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(true);
  const [positionKey, setPositionKey] = useState<string>(""); // "code|name"
  const [width, setWidth] = useState(0);
  const [widthInput, setWidthInput] = useState("");
  const [layers, setLayers] = useState(7);
  const [shelfType, setShelfType] = useState<string>(DEFAULT_SHELF_TYPE);

  useEffect(() => {
    if (!open) return;
    setPositionsLoading(true);
    apiFetch("/api/config/plan-positions")
      .then((res) => res.json())
      .then((data: PlanPosition[]) => {
        setPlanPositions(data);
        // Default to 面包架【烘焙】 if available
        const def = data.find((p) => p.position_name === DEFAULT_POSITION);
        if (def) setPositionKey(`${def.position_code}|${def.position_name}`);
        else if (data.length > 0) setPositionKey(`${data[0].position_code}|${data[0].position_name}`);
      })
      .catch(() => {})
      .finally(() => setPositionsLoading(false));
  }, [open]);

  const selectedPosition = planPositions.find(
    (p) => `${p.position_code}|${p.position_name}` === positionKey,
  );

  const syncWidth = (value: number) => {
    const normalized = snapWidth(value);
    setWidth(normalized);
    setWidthInput(String(normalized));
  };

  const handlePositionChange = (next: string) => {
    setPositionKey(next);
    const pp = planPositions.find((p) => `${p.position_code}|${p.position_name}` === next);
    if (pp) {
      // Smart defaults
      const cats = pp.categories;
      if (cats.includes("冷藏品")) {
        setShelfType("冷柜");
      } else if (cats.includes("烘焙糕点")) {
        setShelfType("烘焙架");
        syncWidth(90);
      }
    }
  };

  const handleSubmit = () => {
    if (!selectedPosition) return;
    const hasSpecs = getSpecsByType(shelfType).length > 0;
    if (hasSpecs && !width) return;
    const finalWidth = widthInput.trim() ? snapWidth(Number(widthInput)) : width;
    if (!finalWidth) return;
    setWidth(finalWidth);
    setWidthInput(String(finalWidth));
    const categories = selectedPosition.categories.map((cat) => ({
      category: cat,
      ratio: 1,
    }));
    onSubmit({ categories, width: finalWidth, layers, shelfType });
  };

  const positionLabel = selectedPosition
    ? `${selectedPosition.position_name} (规划位 ${selectedPosition.position_code})`
    : "请选择规划位";

  const primaryCategory = selectedPosition?.categories[0] ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[360px] mx-auto">
        <DialogHeader>
          <DialogTitle className="text-base">📋 创建货架</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Plan position select */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              货架规划位 <span className="text-destructive">*</span>
            </label>
            {positionsLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                加载规划位…
              </div>
            ) : (
              <Select value={positionKey} onValueChange={handlePositionChange}>
                <SelectTrigger className="h-10">
                  <div className="flex items-center gap-2">
                    {selectedPosition && (
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: getCategoryColor(primaryCategory) }}
                      />
                    )}
                    <SelectValue placeholder="请选择规划位" />
                  </div>
                </SelectTrigger>
                <SelectContent className="max-h-[320px]">
                  {(() => {
                    // Group by position_code
                    const grouped = new Map<number, PlanPosition[]>();
                    for (const p of planPositions) {
                      if (!grouped.has(p.position_code)) grouped.set(p.position_code, []);
                      grouped.get(p.position_code)!.push(p);
                    }
                    return Array.from(grouped.entries()).map(([code, positions]) => (
                      <SelectGroup key={code}>
                        <SelectLabel className="text-[10px] text-muted-foreground/70 pl-2">
                          规划位 {code}
                        </SelectLabel>
                        {positions.map((p) => {
                          const key = `${p.position_code}|${p.position_name}`;
                          const firstCat = p.categories[0];
                          return (
                            <SelectItem key={key} value={key}>
                              <span className="flex items-center gap-2">
                                <span
                                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: getCategoryColor(firstCat) }}
                                />
                                <span>{p.position_name}</span>
                                <span className="ml-1 text-[10px] text-muted-foreground">
                                  ({p.categories.length} 个品类)
                                </span>
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectGroup>
                    ));
                  })()}
                </SelectContent>
              </Select>
            )}
            {selectedPosition && selectedPosition.categories.length > 1 && (
              <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground bg-muted/50 rounded-md px-2.5 py-1.5">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                <span>包含品类：{selectedPosition.categories.join("、")}</span>
              </div>
            )}
          </div>

          {/* Shelf type */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">货架类型</label>
            <Select value={shelfType} onValueChange={setShelfType}>
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

          {/* Width: spec picker for 冷柜, stepper otherwise */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">货架规格</label>
            {getSpecsByType(shelfType).length > 0 ? (
              <ShelfSpecPicker
                shelfType={shelfType}
                selectedWidth={width}
                onSelect={(spec) => syncWidth(spec.width)}
              />
            ) : (
              <>
                <div className="flex items-center justify-center gap-4">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    disabled={width <= MIN_WIDTH}
                    onClick={() => syncWidth(width - WIDTH_STEP)}
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                  <div className="flex items-center justify-center min-w-[80px]">
                    <Input
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={widthInput}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => {
                        const next = e.target.value.replace(/\D/g, "");
                        setWidthInput(next);
                        if (!next) return;
                        const parsed = Number(next);
                        if (!Number.isNaN(parsed)) {
                          setWidth(clampWidth(parsed));
                        }
                      }}
                      onBlur={() => syncWidth(widthInput ? Number(widthInput) : DEFAULT_WIDTH)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                      className="h-auto w-16 rounded-none border-0 border-b border-border bg-transparent px-0 py-0 text-center text-lg font-bold shadow-none focus-visible:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="text-sm text-muted-foreground ml-1">cm</span>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    disabled={width >= MAX_WIDTH}
                    onClick={() => syncWidth(width + WIDTH_STEP)}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground bg-muted/50 rounded-md px-2.5 py-1.5">
                  <Info className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>若为多个货架拼接,请选择拼接后的总宽度。例如两个 75cm 的货架拼接,请选择 150cm。</span>
                </div>
              </>
            )}
          </div>

          {/* Layer stepper */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {positionLabel} 所占货架层数
            </label>
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                disabled={layers <= 1}
                onClick={() => setLayers((prev) => Math.max(1, prev - 1))}
              >
                <Minus className="w-4 h-4" />
              </Button>
              <span className="text-lg font-bold min-w-[80px] text-center">{layers} 层</span>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                disabled={layers >= 15}
                onClick={() => setLayers((prev) => Math.min(15, prev + 1))}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!selectedPosition || (getSpecsByType(shelfType).length > 0 && !width)} className="w-full">
            创建货架
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
