/**
 * 选品 · 调改效果追踪
 *
 * 列出该场景的全部调改记录(来自 store_scene_adjustments),每条卡显示:
 *   - 摘要 + 时间 + 上下架计数 + 触发人
 *   - 效果角标:满 14 天且窗口内有快照 → 销量Δ% + 销售额Δ%(场景维度聚合)
 *               不足条件 → "数据积累中"
 * effect 字段由 backend listAdjustments 同步附带,见 scene.service.ts:computeAdjustmentEffects。
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AppBar, Card, Chip, ScreenWrap, Spin } from '../ui/primitives';
import { TOKENS } from '../ui/tokens';
import { I } from '../ui/icons';
import { scenesApi, type AdjustmentEffect } from '../api';
import { emojiForScene, fmtDate } from '../data';
import { SkuThumb } from '../components/SkuThumb';
import { SkuDetailDialog, type SkuDetailLike } from '../components/SkuDetailDialog';

export function RecordsPage() {
  const { scene: sceneStr } = useParams({ from: '/shelves/scene/$scene/records' });
  const scene = Number(sceneStr);
  const navigate = useNavigate();

  const listQ = useQuery({
    queryKey: ['scenes', scene, 'adjustments'],
    queryFn: () => scenesApi.listAdjustments(scene),
  });
  const scenesQ = useQuery({ queryKey: ['scenes', 'list'], queryFn: scenesApi.list });
  const def = scenesQ.data?.scenes.find((s) => s.scene === scene);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkuDetailLike | null>(null);
  const records = listQ.data?.adjustments ?? [];

  // 滚动容器 + 每张卡的 ref;展开时把整张卡(包含展开列表)滚到视口里,
  // 避免用户展开下面的卡时只看到一行标题、看不到刚展开的清单。
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  useEffect(() => {
    if (!openId) return;
    // 等下一帧,让展开的 DOM 先渲染、量到真实高度再滚
    const t = requestAnimationFrame(() => {
      const card = cardRefs.current.get(openId);
      const scroller = scrollerRef.current;
      if (!card || !scroller) return;
      const cardRect = card.getBoundingClientRect();
      const scRect = scroller.getBoundingClientRect();
      // 若卡片底部在视口外,把卡顶滚到容器顶部往下 8px 处;若卡顶在视口外(上滚),也对齐到顶
      const cardBottomOverflow = cardRect.bottom - scRect.bottom;
      const cardTopOverflow = scRect.top - cardRect.top;
      if (cardBottomOverflow > 0 || cardTopOverflow > 0) {
        const target = scroller.scrollTop + (cardRect.top - scRect.top) - 8;
        scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      }
    });
    return () => cancelAnimationFrame(t);
  }, [openId]);

  const goBack = () => void navigate({ to: '/shelves/scene/$scene', params: { scene: sceneStr } });

  return (
    <ScreenWrap>
      <AppBar title="调改效果追踪" subtitle={`${emojiForScene(scene)} ${def?.name ?? ''}`} onBack={goBack} />
      {/* 双层结构:外层只管 flex:1 拿可用高 + 出了就滚,内层只管 flex column 堆叠。
          一层同时挂 flex column + overflow:auto 时,所有子元素默认 flex-shrink:1 → 装不下
          时会优先压扁每张卡片(展开内容看不全 / chip 变形),而不是触发滚动。 */}
      <div ref={scrollerRef} style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {listQ.isLoading ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <Spin size={26} />
            <div style={{ fontSize: 12.5, color: TOKENS.inkMuted, marginTop: 10 }}>正在读取调改记录…</div>
          </div>
        ) : listQ.isError ? (
          <div style={{
            border: `1.5px solid ${TOKENS.redSoft}`, background: TOKENS.redSoft,
            borderRadius: 14, padding: 18, textAlign: 'center', color: TOKENS.red, fontSize: 13, lineHeight: 1.7,
          }}>
            读取调改记录失败,请下拉或稍后重试。
            <button
              onClick={() => listQ.refetch()}
              style={{
                display: 'block', margin: '10px auto 0', appearance: 'none', border: 0,
                background: '#fff', color: TOKENS.red, borderRadius: 12,
                padding: '6px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              }}
            >重试</button>
          </div>
        ) : records.length === 0 ? (
          <div style={{
            border: `1.5px dashed ${TOKENS.line}`, borderRadius: 14,
            padding: '40px 16px', textAlign: 'center', color: TOKENS.inkMuted, fontSize: 13, lineHeight: 1.7,
          }}>
            还没有调改记录。<br />完成第一次调改后，这里会显示每次调改和之后的销量变化。
          </div>
        ) : records.map((rec) => {
          const open = openId === rec.id;
          const up = rec.items.filter((i) => i.action === 'add');
          const down = rec.items.filter((i) => i.action === 'remove');
          return (
            <Card
              key={rec.id}
              pad={0}
              style={{ overflow: 'hidden' }}
            >
              <div ref={(el) => {
                if (el) cardRefs.current.set(rec.id, el);
                else cardRefs.current.delete(rec.id);
              }}>
                <button onClick={() => setOpenId(open ? null : rec.id)} style={{
                  appearance: 'none', border: 0, background: 'transparent', width: '100%', textAlign: 'left',
                  padding: 14, cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: TOKENS.ink }}>{rec.summaryText ?? '调改'}</div>
                    <div style={{
                      fontSize: 11.5, color: TOKENS.inkMuted, marginTop: 3,
                      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                    }}>
                      <span>{fmtDate(rec.triggeredAt)}</span>
                      {(rec.addedCount > 0 || rec.removedCount > 0) && (
                        <span style={{ display: 'inline-flex', gap: 4 }}>
                          {rec.addedCount > 0 && (
                            <span style={{ color: TOKENS.green, fontWeight: 700 }}>·上 {rec.addedCount}</span>
                          )}
                          {rec.removedCount > 0 && (
                            <span style={{ color: TOKENS.red, fontWeight: 700 }}>·下 {rec.removedCount}</span>
                          )}
                        </span>
                      )}
                      {rec.triggeredByDisplay && (
                        <span style={{ color: TOKENS.inkMuted }}>· {rec.triggeredByDisplay}</span>
                      )}
                    </div>
                  </div>
                  <EffectBadge effect={rec.effect} />
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s ease',
                  }}>
                    {I.ChevronD({ size: 16, color: TOKENS.inkMuted })}
                  </span>
                </button>
                {open && (
                  <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${TOKENS.lineSoft}` }}>
                    {up.length === 0 && down.length === 0 ? (
                      <div style={{ fontSize: 12.5, color: TOKENS.inkMuted, padding: '12px 0' }}>
                        没有具体的上下架明细。
                      </div>
                    ) : (
                      [
                        { title: '上架', list: up,   color: TOKENS.green },
                        { title: '停止进货', list: down, color: TOKENS.red },
                      ].map((g) => g.list.length > 0 && (
                        <div key={g.title} style={{ marginTop: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: g.color, marginBottom: 8 }}>{g.title}（{g.list.length}）</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                            {g.list.map((it) => (
                              <button
                                key={`${it.skuCode}-${it.action}`}
                                onClick={() => setDetail({
                                  skuCode: it.skuCode,
                                  productName: it.productName ?? undefined,
                                })}
                                style={{
                                  appearance: 'none', border: 0, background: 'transparent', fontFamily: 'inherit',
                                  width: '100%', textAlign: 'left', cursor: 'pointer',
                                  display: 'flex', alignItems: 'center', gap: 9, padding: 0,
                                }}
                              >
                                <SkuThumb skuCode={it.skuCode} size={34} />
                                <span style={{
                                  flex: 1, minWidth: 0, fontSize: 13, color: TOKENS.ink,
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>{it.productName ?? it.skuCode}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
        </div>
      </div>

      <SkuDetailDialog sku={detail} onClose={() => setDetail(null)} />
    </ScreenWrap>
  );
}

// ---- 效果角标 -----------------------------------------------------------
//
// effect 状态机:
//   - undefined / accumulating → 灰色 chip "数据积累中"(老 UI 一致)
//   - computed → 两行小字,销量Δ% / 销售额Δ%,正绿 / 负红 / 平灰 / null "—"
// 字号 / 排版有意做小,在卡顶部按钮内右侧约 ~88px 宽空间能贴下不撑高。
function EffectBadge({ effect }: { effect?: AdjustmentEffect }) {
  if (!effect || effect.status === 'accumulating') {
    return <Chip tone="gray">数据积累中</Chip>;
  }
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2,
      fontVariantNumeric: 'tabular-nums', letterSpacing: 0.2,
    }}>
      <DeltaLine label="销量" pct={effect.qtyDeltaPct} />
      <DeltaLine label="销额" pct={effect.amtDeltaPct} />
    </div>
  );
}

function DeltaLine({ label, pct }: { label: string; pct: number | null }) {
  const color = pct == null
    ? TOKENS.inkMuted
    : pct > 0 ? TOKENS.green : pct < 0 ? TOKENS.red : TOKENS.inkMuted;
  const text = pct == null
    ? '—'
    : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color, lineHeight: 1.2, whiteSpace: 'nowrap' }}>
      <span style={{ color: TOKENS.inkMuted, fontWeight: 600, marginRight: 4 }}>{label}</span>
      {text}
    </div>
  );
}
