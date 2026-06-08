/**
 * 价盘管理 (/prices)
 *
 * M5-PR1：
 *   - 列出当前门店的在册 SKU（含售价、原价、近 30 天销量）
 *   - 搜索筛选 + 调过价标记
 *   - 点击商品 → Sheet 弹层：90 天价格曲线 + 调价表单
 *   - 调价：D3 两层写入 + 自动 refetch 列表
 *
 * 注：竞品价 / AI 诊断 在后端齐备但 UI 暂未接入，等 M5-PR2/PR3 再拼装。
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { ArrowLeft, Search, X, TrendingUp, TrendingDown } from 'lucide-react';
import { IOSDevice } from '@/components/IOSDevice';
import { useMe } from '@/lib/auth';
import {
  useSkus,
  usePriceCurve,
  useSubmitPriceChange,
} from '@/lib/hooks';
import { ApiError } from '@/lib/api-client';
import type { StoreSkuRow } from '@myj/shared';

export const Route = createFileRoute('/prices/')({
  component: PricesPage,
});

function PricesPage() {
  const meQuery = useMe();
  const storeCode = meQuery.data?.currentStore?.code ?? '';

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<StoreSkuRow | null>(null);

  const skusQuery = useSkus({ search: search.trim() || undefined });

  const skus = skusQuery.data?.skus ?? [];

  return (
    <IOSDevice>
      <div className="h-full bg-background flex flex-col">
        {/* Header */}
        <header className="flex items-center gap-3 px-[22px] pt-3 pb-2 border-b border-hairline">
          <Link
            to="/"
            className="w-[38px] h-[38px] rounded-xl bg-surface border border-hairline flex items-center justify-center"
            aria-label="返回首页"
          >
            <ArrowLeft size={18} className="text-ink" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-semibold text-ink tracking-wide">价盘管理</div>
            <div className="text-[11.5px] text-ink-muted tracking-wide truncate">
              {storeCode || '未选择门店'} · {skusQuery.isLoading ? '载入中…' : `${skus.length} 个 SKU`}
            </div>
          </div>
        </header>

        {/* Search */}
        <div className="px-[22px] pt-3 pb-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="商品名 / SKU / 条码"
              className="w-full h-10 pl-9 pr-9 rounded-xl bg-surface border border-hairline text-[13px] placeholder:text-ink-muted/60 focus:outline-none focus:border-primary"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                aria-label="清除"
              >
                <X size={14} className="text-ink-muted" />
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-[22px] pb-6">
          {skusQuery.isLoading && (
            <div className="py-12 text-center text-sm text-ink-muted">载入商品中…</div>
          )}
          {skusQuery.isError && (
            <div className="py-12 text-center text-sm text-rose-600">
              {(skusQuery.error as Error)?.message ?? '载入失败'}
            </div>
          )}
          {skusQuery.isSuccess && skus.length === 0 && (
            <div className="py-12 text-center text-sm text-ink-muted">
              {search ? '没有匹配的商品' : '该门店暂无 SKU 数据'}
            </div>
          )}
          <div className="flex flex-col gap-2.5 mt-1">
            {skus.map((sku) => (
              <SkuRow key={sku.id} sku={sku} onClick={() => setSelected(sku)} />
            ))}
          </div>
        </div>

        {/* Detail sheet */}
        {selected && (
          <PriceSheet sku={selected} onClose={() => setSelected(null)} />
        )}
      </div>
    </IOSDevice>
  );
}

// ---- SKU 行 -------------------------------------------------------------

