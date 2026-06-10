import { useNavigate, useParams } from "@/components/shelves/lib/router-shim";
import { Camera, LayoutGrid, History, Settings, ChevronRight, FileClock, PlayCircle } from "lucide-react";
import { useAppContext } from "@/components/shelves/contexts/AppContext";
import { SceneHeader } from "@/components/shelves/components/v2/SceneHeader";
import { usePlanPosition } from "@/components/shelves/hooks/usePlanPositions";

const SceneIndexPage = () => {
  const navigate = useNavigate();
  const { code } = useParams();
  const codeNum = Number(code);
  const { selectedStore } = useAppContext();
  const { position } = usePlanPosition(codeNum);

  const hasDraft = (() => {
    try {
      const raw = sessionStorage.getItem(`photo_draft_${selectedStore}_${codeNum}`);
      if (!raw) return false;
      const saved = JSON.parse(raw) as { photos?: unknown[] };
      return Array.isArray(saved?.photos) && saved.photos.length > 0;
    } catch { return false; }
  })();

  const startFresh = () => {
    try { sessionStorage.removeItem(`photo_draft_${selectedStore}_${codeNum}`); } catch { /* ignore */ }
    navigate(`/position/${code}/photo`);
  };

  const items: { icon: typeof Camera; label: string; to?: string; action?: () => void }[] = [
    { icon: Camera, label: "拍照开启新调改", action: startFresh },
    { icon: FileClock, label: "查看上一次调改记录", to: `/position/${code}/last` },
    { icon: LayoutGrid, label: "虚拟货架示意图", to: `/position/${code}/virtual` },
    { icon: History, label: "调改效果追踪", to: `/position/${code}/record` },
    { icon: Settings, label: "基础信息修改", to: `/position/${code}/info` },
  ];

  return (
    <div className="min-h-screen bg-background">
      <SceneHeader storeId={selectedStore} sceneName={position?.position_name} backTo="/position" />
      <div className="p-4 space-y-3">
        {hasDraft && (
          <button
            onClick={() => navigate(`/position/${code}/photo`)}
            className="w-full flex items-center gap-3 p-4 rounded-2xl border-2 border-primary bg-primary/5 hover:bg-primary/10 transition-all"
          >
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <PlayCircle className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold text-primary">继续调改</p>
              <p className="text-xs text-muted-foreground mt-0.5">上次调改未完成，点击继续</p>
            </div>
            <ChevronRight className="w-4 h-4 text-primary" />
          </button>
        )}
        {items.map(({ icon: Icon, label, to, action }) => (
          <button
            key={label}
            onClick={() => action ? action() : to && navigate(to)}
            className="w-full flex items-center gap-3 p-4 rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-md transition-all"
          >
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <span className="flex-1 text-left font-medium">{label}</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
};

export default SceneIndexPage;
