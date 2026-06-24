/**
 * 销量跟踪 Tab —— 历史记录里第三个 tab。
 *
 * 数据来源:JobsContext 的 recentJobs(近 30 天所有 task,服务端)。
 *
 * 内容：
 *   - 主视图：列出在**当前店**做过海报且生成成功的 SKU（按 sku 聚合）；每个 card 显示
 *     最近海报缩略图、商品名（从 useStoreSkus 实时查）、SKU 号、活动次数、最近活动日期
 *   - 详情视图：点击 SKU 进入；柱状图展示过去 90 天 weekly 销量,活动时间立 marker
 *
 * 跨店保护:仅显示 storeId === currentStoreId 的海报,避免 A 店做的 SKU 用 B 店销量曲线。
 */
import * as React from 'react';
import { TOKENS } from './tokens';
import type { Job } from './JobsContext';
import { useStoreSkus } from '@/lib/hooks';
import { SalesTrackingChart } from './SalesTrackingChart';

interface Props {
  accent: string;
  /** 来自 JobsContext.recentJobs(近 30 天) */
  jobs: Job[];
  currentStoreId: string | null;
  onPreviewPoster: (url: string) => void;
}

/** 聚合后每个 SKU 的展示数据 */
interface TrackedSku {
  sku: string;
  /** 用户最早→最晚所有活动时间戳（毫秒） */
  posterTimes: number[];
  /** 最近一次海报缩略图 */
  latestImageUrl: string;
}

export function SalesTrackingView({
  accent,
  jobs,
  currentStoreId,
  onPreviewPoster,
}: Props) {
  const [selectedSku, setSelectedSku] = React.useState<string | null>(null);

  // 当前店 SKU 元数据（用来查 productName）。staleTime 60s，多次进入 tab 不会反复打
  const skusQuery = useStoreSkus(currentStoreId);
  const skuNameMap = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const s of skusQuery.data?.skus ?? []) m.set(s.skuCode, s.productName);
    return m;
  }, [skusQuery.data]);

  // 聚合 recentJobs → trackedSkus
  // 过滤条件:
  //   1) status === 'done'    成功生成才有海报图
  //   2) 同店(storeId 匹配)   避免 A 店做的 SKU 用 B 店销量曲线
  //   3) 有 sku                没绑商品的海报无销量可追
  //   4) 有 result_image_url   缩略图
  const trackedSkus = React.useMemo<TrackedSku[]>(() => {
    if (!currentStoreId) return [];
    const map = new Map<string, TrackedSku>();
    const sorted = [...jobs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    for (const j of sorted) {
      if (j.status !== 'done') continue;
      if (j.params?.storeId !== currentStoreId) continue;
      const sku = j.params?.sku;
      if (!sku) continue;
      const imageUrl = j.result_image_url;
      if (!imageUrl) continue;
      const ts = new Date(j.created_at).getTime();
      const existing = map.get(sku);
      if (existing) {
        existing.posterTimes.push(ts);
      } else {
        map.set(sku, {
          sku,
          posterTimes: [ts],
          latestImageUrl: imageUrl,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => Math.max(...b.posterTimes) - Math.max(...a.posterTimes),
    );
  }, [jobs, currentStoreId]);

  if (!currentStoreId) {
    return <EmptyState text="未选择门店" />;
  }

  if (selectedSku) {
    const tracked = trackedSkus.find((t) => t.sku === selectedSku);
    if (!tracked) {
      // 用户选了 SKU 后切店导致 trackedSkus 变空？回到列表
      setSelectedSku(null);
      return null;
    }
    return (
      <SalesTrackingChart
        accent={accent}
        sku={tracked.sku}
        productName={skuNameMap.get(tracked.sku) ?? tracked.sku}
        posterTimes={tracked.posterTimes}
        currentStoreId={currentStoreId}
        onBack={() => setSelectedSku(null)}
      />
    );
  }

  if (trackedSkus.length === 0) {
    return (
      <EmptyState text="近 30 天没有可追踪的活动。生成带商品 SKU 的海报后,会自动出现在这里。" />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {trackedSkus.map((t) => {
        const productName = skuNameMap.get(t.sku) ?? t.sku;
        const latest = Math.max(...t.posterTimes);
        const dateLabel = new Date(latest).toLocaleDateString('zh-CN', {
          month: 'numeric',
          day: 'numeric',
        });
        return (
          <div
            key={t.sku}
            onClick={() => setSelectedSku(t.sku)}
            style={{
              background: '#fff',
              borderRadius: 14,
              padding: 12,
              boxShadow: TOKENS.shadow1,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <img
              src={t.latestImageUrl}
              alt=""
              onClick={(e) => { e.stopPropagation(); onPreviewPoster(t.latestImageUrl); }}
              style={{
                width: 60,
                height: 80,
                objectFit: 'cover',
                borderRadius: 8,
                flexShrink: 0,
                background: '#1a1a1a',
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: TOKENS.ink,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {productName}
              </div>
              <div style={{ fontSize: 11, color: TOKENS.inkMuted, marginTop: 3 }}>
                {t.sku}
              </div>
              <div style={{ fontSize: 11, color: TOKENS.inkMuted, marginTop: 4 }}>
                最近活动 {dateLabel} · 共 {t.posterTimes.length} 次
              </div>
            </div>
            <div style={{ fontSize: 13, color: accent, fontWeight: 700, flexShrink: 0 }}>
              查看 →
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        border: `1.5px dashed ${TOKENS.line}`,
        borderRadius: 12,
        padding: '36px 16px',
        textAlign: 'center',
        color: TOKENS.inkMuted,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {text}
    </div>
  );
}
