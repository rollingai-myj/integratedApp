/**
 * 货架历史记录列表 — 渲染当前货架的所有历史快照，最新一条标记为「当前」。
 */
import { useQuery } from "@tanstack/react-query";
import { fetchShelfHistory, normalizeActionType, ACTION_LABEL_CN, type ShelfHistoryActionType } from "@/components/shelves/services/shelfHistory";
import { Loader2, Image as ImageIcon, CheckCircle2, Zap, LayoutGrid, Camera, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Props {
  storeId: string;
  shelfId: string;
  open: boolean;
  onSelect?: (row: any | null) => void;
  selectedId?: string | null;
}

const ACTION_META: Record<ShelfHistoryActionType, { Icon: any; iconClass: string }> = {
  upload_photo: { Icon: Camera, iconClass: "text-muted-foreground" },
  diagnose: { Icon: CheckCircle2, iconClass: "text-green-500" },
  optimize_selection: { Icon: Sparkles, iconClass: "text-blue-500" },
  apply_strategy: { Icon: Zap, iconClass: "text-amber-500" },
  generate_layout: { Icon: LayoutGrid, iconClass: "text-primary" },
};

export const ShelfHistoryList = ({ storeId, shelfId, open, onSelect, selectedId }: Props) => {
  const { data, isLoading } = useQuery({
    queryKey: ["shelf_photo_history", storeId, shelfId],
    queryFn: () => fetchShelfHistory(storeId, shelfId),
    enabled: open && !!shelfId,
  });

  if (isLoading) {
    return (
      <div className="px-4 py-8 flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        加载中...
      </div>
    );
  }

  const items = data || [];
  if (items.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-muted-foreground">暂无历史记录</div>;
  }

  const fmt = (d: string) =>
    new Date(d).toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });

  return (
    <>
      {items.map((row, idx) => {
        const actionKey = normalizeActionType(row.action_type ?? row.status);
        const meta = ACTION_META[actionKey];
        const label = ACTION_LABEL_CN[actionKey];
        const Icon = meta.Icon;
        const isCurrent = idx === 0;
        const isSelected = selectedId === row.id;
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => onSelect?.(isCurrent ? null : row)}
            className={`w-full px-4 py-3 flex items-start gap-3 text-left transition-colors hover:bg-muted/50 ${isSelected ? "bg-primary/5 border-l-2 border-l-primary" : "border-l-2 border-l-transparent"}`}
          >
            <div className="w-16 h-16 rounded-md bg-muted overflow-hidden flex-shrink-0 flex items-center justify-center">
              {row.photo_url ? (
                <img src={row.photo_url} alt="历史照片" className="w-full h-full object-cover" />
              ) : (
                <ImageIcon className="w-5 h-5 text-muted-foreground/60" />
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-foreground">{fmt(row.created_at)}</p>
                {isCurrent && (
                  <Badge className="h-4 px-1.5 text-[10px] bg-primary text-primary-foreground hover:bg-primary">当前</Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
                <Icon className={`w-3 h-3 flex-shrink-0 ${meta.iconClass}`} />
                <span>{label}</span>
              </div>
            </div>
          </button>
        );
      })}
    </>
  );
};
