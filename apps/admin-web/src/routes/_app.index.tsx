/**
 * Dashboard — 4 KPI + 调改趋势 + Top 5 活跃门店 + 场景占比
 *
 * 顶部时间窗下拉(7 / 30 / 90 天),切换会触发 4 个查询。
 * 各卡用独立 query,任一失败不阻塞其他;loading 期间用 skeleton。
 */
import * as React from 'react';
import type { CSSProperties } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { TOKENS } from '@/tokens';
import { StatCard } from '@/components/StatCard';
import { LineChart } from '@/components/charts/LineChart';
import { BarList } from '@/components/charts/BarList';
import { DonutChart } from '@/components/charts/DonutChart';
import {
  fetchDashboardKpis,
  fetchAdjustmentTrend,
  fetchTopActiveStores,
  fetchSceneDistribution,
} from '@/lib/dashboard';

export const Route = createFileRoute('/_app/')({
  component: Dashboard,
});

const RANGE_OPTIONS = [
  { value: 7,  label: '近 7 天' },
  { value: 30, label: '近 30 天' },
  { value: 90, label: '近 90 天' },
];

function Dashboard() {
  const [days, setDays] = React.useState<number>(30);

  const kpisQ = useQuery({
    queryKey: ['dashboard', 'kpis', days],
    queryFn: () => fetchDashboardKpis(days),
  });
  const trendQ = useQuery({
    queryKey: ['dashboard', 'trend', days],
    queryFn: () => fetchAdjustmentTrend(days),
  });
  const topQ = useQuery({
    queryKey: ['dashboard', 'top', days],
    queryFn: () => fetchTopActiveStores(days, 5),
  });
  const sceneQ = useQuery({
    queryKey: ['dashboard', 'scenes', days],
    queryFn: () => fetchSceneDistribution(days),
  });

  const rangeLabel = RANGE_OPTIONS.find(o => o.value === days)?.label ?? `近 ${days} 天`;

  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        marginBottom: 20, gap: 16, flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{
            fontSize: TOKENS.f2xl, fontWeight: 700, color: TOKENS.ink, margin: '0 0 6px',
          }}>
            仪表盘
          </h1>
          <div style={{ fontSize: TOKENS.fSm, color: TOKENS.inkMuted }}>
            门店调改、海报生成、价格变更 — 一眼概览
          </div>
        </div>
        <RangePicker value={days} options={RANGE_OPTIONS} onChange={setDays} />
      </div>

      {/* KPI */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 16,
        marginBottom: 20,
      }}>
        <StatCard
          label="活跃门店"
          sub={`${rangeLabel}有调改的门店`}
          block={kpisQ.data?.activeStores}
          loading={kpisQ.isLoading}
        />
        <StatCard
          label="调改 SKU"
          sub={rangeLabel}
          block={kpisQ.data?.adjustedSkus}
          loading={kpisQ.isLoading}
        />
        <StatCard
          label="海报生成"
          sub={rangeLabel}
          block={kpisQ.data?.posterTasks}
          loading={kpisQ.isLoading}
        />
        <StatCard
          label="价格调整"
          sub={rangeLabel}
          block={kpisQ.data?.priceChanges}
          loading={kpisQ.isLoading}
        />
      </div>

      {/* 第二行:趋势 + Top 5 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.6fr 1fr',
        gap: 16,
        marginBottom: 16,
      }}>
        <Panel title="调改趋势" subtitle="按天 · 上架 / 下架">
          {trendQ.isLoading ? (
            <ChartSkeleton height={240} />
          ) : trendQ.error ? (
            <ErrorBlock />
          ) : (
            <LineChart data={trendQ.data ?? []} />
          )}
        </Panel>
        <Panel title="Top 5 活跃门店" subtitle="按调改 SKU 总数">
          {topQ.isLoading ? (
            <ChartSkeleton height={200} />
          ) : topQ.error ? (
            <ErrorBlock />
          ) : (
            <BarList items={(topQ.data ?? []).map(s => ({
              id: s.storeId,
              label: `${s.storeCode} · ${s.storeName}`,
              value: s.totalChanges,
            }))} />
          )}
        </Panel>
      </div>

      {/* 第三行:场景占比 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: 16,
      }}>
        <Panel title="场景占比" subtitle={`${rangeLabel}调改 SKU 在各场景下的分布`}>
          {sceneQ.isLoading ? (
            <ChartSkeleton height={200} />
          ) : sceneQ.error ? (
            <ErrorBlock />
          ) : (
            <DonutChart slices={(sceneQ.data ?? []).map(s => ({
              id: s.scene,
              label: s.sceneName,
              value: s.count,
            }))} />
          )}
        </Panel>
      </div>
    </div>
  );
}

function RangePicker({
  value,
  options,
  onChange,
}: {
  value: number;
  options: { value: number; label: string }[];
  onChange: (v: number) => void;
}) {
  return (
    <div style={{
      display: 'inline-flex',
      background: TOKENS.card,
      border: `1px solid ${TOKENS.line}`,
      borderRadius: 10,
      padding: 3,
      gap: 2,
      boxShadow: TOKENS.shadow1,
    }}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              appearance: 'none',
              border: 0,
              background: active ? TOKENS.red : 'transparent',
              color: active ? '#fff' : TOKENS.inkSoft,
              padding: '6px 14px',
              borderRadius: 8,
              fontSize: TOKENS.fSm,
              fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={panelStyle}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: TOKENS.fMd, fontWeight: 700, color: TOKENS.ink }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: TOKENS.fXs, color: TOKENS.inkMuted, marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div style={{
      height,
      borderRadius: 8,
      background: `linear-gradient(110deg, ${TOKENS.bgWarm} 30%, #efe9df 50%, ${TOKENS.bgWarm} 70%)`,
      backgroundSize: '200% 100%',
      animation: 'sc-shimmer 1.4s linear infinite',
    }} />
  );
}

function ErrorBlock() {
  return (
    <div style={{
      padding: '40px 16px',
      textAlign: 'center',
      color: TOKENS.danger,
      fontSize: TOKENS.fSm,
    }}>
      数据加载失败,请刷新重试
    </div>
  );
}

const panelStyle: CSSProperties = {
  background: TOKENS.card,
  border: `1px solid ${TOKENS.line}`,
  borderRadius: TOKENS.r5,
  padding: '20px 24px',
  boxShadow: TOKENS.shadow1,
};
