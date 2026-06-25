/**
 * 选品 · 上一次调改详情
 *
 * 数据来源：
 *  - store_scene_state.last_snapshot（FlowPage apply 前写入）：当时的照片 / 诊断 / 识别框 / 调改项
 *  - store_scene_adjustments 最新一条：作为兼容兜底（旧批次无 last_snapshot 数据）
 *  - rt.virtualStatus + rt.virtualRawOutputs：虚拟货架图状态
 */
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AppBar, Card, GhostBtn, ScreenWrap, Spin } from '../ui/primitives';
import { TOKENS } from '../ui/tokens';
import { I } from '../ui/icons';
import { scenesApi, storeApi } from '../api';
import { emojiForScene, fmtDate } from '../data';
import { SkuThumb } from '../components/SkuThumb';
import { SkuDetailDialog, type SkuDetailLike } from '../components/SkuDetailDialog';
import { VirtualShelfRenderer } from '../virtual-shelf/VirtualShelfRenderer';
import { unwrapSkuLct } from '../virtual-shelf/parseDifyOutput';

interface SnapshotShape {
  at?: string;
  summary?: string;
  items?: Array<{
    skuCode: string;
    skuName?: string | null;
    spec?: string | null;
    kind: 'add' | 'remove';
  }>;
  photos?: Array<{ url: string }>;
  /**
   * 诊断 snapshot 同时兼容新/旧 schema:
   *   新:paragraphCustomer = string[];paragraphStatus = StatusItem[];summary;paragraphSeason
   *   旧:paragraphCustomer / paragraphCompetition / paragraphStatus 都是单段 string
   * apply 时直接把当时的 diagnosis 整体序列化进 lastSnapshot,所以历史快照可能仍是旧 shape。
   * LastPage 在渲染时分别 narrow,任何一种都不该崩。
   */
  diagnosis?: {
    summary?: string;
    paragraphSeason?: string;
    paragraphCustomer?: string[] | string;
    paragraphCompetition?: string;
    paragraphStatus?: string | Array<{
      midCategory?: string;
      salesPct?: number;
      dailyAvgVolume?: number;
      headline?: string;
      description?: string;
    }>;
  } | null;
}

