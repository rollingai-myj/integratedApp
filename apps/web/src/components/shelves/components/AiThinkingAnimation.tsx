import { useState, useEffect } from "react";
import { cn } from "@/components/shelves/lib/utils";
import { Loader2, Check, Sparkles } from "lucide-react";

interface Props {
  steps: string[];
  onComplete: () => void;
  isRunning: boolean;
  /** ms per step (uniform) or per-step array */
  stepIntervals?: number | number[];
}

export const AiThinkingAnimation = ({ steps, onComplete, isRunning, stepIntervals = 2500 }: Props) => {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (!isRunning) return;
    setCurrentStep(0);

    let step = 0;
    let timer: ReturnType<typeof setTimeout>;

    const getDelay = (i: number) =>
      Array.isArray(stepIntervals) ? (stepIntervals[i] ?? stepIntervals[stepIntervals.length - 1]) : stepIntervals;

    const advance = () => {
      if (step >= steps.length - 1) {
        setTimeout(onComplete, 800);
        return;
      }
      const delay = getDelay(step + 1);
      timer = setTimeout(() => {
        step += 1;
        setCurrentStep(step);
        advance();
      }, delay);
    };

    timer = setTimeout(() => advance(), getDelay(0));

    return () => clearTimeout(timer);
  }, [isRunning, steps.length, onComplete, stepIntervals]);

  if (!isRunning) return null;

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-primary animate-pulse" />
        <span className="text-sm font-semibold ai-gradient-text">AI 正在分析中...</span>
      </div>
      {steps.map((step, i) => (
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
          <span>{step}</span>
        </div>
      ))}
    </div>
  );
};
