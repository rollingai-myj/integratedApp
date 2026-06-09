import { useState } from "react";
import { useParams } from "@/components/shelves/lib/router-shim";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ChevronDown } from "lucide-react";
import { useAppContext } from "@/components/shelves/contexts/AppContext";
import { SceneHeader } from "@/components/shelves/components/v2/SceneHeader";
import { usePlanPosition } from "@/components/shelves/hooks/usePlanPositions";
import { listAdjustments, type SceneAdjustment } from "@/components/shelves/services/scenes";
import { cn } from "@/components/shelves/lib/utils";
import { classifyAction } from "@/components/shelves/lib/strategyAction";

const fmtTime = (s: string) => new Date(s).toLocaleString("zh-CN", { hour12: false });

const RecordPage = () => {
  const { code } = useParams();
  const sceneId = Number(code);
  const { selectedStore } = useAppContext();
  const { position } = usePlanPosition(sceneId);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["adjustments", selectedStore, sceneId],
    queryFn: () => listAdjustments(selectedStore, sceneId),
    enabled: !!selectedStore && Number.isFinite(sceneId),
  });

  const [openId, setOpenId] = useState<number | null>(null);

  const renderItems = (rec: SceneAdjustment) => {
    const up = rec.items.filter((i) => classifyAction(i.action) === "push");
    const down = rec.items.filter((i) => classifyAction(i.action) === "remove");
    const Group = ({ title, list, color }: { title: string; list: typeof rec.items; color: string }) =>
      list.length ? (
        <div>
          <p className={cn("text-xs font-semibold mb-1", color)}>{title}（{list.length}）</p>
          <div className="space-y-1">
            {list.map((it, i) => (
              <div key={i} className="text-xs flex items-center justify-between">
                <span className="truncate">{it.skuName}{it.spec ? <span className="text-muted-foreground"> | {it.spec}</span> : null}</span>
                <span className="text-muted-foreground ml-2 shrink-0">{it.action}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null;
    return (
      <div className="space-y-3 pt-2">
        <Group title="上架" list={up} color="text-green-600" />
        <Group title="停止进货" list={down} color="text-red-500" />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <SceneHeader storeId={selectedStore} sceneName={position?.position_name} backTo={`/position/${code}/index`} />
      <div className="p-4 space-y-3">
        {isLoading ? (
          <div className="py-20 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />加载中…</div>
        ) : records.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">暂无调改记录</div>
        ) : (
          records.map((rec) => (
            <div key={rec.id} className="rounded-2xl border border-border bg-card overflow-hidden">
              <button
                onClick={() => setOpenId(openId === rec.id ? null : rec.id)}
                className="w-full flex items-center justify-between gap-2 p-4 hover:bg-muted/40 transition-colors"
              >
                <div className="text-left min-w-0">
                  <div className="text-sm font-medium">{rec.summary || "调改"}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{fmtTime(rec.created_at)}</div>
                </div>
                <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", openId === rec.id && "rotate-180")} />
              </button>
              {openId === rec.id && <div className="px-4 pb-4 border-t">{renderItems(rec)}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default RecordPage;
