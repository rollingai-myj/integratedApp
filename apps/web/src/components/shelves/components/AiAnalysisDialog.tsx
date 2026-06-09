/**
 * AI 分析进度弹窗 — 展示分析动画步骤，到最后一步后持续转动直到关闭
 */
import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sparkles, Loader2, Check } from "lucide-react";
import { cn } from "@/components/shelves/lib/utils";

const STEPS = [
  "正在查看货架商品数据",
  "正在分析销售表现",
  "正在对比优质店数据",
  "正在生成选品建议",
];

interface Props {
  open: boolean;
}

export const AiAnalysisDialog = ({ open }: Props) => {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (!open) {
      setCurrentStep(0);
      return;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];
    let cumulative = 0;
    const intervals = [2000, 2500, 3000]; // delays before advancing to step 1, 2, 3

    intervals.forEach((delay, i) => {
      cumulative += delay;
      timers.push(setTimeout(() => setCurrentStep(i + 1), cumulative));
    });

    return () => timers.forEach(clearTimeout);
  }, [open]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-sm p-0 gap-0 [&>button]:hidden" onInteractOutside={e => e.preventDefault()}>
        <div className="p-5 space-y-5">
          {/* Header */}
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl ai-gradient flex items-center justify-center">
              <Sparkles className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold">AI 正在分析中</p>
              <p className="text-[11px] text-muted-foreground">请稍候，正在为您生成优化策略...</p>
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-3">
            {STEPS.map((stepText, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-3 text-sm transition-all duration-500",
                  i < currentStep
                    ? "text-foreground opacity-100"
                    : i === currentStep
                    ? "text-primary font-medium opacity-100"
                    : "text-muted-foreground opacity-40"
                )}
              >
                {i < currentStep ? (
                  <Check className="w-4 h-4 text-green-500 shrink-0" />
                ) : i === currentStep ? (
                  <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-muted-foreground/30 shrink-0" />
                )}
                <span>{stepText}</span>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
