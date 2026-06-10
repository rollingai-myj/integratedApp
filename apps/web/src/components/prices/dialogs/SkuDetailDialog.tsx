/**
 * 价盘 · 商品详情 + 调价对话框（来自原 priceChange repo）
 *
 * 与原版的差异：
 *   - 入参从 `SKU` 改为 `StoreSkuRow`，内部用 `rowToSku` 适配
 *   - 价格曲线 (`CurveData`) 改成走 props 传入，由父组件用 React Query 拉
 *     `/prices/curve` 后用 `curveSkuToData` 适配（避免 dialog 自己关心数据源）
 *   - 竞品价格暂时不渲染 tab（后端未暴露 /prices/competitor-prices；后续 PR 接入再放开）
 *   - 调价提交从原版的 store action 改成 React Query mutation prop
 */
import {
  Bar,
  BarChart,
  Cell as RechartsCell,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useIOSDeviceZoom } from '@/components/IOSDevice';
import { Button } from '@/components/ui/button';
import { SkuImage } from '../SkuImage';
import {
  type CurveData,
  type CurvePeriod,
  fmtMoney,
  rowToSku,
  type SKU,
} from '@/lib/prices/types';
import type { StoreSkuRow } from '@myj/shared';
import type { SkuDiagnosis } from '@/lib/prices/diagnosis';

interface Props {
  row: StoreSkuRow | null;
  curve: CurveData | null;          // 已适配好的曲线数据
  diagnosis?: SkuDiagnosis;          // 当前 SKU 的诊断（若有）
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** 实际触发调价提交。父组件通过 useSubmitPriceChange 注入 */
  onSubmit: (input: { skuCode: string; newPrice: number; oldPrice: number }) => Promise<void>;
  submitting?: boolean;
}

