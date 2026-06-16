/**
 * 价盘 · 冷藏品工作页（来自原 priceChange repo /cold）
 *
 * V027 起：本 app 是模拟器,不真改门店价。
 *   - SKU 列表：useStoreSkus
 *   - 价格曲线：usePriceCurve（V027 snapshot 单源）
 *   - "调价"按钮 → "模拟调价"；详情底部 "应用调价" → 被动提示"请在您的经营系统中调价"
 *   - 调价历史：从 curve.periods 相邻段不同价 推导（snapshot 时间序列）
 *   - 规则诊断：纯前端基于曲线趋势（lib/prices/diagnosis.ts）
 */
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { IOSDevice } from '@/components/IOSDevice';
import { BrandHeader } from '@/components/prices/BrandHeader';
import { SkuImage } from '@/components/prices/SkuImage';
import { PriceTagLoader } from '@/components/prices/PriceTagLoader';
import { SkuDetailDialog } from '@/components/prices/dialogs/SkuDetailDialog';
import {
  HistoryDialog,
  type HistoryEntry,
} from '@/components/prices/dialogs/HistoryDialog';
import { useMe } from '@/lib/auth';
import {
  usePriceCurve,
  useScenes,
  useStoreSkus,
} from '@/lib/hooks';
import {
  curveSkuToData,
  fmtMoney,
  getSkuImageUrl,
  monthlyProfit,
  monthlySales,
  rowToSku,
  type CurveData,
} from '@/lib/prices/types';
import {
  ruleBasedDiagnosis,
  type SkuDiagnosis,
} from '@/lib/prices/diagnosis';
import type { StoreSkuRow } from '@myj/shared';

export const Route = createFileRoute('/prices/cold')({
  component: ColdPage,
  // ?scene=面包架【烘焙】 走烘焙；缺省走冷藏。同一页两套数据，避免再克隆一份 614 行的 UI。
  validateSearch: (search: Record<string, unknown>): { scene?: string } => ({
    scene: typeof search.scene === 'string' ? search.scene : undefined,
  }),
  head: () => ({
    meta: [
      { title: '价盘分析 · 美宜佳' },
      { name: 'description', content: '美宜佳门店价格诊断、调整与效果追踪' },
      {
        name: 'viewport',
        content:
          'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no',
      },
    ],
  }),
});

type SortKey = 'recent' | 'profit' | 'sales';

const fmtShort = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;