function SkuRow({ sku, onClick }: { sku: StoreSkuRow; onClick: () => void }) {
  const retail = sku.retailPrice;
  const orig = sku.originalPrice;
  const discounted = retail != null && orig != null && retail < orig;

  return (
    <button
      onClick={onClick}
      className="text-left bg-surface border border-hairline rounded-2xl p-3.5 active:scale-[0.98] transition-transform"
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-primary-soft flex items-center justify-center shrink-0 overflow-hidden">
          {sku.officialImageUrl ? (
            <img src={sku.officialImageUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-[18px] text-primary font-semibold">
              {sku.productName.slice(0, 1)}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-ink truncate leading-tight">
            {sku.productName}
          </div>
          <div className="text-[11px] text-ink-muted mt-0.5 truncate">
            {[sku.skuCode, sku.brand, sku.spec].filter(Boolean).join(' · ')}
          </div>
          <div className="flex items-baseline gap-2 mt-1.5">
            <span className="text-[17px] font-semibold text-ink leading-none">
              ¥{retail != null ? Number(retail).toFixed(2) : '—'}
            </span>
            {orig != null && (
              <span
                className={`text-[11px] ${
                  discounted ? 'text-ink-muted line-through' : 'text-ink-muted'
                }`}
              >
                ¥{Number(orig).toFixed(2)}
              </span>
            )}
            {sku.hasPriceChange && (
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                已调价
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-ink-muted">
            <span>30 天销量 {sku.salesQty30d ?? 0}</span>
            {sku.grossMargin30d != null && (
              <span>毛利 {(Number(sku.grossMargin30d) * 100).toFixed(1)}%</span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ---- 详情 Sheet ---------------------------------------------------------

function PriceSheet({
  sku,
  onClose,
}: {
  sku: StoreSkuRow;
  onClose: () => void;
}) {
  const curveQuery = usePriceCurve([sku.skuCode], 90);
  const submit = useSubmitPriceChange();

  const [newPrice, setNewPrice] = useState(
    sku.retailPrice != null ? String(sku.retailPrice) : '',
  );
  const [note, setNote] = useState('');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const curve = curveQuery.data?.curves?.[0];

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg(null);
    const price = Number(newPrice);
    if (!Number.isFinite(price) || price < 0) {
      setErrMsg('请输入有效的非负价格');
      return;
    }
    submit.mutate(
      {
        skuCode: sku.skuCode,
        newPrice: price,
        oldPrice: sku.retailPrice ?? undefined,
        source: 'manual',
        note: note.trim() || undefined,
      },
      {
        onSuccess: () => onClose(),
        onError: (err) => {
          if (err instanceof ApiError) setErrMsg(err.message);
          else setErrMsg('提交失败，请重试');
        },
      },
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 -translate-x-1/2 bottom-0 z-40 w-full max-w-[390px] bg-background rounded-t-3xl border-t border-hairline max-h-[90%] overflow-y-auto">
        <div className="sticky top-0 bg-background px-[22px] pt-4 pb-3 border-b border-hairline flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-semibold text-ink truncate">{sku.productName}</div>
            <div className="text-[11px] text-ink-muted truncate">{sku.skuCode}</div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface border border-hairline flex items-center justify-center"
            aria-label="关闭"
          >
            <X size={16} className="text-ink" />
          </button>
        </div>

        <div className="px-[22px] py-4">
          <div className="text-[12px] font-semibold text-ink-muted mb-2 tracking-wide">
            近 90 天价格曲线
          </div>
          <PriceSparkline curve={curve} />

          <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3">
            <label className="block">
              <div className="text-[12px] text-ink-muted mb-1.5 tracking-wide">新价（元）</div>
              <input
                type="number"
                step="0.01"
                min="0"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                className="w-full h-11 px-3 rounded-xl bg-surface border border-hairline text-[15px] focus:outline-none focus:border-primary"
                required
              />
            </label>
            <label className="block">
              <div className="text-[12px] text-ink-muted mb-1.5 tracking-wide">备注（可选）</div>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例：与隔壁竞品对齐"
                className="w-full h-11 px-3 rounded-xl bg-surface border border-hairline text-[13px] focus:outline-none focus:border-primary"
              />
            </label>
            {errMsg && (
              <div className="text-[12px] text-rose-600 px-1">{errMsg}</div>
            )}
            <button
              type="submit"
              disabled={submit.isPending}
              className="h-11 rounded-xl bg-primary text-white font-semibold text-[14px] active:opacity-80 disabled:opacity-50"
            >
              {submit.isPending ? '提交中…' : '提交调价'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

// ---- 价格曲线小图（纯 SVG，无外部依赖） --------------------------------

function PriceSparkline({
  curve,
}: {
  curve: { points: Array<{ snapshotDate: string; retailPrice: number | null }> } | undefined;
}) {
  const points = useMemo(
    () =>
      (curve?.points ?? [])
        .filter((p) => p.retailPrice != null)
        .map((p) => ({ date: p.snapshotDate, price: Number(p.retailPrice) })),
    [curve],
  );

  if (points.length === 0) {
    return (
      <div className="h-24 rounded-xl bg-surface border border-hairline flex items-center justify-center text-[12px] text-ink-muted">
        暂无价格快照
      </div>
    );
  }

  const w = 340;
  const h = 96;
  const padX = 12;
  const padY = 14;
  const min = Math.min(...points.map((p) => p.price));
  const max = Math.max(...points.map((p) => p.price));
  const range = Math.max(max - min, 0.01);
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;

  const path = points
    .map((p, i) => {
      const x = padX + (i / Math.max(points.length - 1, 1)) * innerW;
      const y = padY + (1 - (p.price - min) / range) * innerH;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  const first = points[0]!.price;
  const last = points[points.length - 1]!.price;
  const trend = last - first;

  return (
    <div className="rounded-xl bg-surface border border-hairline p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-ink-muted">
          {points[0]!.date} ~ {points[points.length - 1]!.date}
        </span>
        <span
          className={`flex items-center gap-1 text-[11.5px] font-semibold ${
            trend > 0 ? 'text-rose-600' : trend < 0 ? 'text-emerald-600' : 'text-ink-muted'
          }`}
        >
          {trend > 0 ? <TrendingUp size={12} /> : trend < 0 ? <TrendingDown size={12} /> : null}
          {trend === 0 ? '持平' : `${trend > 0 ? '+' : ''}${trend.toFixed(2)}`}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24">
        <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => {
          const x = padX + (i / Math.max(points.length - 1, 1)) * innerW;
          const y = padY + (1 - (p.price - min) / range) * innerH;
          return <circle key={i} cx={x} cy={y} r="2.5" fill="var(--primary)" />;
        })}
      </svg>
      <div className="flex items-center justify-between text-[11px] text-ink-muted mt-1">
        <span>低 ¥{min.toFixed(2)}</span>
        <span>当前 ¥{last.toFixed(2)}</span>
        <span>高 ¥{max.toFixed(2)}</span>
      </div>
    </div>
  );
}
