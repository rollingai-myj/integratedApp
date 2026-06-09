import { useNavigate } from "@/components/shelves/lib/router-shim";
import { ArrowRight, Store } from "lucide-react";
import { useAppContext } from "@/components/shelves/contexts/AppContext";

const HomePage = () => {
  const navigate = useNavigate();
  const { selectedStore } = useAppContext();

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-orange-50 via-background to-background">
      {/* Top bar: switch store */}
      <div className="flex justify-end p-3">
        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full border border-border bg-card/70 backdrop-blur text-xs text-muted-foreground hover:bg-muted transition-colors"
        >
          <Store className="w-3.5 h-3.5" />
          切换门店
        </button>
      </div>

      {/* Center: welcome */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 -mt-12">
        <p className="text-muted-foreground text-sm mb-1">欢迎</p>
        <h1 className="text-3xl font-bold tracking-tight mb-10">{selectedStore || "门店"}</h1>

        <button
          onClick={() => navigate("/position")}
          className="w-full max-w-sm flex items-center justify-center gap-2 py-5 rounded-2xl text-white text-lg font-semibold shadow-lg transition-transform active:scale-[0.98]"
          style={{ background: "linear-gradient(95deg, #E84A28 0%, #C82B19 100%)" }}
        >
          开始调改
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

export default HomePage;