function ColdPage() {
  const meQuery = useMe();
  const storeId = meQuery.data?.currentStore?.id ?? null;

  // 选哪个场景的价盘：URL `?scene=xxx`（精确匹配 hq_categories 场景名）；缺省 = 冷藏
  const search = Route.useSearch();
  const sceneName = search.scene || '冷藏';

  // 场景编号从后端拿（不写死 12 / 2，避免场景表重排后悄悄串类）。
  // scene 没就绪前用 null 关掉 SKU 查询，防止首次发出"不带 scene"的请求把全 13 类商品都拉回来。
  const scenesQuery = useScenes();
  const coldScene = useMemo(
    () => scenesQuery.data?.scenes.find((s) => s.name === sceneName)?.scene,
    [scenesQuery.data, sceneName],
  );

  // 数据
  const skusQuery = useStoreSkus(
    coldScene != null ? storeId : null,
    coldScene != null ? { scene: coldScene } : undefined,
  );
  const allRows = useMemo<StoreSkuRow[]>(
    () => skusQuery.data?.skus ?? [],
    [skusQuery.data],
  );
  const allSkuCodes = useMemo(
    () => allRows.map((r: StoreSkuRow) => r.skuCode),
    [allRows],
  );
  const curveQuery = usePriceCurve(storeId, allSkuCodes, 90);

  // 曲线按 skuCode 索引 + 适配到原版 CurveData（V027：内含 raw PriceCurveSku 供 rowToSku 用）
  const curveByCode = useMemo(() => {
    const map = new Map<string, CurveData>();
    const rows = curveQuery.data?.curves ?? [];
    for (const r of rows) {
      const row = allRows.find((x: StoreSkuRow) => x.skuCode === r.skuCode);
      const fallbackWholesale = Number(row?.wholesalePrice ?? 0);
      map.set(r.skuCode, curveSkuToData(r, fallbackWholesale));
    }
    return map;
  }, [curveQuery.data, allRows]);

  // 规则诊断（纯前端基于曲线趋势）
  const diagnoses = useMemo<Record<string, SkuDiagnosis>>(() => {
    const map: Record<string, SkuDiagnosis> = {};
    for (const r of allRows) {
      const sku = rowToSku(r, curveByCode.get(r.skuCode)?.raw);
      const diag = ruleBasedDiagnosis(sku, curveByCode.get(r.skuCode) ?? null);
      if (diag) map[r.skuCode] = diag;
    }
    return map;
  }, [allRows, curveByCode]);

  // UI 状态
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [detailRow, setDetailRow] = useState<StoreSkuRow | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // 初次进入：800ms loader（与原版"价签 loader"节奏一致）
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(t);
  }, []);

  // 过滤 + 排序
  const filtered = useMemo<StoreSkuRow[]>(() => {
    let list = allRows;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (r: StoreSkuRow) =>
          r.productName.toLowerCase().includes(q) ||
          (r.brand ?? '').toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    if (sortKey === 'profit') {
      sorted.sort(
        (a: StoreSkuRow, b: StoreSkuRow) =>
          monthlyProfit(rowToSku(b, curveByCode.get(b.skuCode)?.raw))
          - monthlyProfit(rowToSku(a, curveByCode.get(a.skuCode)?.raw)),
      );
    } else if (sortKey === 'sales') {
      sorted.sort(
        (a: StoreSkuRow, b: StoreSkuRow) => (b.salesQty30d ?? 0) - (a.salesQty30d ?? 0),
      );
    } else {
      // 最近调整：按 snapshot 推导的"最后一次 retail 跳变"日期倒序；未跳变（null）排末尾
      sorted.sort((a: StoreSkuRow, b: StoreSkuRow) => {
        const ta = a.lastPriceChangeAt ? Date.parse(a.lastPriceChangeAt) : 0;
        const tb = b.lastPriceChangeAt ? Date.parse(b.lastPriceChangeAt) : 0;
        return tb - ta;
      });
    }
    return sorted;
  }, [allRows, query, sortKey, curveByCode]);

  // KPI 汇总
  const totalSales = useMemo(
    () => allRows.reduce(
      (a: number, r: StoreSkuRow) =>
        a + monthlySales(rowToSku(r, curveByCode.get(r.skuCode)?.raw)),
      0,
    ),
    [allRows, curveByCode],
  );
  const totalProfit = useMemo(
    () => allRows.reduce(
      (a: number, r: StoreSkuRow) =>
        a + monthlyProfit(rowToSku(r, curveByCode.get(r.skuCode)?.raw)),
      0,
    ),
    [allRows, curveByCode],
  );

  // SKU 索引（流水→详情时按 skuCode 找回 row）
  const skuByCode = useMemo(() => {
    const m = new Map<string, StoreSkuRow>();
    for (const r of allRows) m.set(r.skuCode, r);
    return m;
  }, [allRows]);

  // 历史 entries（V027：从 curve.periods 相邻段不同价推导）
  // snapshot 时间序列里，相邻两段 price 不同 → 用户在经营系统里调过一次价
  // 月均毛利变化用新/旧段的 monthlyGrossProfit 对比（hasSalesData=true 的段才计）
  const historyEntries = useMemo<HistoryEntry[]>(() => {
    const list: HistoryEntry[] = [];
    for (const r of allRows) {
      const periods = curveByCode.get(r.skuCode)?.periods ?? [];
      for (let i = 1; i < periods.length; i++) {
        const prev = periods[i - 1]!;
        const curr = periods[i]!;
        if (Math.abs(prev.price - curr.price) < 0.01) continue;
        if (!curr.startDate) continue;
        list.push({
          row: r,
          startDate: curr.startDate,
          endDate: null,
          dateLabel: fmtShort(new Date(curr.startDate)),
          from: prev.price,
          to: curr.price,
          profit: curr.hasSalesData ? curr.monthlyGrossProfit : undefined,
          profitUp:
            curr.hasSalesData && prev.hasSalesData
              ? curr.monthlyGrossProfit >= prev.monthlyGrossProfit
              : undefined,
        });
      }
    }
    // 按 startDate 倒序（最近的调价在最上面）
    list.sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
    return list;
  }, [allRows, curveByCode]);
  const historyCount = historyEntries.length;

  // 启动 loader
  if (loading || scenesQuery.isLoading || skusQuery.isLoading) {
    return (
      <IOSDevice>
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-center">
            <PriceTagLoader />
            <div className="mt-5 text-xs text-muted-foreground">正在加载{sceneName}数据…</div>
          </div>
        </div>
      </IOSDevice>
    );
  }

  // 未选门店
  if (!storeId) {
    return (
      <IOSDevice>
        <div className="min-h-screen bg-background">
          <BrandHeader backTo="/prices" />
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">
            请先选择门店再进入价盘
          </div>
        </div>
      </IOSDevice>
    );
  }

  return (
    <IOSDevice>
    <div className="min-h-screen pb-24">
      <BrandHeader backTo="/prices" />

      <div className="px-4 pb-1 pt-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="label-eyebrow" style={{ color: 'var(--brand)' }}>
              COLD CHAIN · 2025 Q4
            </div>
            <h1 className="mt-1 text-[26px] font-extrabold leading-[1.1] tracking-tight">
              {sceneName}价盘
            </h1>
          </div>
          <button
            onClick={() => setHistoryOpen(true)}
            className="chip-base"
            style={{ padding: '6px 11px' }}
          >
            <span>📜 调价历史</span>
            {historyCount > 0 && (
              <span className="num ml-0.5" style={{ color: 'var(--brand)' }}>
                · {historyCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <main className="space-y-3 px-3 py-3">
        {/* KPI */}
        <div className="grid grid-cols-3 gap-2">
          <Kpi label="SKU 总数" value={allRows.length.toString()} />
          <Kpi label="月销售额" value={fmtMoney(totalSales)} />
          <Kpi label="月均毛利" value={fmtMoney(totalProfit)} brand />
        </div>

        {/* 搜索 + 排序 */}
        <div className="flex gap-2">
          <Input
            placeholder="🔍 搜索名称 / 品牌…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 flex-1 rounded-full border bg-card text-sm shadow-[var(--shadow-card)] focus-visible:ring-brand"
          />
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger
              className="h-11 w-24 rounded-full border-0 bg-brand text-xs font-bold text-brand-foreground"
              style={{ boxShadow: 'var(--shadow-brand)' }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">最近调整</SelectItem>
              <SelectItem value="profit">毛利</SelectItem>
              <SelectItem value="sales">销量</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* SKU 卡片列表 */}
        {filtered.length === 0 ? (
          <div className="solid-card py-10 text-center text-sm text-muted-foreground">
            未找到匹配商品 ·{' '}
            <button
              onClick={() => setQuery('')}
              className="underline underline-offset-2"
              style={{ color: 'var(--brand)' }}
            >
              清空
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => (
              <SkuCard
                key={r.id}
                row={r}
                curve={curveByCode.get(r.skuCode) ?? null}
                diagnosis={diagnoses[r.skuCode]}
                onTap={() => setDetailRow(r)}
                onAdjust={() => setDetailRow(r)}
              />
            ))}
          </div>
        )}

      </main>

      <SkuDetailDialog
        row={detailRow}
        curve={detailRow ? curveByCode.get(detailRow.skuCode) ?? null : null}
        diagnosis={detailRow ? diagnoses[detailRow.skuCode] : undefined}
        open={!!detailRow}
        onOpenChange={(v) => !v && setDetailRow(null)}
      />
      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        entries={historyEntries}
        onSelectSku={(r) => {
          setHistoryOpen(false);
          setDetailRow(r);
        }}
      />
    </div>
    </IOSDevice>
  );
}

