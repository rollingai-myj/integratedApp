/**
 * 货盘选品 (/shelves)
 *
 * M5-PR1：
 *   - Tab 1 场景：货架位 × 品类列表，附调改次数
 *   - Tab 2 货架：当前门店的货架配置（位号 / 宽度 / 层数 / 支持品类）
 *   - Tab 3 SKU：在册商品浏览（含售价、销量、库存）
 *
 * 后续 M5-PR2 会接入：拍照检测 / 调改提交 / 虚拟货架生成 / 调研问卷 / 纠错。
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeft, Search, X } from 'lucide-react';
import { IOSDevice } from '@/components/IOSDevice';
import { useMe } from '@/lib/auth';
import {
  useShelfConfigs,
  useScenes,
  useSceneAdjustmentCounts,
  useSkus,
} from '@/lib/hooks';
import type { SceneDefinition, ShelfConfig, StoreSkuRow } from '@myj/shared';

export const Route = createFileRoute('/shelves/')({
  component: ShelvesPage,
});

type TabKey = 'scenes' | 'configs' | 'skus';

function ShelvesPage() {
  const meQuery = useMe();
  const storeCode = meQuery.data?.currentStore?.code ?? '';
  const hasStore = !!meQuery.data?.currentStore?.id;

  const [tab, setTab] = useState<TabKey>('scenes');

  return (
    <IOSDevice>
      <div className="h-full bg-background flex flex-col">
        <header className="flex items-center gap-3 px-[22px] pt-3 pb-2 border-b border-hairline">
          <Link
            to="/"
            className="w-[38px] h-[38px] rounded-xl bg-surface border border-hairline flex items-center justify-center"
            aria-label="返回首页"
          >
            <ArrowLeft size={18} className="text-ink" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-semibold text-ink tracking-wide">货盘选品</div>
            <div className="text-[11.5px] text-ink-muted tracking-wide truncate">
              {storeCode || '未选择门店'}
            </div>
          </div>
        </header>

        {/* Tabs */}
        <div className="px-[22px] pt-3 flex gap-2">
          {(['scenes', 'configs', 'skus'] as TabKey[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 h-9 rounded-xl text-[13px] font-semibold transition-colors ${
                tab === t
                  ? 'bg-primary text-white'
                  : 'bg-surface border border-hairline text-ink-muted'
              }`}
            >
              {t === 'scenes' ? '场景' : t === 'configs' ? '货架' : 'SKU'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === 'scenes' && <ScenesTab />}
          {tab === 'configs' && <ConfigsTab hasStore={hasStore} />}
          {tab === 'skus' && <SkusTab hasStore={hasStore} />}
        </div>
      </div>
    </IOSDevice>
  );
}

// ---- 场景 Tab -----------------------------------------------------------

function ScenesTab() {
  const scenesQ = useScenes();
  const countsQ = useSceneAdjustmentCounts();

  if (scenesQ.isLoading) {
    return <div className="py-12 text-center text-sm text-ink-muted">载入场景…</div>;
  }
  if (scenesQ.isError) {
    return (
      <div className="py-12 text-center text-sm text-rose-600">
        {(scenesQ.error as Error)?.message ?? '载入失败'}
      </div>
    );
  }

  const scenes = scenesQ.data?.scenes ?? [];
  const countMap = new Map(
    (countsQ.data?.counts ?? []).map((c) => [c.positionCode, c]),
  );

  if (scenes.length === 0) {
    return (
      <div className="py-12 px-8 text-center text-sm text-ink-muted">
        未配置场景定义
      </div>
    );
  }

  return (
    <div className="px-[22px] py-3 flex flex-col gap-2.5">
      {scenes.map((s) => (
        <SceneCard
          key={s.positionCode}
          scene={s}
          remakeCount={countMap.get(s.positionCode)?.remakeCount ?? 0}
          lastRemakeAt={countMap.get(s.positionCode)?.lastRemakeAt ?? null}
        />
      ))}
      <div className="mt-4 px-3 py-3 rounded-2xl bg-amber-50 border border-amber-200">
        <div className="text-[12px] text-amber-900 leading-relaxed">
          调改提交 / 拍照检测 / 虚拟货架生成将在 M5-PR2 接入。
        </div>
      </div>
    </div>
  );
}

function SceneCard({
  scene,
  remakeCount,
  lastRemakeAt,
}: {
  scene: SceneDefinition;
  remakeCount: number;
  lastRemakeAt: string | null;
}) {
  return (
    <div className="bg-surface border border-hairline rounded-2xl p-3.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10.5px] text-ink-muted">位号</span>
        <span className="text-[15px] font-semibold text-ink">{scene.positionCode}</span>
        <span className="text-[13px] text-ink ml-1">{scene.positionName}</span>
        {remakeCount > 0 && (
          <span className="ml-auto text-[10.5px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">
            已调改 {remakeCount}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {scene.categories.map((c, i) => (
          <span
            key={`${c.code ?? ''}-${i}`}
            className="text-[11px] px-2 py-0.5 rounded-full bg-primary-soft text-ink"
          >
            {c.name}
          </span>
        ))}
      </div>
      {lastRemakeAt && (
        <div className="mt-2 text-[10.5px] text-ink-muted">
          上次调改 {lastRemakeAt.slice(0, 10)}
        </div>
      )}
    </div>
  );
}

// ---- 货架配置 Tab -------------------------------------------------------

function ConfigsTab({ hasStore }: { hasStore: boolean }) {
  const q = useShelfConfigs();

  if (!hasStore) {
    return <div className="py-12 text-center text-sm text-ink-muted">未选择门店</div>;
  }
  if (q.isLoading) {
    return <div className="py-12 text-center text-sm text-ink-muted">载入货架…</div>;
  }
  if (q.isError) {
    return (
      <div className="py-12 text-center text-sm text-rose-600">
        {(q.error as Error)?.message ?? '载入失败'}
      </div>
    );
  }
  const configs = q.data?.configs ?? [];
  if (configs.length === 0) {
    return (
      <div className="py-12 px-8 text-center text-sm text-ink-muted">
        该门店尚未配置货架
      </div>
    );
  }

  return (
    <div className="px-[22px] py-3 flex flex-col gap-2.5">
      {configs.map((c) => (
        <ConfigCard key={c.id} cfg={c} />
      ))}
    </div>
  );
}

function ConfigCard({ cfg }: { cfg: ShelfConfig }) {
  return (
    <div className="bg-surface border border-hairline rounded-2xl p-3.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[15px] font-semibold text-ink">{cfg.shelfCode}</span>
        <span className="text-[10.5px] text-ink-muted">位号 {cfg.positionCode}</span>
        {cfg.groupName && (
          <span className="ml-auto text-[11px] text-ink-muted">{cfg.groupName}</span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-4 text-[11.5px] text-ink-muted">
        {cfg.widthCm != null && <span>宽 {cfg.widthCm} cm</span>}
        {cfg.layerCount != null && <span>{cfg.layerCount} 层</span>}
      </div>
      {cfg.supportedCategories.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {cfg.supportedCategories.map((cat) => (
            <span
              key={cat}
              className="text-[11px] px-2 py-0.5 rounded-full bg-primary-soft text-ink"
            >
              {cat}
            </span>
          ))}
        </div>
      )}
      {cfg.notes && (
        <div className="mt-2 text-[11.5px] text-ink-muted leading-snug">
          {cfg.notes}
        </div>
      )}
    </div>
  );
}

// ---- SKU Tab -----------------------------------------------------------

function SkusTab({ hasStore }: { hasStore: boolean }) {
  const [search, setSearch] = useState('');
  const q = useSkus({ search: search.trim() || undefined });

  if (!hasStore) {
    return <div className="py-12 text-center text-sm text-ink-muted">未选择门店</div>;
  }
  const skus = q.data?.skus ?? [];

  return (
    <>
      <div className="px-[22px] pt-3 pb-2 sticky top-0 bg-background z-10">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="商品名 / SKU"
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
        <div className="text-[11px] text-ink-muted mt-1.5 px-1">
          {q.isLoading ? '载入…' : `${skus.length} 个 SKU`}
        </div>
      </div>

      <div className="px-[22px] pb-6 flex flex-col gap-2">
        {q.isError && (
          <div className="py-8 text-center text-sm text-rose-600">
            {(q.error as Error)?.message ?? '载入失败'}
          </div>
        )}
        {q.isSuccess && skus.length === 0 && (
          <div className="py-12 text-center text-sm text-ink-muted">
            {search ? '没有匹配的商品' : '该门店暂无 SKU 数据'}
          </div>
        )}
        {skus.map((s) => (
          <SkuLine key={s.id} sku={s} />
        ))}
      </div>
    </>
  );
}

function SkuLine({ sku }: { sku: StoreSkuRow }) {
  return (
    <div className="bg-surface border border-hairline rounded-xl px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-medium text-ink truncate">{sku.productName}</div>
          <div className="text-[10.5px] text-ink-muted truncate">
            {[sku.skuCode, sku.spec].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[14px] font-semibold text-ink leading-none">
            ¥{sku.retailPrice != null ? Number(sku.retailPrice).toFixed(2) : '—'}
          </div>
          {sku.stockQty != null && (
            <div className="text-[10.5px] text-ink-muted mt-1">
              库存 {sku.stockQty}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 仅 admin.index.tsx 还在引用（后台管理待 M5-PR2）
export function ModulePlaceholder({
  title,
  milestone,
}: {
  title: string;
  milestone: string;
}) {
  return (
    <IOSDevice>
      <div className="h-full bg-background flex flex-col">
        <header className="flex items-center gap-3 px-[22px] pt-3 pb-2">
          <Link
            to="/"
            className="w-[38px] h-[38px] rounded-xl bg-surface border border-hairline flex items-center justify-center"
          >
            <ArrowLeft size={18} className="text-ink" />
          </Link>
          <div className="text-[16px] font-semibold text-ink">{title}</div>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="text-[42px] font-bold text-primary">{milestone}</div>
          <div className="mt-3 text-[14px] text-ink-muted">即将上线</div>
        </div>
      </div>
    </IOSDevice>
  );
}
