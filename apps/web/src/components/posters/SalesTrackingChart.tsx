/**
 * 销量跟踪 · 单 SKU 柱状图
 *
 * - X 轴：过去 90 天 weekly snapshot（snapshotDate）
 * - Y 轴：sales_qty_30d（30 天滚动销量；store_sku_snapshots 写死的口径）
 * - marker：每个"做海报时间"在 X 轴最接近 snapshot 处用 ReferenceLine 立标
 *
 * 不复用 prices 的 PriceCurveChart：那是"按价格点位横向柱"，与本需求"按时间纵向柱
 * + 时间节点标注"是两种图。
 */
import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOKENS } from './tokens';
import { usePriceCurve } from '@/lib/hooks';

interface Props {
  accent: string;
  sku: string;
  productName: string;
  /** 用户做海报的时间戳（毫秒），可能多次 */
  posterTimes: number[];
  currentStoreId: string;
  onBack: () => void;
}

const DAYS_BACK = 90;

/** YYYY-MM-DD → "M/D" 紧凑展示 */
function shortDate(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 把 posterTime (ms) 对齐到 X 轴最接近的 snapshot 日期；找不到返回 null */
function nearestSnapshotDate(
  posterTime: number,
  snapshots: string[],
): string | null {
  if (snapshots.length === 0) return null;
  let best = snapshots[0]!;
  let bestDiff = Math.abs(new Date(best).getTime() - posterTime);
  for (const s of snapshots.slice(1)) {
    const diff = Math.abs(new Date(s).getTime() - posterTime);
    if (diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
}

export function SalesTrackingChart({
  accent,
  sku,
  productName,
  posterTimes,
  currentStoreId,
  onBack,
}: Props) {
  // 后端 /prices/curve 用 session.active_store_id 决定查哪家店（不读 query 参数里的
  // storeId）；这里传 storeId 仅是为了让 hook 的 enabled 守卫通过 + cache key 区分门店。
  const curveQuery = usePriceCurve(currentStoreId, [sku], DAYS_BACK);

  const points = curveQuery.data?.curves[0]?.points ?? [];
  // 过滤掉无销量的 snapshot（source='price_change' 但 sales 还没补的那一行；
  // 见 V006 / D3 说明）
  const data = React.useMemo(
    () =>
      points
        .filter((p) => p.salesQty30d != null)
        .map((p) => ({
          date: p.snapshotDate,
          label: shortDate(p.snapshotDate),
          salesQty: p.salesQty30d as number,
        })),
    [points],
  );

  const markerDates = React.useMemo(
    () =>
      Array.from(
        new Set(
          posterTimes
            .map((t) => nearestSnapshotDate(t, data.map((d) => d.date)))
            .filter((x): x is string => !!x),
        ),
      ),
    [posterTimes, data],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onBack}
          aria-label="返回"
          style={{
            appearance: 'none',
            border: 0,
            background: '#f3f4f6',
            width: 36,
            height: 36,
            borderRadius: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            color: TOKENS.ink,
          }}
        >
          ‹
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 800,
              color: TOKENS.ink,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {productName}
          </div>
          <div style={{ fontSize: 11, color: TOKENS.inkMuted, marginTop: 2 }}>
            {sku} · 过去 {DAYS_BACK} 天销量
          </div>
        </div>
      </div>

      {/* Chart */}
      <div
        style={{
          background: '#fff',
          borderRadius: 14,
          padding: '14px 8px 10px',
          boxShadow: TOKENS.shadow1,
        }}
      >
        {curveQuery.isLoading ? (
          <div style={{ padding: 30, textAlign: 'center', color: TOKENS.inkMuted, fontSize: 12 }}>
            加载销量数据…
          </div>
        ) : data.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: TOKENS.inkMuted, fontSize: 12 }}>
            这个 SKU 在过去 {DAYS_BACK} 天没有销量数据
          </div>
        ) : (
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: TOKENS.inkMuted }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: TOKENS.inkMuted }} width={32} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${TOKENS.line}` }}
                  labelStyle={{ fontWeight: 700 }}
                  formatter={(v: number) => [`${v} 件`, '30 天销量']}
                />
                <Bar dataKey="salesQty" fill={accent} radius={[3, 3, 0, 0]} />
                {markerDates.map((d, idx) => {
                  // index===0 是最早的活动 → "做活动之前"是 marker 之前的点位；
                  // 最后一个是 "做活动之后" 的分界。但单 marker 已能体现"前/后"语义。
                  const label = markerDates.length === 1
                    ? '做活动'
                    : idx === 0
                      ? '首次活动'
                      : idx === markerDates.length - 1
                        ? '最近活动'
                        : '活动';
                  return (
                    <ReferenceLine
                      key={d}
                      x={shortDate(d)}
                      stroke={accent}
                      strokeWidth={2}
                      strokeDasharray="4 3"
                      label={{
                        value: label,
                        position: 'top',
                        fill: accent,
                        fontSize: 9,
                        fontWeight: 700,
                      }}
                    />
                  );
                })}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: TOKENS.inkMuted, lineHeight: 1.5, padding: '0 4px' }}>
        销量按 weekly 快照 30 天滚动统计；活动节点对齐到最近一次快照日期。
      </div>
    </div>
  );
}