// ---- KPI 卡片 -----------------------------------------------------------

function Kpi({ label, value, brand }: { label: string; value: string; brand?: boolean }) {
  return (
    <div
      className={brand ? 'p-3 text-brand-foreground' : 'solid-card p-3'}
      style={{
        borderRadius: '22px',
        ...(brand
          ? {
              background: 'linear-gradient(135deg, var(--brand), #8a1224)',
              boxShadow: 'var(--shadow-brand)',
              border: '1px solid var(--brand)',
            }
          : {}),
      }}
    >
      <div
        className="label-eyebrow"
        style={brand ? { color: 'rgba(255,255,255,0.78)' } : undefined}
      >
        {label}
      </div>
      <div className="num mt-1.5 text-[17px] leading-none">{value}</div>
    </div>
  );
}

// ---- SKU 卡片 ---------------------------------------------------------

function SkuCard({
  row,
  curve,
  diagnosis,
  onTap,
  onAdjust,
}: {
  row: StoreSkuRow;
  curve: CurveData | null;
  diagnosis?: SkuDiagnosis;
  onTap: () => void;
  onAdjust: () => void;
}) {
  const sku = rowToSku(row, curve?.raw);
  const changed = sku.hasAdjusted;
  const up = sku.currentPrice > sku.originalPrice;
  const suggestion = diagnosis?.suggestion;
  const showTag = diagnosis && (suggestion === 'raise' || suggestion === 'lower');

  return (
    <div
      className="solid-card relative overflow-hidden p-3.5 active:opacity-90"
      style={{
        borderRadius: '22px',
        borderColor: changed ? 'var(--brand-20)' : undefined,
      }}
      onClick={onTap}
    >
      {changed && (
        <span
          className="absolute left-0 top-0 h-full w-[3px] bg-brand"
          style={{ borderTopLeftRadius: 22, borderBottomLeftRadius: 22 }}
        />
      )}

      <div className="flex gap-3">
        <SkuImage
          src={sku.imgUrl || getSkuImageUrl(sku.code)}
          alt={sku.name}
          code={sku.code}
          className="h-14 w-14 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-sm font-semibold leading-snug">{sku.name}</div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {sku.spec} · {sku.brand}
              </div>
            </div>
            {showTag && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight"
                style={{
                  maxWidth: diagnosis.source === 'rule' ? '120px' : undefined,
                  textAlign: 'right',
                  background:
                    suggestion === 'raise'
                      ? 'color-mix(in oklab, #10B981 12%, transparent)'
                      : 'color-mix(in oklab, #EF4444 12%, transparent)',
                  color: suggestion === 'raise' ? '#059669' : '#DC2626',
                  border:
                    suggestion === 'raise'
                      ? '1px solid color-mix(in oklab, #10B981 24%, transparent)'
                      : '1px solid color-mix(in oklab, #EF4444 24%, transparent)',
                }}
              >
                {diagnosis.source === 'rule'
                  ? diagnosis.diagnosis
                  : suggestion === 'raise'
                  ? '有涨价机会'
                  : '有降价空间'}
              </span>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="num text-[18px] leading-none">{fmtMoney(sku.currentPrice)}</span>
              {changed && (
                <span
                  className={up ? 'chip-base' : 'chip-base chip-green-soft'}
                  style={
                    up
                      ? {
                          background: 'color-mix(in oklab, var(--up) 12%, transparent)',
                          color: 'var(--up)',
                          borderColor: 'color-mix(in oklab, var(--up) 20%, transparent)',
                        }
                      : undefined
                  }
                >
                  <span className="num">
                    {up ? '▲' : '▼'}{' '}
                    {fmtMoney(Math.abs(sku.currentPrice - sku.originalPrice))}
                  </span>
                </span>
              )}
              <span className="num text-[11px] text-muted-foreground">
                批 {fmtMoney(sku.wholesalePrice)}
              </span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAdjust();
              }}
              className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold text-white transition active:scale-[0.96]"
              style={{
                background: 'linear-gradient(135deg, var(--brand), #8a1224)',
                boxShadow: 'var(--shadow-brand)',
              }}
            >
              模拟调价
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
