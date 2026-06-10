import { useState, useEffect } from "react";
import { useParams } from "@/components/shelves/lib/router-shim";
import { Loader2 } from "lucide-react";
import { useAppContext } from "@/components/shelves/contexts/AppContext";
import { SceneHeader } from "@/components/shelves/components/v2/SceneHeader";
import { PhotoWithBoxes } from "@/components/shelves/components/v2/PhotoWithBoxes";
import { VirtualShelfRenderer } from "@/components/shelves/components/v2/VirtualShelfRenderer";
import { DiagnosisListPanel } from "@/components/shelves/components/shelf-detail/DiagnosisListPanel";
import { StrategyTableSection } from "@/components/shelves/components/StrategyResultInline";
import { usePlanPosition } from "@/components/shelves/hooks/usePlanPositions";
import { getStoreSkuData } from "@/components/shelves/data/skuDataByStore";
import { sceneSkus } from "@/components/shelves/services/sceneAnalysis";
import { problemSkuCodes } from "@/components/shelves/lib/problemSku";
import { sceneShelfId } from "@/components/shelves/services/scenes";
import { getSceneRuntime, type ScenePhoto } from "@/components/shelves/services/sceneRuntime";
import type { DiagnosisResult } from "@/components/shelves/services/difyAlignApi";
import type { StrategyResult } from "@/components/shelves/services/difyApi";
import type { Strategy } from "@/components/shelves/contexts/AppContext";

interface Snapshot {
  at?: string;
  summary?: string;
  photos?: ScenePhoto[];
  diagnosis?: DiagnosisResult | null;
  strategy?: StrategyResult | null;
  virtual_shelf_raw_outputs?: unknown;
  virtual_shelf_context?: unknown;
}

const fmtTime = (s?: string) => (s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "");

const LastRecordPage = () => {
  const { code } = useParams();
  const sceneId = Number(code);
  const { selectedStore } = useAppContext();
  const { position } = usePlanPosition(sceneId);
  const skus = sceneSkus(getStoreSkuData(selectedStore), position);
  const problemIds = problemSkuCodes(skus);

  const [loading, setLoading] = useState(true);
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!selectedStore || !Number.isFinite(sceneId)) return;
    getSceneRuntime(selectedStore, sceneShelfId(sceneId)).then((rt) => {
      setSnap((rt?.last_snapshot as Snapshot) ?? null);
      setLoading(false);
    });
  }, [selectedStore, sceneId]);

  const strategyForTable: Strategy | null = snap?.strategy
    ? { ...snap.strategy, skus: snap.strategy.skus.map((s) => ({ ...s })), applied: true }
    : null;

  return (
    <div className="min-h-screen bg-background pb-12">
      <SceneHeader storeId={selectedStore} sceneName={position?.position_name} backTo={`/position/${code}/index`} />
      <div className="p-4 space-y-4">
        {loading ? (
          <div className="py-20 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />加载中…</div>
        ) : !snap ? (
          <div className="py-20 text-center text-sm text-muted-foreground">暂无调改记录</div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">{fmtTime(snap.at)} · {snap.summary}</div>
            {snap.photos && snap.photos.length > 0 && (
              <div className="space-y-1">
                <div className="flex overflow-x-auto snap-x snap-mandatory gap-3 pb-1 -mx-1 px-1">
                  {snap.photos.map((p, i) => (
                    <div key={i} className="snap-start shrink-0 w-full">
                      <PhotoWithBoxes src={p.url} matches={p.matches} problemSkuIds={problemIds} />
                    </div>
                  ))}
                </div>
                {snap.photos.some((p) => p.matches?.some((m) => m.matched_sku_id && problemIds.has(m.matched_sku_id))) && (
                  <p className="text-xs text-muted-foreground">红框为问题单品，请留意观察</p>
                )}
              </div>
            )}
            {snap.diagnosis && <DiagnosisListPanel diagnosis={snap.diagnosis} />}
            {strategyForTable && (
              <StrategyTableSection strategy={strategyForTable} storeId={selectedStore} shelfId={sceneShelfId(sceneId)} readOnly />
            )}
            {snap.virtual_shelf_raw_outputs && (
              <VirtualShelfRenderer rawOutputs={snap.virtual_shelf_raw_outputs} context={snap.virtual_shelf_context as any} skus={skus} />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default LastRecordPage;
