import { useNavigate } from "@/components/shelves/lib/router-shim";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useAppContext } from "@/components/shelves/contexts/AppContext";
import { SceneHeader } from "@/components/shelves/components/v2/SceneHeader";
import { usePlanPositions } from "@/components/shelves/hooks/usePlanPositions";
import { listRemakeCounts } from "@/components/shelves/services/scenes";

const PositionPage = () => {
  const navigate = useNavigate();
  const { selectedStore } = useAppContext();
  const { positions, isLoading } = usePlanPositions();

  const { data: counts = [] } = useQuery({
    queryKey: ["remake_counts", selectedStore],
    queryFn: () => listRemakeCounts(selectedStore),
    enabled: !!selectedStore,
  });
  // v2 表的 position_code 列存的是场景序号(index)
  const countMap = new Map(counts.map((c) => [c.position_code, c.remake_count]));

  const handleClick = (sceneId: number) => {
    const n = countMap.get(sceneId) ?? 0;
    if (n === 0) navigate(`/position/${sceneId}/survey`);
    else navigate(`/position/${sceneId}/index`);
  };

  return (
    <div className="min-h-screen bg-background">
      <SceneHeader storeId={selectedStore} backTo="/home" />
      <div className="p-4">
        <p className="text-sm text-muted-foreground mb-4">请选择您要调改的场景</p>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载场景…
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {positions.map((p, idx) => {
              const n = countMap.get(idx) ?? 0;
              return (
                <button
                  key={`${idx}-${p.position_name}`}
                  onClick={() => handleClick(idx)}
                  className="text-left p-4 rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-md transition-all min-h-[120px] flex flex-col"
                >
                  <div className="font-semibold text-base mb-1">{p.position_name}</div>
                  <div className="text-[11px] text-muted-foreground leading-snug flex-1">
                    {p.categories.join("、")}
                  </div>
                  <div className="mt-2 text-[11px]">
                    {n > 0 ? (
                      <span className="text-primary font-medium">已调改 {n} 次</span>
                    ) : (
                      <span className="text-muted-foreground">未调改</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PositionPage;
