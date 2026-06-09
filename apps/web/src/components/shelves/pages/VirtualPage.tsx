import { useState } from "react";
import { useParams } from "@/components/shelves/lib/router-shim";
import { useQuery } from "@tanstack/react-query";
import { Loader2, LayoutGrid } from "lucide-react";
import { useAppContext } from "@/components/shelves/contexts/AppContext";
import { SceneHeader } from "@/components/shelves/components/v2/SceneHeader";
import { usePlanPosition } from "@/components/shelves/hooks/usePlanPositions";
import { listVirtualHistory, type VirtualHistoryRow } from "@/components/shelves/services/scenes";
import { sceneSkus } from "@/components/shelves/services/sceneAnalysis";
import { getStoreSkuData } from "@/components/shelves/data/skuDataByStore";
import { VirtualShelfRenderer } from "@/components/shelves/components/v2/VirtualShelfRenderer";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const fmtTime = (s: string) => new Date(s).toLocaleString("zh-CN", { hour12: false });

const VirtualPage = () => {
  const { code } = useParams();
  const sceneId = Number(code);
  const { selectedStore } = useAppContext();
  const { position } = usePlanPosition(sceneId);
  const skus = sceneSkus(getStoreSkuData(selectedStore), position);

  const { data: history = [], isLoading } = useQuery({
    queryKey: ["virtual_history", selectedStore, sceneId],
    queryFn: () => listVirtualHistory(selectedStore, sceneId),
    enabled: !!selectedStore && Number.isFinite(sceneId),
  });

  const [active, setActive] = useState<VirtualHistoryRow | null>(null);

  return (
    <div className="min-h-screen bg-background">
      <SceneHeader storeId={selectedStore} sceneName={position?.position_name} backTo={`/position/${code}/index`} />
      <div className="p-4">
        {isLoading ? (
          <div className="py-20 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />加载中…</div>
        ) : history.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">请先完成调改并生成虚拟货架</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {history.map((h) => (
              <button
                key={h.id}
                onClick={() => setActive(h)}
                className="rounded-2xl border border-border bg-card p-4 flex flex-col items-center gap-2 hover:border-primary/40 hover:shadow-md transition-all"
              >
                <div className="w-full h-24 rounded-lg bg-muted/50 flex items-center justify-center">
                  <LayoutGrid className="w-8 h-8 text-muted-foreground/60" />
                </div>
                <span className="text-[11px] text-muted-foreground">{fmtTime(h.created_at)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!active} onOpenChange={(o) => { if (!o) setActive(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-[640px] max-h-[85vh] overflow-auto">
          {active && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-2">{fmtTime(active.created_at)}</p>
              <VirtualShelfRenderer rawOutputs={active.raw_outputs} context={active.context as any} skus={skus} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VirtualPage;
