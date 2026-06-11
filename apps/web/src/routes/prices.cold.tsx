/**
 * 价盘 · 冷藏品工作页（来自原 priceChange repo /cold）
 *
 * 1:1 还原原 repo `src/routes/cold.tsx`，数据层适配：
 *   - SKU 列表：useStoreSkus（统一后端 /skus，session 取 storeId）
 *   - 价格曲线：usePriceCurve 一次性拉所有可见 SKU 的曲线
 *   - 调价：useSubmitPriceChange（D3 两层写入，乐观更新由 React Query 自动 invalidate）
 *   - AI 诊断：useDiagnoseSkus（统一后端 /prices/diagnose，密钥在后端）
 *   - 规则诊断：纯前端，根据曲线趋势判断（adapt 自 lib/prices/diagnosis.ts）
 *   - 调价历史：从所有 SKU 的 periods 推（相邻段对比月毛利涨跌）
 */
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
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
  useDiagnoseSkus,
  usePriceChanges,
  usePriceCurve,
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
  adaptDiagnosis,
  ruleBasedDiagnosis,
  type SkuDiagnosis,
} from '@/lib/prices/diagnosis';
import type { PriceChangeRecord, StoreSkuRow } from '@myj/shared';

export const Route = createFileRoute('/prices/cold')({
  component: ColdPage,
  head: () => ({
    meta: [
      { title: '冷藏品价盘分析 · 美宜佳' },
      { name: 'description', content: '美宜佳冷藏品价格诊断、调整与效果追踪' },
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

  // 数据
  const skusQuery = useStoreSkus(storeId);
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

  // 规则诊断 + AI 诊断（合并）
  const [aiDiagnoses, setAiDiagnoses] = useState<Record<string, SkuDiagnosis>>({});
  const ruleDiagnoses = useMemo(() => {
    const map: Record<string, SkuDiagnosis> = {};
    for (const r of allRows) {
      const sku = rowToSku(r);
      const diag = ruleBasedDiagnosis(sku, curveByCode.get(r.skuCode) ?? null);
      if (diag) map[r.skuCode] = diag;
    }
    return map;
  }, [allRows, curveByCode]);
  const diagnoses = useMemo<Record<string, SkuDiagnosis>>(
    () => ({ ...aiDiagnoses, ...ruleDiagnoses }),
    [aiDiagnoses, ruleDiagnoses],
  );

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

  // AI 诊断 mutation
  const diagnose = useDiagnoseSkus();
  const [refreshProgress, setRefreshProgress] = useState('');
  const refreshDiagnoses = useCallback(async () => {
    if (diagnose.isPending) return;
    // 只诊断"没有规则建议"的 SKU
    const pending = allRows
      .filter((r: StoreSkuRow) => !ruleDiagnoses[r.skuCode] && !aiDiagnoses[r.skuCode])
      .map((r: StoreSkuRow) => ({
        skuCode: r.skuCode,
        currentPrice: Number(r.retailPrice ?? 0),
        wholesalePrice: r.wholesalePrice != null ? Number(r.wholesalePrice) : undefined,
        salesQty30d: r.salesQty30d ?? undefined,
        grossMargin30d: r.grossMargin30d != null ? Number(r.grossMargin30d) : undefined,
      }));

    if (pending.length === 0) {
      setRefreshProgress('所有商品已有诊断');
      return;
    }

    setRefreshProgress(`正在诊断 ${pending.length} 个商品…`);
    try {
      const res = await diagnose.mutateAsync(pending);
      const next: Record<string, SkuDiagnosis> = {};
      for (const r of res.results) next[r.skuCode] = adaptDiagnosis(r);
      setAiDiagnoses((prev) => ({ ...prev, ...next }));
      setRefreshProgress(`完成 ${res.results.length} 个商品诊断`);
      toast.success(`AI 诊断完成：${res.results.length} 个商品`);
    } catch (err: any) {
      setRefreshProgress('调用失败');
      toast.error(err?.message ?? 'AI 诊断调用失败，请稍后重试');
    }
  }, [diagnose, allRows, ruleDiagnoses, aiDiagnoses]);

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
      sorted.sort(
        (a: StoreSkuRow, b: StoreSkuRow) =>
          Number(b.hasPriceChange) - Number(a.hasPriceChange),
      );
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
  if (loading || skusQuery.isLoading) {
    return (
      <IOSDevice>
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-center">
            <PriceTagLoader />
            <div className="mt-5 text-xs text-muted-foreground">正在加载冷藏品数据…</div>
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
              冷藏品价盘
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

        {/* AI 诊断刷新按钮 */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={refreshDiagnoses}
            disabled={diagnose.isPending}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium transition active:scale-[0.97]"
            style={{
              background: 'color-mix(in oklab, var(--brand) 10%, transparent)',
              color: 'var(--brand)',
              border: '1px solid color-mix(in oklab, var(--brand) 20%, transparent)',
              opacity: diagnose.isPending ? 0.6 : 1,
            }}
          >
            <span>{diagnose.isPending ? '⏳' : '🤖'}</span>
            <span>{diagnose.isPending ? '分析中…' : '刷新 AI 建议'}</span>
          </button>
          {refreshProgress && (
            <span className="text-[10px] text-muted-foreground">{refreshProgress}</span>
          )}
        </div>
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
