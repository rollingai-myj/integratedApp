/**
 * 价盘 · 冷藏品工作页（来自原 priceChange repo /cold）
 *
 * 数据层：
 *   - SKU 列表：useStoreSkus（统一后端 /skus，session 取 storeId）
 *   - 价格曲线：usePriceCurve 一次性拉所有可见 SKU 的曲线
 *   - 调价：useSubmitPriceChange（只写流水，效果对比靠两期 snapshot）
 *   - 规则诊断：纯前端，根据曲线趋势判断（lib/prices/diagnosis.ts）
 *   - 调价历史：从所有 SKU 的 periods 推（相邻段对比月毛利涨跌）
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
  usePriceChanges,
  usePriceCurve,
  useScenes,
  useStoreSkus,
  useSubmitPriceChange,
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
import type { PriceChangeRecord, StoreSkuRow } from '@myj/shared';

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
  // 调价流水：是"调价历史 / 调价记录"的真实数据源（同日多次调价不会被覆盖）
  const changesQuery = usePriceChanges(storeId);
  const allChanges = useMemo<PriceChangeRecord[]>(
    () => changesQuery.data?.changes ?? [],
    [changesQuery.data],
  );

  // 曲线按 skuCode 索引 + 适配到原版 CurveData
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
      const sku = rowToSku(r);
      const diag = ruleBasedDiagnosis(sku, curveByCode.get(r.skuCode) ?? null);
      if (diag) map[r.skuCode] = diag;
    }
    return map;
  }, [allRows, curveByCode]);

  // 提交
  const submit = useSubmitPriceChange();
  const onSubmitPriceChange = useCallback(
    async (input: { skuCode: string; newPrice: number; oldPrice: number }) => {
      if (!storeId) throw new Error('未选择门店');
      await submit.mutateAsync({
        storeId,
        skuCode: input.skuCode,
        newPrice: input.newPrice,
        oldPrice: input.oldPrice,
        source: 'manual',
        note: '手动调价',
      });
    },
    [storeId, submit],
  );

  // UI 状态
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [detailRow, setDetailRow] = useState<StoreSkuRow | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recentlyChanged, setRecentlyChanged] = useState<string[]>([]);

  // 初次进入：800ms loader（与原版"价签 loader"节奏一致）
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(t);
  }, []);

  // 刚调过价的 1.6s 高亮
  useEffect(() => {
    if (recentlyChanged.length) {
      const t = setTimeout(() => setRecentlyChanged([]), 1600);
      return () => clearTimeout(t);
    }
  }, [recentlyChanged]);

  // 提交成功后给行打"刚调过"标记
  useEffect(() => {
    if (submit.isSuccess && submit.variables?.skuCode) {
      setRecentlyChanged([submit.variables.skuCode]);
      submit.reset();
    }
  }, [submit]);

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
          monthlyProfit(rowToSku(b)) - monthlyProfit(rowToSku(a)),
      );
    } else if (sortKey === 'sales') {
      sorted.sort(
        (a: StoreSkuRow, b: StoreSkuRow) => (b.salesQty30d ?? 0) - (a.salesQty30d ?? 0),
      );
    } else {
      // 最近调整：按最后一次调价时间倒序；从未调过价的（null）排在最后
      sorted.sort((a: StoreSkuRow, b: StoreSkuRow) => {
        const ta = a.lastPriceChangeAt ? Date.parse(a.lastPriceChangeAt) : 0;
        const tb = b.lastPriceChangeAt ? Date.parse(b.lastPriceChangeAt) : 0;
        return tb - ta;
      });
    }
    return sorted;
  }, [allRows, query, sortKey]);

  // KPI 汇总
  const totalSales = useMemo(
    () => allRows.reduce((a: number, r: StoreSkuRow) => a + monthlySales(rowToSku(r)), 0),
    [allRows],
  );
  const totalProfit = useMemo(
    () => allRows.reduce((a: number, r: StoreSkuRow) => a + monthlyProfit(rowToSku(r)), 0),
    [allRows],
  );

  // SKU 索引（流水→详情时按 skuCode 找回 row）
  const skuByCode = useMemo(() => {
    const m = new Map<string, StoreSkuRow>();
    for (const r of allRows) m.set(r.skuCode, r);
    return m;
  }, [allRows]);

  // 历史 entries：从调价流水推（每次调价一条独立记录，同日多次也能完整展示）
  // 月均毛利富集：在 curve.periods 里按价格找匹配段，只用有真实销量的段
  const historyEntries = useMemo<HistoryEntry[]>(() => {
    const list: HistoryEntry[] = [];
    for (const c of allChanges) {
      // oldPrice 为 null 说明 fact 表查不到上一价，是首次定价而非调价 → 跳过
      if (c.oldPrice == null) continue;
      const row = skuByCode.get(c.skuCode);
      if (!row) continue;
      const periods = curveByCode.get(c.skuCode)?.periods ?? [];
      const findPeriod = (price: number) =>
        periods.find((p) => Math.abs(p.price - price) < 0.01 && p.hasSalesData);
      const newPeriod = findPeriod(c.newPrice);
      const oldPeriod = findPeriod(c.oldPrice);
      list.push({
        row,
        startDate: c.effectiveDate,
        endDate: null,
        dateLabel: fmtShort(new Date(c.effectiveDate)),
        from: c.oldPrice,
        to: c.newPrice,
        // 仅当新价已有销量快照时才填月均毛利；否则 HistoryDialog 不渲染那一行
        profit: newPeriod?.monthlyGrossProfit,
        profitUp:
          newPeriod && oldPeriod
            ? newPeriod.monthlyGrossProfit >= oldPeriod.monthlyGrossProfit
            : undefined,
      });
    }
    return list; // 后端已按 createdAt DESC
  }, [allChanges, skuByCode, curveByCode]);
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
                diagnosis={diagnoses[r.skuCode]}
                flashBrand={recentlyChanged.includes(r.skuCode)}
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
        changes={detailRow ? allChanges.filter((c) => c.skuCode === detailRow.skuCode) : []}
        open={!!detailRow}
        onOpenChange={(v) => !v && setDetailRow(null)}
        onSubmit={onSubmitPriceChange}
        submitting={submit.isPending}
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
  diagnosis,
  flashBrand,
  onTap,
  onAdjust,
}: {
  row: StoreSkuRow;
  diagnosis?: SkuDiagnosis;
  flashBrand: boolean;
  onTap: () => void;
  onAdjust: () => void;
}) {
  const sku = rowToSku(row);
  const changed = sku.hasAdjusted;
  const up = sku.currentPrice > sku.originalPrice;
  const suggestion = diagnosis?.suggestion;
  const showTag = diagnosis && (suggestion === 'raise' || suggestion === 'lower');

  return (
    <div
      className={[
        'solid-card relative overflow-hidden p-3.5 active:opacity-90',
        flashBrand ? 'row-flash-brand' : '',
      ].join(' ')}
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
              调价
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
