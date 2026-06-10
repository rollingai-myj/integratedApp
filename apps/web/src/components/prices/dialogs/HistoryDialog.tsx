/**
 * 价盘 · 调价历史对话框（来自原 priceChange repo）
 *
 * 与原版的差异：
 *   - 入参从 store 改为父组件预先聚合好的 entries 数组
 *   - SKU 形状从 SKU 改为 StoreSkuRow，内部用 rowToSku 适配
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useIOSDeviceZoom } from '@/components/IOSDevice';
import { SkuImage } from '../SkuImage';
import { fmtMoney, rowToSku } from '@/lib/prices/types';
import type { StoreSkuRow } from '@myj/shared';

export interface HistoryEntry {
  row: StoreSkuRow;
  startDate: string;
  endDate: string | null;
  dateLabel: string;
  from: number;
  to: number;
  /** 新价已有销量快照时填月均毛利；尚无销量时省略 → 渲染时跳过那一行 */
  profit?: number;
  profitUp?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entries: HistoryEntry[];
  onSelectSku?: (row: StoreSkuRow) => void;
}

export function HistoryDialog({ open, onOpenChange, entries, onSelectSku }: Props) {
  // 弹窗 portal 在 IOSDevice 之外，需手动同步 zoom 才能保持比例。
  const zoom = useIOSDeviceZoom()?.zoom ?? 1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col overflow-hidden rounded-[22px] sm:max-w-md"
        style={{
          zoom,
          // zoom 会把元素整体放大 zoom 倍，vh/vw 是基于视口的，所以这里反向除一次保持视觉 88vh / 94vw
          maxHeight: `${88 / zoom}vh`,
          maxWidth: `${94 / zoom}vw`,
        }}
      >
        <DialogHeader className="shrink-0">
          <div className="label-eyebrow" style={{ color: 'var(--brand)' }}>
            HISTORY
          </div>
          <DialogTitle className="text-[20px] font-extrabold tracking-tight">
            📜 调价历史记录
          </DialogTitle>
          <DialogDescription className="text-xs">
            来自调价记录表 · 按时间倒序（共 {entries.length} 条）
          </DialogDescription>
        </DialogHeader>

        {entries.length === 0 ? (
          <div
            className="solid-card py-10 text-center text-sm text-muted-foreground"
            style={{ borderRadius: '18px' }}
          >
            暂无调价记录
          </div>
        ) : (
          <ul className="flex-1 min-h-0 space-y-2 overflow-y-auto">
            {entries.map((entry, i) => {
              const sku = rowToSku(entry.row);
              const diff = entry.to - entry.from;
              const up = diff > 0;
              return (
                <li
                  key={i}
                  className="solid-card flex gap-2.5 p-3 cursor-pointer active:opacity-80 transition-opacity"
                  style={{ borderRadius: '16px' }}
                  onClick={() => onSelectSku?.(entry.row)}
                >
                  <SkuImage
                    src={sku.imgUrl}
                    alt={sku.name}
                    code={sku.code}
                    className="h-10 w-10 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-1 text-xs font-semibold">{sku.name}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{entry.dateLabel}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                      <span className="num text-muted-foreground">{fmtMoney(entry.from)}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="num">{fmtMoney(entry.to)}</span>
                      <span
                        className="num inline-flex items-center rounded-full px-2 py-0.5 text-[10px]"
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
                        {up ? '↑' : '↓'} {fmtMoney(Math.abs(diff))}
                      </span>
                    </div>
                    {entry.profit != null && entry.profitUp != null && (
                      <div className="mt-0.5 flex items-center text-[10px]">
                        <span style={{ color: entry.profitUp ? '#059669' : '#DC2626' }}>
                          月均毛利{entry.profitUp ? '增长' : '减少'}到 {fmtMoney(entry.profit)}
                        </span>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
