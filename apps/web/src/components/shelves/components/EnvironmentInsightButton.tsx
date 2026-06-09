import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Globe, Loader2, RefreshCw, Pencil } from "lucide-react";
import { useEnvironmentInsight } from "@/components/shelves/hooks/useEnvironmentInsight";

const CATEGORY_OPTIONS = [
  "住宅区", "办公区", "工业区", "交通枢纽", "科教区", "旅游区",
  "商业区", "市场区", "文教区", "医院区", "娱乐区", "其他",
];

const STATUS_LABEL: Record<string, string> = {
  checking: "正在加载周边环境...",
  locating: "正在定位门店...",
  "fetching-poi": "正在获取周边 POI...",
  "ai-analyzing": "AI 正在分析周边商圈...",
};

export const EnvironmentInsightButton = () => {
  const { status, insight, errorMessage, reanalyze, updateCategory } = useEnvironmentInsight();
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editSelected, setEditSelected] = useState<string[]>([]);

  const currentCategoryList = useMemo(() => {
    if (!insight?.category) return [];
    return insight.category.split(/[·、,，\/]/).map((s) => s.trim()).filter(Boolean);
  }, [insight?.category]);

  const openEdit = () => {
    setEditSelected(currentCategoryList.filter((c) => CATEGORY_OPTIONS.includes(c)));
    setEditOpen(true);
  };

  const toggleOption = (opt: string) => {
    setEditSelected((prev) =>
      prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt]
    );
  };

  const saveEdit = async () => {
    if (editSelected.length === 0) return;
    await updateCategory(editSelected.join("·"));
    setEditOpen(false);
  };

  const isWorking =
    status === "checking" ||
    status === "locating" ||
    status === "fetching-poi" ||
    status === "ai-analyzing";

  const canOpen = status === "ready" || status === "error";
  const buttonLabel =
    status === "ready" && insight?.category
      ? insight.category
      : status === "error"
      ? "周边环境（重试）"
      : "周边环境";

  return (
    <>
      {isWorking ? (
        <div className="inline-flex items-center gap-1.5 text-[10px] sm:text-xs h-7 sm:h-8 px-2 sm:px-3 rounded-md bg-secondary text-secondary-foreground whitespace-nowrap w-auto max-w-[200px] sm:max-w-none">
          <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin flex-shrink-0" />
          <span className="truncate">正在分析周边环境</span>
        </div>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          disabled={!canOpen}
          onClick={() => setOpen(true)}
          className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs h-7 sm:h-8 px-2 sm:px-3 max-w-[140px] sm:max-w-none"
        >
          <Globe className="w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0" />
          <span className="truncate">{buttonLabel}</span>
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" />
              周边环境洞察
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto -mx-2 px-2 space-y-4">
            {status === "error" && (
              <div className="text-sm text-destructive py-2">
                {errorMessage || "分析失败"}
              </div>
            )}
            {insight && (insight.category || insight.competitor_analysis) ? (
              <>
                <section>
                  <div className="flex items-center justify-between mb-1.5">
                    <h4 className="text-xs font-semibold text-muted-foreground">
                      商圈类型
                    </h4>
                    <Popover open={editOpen} onOpenChange={setEditOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-xs gap-1"
                          onClick={openEdit}
                        >
                          <Pencil className="w-3 h-3" />
                          编辑
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-64 p-3">
                        <div className="text-xs font-semibold text-muted-foreground mb-2">
                          选择商圈类型（可多选）
                        </div>
                        <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                          {CATEGORY_OPTIONS.map((opt) => (
                            <label
                              key={opt}
                              className="flex items-center gap-2 text-sm cursor-pointer"
                            >
                              <Checkbox
                                checked={editSelected.includes(opt)}
                                onCheckedChange={() => toggleOption(opt)}
                              />
                              <span>{opt}</span>
                            </label>
                          ))}
                        </div>
                        <div className="flex justify-end gap-2 mt-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditOpen(false)}
                          >
                            取消
                          </Button>
                          <Button
                            size="sm"
                            onClick={saveEdit}
                            disabled={editSelected.length === 0}
                          >
                            保存
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {insight.category || "—"}
                  </p>
                </section>
                <section>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-1.5">
                    商圈分析
                  </h4>
                  <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                    {insight.crowd_source_analysis || "—"}
                  </p>
                </section>
                <section>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-1.5">
                    主要竞对
                  </h4>
                  {insight.top_competitors && insight.top_competitors.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {insight.top_competitors.map((c, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </section>
                <section>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-1.5">
                    竞对分析
                  </h4>
                  <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                    {insight.competitor_analysis || "—"}
                  </p>
                </section>
              </>
            ) : status !== "error" ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                暂无报告
              </div>
            ) : null}
          </div>

          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button size="sm" onClick={reanalyze} disabled={isWorking}>
              {isWorking ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              重新分析
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
