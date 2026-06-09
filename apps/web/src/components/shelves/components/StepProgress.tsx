import React, { ReactNode } from "react";
import { useNavigate, useLocation } from "@/components/shelves/lib/router-shim";
import { cn } from "@/components/shelves/lib/utils";
import { Package, ShoppingCart, TrendingUp } from "lucide-react";
import { useAppContext } from "@/components/shelves/contexts/AppContext";

const allSteps = [
  { label: "货架配置", path: "/shelf", icon: Package },
  { label: "选品", path: "/selection", icon: ShoppingCart },
  { label: "业绩", path: "/performance", icon: TrendingUp },
];

interface StepProgressProps {
  rightSlot?: ReactNode;
}

export const StepProgress = ({ rightSlot }: StepProgressProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasSelection, lastShelfDetailId } = useAppContext();

  const steps = hasSelection ? allSteps : allSteps.filter((s) => s.path === "/shelf");
  const currentIndex = steps.findIndex((s) => {
    if (s.path === "/selection") {
      return location.pathname === "/selection" || location.pathname === "/shelf-detail";
    }
    return s.path === location.pathname;
  });

  return (
    <div
      className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-2 py-2 sm:py-3 px-3 sm:px-6 border-b"
      style={{
        background: "rgba(255,255,255,0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        borderBottomColor: "rgba(200,180,160,0.30)",
      }}
    >
      <div className="flex items-center gap-1 sm:gap-2">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const isActive = i === currentIndex;
          const isPast = i < currentIndex;
          return (
            <React.Fragment key={step.path}>
              {i > 0 && (
                <div
                  className={cn(
                    "h-0.5 w-6 sm:w-12 rounded-full transition-colors",
                    isPast ? "ai-gradient" : ""
                  )}
                  style={!isPast ? { background: "rgba(200,180,160,0.4)" } : undefined}
                />
              )}
              <button
                onClick={() => {
                  if (step.path === "/selection" && lastShelfDetailId) {
                    navigate(`/shelf-detail?shelf=${lastShelfDetailId}`);
                  } else {
                    navigate(step.path);
                  }
                }}
                className={cn(
                  "flex items-center gap-1 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all",
                )}
                style={
                  isActive
                    ? {
                        background: "linear-gradient(95deg, #E84A28 0%, #C82B19 100%)",
                        color: "#fff",
                        boxShadow: "0 2px 8px rgba(200,43,25,0.18)",
                      }
                    : isPast
                    ? {
                        color: "rgba(50,12,18,0.45)",
                        background: "transparent",
                      }
                    : {
                        color: "rgba(50,12,18,0.35)",
                        background: "transparent",
                      }
                }
              >
                <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                {step.label}
              </button>
            </React.Fragment>
          );
        })}
      </div>
      {rightSlot && <div className="flex items-center mt-1 sm:mt-0">{rightSlot}</div>}
    </div>
  );
};
