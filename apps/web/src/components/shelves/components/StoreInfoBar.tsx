import { useState } from "react";
import { useNavigate } from "@/components/shelves/lib/router-shim";
import { useAppContext } from "@/components/shelves/contexts/AppContext";
import { useAuth } from "@/components/shelves/contexts/AuthContext";
import { MapPin, Ruler, Store, Zap, Swords, Users, ArrowLeftRight, LogOut, MoreVertical, BarChart3 } from "lucide-react";
import { cn } from "@/components/shelves/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check } from "lucide-react";
import { EnvironmentInsightButton } from "@/components/shelves/components/EnvironmentInsightButton";
import { APP_VERSION } from "@/components/shelves/lib/version";

const ALL_STORES: { id: string; label: string }[] = [
  { id: "粤28999", label: "粤28999 - 东莞石碣玖颂江湾" },
  { id: "粤29790", label: "粤29790 - 肇庆鼎湖依云水岸" },
  { id: "粤32156", label: "粤32156 - 深圳光明滨河苑" },
  { id: "粤32826", label: "粤32826 - 深圳罗湖红群楼" },
  { id: "粤32839", label: "粤32839 - 东莞厚街汉邦兴隆" },
  { id: "粤34083", label: "粤34083 - 清远佛冈石角附城" },
  { id: "粤35176", label: "粤35176 - 深圳宝安珑湾花园" },
  { id: "粤35853", label: "粤35853 - 肇庆四会迎宾大道" },
  { id: "粤37893", label: "粤37893 - 东莞万江碧桂园云樾" },
  { id: "粤38788", label: "粤38788 - 深圳罗湖东方商业广场" },
  { id: "粤39128", label: "粤39128 - 东莞南城东园大厦" },
  { id: "粤39476", label: "粤39476 - 东莞虎门宁馨中路" },
  { id: "粤39608", label: "粤39608 - 东莞东城上桥松浪街" },
  { id: "粤39620", label: "粤39620 - 韶关曲江源河鸿景东门" },
  { id: "1534", label: "1534 - 深圳宝安福永新和村二区" },
];

export const StoreInfoBar = () => {
  const ctx = useAppContext();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [storeDialogOpen, setStoreDialogOpen] = useState(false);
  const [pendingStore, setPendingStore] = useState("");

  const allItems = [
    { icon: Store, label: ctx.storeName },
    { icon: MapPin, label: ctx.storeAddress },
    { icon: Ruler, label: ctx.storeArea },
    { icon: Store, label: ctx.storeType },
    { icon: Zap, label: ctx.consumptionLevel },
    { icon: Swords, label: ctx.competition },
    { icon: Users, label: ctx.customerType },
  ];
  const items = allItems.filter((item) => item.label && item.label !== "待配置");

  const handleSwitchStore = () => {
    if (pendingStore && pendingStore !== ctx.selectedStore) {
      ctx.setSelectedStore(pendingStore);
      navigate("/shelves", { replace: true });
    }
    setStoreDialogOpen(false);
    setPendingStore("");
  };

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const canSwitchStore = user?.isAdmin === true;

  return (
    <>
      <div
        className="px-3 sm:px-6 py-2 sm:py-2.5 border-b"
        style={{
          background: "rgba(255,255,255,0.6)",
          backdropFilter: "blur(10px) saturate(110%)",
          WebkitBackdropFilter: "blur(10px) saturate(110%)",
          borderBottomColor: "rgba(200,180,160,0.25)",
        }}
      >
        {/* Top row: store info + three-dot menu */}
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-4 overflow-hidden flex-1 min-w-0">
            {items.map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-medium whitespace-nowrap",
                    i === 0 ? "flex-shrink-0" : "min-w-0",
                    i > 1 && "hidden sm:flex"
                  )}
                  style={{ color: "rgba(50,12,18,0.7)" }}
                >
                  <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" style={{ opacity: 0.7 }} />
                  <span className={i === 0 ? "" : "truncate"}>{item.label}</span>
                  {i < items.length - 1 && (
                    <span className="ml-1 sm:ml-2 hidden sm:inline flex-shrink-0" style={{ color: "rgba(50,12,18,0.25)" }}>|</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex-shrink-0 flex items-center gap-1.5 sm:gap-2">
            <div className="hidden sm:block">
              <EnvironmentInsightButton />
            </div>
            <span className="hidden sm:inline text-[10px] font-mono whitespace-nowrap" style={{ color: "rgba(50,12,18,0.35)" }}>v{APP_VERSION}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 sm:h-8 sm:w-8"
                  style={{ color: "rgba(50,12,18,0.55)" }}
                  aria-label="更多操作"
                >
                  <MoreVertical className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {canSwitchStore && (
                  <>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setPendingStore(ctx.selectedStore);
                        setStoreDialogOpen(true);
                      }}
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5 mr-2" />
                      切换门店
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => navigate("/admin/usage")}>
                      <BarChart3 className="w-3.5 h-3.5 mr-2" />
                      查看使用记录
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onSelect={handleLogout}>
                  <LogOut className="w-3.5 h-3.5 mr-2" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {/* 周边环境 button on its own row on mobile */}
        <div className="mt-1.5 sm:hidden flex items-center justify-between gap-2">
          <EnvironmentInsightButton />
          <span className="text-[10px] font-mono whitespace-nowrap" style={{ color: "rgba(50,12,18,0.35)" }}>v{APP_VERSION}</span>
        </div>
      </div>

      {canSwitchStore && (
        <Dialog open={storeDialogOpen} onOpenChange={setStoreDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>切换门店</DialogTitle>
            </DialogHeader>
            <Command className="rounded-md border">
              <CommandInput placeholder="搜索门店编号或名称..." className="h-9" />
              <CommandList>
                <CommandEmpty>未找到匹配门店</CommandEmpty>
                <CommandGroup>
                  {ALL_STORES.map((s) => (
                    <CommandItem
                      key={s.id}
                      value={s.label}
                      onSelect={() => setPendingStore(s.id)}
                    >
                      <Check className={cn("mr-2 h-4 w-4", pendingStore === s.id ? "opacity-100" : "opacity-0")} />
                      {s.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
            <DialogFooter>
              <Button
                onClick={handleSwitchStore}
                disabled={!pendingStore}
                className="w-full sm:w-auto"
                size="sm"
              >
                确认切换
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