const fmtShort = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}号`;

interface ChartDataPoint {
  price: number;
  monthlyProfit: number;
  monthlySales: number;
  periodLabel: string;
  startDate: string | null;
  endDate: string | null;
}

// 价格曲线柱状图（来自原版，仅 import 路径调整）
const PriceCurveChart = memo(function PriceCurveChart({
  data,
  wholesalePrice,
  selectedPeriod,
  popupPos,
  onBarClick,
}: {
  data: ChartDataPoint[];
  wholesalePrice: number;
  selectedPeriod: ChartDataPoint | null;
  popupPos: { x: number; y: number } | null;
  onBarClick: (d: ChartDataPoint | null, x: number, y: number) => void;
}) {
  if (!data || data.length === 0) return null;
  const maxProfit = Math.max(...data.map((d) => d.monthlyProfit));

  return (
    <div className="relative h-[220px] w-full recharts-no-focus">
      <ResponsiveContainer>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 24, right: 28, bottom: 20, left: 0 }}
          barSize={20}
          onClick={(state: any) => {
            if (state?.activePayload?.[0]) {
              onBarClick(state.activePayload[0].payload as ChartDataPoint, state.chartX ?? 0, state.chartY ?? 0);
            } else {
              onBarClick(null, 0, 0);
            }
          }}
        >
          <XAxis
            type="number"
            tick={{ fontSize: 10 }}
            tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${Math.round(v)}`)}
            axisLine={false}
            tickLine={false}
            label={{
              value: '每月赚（月均毛利）',
              position: 'bottom',
              offset: 10,
              fontSize: 10,
              fill: 'var(--muted-foreground)',
            }}
          />
          <YAxis
            dataKey="price"
            type="category"
            tick={{ fontSize: 11, fontWeight: 600 }}
            tickFormatter={(v) => `¥${v}`}
            axisLine={false}
            tickLine={false}
            width={56}
            label={{
              value: '售价（元）',
              position: 'insideTop',
              offset: -18,
              fontSize: 10,
              fill: 'var(--muted-foreground)',
            }}
          />
          <ReferenceLine x={0} stroke="var(--border)" strokeWidth={1} />
          <Bar
            dataKey="monthlyProfit"
            radius={[0, 6, 6, 0]}
            activeBar={false}
            label={{
              position: 'right',
              fontSize: 10,
              fill: 'var(--foreground)',
              fontWeight: 700,
              formatter: (v: number) => fmtMoney(v),
            }}
          >
            {data.map((entry, index) => {
              const isBest = entry.monthlyProfit === maxProfit && maxProfit > 0;
              let fill = 'var(--border)';
              if (isBest) fill = 'var(--brand)';
              else if (entry.price < wholesalePrice) fill = '#fca5a5';
              return <RechartsCell key={index} fill={fill} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {selectedPeriod && popupPos && (
        <div
          className="num absolute z-50 rounded-xl border border-border/60 bg-popover px-3 py-2 text-[11px] shadow-lg"
          style={{
            left: Math.min(popupPos.x, 160),
            top: Math.max(popupPos.y - 60, 20),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="label-eyebrow text-[9px] mb-0.5" style={{ color: 'var(--brand)' }}>
            统计时间段
          </div>
          <div className="font-semibold text-foreground">{selectedPeriod.periodLabel}</div>
          <div className="mt-1 text-muted-foreground">
            售价 <span className="font-medium text-foreground">{fmtMoney(selectedPeriod.price)}</span>
            {' · '}月均毛利 <span className="font-medium text-foreground">{fmtMoney(selectedPeriod.monthlyProfit)}</span>
          </div>
        </div>
      )}
    </div>
  );
});

function periodLabel(p: CurvePeriod): string {
  if (p.startDate && p.endDate && p.startDate !== p.endDate) {
    return `${fmtShort(new Date(p.startDate))} ～ ${fmtShort(new Date(p.endDate))}`;
  }
  if (p.endDate) return `之前 ～ ${fmtShort(new Date(p.endDate))}`;
  if (p.startDate) return `${fmtShort(new Date(p.startDate))} ～ 至今`;
  return '当前';
}

export function SkuDetailDialog({
  row,
  curve,
  diagnosis,
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: Props) {
  const sku: SKU | null = useMemo(() => (row ? rowToSku(row) : null), [row]);
  // 弹窗 portal 在 IOSDevice 之外，需手动同步 zoom 才能保持比例。
  const zoom = useIOSDeviceZoom()?.zoom ?? 1;

  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState<ChartDataPoint | null>(null);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (open && sku) {
      setEditing(false);
      setInput(sku.currentPrice.toFixed(2));
      setSelectedPeriod(null);
      setPopupPos(null);
    }
  }, [open, sku]);

  const handleBarClick = useCallback(
    (d: ChartDataPoint | null, x: number, y: number) => {
      if (!d) {
        setSelectedPeriod(null);
        setPopupPos(null);
        return;
      }
      if (selectedPeriod?.price === d.price && selectedPeriod?.periodLabel === d.periodLabel) {
        setSelectedPeriod(null);
        setPopupPos(null);
      } else {
        setSelectedPeriod(d);
        setPopupPos({ x, y });
      }
    },
    [selectedPeriod],
  );

  const parsed = parseFloat(input);
  const newPrice = Number.isFinite(parsed) ? parsed : 0;
  const validation = useMemo(() => {
    if (!sku) return { ok: false, msg: '' };
    if (!Number.isFinite(parsed)) return { ok: false, msg: '请输入有效数字' };
    if (parsed <= 0) return { ok: false, msg: '价格必须大于 0' };
    return { ok: true, msg: '' };
  }, [parsed, sku]);

  const dbWholesale = curve?.wholesalePrice ?? sku?.wholesalePrice ?? 0;

  const chartData: ChartDataPoint[] = useMemo(() => {
    if (!sku) return [];
    const periods = curve?.periods;
    if (!periods || periods.length === 0) {
      return [
        {
          price: sku.currentPrice,
          monthlyProfit: (sku.currentPrice - sku.wholesalePrice) * sku.ownStoreSales,
          monthlySales: sku.ownStoreSales,
          periodLabel: '当前',
          startDate: null,
          endDate: null,
        },
      ];
    }
    return [...periods]
      .sort((a, b) => b.price - a.price)
      .map((p) => ({
        price: p.price,
        monthlyProfit: p.monthlyGrossProfit,
        monthlySales: p.monthlySales,
        periodLabel: periodLabel(p),
        startDate: p.startDate,
        endDate: p.endDate,
      }));
  }, [sku, curve]);

  // 调价警示：以利润最高点为锚，仅在有邻点的一侧设安全边界
  const priceWarning = useMemo(() => {
    if (!sku || !editing || Math.abs(newPrice - (sku?.currentPrice ?? 0)) < 0.01) return null;
    const periods = curve?.periods;
    if (!periods || periods.length < 2) return null;

    const sorted = [...periods].sort((a, b) => a.price - b.price);
    const bestIdx = sorted.reduce(
      (best, _, i, arr) =>
        arr[i]!.monthlyGrossProfit > arr[best]!.monthlyGrossProfit ? i : best,
      0,
    );
    const minSafe = bestIdx > 0 ? sorted[bestIdx - 1]!.price : sorted[bestIdx]!.price;
    const maxSafe =
      bestIdx < sorted.length - 1 ? sorted[bestIdx + 1]!.price : sorted[bestIdx]!.price;

    if (newPrice < minSafe) return `该价格已验证利润更低，建议调到${minSafe.toFixed(1)}元以上`;
    if (newPrice > maxSafe) return `该价格已验证利润更低，建议调到${maxSafe.toFixed(1)}元以下`;
    return null;
  }, [sku, editing, newPrice, curve]);

  const unit = sku ? sku.currentPrice - dbWholesale : 0;
  const monthSales = sku ? sku.currentPrice * sku.ownStoreSales : 0;
  const monthProfit = unit * (sku?.ownStoreSales ?? 0);

  const delta = newPrice - (sku?.currentPrice ?? 0);
  const up = delta > 0;
  const newUnit = newPrice - dbWholesale;

  const step = (dir: 1 | -1) => {
    const next = Math.round((parseFloat(input) + dir * 0.5) * 100) / 100;
    if (Number.isFinite(next)) setInput(next.toFixed(2));
  };

  const handleStartAdjust = () => setEditing(true);

  const apply = async () => {
    if (!validation.ok || !sku || !row) return;
    try {
      await onSubmit({
        skuCode: sku.code,
        newPrice,
        oldPrice: sku.currentPrice,
      });
      toast.success(`已调整为 ${fmtMoney(newPrice)}`);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message ?? '调价失败');
    }
  };

  const unchanged = sku ? Math.abs(newPrice - sku.currentPrice) < 0.01 : true;

  // 调价时间线 — 从 periods 推（相邻段对比月毛利涨跌）
  const periods = curve?.periods;
  const timeline = useMemo(() => {
    if (!sku || !periods || periods.length < 2) return null;
    return periods
      .map((p, i) => {
        if (i === 0) return null;
        const prev = periods[i - 1]!;
        const diffProfit = p.monthlyGrossProfit - prev.monthlyGrossProfit;
        return {
          dateLabel: periodLabel(p),
          from: prev.price,
          to: p.price,
          profit: p.monthlyGrossProfit,
          profitUp: diffProfit >= 0,
        };
      })
      .filter(Boolean) as Array<{
      dateLabel: string;
      from: number;
      to: number;
      profit: number;
      profitUp: boolean;
    }>;
  }, [sku, periods]);

  if (!sku) return null;

  const editingContent = editing ? (
    <div className="solid-card p-2.5" style={{ borderRadius: '16px' }}>
      <div className="flex items-center gap-2">
        <span className="label-eyebrow w-8 shrink-0">售价</span>
        <span className="num shrink-0 text-xs">{fmtMoney(sku.currentPrice)}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground/40">→</span>
        <div
          className="flex items-center overflow-hidden rounded-full bg-background"
          style={{ border: '1px solid var(--border-strong)' }}
        >
          <button
            type="button"
            aria-label="减"
            className="flex h-8 w-8 shrink-0 items-center justify-center text-base text-brand active:bg-[var(--brand-12)]"
            onClick={() => step(-1)}
          >
            −
          </button>
          <input
            type="text"
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="num h-8 w-14 bg-transparent text-center text-sm focus:outline-none"
          />
          <button
            type="button"
            aria-label="加"
            className="flex h-8 w-8 shrink-0 items-center justify-center text-base text-brand active:bg-[var(--brand-12)]"
            onClick={() => step(1)}
          >
            +
          </button>
        </div>
        <div className="ml-auto flex h-6 min-w-[56px] shrink-0 items-center justify-end">
          {validation.ok && Math.abs(delta) >= 0.005 && (
            <span
              className="num inline-flex items-center rounded-full px-2 py-0.5 text-[11px]"
              style={{
                background: up
                  ? 'color-mix(in oklab, var(--up) 12%, transparent)'
                  : 'color-mix(in oklab, var(--down) 12%, transparent)',
                color: up ? 'var(--up)' : 'var(--down)',
                border: `1px solid ${
                  up
                    ? 'color-mix(in oklab, var(--up) 20%, transparent)'
                    : 'color-mix(in oklab, var(--down) 20%, transparent)'
                }`,
              }}
            >
              {up ? '▲' : '▼'}&thinsp;{fmtMoney(Math.abs(delta))}
            </span>
          )}
        </div>
      </div>
      <div className="my-1.5 h-px bg-border" />
      <div className="flex items-center gap-2">
        <span className="label-eyebrow w-8 shrink-0">毛利</span>
        <span className="num shrink-0 text-xs text-muted-foreground">{fmtMoney(unit)}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground/40">→</span>
        <span
          className={[
            'num shrink-0 text-xs',
            validation.ok && newUnit < 0
              ? 'text-[#b91c1c] font-semibold'
              : validation.ok && newUnit < unit
              ? 'text-[var(--down)]'
              : validation.ok && newUnit > unit
              ? 'text-[var(--up)]'
              : 'text-foreground',
          ].join(' ')}
        >
          {fmtMoney(validation.ok ? newUnit : unit)}
        </span>
        {validation.ok && newPrice < dbWholesale && (
          <span className="ml-auto min-w-0 truncate text-right text-[11px] font-medium text-[#b91c1c]">
            ⚠️ 低于批发价，每件亏 {fmtMoney(Math.abs(newUnit))}
          </span>
        )}
      </div>
      {!validation.ok && validation.msg && (
        <div className="mt-2 text-[11px] text-destructive">{validation.msg}</div>
      )}
      {priceWarning && (
        <div className="mt-2 text-[11px] font-medium" style={{ color: '#d97706' }}>
          ⚠️ {priceWarning}
        </div>
      )}
    </div>
  ) : null;

  const hasPeriods = periods && periods.length >= 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden rounded-[20px] sm:max-w-md"
        style={{
          zoom,
          // zoom 把元素整体放大 zoom 倍，vh/vw 是基于视口的，所以反向除一次保持视觉 92vh / 94vw
          maxHeight: `${92 / zoom}vh`,
          maxWidth: `${94 / zoom}vw`,
        }}
      >
        <DialogHeader>
          <div className="label-eyebrow" style={{ color: 'var(--brand)' }}>
            SKU DETAIL
          </div>
          <DialogTitle className="text-[20px] font-extrabold tracking-tight">商品详情</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          {/* 商品头部 */}
          <div className="solid-card flex gap-2.5 p-2" style={{ borderRadius: '16px' }}>
            <SkuImage src={sku.imgUrl} alt={sku.name} code={sku.code} className="h-[48px] w-[48px] shrink-0" />
            <div className="min-w-0 flex-1 py-0.5">
              <div className="text-[13px] font-semibold leading-snug">{sku.name}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {sku.spec} · {sku.brand}
              </div>
              <div className="mt-1 chip-base">
                <span className="num">SKU {sku.code}</span>
              </div>
            </div>
          </div>

          {timeline ? (
            <div className="solid-card px-3 py-2.5" style={{ borderRadius: '14px' }}>
              <div className="label-eyebrow mb-1.5">调价记录</div>
              {timeline.map((t, i) => (
                <div key={i} className="text-[11px] leading-relaxed text-muted-foreground">
                  <div className="font-medium text-foreground">{t.dateLabel}</div>
                  <div className="mt-0.5">
                    {'售价 '}
                    <span className="num font-medium text-foreground">
                      {fmtMoney(t.from)}→{fmtMoney(t.to)}
                    </span>
                    {'，月均毛利'}
                    <span
                      style={{ color: t.profitUp ? '#059669' : '#DC2626' }}
                      className="font-medium"
                    >
                      {t.profitUp ? '增长' : '减少'}
                    </span>
                    到<span className="num text-foreground">{fmtMoney(t.profit)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1">
              <Cell label="现售价" value={fmtMoney(sku.currentPrice)} />
              <Cell label="批发价" value={fmtMoney(dbWholesale)} />
              <Cell label="单件毛利" value={fmtMoney(unit)} />
              <Cell label="月销量" value={sku.ownStoreSales.toString()} />
              <Cell label="月销售额" value={fmtMoney(monthSales)} />
              <Cell label="月均毛利" value={fmtMoney(monthProfit)} brand />
            </div>
          )}

          {diagnosis?.diagnosis && (
            <div
              className="px-3 py-2.5 text-xs leading-relaxed"
              style={{
                borderRadius: '14px',
                background:
                  diagnosis.suggestion === 'raise'
                    ? 'color-mix(in oklab, #10B981 8%, transparent)'
                    : diagnosis.suggestion === 'lower'
                    ? 'color-mix(in oklab, #EF4444 8%, transparent)'
                    : 'color-mix(in oklab, var(--brand) 6%, transparent)',
                border:
                  diagnosis.suggestion === 'raise'
                    ? '1px solid color-mix(in oklab, #10B981 20%, transparent)'
                    : diagnosis.suggestion === 'lower'
                    ? '1px solid color-mix(in oklab, #EF4444 20%, transparent)'
                    : '1px solid var(--border)',
              }}
            >
              <span className="font-semibold">🤖 智能建议：</span>
              <span className="text-muted-foreground">{diagnosis.diagnosis}</span>
            </div>
          )}

          {hasPeriods && (
            <div className="solid-card px-2.5 pb-1 pt-2" style={{ borderRadius: '16px' }}>
              <PriceCurveChart
                data={chartData}
                wholesalePrice={dbWholesale}
                selectedPeriod={selectedPeriod}
                popupPos={popupPos}
                onBarClick={handleBarClick}
              />
            </div>
          )}

          {editingContent}
        </div>

        <DialogFooter className="flex-row gap-2 pt-0">
          <Button variant="outline" className="flex-1 rounded-full" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          {editing ? (
            <Button
              className="flex-1 rounded-full"
              style={{ boxShadow: 'var(--shadow-brand)' }}
              disabled={!validation.ok || unchanged || submitting}
              onClick={apply}
            >
              {submitting ? '提交中…' : '应用调价'}
            </Button>
          ) : (
            <Button
              className="flex-1 rounded-full"
              style={{ boxShadow: 'var(--shadow-brand)' }}
              onClick={handleStartAdjust}
            >
              调整价格
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Cell({ label, value, brand }: { label: string; value: string; brand?: boolean }) {
  return (
    <div
      className="px-2 py-1.5"
      style={{
        borderRadius: '12px',
        background: 'color-mix(in oklab, #140e0a 4%, transparent)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="label-eyebrow">{label}</div>
      <div className={['num mt-0.5 text-[11px]', brand ? 'text-brand' : 'text-foreground'].join(' ')}>
        {value}
      </div>
    </div>
  );
}
