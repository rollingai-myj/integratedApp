/**
 * 货架规格选择器 — 收起态显示按钮，点击弹出大图横滑选择。
 * 滑到哪一张，"确认选择"即选哪一张。
 */
import { useEffect, useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { cn } from "@/components/shelves/lib/utils";
import { getSpecsByType, type ShelfSpec } from "@/components/shelves/data/shelfSpecs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";

interface ShelfSpecPickerProps {
  shelfType: string;
  selectedWidth: number;
  onSelect: (spec: ShelfSpec) => void;
}

export const ShelfSpecPicker = ({ shelfType, selectedWidth, onSelect }: ShelfSpecPickerProps) => {
  const [open, setOpen] = useState(false);
  const specs = getSpecsByType(shelfType);
  const current = specs.find((s) => s.width === selectedWidth);
  const matched = !!current;

  const [api, setApi] = useState<CarouselApi | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  // 弹层打开后，将轮播定位到当前已选规格
  useEffect(() => {
    if (!open || !api) return;
    const idx = Math.max(
      0,
      specs.findIndex((s) => s.width === selectedWidth),
    );
    api.scrollTo(idx, true);
    setCurrentIndex(idx);
  }, [open, api, specs, selectedWidth]);

  // 监听轮播切换
  useEffect(() => {
    if (!api) return;
    const handler = () => setCurrentIndex(api.selectedScrollSnap());
    api.on("select", handler);
    handler();
    return () => {
      api.off("select", handler);
    };
  }, [api]);

  if (specs.length === 0) return null;

  const handleConfirm = () => {
    const picked = specs[currentIndex];
    if (!picked) return;
    onSelect(picked);
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "w-full flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-left transition-colors",
          matched ? "border-border hover:border-primary/50" : "border-destructive/50 hover:border-destructive",
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          {current ? (
            <div className="w-10 h-10 rounded-md overflow-hidden bg-muted shrink-0">
              <img src={current.image} alt={current.name} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-md bg-muted shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">货架规格</div>
            <div className={cn("text-sm font-medium truncate", !matched && "text-destructive")}>
              {current ? `${current.name} · ${current.width} cm` : "请选择货架规格"}
            </div>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      {!matched && (
        <div className="flex items-start gap-1.5 text-[10px] text-destructive bg-destructive/10 rounded-md px-2.5 py-1.5">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          <span>当前宽度未匹配标准规格,请重新选择</span>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>选择货架规格</DialogTitle>
          </DialogHeader>
          <Carousel opts={{ align: "center" }} setApi={setApi} className="w-full px-8">
            <CarouselContent>
              {specs.map((spec, idx) => {
                const active = idx === currentIndex;
                return (
                  <CarouselItem key={spec.id} className="basis-full">
                    <div
                      className={cn(
                        "w-full rounded-xl border bg-card p-3 transition-all",
                        active
                          ? "border-primary ring-2 ring-primary/30"
                          : "border-border opacity-70",
                      )}
                    >
                      <div className="aspect-square w-full overflow-hidden rounded-lg bg-muted">
                        <img src={spec.image} alt={spec.name} className="w-full h-full object-contain" />
                      </div>
                      <div className="mt-3 text-base font-semibold">{spec.name}</div>
                      <div className="text-sm text-muted-foreground">宽度 {spec.width} cm</div>
                    </div>
                  </CarouselItem>
                );
              })}
            </CarouselContent>
            <CarouselPrevious className="-left-2" />
            <CarouselNext className="-right-2" />
          </Carousel>
          <DialogFooter>
            <Button onClick={handleConfirm} className="w-full">
              确认选择
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
