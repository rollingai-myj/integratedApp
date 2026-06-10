/**
 * /shelves/position —— 场景选择
 *
 * 视觉对齐价盘模块的"品类选择"页（apps/web/src/routes/prices.index.tsx）：
 *   - 顶部 BrandHeader 风格胶囊：左侧 ← 箭头返回门户 + Shelves · 选品助手 / 门店 编号
 *   - "请选择场景" h1 + 副标题
 *   - 2 列 emoji 卡片，每张卡按场景名匹配 emoji；底部显示"未调改/已调改 N 次"
 *
 * 行为延续原 repo：未调改场景跳 survey 完成"货架组+问卷"配置；已调改场景跳
 * SceneIndex 的"调改 hub"。
 *
 * 13 个场景（与价盘 prices.index.tsx CATEGORIES 保持名字/emoji/顺序一致）：
 *   糖巧 / 面包架【常温奶】/ 面包架【烘焙】/ 小零食 / 大休闲 / 饼干膨化 /
 *   方便速食 / 根油调味 / 酒 / 玩具 / 日化 / 家杂 / 冷藏
 */
import { useNavigate } from '@/components/shelves/lib/router-shim';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useAppContext } from '@/components/shelves/contexts/AppContext';
import { usePlanPositions } from '@/components/shelves/hooks/usePlanPositions';
import { listRemakeCounts } from '@/components/shelves/services/scenes';
import { emojiForScene } from '@/lib/scenes';

const PositionPage = () => {
  const navigate = useNavigate();
  const { selectedStore } = useAppContext();
  const { positions, isLoading } = usePlanPositions();

  const { data: counts = [] } = useQuery({
    queryKey: ['remake_counts', selectedStore],
    queryFn: () => listRemakeCounts(selectedStore),
    enabled: !!selectedStore,
  });
  const countMap = new Map(counts.map((c) => [c.position_code, c.remake_count]));

  const handleClick = (sceneId: number) => {
    const n = countMap.get(sceneId) ?? 0;
    // 未调改 → 先完成货架组+问卷配置；已调改 → 直接进 hub
    if (n === 0) navigate(`/position/${sceneId}/survey`);
    else navigate(`/position/${sceneId}/index`);
  };

  return (
    // min-h-full（而非 min-h-screen）：IOSDevice 内层 overflow-y-auto 容器高度 =
    // (100/zoom)vh，若用 min-h-screen 只到 100vh，容器底部会留出 (100/zoom-100)vh
    // 的空白可滚区。min-h-full 强制本页至少撑满 IOSDevice 内层 → 没有空白可滚。
    <div className="min-h-full bg-background">
      {/* 头部胶囊（与价盘 BrandHeader 同款：左侧 ← 箭头返回门户 + 品牌行） */}
      <header className="sticky top-0 z-30 w-full">
        <div className="glass-card mx-3 mt-3 flex h-14 items-center justify-between rounded-full px-2.5 pl-3 pr-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link to="/" className="icon-btn h-9 w-9 text-base" aria-label="返回门户">
              ←
            </Link>
            <div className="min-w-1 leading-tight">
              <div className="label-eyebrow" style={{ color: 'var(--brand)' }}>
                Shelves · 选品助手
              </div>
              <div className="truncate text-[13px] font-bold text-foreground">
                {selectedStore ? `门店 ${selectedStore}` : '未选择门店'}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="px-4 py-5 pb-8">
        <h1 className="text-lg font-semibold text-foreground">请选择场景</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          进入货架诊断与选品调改工作台
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载场景…
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3">
            {positions.map((p, idx) => {
              const n = countMap.get(idx) ?? 0;
              return (
                <button
                  key={`${idx}-${p.position_name}`}
                  onClick={() => handleClick(idx)}
                  className="group rounded-xl border bg-card p-4 shadow-sm transition active:scale-[0.98] text-left"
                >
                  <div className="text-3xl">{emojiForScene(p.position_name)}</div>
                  <div className="mt-3 text-base font-medium text-foreground">
                    {p.position_name}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                    {p.categories.join('、')}
                  </div>
                  <div className="mt-2 text-[11px]">
                    {n > 0 ? (
                      <span className="font-semibold" style={{ color: 'var(--brand)' }}>
                        已调改 <span className="num">{n}</span> 次
                      </span>
                    ) : (
                      <span className="text-muted-foreground">未调改</span>
                    )}
                  </div>
                  <div className="mt-2 text-[11px]" style={{ color: 'var(--brand)' }}>
                    进入 →
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default PositionPage;
