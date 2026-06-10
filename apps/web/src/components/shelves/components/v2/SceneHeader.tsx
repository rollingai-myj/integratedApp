import { useNavigate } from "@/components/shelves/lib/router-shim";
import { ArrowLeft, Home } from "lucide-react";

interface Props {
  /** 门店号 */
  storeId?: string;
  /** 场景名（可选） */
  sceneName?: string;
  /** 返回上一级目标；缺省用浏览器后退 */
  backTo?: string;
}

export const SceneHeader = ({ storeId, sceneName, backTo }: Props) => {
  const navigate = useNavigate();
  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 px-3 py-2.5 bg-background/90 backdrop-blur border-b border-border">
      <button
        onClick={() => (backTo ? navigate(backTo) : navigate(-1))}
        className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border hover:bg-muted transition-colors"
        aria-label="返回上一级"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <button
        onClick={() => navigate("/home")}
        className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border hover:bg-muted transition-colors"
        aria-label="回主页"
      >
        <Home className="w-4 h-4" />
      </button>
      <div className="ml-1 min-w-0 text-sm font-medium truncate">
        {storeId && <span>{storeId}</span>}
        {sceneName && <span className="text-muted-foreground"> · {sceneName}</span>}
      </div>
    </div>
  );
};
