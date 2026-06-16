/**
 * 价盘 · 商品详情 + 模拟调价对话框
 *
 * V027 起：本 app 是模拟器，不真改门店价。
 *   - "应用调价"按钮 → 被动提示"请在您的经营系统中调价"（不再触发任何后端写入）
 *   - "调整价格"按钮文案 → "模拟调价"
 *   - 调价历史不再来自 store_price_changes，从 curve.periods 相邻段不同价推导
 *
 * 数据：
 *   - row：StoreSkuRow，内部用 rowToSku(row, curve.raw) 适配 SKU
 *   - curve：CurveData props，父组件用 curveSkuToData 适配
 *   - 竞品价格暂时不渲染 tab（后端未暴露）
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
  getSkuBarcodeUrl,
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
}

const fmtShort = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}号`;

interface ChartDataPoint {
  price: number;
  monthlyProfit: number;
  monthlySales: number;
  periodLabel: string;
  startDate: string | null;
  endDate: string | null;
  hasSalesData: boolean;
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
}: Props) {
  const sku: SKU | null = useMemo(
    () => (row ? rowToSku(row, curve?.raw) : null),
    [row, curve],
  );
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
      // 兜底"当前价"伪段：当作有销量（fallback 是组件初次进入无 curve 时的占位）
      return [
        {
          price: sku.currentPrice,
          monthlyProfit: (sku.currentPrice - sku.wholesalePrice) * sku.ownStoreSales,
          monthlySales: sku.ownStoreSales,
          periodLabel: '当前',
          startDate: null,
          endDate: null,
          hasSalesData: true,
        },
      ];
    }
    // 柱状图只显示销量快照里"已经有数据"的价格段 —— 调价当下的孤立 price_change
    // 在 fact 表只有价格没有销量，柱子永远是 0，渲染出来反而误导
    return [...periods]
      .filter((p) => p.hasSalesData)
      .sort((a, b) => b.price - a.price)
      .map((p) => ({
        price: p.price,
        monthlyProfit: p.monthlyGrossProfit,
        monthlySales: p.monthlySales,
        periodLabel: periodLabel(p),
        startDate: p.startDate,
        endDate: p.endDate,
        hasSalesData: p.hasSalesData,
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

  // V027：apply() 已删；保留 newPrice / validation 仅供模拟器 UI 显示利润预测

  // V027：调价时间线从 curve.periods 相邻段不同价推导
  //   - snapshot 序列里前后两段价格不同 → 用户在经营系统里调过一次价
  //   - 月均毛利变化：用新/旧段的 monthlyGrossProfit 对比（hasSalesData=true 的段才计）
  const periods = curve?.periods;
  const timeline = useMemo(() => {
    if (!sku || !periods || periods.length < 2) return null;
    const list: Array<{
      dateLabel: string;
      from: number;
      to: number;
      profit: number | undefined;
      profitUp: boolean | undefined;
    }> = [];
    for (let i = 1; i < periods.length; i++) {
      const prev = periods[i - 1]!;
      const curr = periods[i]!;
      if (Math.abs(prev.price - curr.price) < 0.01) continue;
      if (!curr.startDate) continue;
      list.push({
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
    // 按日期倒序（最近的调价在最上面）
    list.reverse();
    return list.length > 0 ? list : null;
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

  // 柱状图需要至少 2 个"有销量数据"的段才有可比性 —— 全是孤立调价点时不渲染
  const hasChartData = chartData.length >= 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col overflow-hidden rounded-[20px] sm:max-w-md"
        style={{
          zoom,
          // zoom 把元素整体放大 zoom 倍，vh/vw 是基于视口的，所以反向除一次保持视觉 92vh / 94vw
          maxHeight: `${92 / zoom}vh`,
          maxWidth: `${94 / zoom}vw`,
        }}
      >
        <DialogHeader className="shrink-0">
          <div className="label-eyebrow" style={{ color: 'var(--brand)' }}>
            SKU DETAIL
          </div>
          <DialogTitle className="text-[20px] font-extrabold tracking-tight">商品详情</DialogTitle>
        </DialogHeader>

        {/* 调价警告 / 低于批发价提示 / AI 诊断 / 柱状图 都可能撑高内容,
            flex-1 + overflow-y-auto + min-h-0 让 Footer 永远可见 */}
        <div className="flex-1 min-h-0 space-y-2 overflow-y-auto">
          {/* 商品头部 */}
          <div className="solid-card flex items-center gap-2.5 p-2" style={{ borderRadius: '16px' }}>
            <SkuImage src={sku.imgUrl} alt={sku.name} code={sku.code} className="h-[48px] w-[48px] shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-[12px] font-semibold leading-snug">{sku.name}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {sku.spec} · {sku.brand}
              </div>
              <div className="num mt-0.5 text-[10px] text-muted-foreground">SKU {sku.code}</div>
            </div>
            {/* 条形码：与选品/货架模块共用 OSS 图源；加载失败时隐藏避免破图 */}
            <BarcodeImage code={sku.code} />
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
                    {/* 新价没有销量快照时（profit/profitUp = undefined），
                        不展示"月均毛利..."以免误导（毛利根本算不出来） */}
                    {t.profit != null && t.profitUp != null && (
                      <>
                        {'，月均毛利'}
                        <span
                          style={{ color: t.profitUp ? '#059669' : '#DC2626' }}
                          className="font-medium"
                        >
                          {t.profitUp ? '增长' : '减少'}
                        </span>
                        到<span className="num text-foreground">{fmtMoney(t.profit)}</span>
                      </>
                    )}
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

          {hasChartData && (
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

        {editing && (
          <div
            className="shrink-0 px-1 pb-1 pt-0 text-center text-[11px] leading-relaxed whitespace-nowrap"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {/* V027：app 是模拟器，不真改门店价；whitespace-nowrap + 11px 把这行字锁在同一行 */}
            请在经营系统中进行调价，后续可在此查看销售数据变化
          </div>
        )}
        {!editing && (
          <DialogFooter className="shrink-0 flex-row gap-2 pt-0">
            <Button
              className="flex-1 rounded-full"
              style={{ boxShadow: 'var(--shadow-brand)' }}
              onClick={handleStartAdjust}
            >
              模拟调价
            </Button>
          </DialogFooter>
        )}
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

/**
 * 商品头部卡片右侧的条形码缩略图。
 * OSS 图源；加载失败时隐藏整个 <img>，避免 alt 文字渲染破坏布局。
 */
function BarcodeImage({ code }: { code: string }) {
  const url = getSkuBarcodeUrl(code);
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      className="ml-auto h-9 w-auto shrink-0 self-center"
      onError={() => setFailed(true)}
    />
  );
}