export function LastPage() {
  const { scene: sceneStr } = useParams({ from: '/shelves/scene/$scene/last' });
  const scene = Number(sceneStr);
  const navigate = useNavigate();

  const rtQ = useQuery({
    queryKey: ['scenes', scene, 'runtime'],
    queryFn: () => scenesApi.runtime(scene),
    // Dify virtual-shelf 工作流 5~10 分钟才完成;FlowPage 异步完成时跨页 invalidate
    // 在某些时序下打不到 LastPage,自己轮询最稳。轮询间隔 2 秒 —— 用户已经等 5-10 分钟了,
    // Dify 一返回就要立刻见到结果,而不是再忍 5 秒空窗。
    refetchInterval: (q) => {
      const status = (q.state.data as { virtualStatus?: string } | undefined)?.virtualStatus;
      return status === 'processing' ? 2_000 : false;
    },
  });
  const adjQ = useQuery({ queryKey: ['scenes', scene, 'adjustments'], queryFn: () => scenesApi.listAdjustments(scene, 1) });
  const scenesQ = useQuery({ queryKey: ['scenes', 'list'], queryFn: scenesApi.list });
  const def = scenesQ.data?.scenes.find((s) => s.scene === scene);
  // 面包架/烘焙类 → 木质货架外观 + 用 length(深度)当视觉高度(商品平放陈列)
  const isBakery = /面包|烘焙/.test(def?.name ?? '');

  const [detail, setDetail] = useState<SkuDetailLike | null>(null);

  const adj = adjQ.data?.adjustments[0];
  const rt = rtQ.data;
  const snap = (rt?.lastSnapshot ?? null) as SnapshotShape | null;
  const virtualReady = rt?.virtualStatus === 'completed';
  const virtualFailed = rt?.virtualStatus === 'failed';

  // 拉本店 SKU 维度,陈列图按 length_cm / height_cm 真实比例绘制商品。
  const storeSkusQ = useQuery({
    queryKey: ['store', 'skus', 'scene', scene],
    queryFn: () => storeApi.skus(scene),
    enabled: virtualReady,
    staleTime: 5 * 60_000,
  });
  const skuDims = useMemo(
    () => (storeSkusQ.data?.skus ?? []).map((s) => ({
      skuCode: s.skuCode,
      depth: s.lengthCm,
      height: s.heightCm,
    })),
    [storeSkusQ.data],
  );

  // V028: virtualRawOutputs 现在被后端包成 { raw: <Dify outputs>, parsed: <extracted> }。
  // 兼容老格式(直接是 Dify outputs)做 unwrap。
  const virtualOutputs = (() => {
    const v = rt?.virtualRawOutputs as Record<string, unknown> | null | undefined;
    if (!v) return null;
    if ('raw' in v && v.raw && typeof v.raw === 'object') return v.raw as Record<string, unknown>;
    return v;
  })();

  // 从 sku_lct 推每个货架的宽度(cm):取每个 shelf_id 上所有 end_x 的最大值并向上取整
  // 没有真实 store_scene_shelves 的 widths 兜底;context.shelfWidths 留空会默认 [120] 导致比例失真
  const shelfWidths = (() => {
    const raw = virtualOutputs;
    if (!raw) return [120];
    const groups = unwrapSkuLct(raw.sku_lct);
    const maxByShelf = new Map<number, number>();
    for (const g of groups) {
      for (const s of g.skus ?? []) {
        const cur = maxByShelf.get(s.shelf_id) ?? 0;
        if (s.end_x > cur) maxByShelf.set(s.shelf_id, s.end_x);
      }
    }
    const sorted = Array.from(maxByShelf.entries()).sort((a, b) => a[0] - b[0]).map(([, w]) => Math.ceil(w));
    return sorted.length ? sorted : [120];
  })();

  if (!adj && !snap) {
    return (
      <ScreenWrap>
        <AppBar
          title="上一次调改"
          subtitle={`${emojiForScene(scene)} ${def?.name ?? ''}`}
          onBack={() => navigate({ to: '/shelves/scene/$scene', params: { scene: sceneStr } })}
        />
        <div style={{ padding: 32, textAlign: 'center', color: TOKENS.inkMuted }}>
          还没有调改记录
        </div>
      </ScreenWrap>
    );
  }

  // items：优先用快照里的，否则用 store_scene_adjustments
  const items = snap?.items?.length
    ? snap.items
    : (adj?.items ?? []).map((it) => ({
        skuCode: it.skuCode,
        skuName: it.productName ?? null,
        spec: null,
        kind: it.action,
      }));
  const up = items.filter((i) => i.kind === 'add');
  const down = items.filter((i) => i.kind === 'remove');
  const at = snap?.at ?? adj?.triggeredAt;
  const summaryText = snap?.summary ?? adj?.summaryText ?? '调改';
  const photos = snap?.photos ?? [];
  const diagnosis = snap?.diagnosis ?? null;

  return (
    <ScreenWrap>
      <AppBar
        title="上一次调改"
        subtitle={`${def?.name ?? ''}${at ? ` · ${fmtDate(at)}` : ''}`}
        onBack={() => navigate({ to: '/shelves/scene/$scene', params: { scene: sceneStr } })}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card pad={14} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, background: TOKENS.greenSoft, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{I.Check({ size: 20, color: TOKENS.green })}</div>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: TOKENS.ink }}>{summaryText}</div>
            {at && <div style={{ fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 2 }}>{fmtDate(at)} 应用</div>}
          </div>
        </Card>

        {photos.length > 0 && (
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkMuted, letterSpacing: 1, margin: '2px 2px 8px' }}>当时的货架照片</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {photos.map((p, i) => (
                <img
                  key={i}
                  src={p.url}
                  alt={`货架照片 ${i + 1}`}
                  style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 12, background: TOKENS.bg }}
                />
              ))}
            </div>
          </div>
        )}

        {diagnosis && (() => {
          // 把可能的旧 string 字段归一化为统一渲染数据
          const customers: string[] = Array.isArray(diagnosis.paragraphCustomer)
            ? diagnosis.paragraphCustomer
            : typeof diagnosis.paragraphCustomer === 'string'
              ? diagnosis.paragraphCustomer.split(/[、,，;；\n]+/).map((s) => s.trim()).filter(Boolean)
              : [];
          const statusItems = Array.isArray(diagnosis.paragraphStatus) ? diagnosis.paragraphStatus : [];
          const legacyStatusText = typeof diagnosis.paragraphStatus === 'string' ? diagnosis.paragraphStatus : '';
          const legacyCompetition = typeof diagnosis.paragraphCompetition === 'string' ? diagnosis.paragraphCompetition : '';
          const hasAny =
            diagnosis.summary || diagnosis.paragraphSeason ||
            customers.length > 0 || statusItems.length > 0 ||
            legacyStatusText || legacyCompetition;
          if (!hasAny) return null;
          return (
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkMuted, letterSpacing: 1, margin: '2px 2px 8px' }}>当时的诊断结论</div>
              <Card pad={14}>
                {diagnosis.summary && (
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: TOKENS.ink, lineHeight: 1.55 }}>
                    {diagnosis.summary}
                  </div>
                )}
                {diagnosis.paragraphSeason && (
                  <div style={{
                    fontSize: 12.5, color: TOKENS.inkSoft, lineHeight: 1.7,
                    marginTop: diagnosis.summary ? 6 : 0,
                  }}>
                    {diagnosis.paragraphSeason}
                  </div>
                )}
                {customers.length > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {customers.map((c, i) => (
                      <span key={`${i}-${c}`} style={{
                        display: 'inline-flex', alignItems: 'center',
                        padding: '4px 10px', borderRadius: 14,
                        background: '#f1ece4', color: TOKENS.inkSoft,
                        fontSize: 12, fontWeight: 700, lineHeight: 1.3,
                      }}>{c}</span>
                    ))}
                  </div>
                )}
                {statusItems.length > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {statusItems.map((item, i) => (
                      <div key={`${i}-${item.midCategory ?? ''}`} style={{
                        borderTop: `1px solid ${TOKENS.lineSoft}`, paddingTop: 8,
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: TOKENS.ink }}>
                          {item.midCategory ?? ''}{item.midCategory && item.headline ? ' · ' : ''}{item.headline ?? ''}
                        </div>
                        {item.description && (
                          <div style={{ fontSize: 12.5, color: TOKENS.inkSoft, lineHeight: 1.7, marginTop: 4 }}>
                            {item.description}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {/* 兼容旧 schema:paragraphCompetition/paragraphStatus 是单段 string 时直接当文本展示 */}
                {legacyCompetition && (
                  <div style={{
                    marginTop: 10, paddingTop: 8, borderTop: `1px solid ${TOKENS.lineSoft}`,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: TOKENS.red, marginBottom: 4 }}>竞争分析</div>
                    <div style={{ fontSize: 12.5, color: TOKENS.ink, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{legacyCompetition}</div>
                  </div>
                )}
                {legacyStatusText && (
                  <div style={{
                    marginTop: 10, paddingTop: 8, borderTop: `1px solid ${TOKENS.lineSoft}`,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: TOKENS.red, marginBottom: 4 }}>货架现状</div>
                    <div style={{ fontSize: 12.5, color: TOKENS.ink, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{legacyStatusText}</div>
                  </div>
                )}
              </Card>
            </div>
          );
        })()}

        <div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkMuted, letterSpacing: 1, margin: '2px 2px 8px' }}>应用的调改清单</div>
          <Card pad={14}>
            {[
              { title: '上架', list: up,   color: TOKENS.green },
              { title: '停止进货', list: down, color: TOKENS.red },
            ].map((g, gi) => g.list.length > 0 && (
              <div key={g.title} style={{ marginTop: gi > 0 ? 14 : 0 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: g.color, marginBottom: 8 }}>{g.title}（{g.list.length}）</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {g.list.map((it, i) => (
                    <button
                      key={i}
                      onClick={() => setDetail({
                        skuCode: it.skuCode,
                        productName: it.skuName ?? undefined,
                        spec: it.spec ?? undefined,
                      })}
                      style={{
                        appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit',
                        width: '100%', textAlign: 'left', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 9, padding: 0,
                      }}
                    >
                      <SkuThumb skuCode={it.skuCode} size={36} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: TOKENS.ink,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it.skuName ?? it.skuCode}
                        {it.spec && <span style={{ fontSize: 11, color: TOKENS.inkMuted, marginLeft: 6 }}>{it.spec}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        </div>

        <div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: TOKENS.inkMuted, letterSpacing: 1, margin: '2px 2px 8px' }}>调改后的陈列示意图</div>
          {virtualFailed ? (
            <Card pad={18} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: TOKENS.red }}>陈列示意图生成失败</div>
              <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginTop: 5 }}>稍后回到这里再看，或重新发起调改触发生成</div>
            </Card>
          ) : !virtualReady ? (
            <Card pad={18} style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center' }}><Spin size={30} /></div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: TOKENS.ink, marginTop: 12 }}>正在生成陈列示意图…</div>
              <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginTop: 5 }}>通常 5~10 分钟，生成好会直接显示在这里</div>
              <div style={{ marginTop: 14, height: 6, borderRadius: 3, background: TOKENS.bgWarm, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '40%', borderRadius: 3, background: TOKENS.red, animation: 'shv-progress 1.6s ease-in-out infinite' }} />
              </div>
            </Card>
          ) : (
            <Card pad={10}>
              <VirtualShelfRenderer
                rawOutputs={virtualOutputs}
                context={{
                  shelfWidths,
                  // 把本次"上架"的 SKU codes 喂给 parser，让 isNewListing 真能被点亮
                  newListedCodes: up.map((i) => i.skuCode),
                  useLengthAsHeight: isBakery,
                }}
                skus={skuDims}
                variant={isBakery ? 'wooden' : 'fridge'}
              />
            </Card>
          )}
        </div>

        <GhostBtn onClick={() => navigate({ to: '/shelves/scene/$scene', params: { scene: sceneStr } })} style={{ marginTop: 8 }}>
          返回工作台
        </GhostBtn>
      </div>

      <SkuDetailDialog sku={detail} onClose={() => setDetail(null)} />
    </ScreenWrap>
  );
}
