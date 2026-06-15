import * as React from 'react';
import { TOKENS } from '../tokens';
import { Icon } from '../icons';
import { loadRecent, countThisWeek, type RecentPoster } from '../recent';
// 原 repo 用 useServerFn 包装 server function，统一应用里 shim 是普通 async fn，
// 直接调用即可，给一个同名 wrapper 保留下面这一行 useServerFn() 用法不变。
const useServerFn = <T extends (...args: never[]) => unknown>(fn: T): T => fn;
import { getPersonalizedPromotions } from '@/lib/promotions.functions';
import { type SelectedPromotion } from '../PromotionContext';
import { RecentDrawer } from '../RecentDrawer';
import { JobsBadge } from '../JobsBadge';
import { ProductImg } from '../ProductImg';
import { deriveBest, loadPromoMode, savePromoMode, type PromoMode, type DealOptionLike, type DerivedBest } from '../lib/promoMode';
import { useGuide, hasSeenGuide } from '../GuideContext';
import { StackRuleHint } from '../StackRuleHint';
import { stripSpec } from '@/utils/promoDisplayText';



type CategoryItem = {
  sku: string;
  product_name: string;
  unit: string | null;
  original_price: number | null;
  category: string | null;
  best_label: string | null;
  best_qty: number | null;
  best_total: number | null;
  best_effective_price: number | null;
  best_saving_percent: number | null;
  display_text: string | null;
  best_valid_from: string | null;
  best_valid_to: string | null;
  best_valid_dates: string[] | null;
  all_options: DealOptionLike[] | null;
  // 可混搭组字段（仅当 is_group=true）
  is_group?: boolean;
  group_id?: string | null;
  brand_label?: string | null;
  group_members?: Array<{ sku: string; productName: string }> | null;
  /** 组级最优叠券若只覆盖部分成员，记录适用的 SKU；null/undefined = 全员适用 */
  best_applies_to_skus?: string[] | null;
};



const MAX_BATCH = 10;


function fmtMD(d: string | null | undefined): string | null {
  if (!d) return null;
  const m = d.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return d;
  return `${Number(m[1])}.${Number(m[2])}`;
}

function validityBadge(it: CategoryItem, best: DerivedBest): { text: string; today: boolean } | null {
  const todayISO = new Date().toISOString().slice(0, 10);
  if (best.validDates?.length) {
    const today = best.validDates.includes(todayISO);
    const text = `仅 ${best.validDates.map(fmtMD).join('、')}`;
    return { text, today };
  }
  if (best.label.includes('会员日')) {
    const today = new Date().getDay() === 2;
    return { text: '周二限定', today };
  }
  if (best.validFrom && best.validTo) {
    const today = best.validFrom <= todayISO && best.validTo >= todayISO;
    return { text: `${fmtMD(best.validFrom)}–${fmtMD(best.validTo)}`, today };
  }
  return null;
}

function ProductCard({
  it, best, accent, checked, onToggle, disabled,
}: {
  it: CategoryItem; best: DerivedBest | null; accent: string;
  checked: boolean; onToggle: (it: CategoryItem) => void;
  disabled?: boolean;
}) {
  // 无会员价档时的灰显态
  if (!best || disabled) {
    const orig = it.original_price ?? 0;
    return (
      <div style={{
        background: '#fafafa', borderRadius: 14, padding: 12,
        boxShadow: TOKENS.shadow1, display: 'flex', gap: 12,
        position: 'relative', border: '2px solid transparent', opacity: 0.6,
      }}>
        <ProductImg sku={it.sku} size={76} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: TOKENS.ink,
            marginBottom: 2, lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>{it.product_name}</div>
          <div style={{
            fontSize: 11, color: TOKENS.inkMuted, marginBottom: 4,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>编号 {it.sku}</div>

          {orig > 0 && (
            <div style={{ fontSize: 12, color: TOKENS.inkMuted, marginBottom: 6 }}>
              原价 ¥{orig.toFixed(2)}/{it.unit ?? ''}
            </div>
          )}
          <div>
            <span style={{ fontSize: 10, color: TOKENS.inkMuted, background: '#eee', padding: '2px 6px', borderRadius: 8, fontWeight: 600 }}>
              此商品无会员价
            </span>
          </div>
        </div>
      </div>
    );
  }
  const badge = validityBadge(it, best);
  const eff = best.effectivePrice;
  const orig = it.original_price ?? 0;
  const save = Math.round(best.savingPercent);
  return (
    <div onClick={() => onToggle(it)} style={{
      background: '#fff', borderRadius: 14, padding: 12,
      boxShadow: TOKENS.shadow1, display: 'flex', gap: 12,
      cursor: 'pointer', position: 'relative',
      border: checked ? `2px solid ${accent}` : '2px solid transparent',
      transition: 'border-color 0.15s',
    }}>
      {/* checkbox */}
      <div style={{
        position: 'absolute', top: 10, left: 10, zIndex: 2,
        width: 22, height: 22, borderRadius: '50%',
        background: checked ? accent : 'rgba(255,255,255,0.92)',
        border: checked ? `2px solid ${accent}` : `1.5px solid ${TOKENS.line}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
      }}>
        {checked && <Icon.Check size={14} color="#fff" />}
      </div>
      <ProductImg sku={it.sku} size={76} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{
          position: 'absolute', top: 10, right: 10,
          background: accent, color: '#fff', fontWeight: 800,
          fontSize: 11, padding: '3px 7px', borderRadius: 8,
        }}>-{save}%</div>
        <div style={{
          fontSize: 14, fontWeight: 700, color: TOKENS.ink,
          marginBottom: 2, paddingRight: 50, lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>{it.product_name}</div>
        <div style={{
          fontSize: 11, color: TOKENS.inkMuted, marginBottom: 4,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>编号 {it.sku}</div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: accent }}>¥{eff.toFixed(2)}</span>
          {orig > 0 && (
            <span style={{ fontSize: 11, color: TOKENS.inkMuted, textDecoration: 'line-through' }}>
              ¥{orig.toFixed(2)}
            </span>
          )}
          <span style={{ fontSize: 11, color: TOKENS.inkSoft }}>/{it.unit ?? ''}</span>
          {best.qty > 1 && (
            <span style={{ fontSize: 11, color: TOKENS.inkSoft }}>· 需购 {best.qty}{it.unit ?? ''}</span>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#0a7d3a', background: '#e6f6ec', padding: '2px 6px', borderRadius: 8, fontWeight: 600 }}>
            {best.label}
          </span>
          {badge && (
            <span style={{
              fontSize: 10, padding: '2px 6px', borderRadius: 8, fontWeight: 600,
              color: badge.today ? '#fff' : '#8a5a00',
              background: badge.today ? '#ff8c1a' : '#fff4e6',
            }}>{badge.today ? '今日有效 · ' : ''}{badge.text}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function toSelectedPromotion(it: CategoryItem, best: DerivedBest): SelectedPromotion {
  return {
    sku: it.sku,
    productName: it.product_name,
    category: it.category,
    displayText: best.displayText,
    unit: it.unit,
    originalPrice: it.original_price,
    bestEffectivePrice: best.effectivePrice,
    bestSavingPercent: best.savingPercent,
    groupId: it.is_group ? it.group_id ?? null : null,
    brandLabel: it.is_group ? it.brand_label ?? null : null,
    groupMembers: it.is_group ? (it.group_members ?? null) : null,
  };
}

/** 可混搭组卡片：整行宽，左侧 2×2 小图，右侧文案 + 「可混搭 · 共 N 款」 */
function GroupCard({
  it, best, accent, checked, onToggle,
}: {
  it: CategoryItem; best: DerivedBest; accent: string;
  checked: boolean; onToggle: (it: CategoryItem) => void;
}) {
  const members = it.group_members ?? [];
  const visible = members.slice(0, 4);
  const more = members.length - visible.length;
  const eff = best.effectivePrice;
  const orig = it.original_price ?? 0;
  const save = Math.round(best.savingPercent);
  return (
    <div onClick={() => onToggle(it)} style={{
      background: '#fff', borderRadius: 14, padding: 12,
      boxShadow: TOKENS.shadow1, display: 'flex', gap: 12,
      cursor: 'pointer', position: 'relative',
      border: checked ? `2px solid ${accent}` : `2px solid ${accent}33`,
      transition: 'border-color 0.15s',
    }}>
      <div style={{
        position: 'absolute', top: 10, left: 10, zIndex: 2,
        width: 22, height: 22, borderRadius: '50%',
        background: checked ? accent : 'rgba(255,255,255,0.92)',
        border: checked ? `2px solid ${accent}` : `1.5px solid ${TOKENS.line}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
      }}>{checked && <Icon.Check size={14} color="#fff" />}</div>

      {/* 2x2 grid */}
      <div style={{
        width: 88, height: 88, flexShrink: 0,
        display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr',
        gap: 2, borderRadius: 10, overflow: 'hidden', background: '#f0f0f3',
        position: 'relative',
      }}>
        {visible.map((m) => (
          <ProductImg key={m.sku} sku={m.sku} size={43} radius={0} />
        ))}
        {visible.length < 4 && Array.from({ length: 4 - visible.length }).map((_, i) => (
          <div key={`pad-${i}`} style={{ background: '#fafafa' }} />
        ))}
        {more > 0 && (
          <div style={{
            position: 'absolute', right: 4, bottom: 4,
            background: 'rgba(0,0,0,0.72)', color: '#fff',
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 8,
          }}>+{more}</div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{
          position: 'absolute', top: 10, right: 10,
          background: accent, color: '#fff', fontWeight: 800,
          fontSize: 11, padding: '3px 7px', borderRadius: 8,
        }}>-{save}%</div>
        {(() => {
          const firstName = stripSpec(members[0]?.productName ?? it.product_name);
          const extra = Math.max(0, members.length - 1);
          return (
            <div style={{
              fontSize: 14, fontWeight: 800, color: TOKENS.ink,
              marginBottom: 2, paddingRight: 50, lineHeight: 1.3,
              overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
              WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            }}>
              {firstName}
              {extra > 0 && (
                <span style={{ fontSize: 12, fontWeight: 500, color: TOKENS.inkSoft, marginLeft: 4 }}>
                  +{extra} 款
                </span>
              )}
            </div>
          );
        })()}
        <div style={{
          fontSize: 10, color: '#fff', background: accent,
          padding: '2px 6px', borderRadius: 6, fontWeight: 700,
          alignSelf: 'flex-start', marginBottom: 6,
        }}>可混搭 · 共 {members.length} 款</div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: accent }}>¥{eff.toFixed(2)}</span>
          {orig > 0 && (
            <span style={{ fontSize: 11, color: TOKENS.inkMuted, textDecoration: 'line-through' }}>
              ¥{orig.toFixed(2)}
            </span>
          )}
          <span style={{ fontSize: 11, color: TOKENS.inkSoft }}>/{it.unit ?? ''}</span>
          {best.qty > 1 && (
            <span style={{ fontSize: 11, color: TOKENS.inkSoft }}>· 需购 {best.qty}{it.unit ?? ''}</span>
          )}
        </div>
        {(() => {
          const badge = validityBadge(it, best);
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#0a7d3a', background: '#e6f6ec', padding: '2px 6px', borderRadius: 8, fontWeight: 600 }}>
                {best.label}
              </span>
              {badge && (
                <span style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 8, fontWeight: 600,
                  color: badge.today ? '#fff' : '#8a5a00',
                  background: badge.today ? '#ff8c1a' : '#fff4e6',
                }}>{badge.today ? '今日有效 · ' : ''}{badge.text}</span>
              )}
            </div>
          );
        })()}
        {(() => {
          const applies = it.best_applies_to_skus;
          const total = members.length;
          if (!applies || applies.length === 0 || applies.length >= total) return null;
          const skuToName = new Map(members.map((m) => [m.sku, stripSpec(m.productName) || m.productName]));
          const names = applies.map((s) => skuToName.get(s) ?? s);
          const shown = names.slice(0, 2).join('、');
          const extra = names.length > 2 ? `等 ${names.length} 款` : '';
          return (
            <div style={{
              marginTop: 4, fontSize: 10, color: TOKENS.inkSoft, lineHeight: 1.4,
            }}>
              该叠券仅适用：{shown}{extra}
            </div>
          );
        })()}

      </div>
    </div>
  );
}


export function ScreenHome({ accent, onStart, onStartBatch, onShowGuide, onToast }: {
  accent: string;
  onStart: (promo?: SelectedPromotion) => void;
  onStartBatch: (list: SelectedPromotion[]) => void;
  onShowGuide: () => void;
  onToast: (text: string) => void;
}) {
  const [recent, setRecent] = React.useState<RecentPoster[]>([]);
  const [categories, setCategories] = React.useState<Array<{ name: string; items: CategoryItem[] }>>([]);
  const [activeCat, setActiveCat] = React.useState<string | null>(null);
  const [recoState, setRecoState] = React.useState<'loading' | 'ok' | 'empty' | 'error'>('loading');
  const [showRecent, setShowRecent] = React.useState(false);
  const [onlyValid, setOnlyValid] = React.useState(true);
  const [onlyNoReturn, setOnlyNoReturn] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [promoMode, setPromoMode] = React.useState<PromoMode>('stack');
  // sku -> SelectedPromotion (snapshot across category switches)
  const [picked, setPicked] = React.useState<Map<string, SelectedPromotion>>(new Map());

  const fetchReco = useServerFn(getPersonalizedPromotions);
  const guide = useGuide();

  React.useEffect(() => { setRecent(loadRecent()); setPromoMode(loadPromoMode()); }, []);

  // 首次进入 Home 且推荐已加载完成时，自动启动新手引导
  React.useEffect(() => {
    if (recoState !== 'ok') return;
    if (hasSeenGuide()) return;
    if (guide.isActive) return;
    const t = setTimeout(() => guide.start(), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoState]);


  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res: any = await fetchReco();
        if (cancelled) return;
        const cats = (res?.categories ?? []) as Array<{ name: string; items: CategoryItem[] }>;
        if (cats.length === 0) { setRecoState('empty'); return; }
        setCategories(cats);
        setActiveCat(cats[0].name);
        setRecoState('ok');
      } catch (e) {
        console.error('[reco]', e);
        if (!cancelled) setRecoState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [fetchReco]);

  // 派生：sku -> DerivedBest|null
  // 当开启"今明有效"时，best 也按"模式候选池中今/明仍有效的最佳一条"挑选，
  // 这样卡片显示的折扣力度/折后价就是实际可用的活动，并且两个模式的有效性
  // 判定口径一致（item 在该模式下是否有任意今/明有效项）。
  const bestMap = React.useMemo(() => {
    const m = new Map<string, DerivedBest | null>();
    for (const c of categories) for (const it of c.items) {
      m.set(it.sku, deriveBest(it, promoMode, { validOnly: onlyValid }));
    }
    return m;
  }, [categories, promoMode, onlyValid]);

  const weekCount = countThisWeek(recent);
  const visibleCategories = React.useMemo(() => {
    // 不再做力度筛选：展示该分类下全部商品；按当前模式的折扣力度降序，
    // 力度相同时按当前模式的折后价降序排列；没有当前模式价格的排在最后。
    const pickPerCategory = (items: CategoryItem[]) => {
      const arr = items.map(it => ({ it, best: bestMap.get(it.sku) ?? null }));
      arr.sort((a, b) => {
        const ag = a.it.is_group ? 1 : 0;
        const bg = b.it.is_group ? 1 : 0;
        if (bg !== ag) return bg - ag;          // 凑单组永远排前
        const ap = a.best?.savingPercent ?? -Infinity;
        const bp = b.best?.savingPercent ?? -Infinity;
        if (bp !== ap) return bp - ap;
        const apr = a.best?.effectivePrice ?? -Infinity;
        const bpr = b.best?.effectivePrice ?? -Infinity;
        return bpr - apr;
      });
      return arr.map(x => x.it);
    };
    const base = categories
      .map(c => ({ name: c.name, items: pickPerCategory(c.items) }))
      .filter(c => c.items.length > 0);

    let result = base;
    if (onlyValid) {
      result = result
        .map(c => ({ name: c.name, items: c.items.filter(it => bestMap.get(it.sku) != null) }))
        .filter(c => c.items.length > 0);
    }
    if (onlyNoReturn) {
      result = result
        .map(c => ({ name: c.name, items: c.items.filter(it => /^N/.test(it.product_name ?? '')) }))
        .filter(c => c.items.length > 0);
    }
    // Synthetic "超优惠" category: all items across categories with discount >= 60% (≤ 4 折)
    const seen = new Set<string>();
    const superDeals: CategoryItem[] = [];
    for (const c of result) {
      for (const it of c.items) {
        if (seen.has(it.sku)) continue;
        const b = bestMap.get(it.sku);
        if (b && (b.savingPercent ?? 0) >= 60) {
          seen.add(it.sku);
          superDeals.push(it);
        }
      }
    }
    const sortedSuper = pickPerCategory(superDeals);
    if (sortedSuper.length > 0) {
      result = [{ name: '超优惠', items: sortedSuper }, ...result];
    }
    return result;
  }, [categories, onlyValid, onlyNoReturn, bestMap]);


  React.useEffect(() => {
    if (recoState !== 'ok') return;
    if (visibleCategories.length === 0) return;
    if (!visibleCategories.find(c => c.name === activeCat)) {
      setActiveCat(visibleCategories[0].name);
    }
  }, [visibleCategories, activeCat, recoState]);
  const activeItems = visibleCategories.find(c => c.name === activeCat)?.items ?? [];



  const toggle = (it: CategoryItem) => {
    const best = bestMap.get(it.sku);
    if (!best) { onToast('此商品无会员价'); return; }
    setPicked(prev => {
      const next = new Map(prev);
      if (next.has(it.sku)) { next.delete(it.sku); return next; }
      if (next.size >= MAX_BATCH) { onToast(`最多选 ${MAX_BATCH} 个`); return prev; }
      next.set(it.sku, toSelectedPromotion(it, best));
      return next;
    });
  };

  // 切换模式时，把已选商品的 displayText/价格按新模式刷新；剔除新模式下无效的
  React.useEffect(() => {
    setPicked(prev => {
      if (prev.size === 0) return prev;
      const next = new Map<string, SelectedPromotion>();
      for (const [sku] of prev) {
        const cat = categories.find(c => c.items.some(i => i.sku === sku));
        const it = cat?.items.find(i => i.sku === sku);
        if (!it) continue;
        const best = deriveBest(it, promoMode);
        if (!best) continue;
        next.set(sku, toSelectedPromotion(it, best));
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoMode]);

  const setMode = (m: PromoMode) => { setPromoMode(m); savePromoMode(m); };



  const startBatch = () => {
    if (picked.size === 0) return;
    onStartBatch(Array.from(picked.values()));
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, background: TOKENS.bg,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      {/* padding-top 加到 84px：让标题和右侧按钮避开 BrandHeader 胶囊（mt-3 + h-14 ≈ 68px）。 */}
      <div style={{
        background: `linear-gradient(160deg, ${accent}, ${TOKENS.redDark})`,
        color: '#fff', padding: '84px 20px 28px', position: 'relative', overflow: 'hidden',
        flexShrink: 0,
      }}>
        <div style={{ position: 'absolute', top: -60, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 1 }}>促销海报设计师</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <button onClick={onShowGuide} aria-label="使用教程" style={{
                appearance: 'none', border: 0, padding: 0, cursor: 'pointer',
                width: 44, height: 44, borderRadius: 14,
                background: 'rgba(255,255,255,0.18)',
                color: '#fff', fontSize: 20, fontWeight: 800, fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>?</button>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', lineHeight: 1 }}>使用教程</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <button onClick={() => setShowRecent(true)} aria-label="历史记录" style={{
                appearance: 'none', border: 0, padding: 0, cursor: 'pointer',
                width: 44, height: 44, borderRadius: 14,
                background: 'rgba(255,255,255,0.18)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative',
              }}>
                <HistoryIcon size={22} color="#fff" />
                {weekCount > 0 && (
                  <div style={{
                    position: 'absolute', top: -4, right: -4,
                    minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                    background: TOKENS.yellow, color: TOKENS.ink,
                    fontSize: 10, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '2px solid #fff',
                  }}>{weekCount}</div>
                )}
              </button>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', lineHeight: 1 }}>历史记录</div>
            </div>
          </div>

        </div>
      </div>

      {/* Scroll area */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: picked.size > 0 ? 92 : 24 }}>
        {/* Direct-make shortcut */}
        <div style={{ padding: '0 16px' }}>
          <div onClick={() => onStart(undefined)} style={{
            background: '#fff', borderRadius: 16, padding: '14px 16px',
            boxShadow: TOKENS.shadow2, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, position: 'relative',
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: `linear-gradient(135deg, ${accent}, ${TOKENS.redDark})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              boxShadow: `0 6px 14px ${accent}40`,
            }}>
              <Icon.Camera size={22} color="#fff" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: TOKENS.ink, marginBottom: 2 }}>
                直接做海报
              </div>
              <div style={{ fontSize: 12, color: TOKENS.inkSoft }}>
                已经想好推什么？直接开拍
              </div>
            </div>
            <div style={{ transform: 'rotate(180deg)' }}>
              <Icon.Back size={18} color={TOKENS.inkMuted} />
            </div>
          </div>
        </div>



        {/* Pick promotions */}
        <div style={{ padding: '20px 16px 0' }}>
          <div style={{ marginBottom: 10, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: TOKENS.ink }}>选活动做海报</div>
              <div style={{ fontSize: 11, color: TOKENS.inkMuted, marginTop: 2 }}>
                勾选要做海报的商品，最多 {MAX_BATCH} 个
              </div>
            </div>
            {recoState === 'ok' && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <div data-guide="mode-toggle" style={{
                  display: 'inline-flex', padding: 3, borderRadius: 999,
                  background: '#eee9e1', border: `1px solid ${TOKENS.line}`,
                }}>
                  {([
                    { key: 'stack' as const, label: '允许叠券' },
                    { key: 'memberOnly' as const, label: '只用会员价' },
                  ]).map(opt => {
                    const active = promoMode === opt.key;
                    return (
                      <div key={opt.key} onClick={() => setMode(opt.key)} style={{
                        padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                        background: active ? '#fff' : 'transparent',
                        color: active ? accent : TOKENS.inkSoft,
                        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                      }}>{opt.label}</div>
                    );
                  })}
                </div>
                <StackRuleHint />
              </div>
            )}
          </div>




          {recoState === 'ok' && (
            <div data-guide="filter-bar" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
              {/* Search box */}
              <div style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6,
                background: '#fff', border: `1px solid ${query ? accent : TOKENS.line}`,
                borderRadius: 999, padding: '0 9px', height: 32,
                transition: 'border-color 0.15s',
              }}>
                <SearchIcon size={14} color={query ? accent : TOKENS.inkMuted} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜商品"
                  style={{
                    flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent',
                    fontSize: 12, color: TOKENS.ink, fontFamily: 'inherit', padding: 0,
                  }}
                />
                {query && (
                  <button onClick={() => setQuery('')} aria-label="清空" style={{
                    appearance: 'none', border: 0, background: 'transparent',
                    padding: 0, cursor: 'pointer',
                    width: 18, height: 18, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: TOKENS.inkMuted,
                  }}>
                    <Icon.Close size={12} color={TOKENS.inkMuted} />
                  </button>
                )}
              </div>
              <div onClick={() => setOnlyValid(v => !v)} style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 9px', borderRadius: 999, height: 28, boxSizing: 'border-box',
                background: onlyValid ? accent : '#fff',
                color: onlyValid ? '#fff' : TOKENS.inkSoft,
                border: `1px solid ${onlyValid ? accent : TOKENS.line}`,
                fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                whiteSpace: 'nowrap',
              }}>今明</div>
              <div onClick={() => setOnlyNoReturn(v => !v)} style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 9px', borderRadius: 999, height: 28, boxSizing: 'border-box',
                background: onlyNoReturn ? accent : '#fff',
                color: onlyNoReturn ? '#fff' : TOKENS.inkSoft,
                border: `1px solid ${onlyNoReturn ? accent : TOKENS.line}`,
                fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                whiteSpace: 'nowrap',
              }}>不可退</div>
            </div>
          )}


          {recoState === 'loading' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{
                  background: '#fff', borderRadius: 14, padding: 12,
                  boxShadow: TOKENS.shadow1, display: 'flex', gap: 12,
                  border: '2px solid transparent',
                }}>
                  <div style={{
                    width: 76, height: 76, borderRadius: 10, flexShrink: 0,
                    background: 'linear-gradient(90deg, #ececf0 0%, #f6f6f8 50%, #ececf0 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'homeSkeletonShimmer 1.2s ease-in-out infinite',
                  }} />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
                    <div style={{
                      height: 12, width: '80%', borderRadius: 6,
                      background: 'linear-gradient(90deg, #ececf0 0%, #f6f6f8 50%, #ececf0 100%)',
                      backgroundSize: '200% 100%',
                      animation: 'homeSkeletonShimmer 1.2s ease-in-out infinite',
                    }} />
                    <div style={{
                      height: 12, width: '55%', borderRadius: 6,
                      background: 'linear-gradient(90deg, #ececf0 0%, #f6f6f8 50%, #ececf0 100%)',
                      backgroundSize: '200% 100%',
                      animation: 'homeSkeletonShimmer 1.2s ease-in-out infinite',
                    }} />
                    <div style={{
                      height: 10, width: '35%', borderRadius: 5,
                      background: 'linear-gradient(90deg, #ececf0 0%, #f6f6f8 50%, #ececf0 100%)',
                      backgroundSize: '200% 100%',
                      animation: 'homeSkeletonShimmer 1.2s ease-in-out infinite',
                    }} />
                  </div>
                </div>
              ))}
              <style>{`@keyframes homeSkeletonShimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
            </div>
          )}
          {recoState === 'empty' && (
            <div style={{
              border: `1.5px dashed ${TOKENS.line}`, borderRadius: 12,
              padding: '24px 12px', textAlign: 'center', color: TOKENS.inkMuted, fontSize: 13,
            }}>本期暂无推荐</div>
          )}
          {recoState === 'error' && (
            <div style={{
              border: `1.5px dashed ${TOKENS.line}`, borderRadius: 12,
              padding: '24px 12px', textAlign: 'center', color: TOKENS.inkMuted, fontSize: 13,
            }}>推荐加载失败</div>
          )}

          {recoState === 'ok' && (() => {
            const q = query.trim().toLowerCase();
            if (q) {
              const matched: CategoryItem[] = [];
              for (const c of visibleCategories) {
                for (const it of c.items) {
                  if ((it.product_name ?? '').toLowerCase().includes(q)) matched.push(it);
                }
              }
              if (matched.length === 0) {
                return (
                  <div style={{
                    border: `1.5px dashed ${TOKENS.line}`, borderRadius: 12,
                    padding: '24px 12px', textAlign: 'center', color: TOKENS.inkMuted, fontSize: 13,
                  }}>没找到「{query}」相关商品</div>
                );
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, color: TOKENS.inkMuted, marginBottom: 2 }}>
                    找到 {matched.length} 个商品
                  </div>
                  {matched.map((it) => {
                    const b = bestMap.get(it.sku);
                    if (it.is_group && b) {
                      return <GroupCard key={it.sku} it={it} best={b} accent={accent}
                        checked={picked.has(it.sku)} onToggle={toggle} />;
                    }
                    return <ProductCard key={it.sku} it={it} best={b ?? null} accent={accent}
                      checked={picked.has(it.sku)} onToggle={toggle} />;
                  })}

                </div>
              );
            }
            if (visibleCategories.length === 0) {
              return (
                <div style={{
                  border: `1.5px dashed ${TOKENS.line}`, borderRadius: 12,
                  padding: '24px 12px', textAlign: 'center', color: TOKENS.inkMuted, fontSize: 13,
                }}>今日暂无有效促销</div>
              );
            }
            return (
              <>
                <div style={{
                  display: 'flex', gap: 8, overflowX: 'auto',
                  paddingBottom: 8, marginBottom: 10,
                  scrollbarWidth: 'none',
                }}>
                  {visibleCategories.map((c) => {
                    const active = c.name === activeCat;
                    return (
                      <div key={c.name} onClick={() => setActiveCat(c.name)} style={{
                        flexShrink: 0, cursor: 'pointer',
                        padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                        background: active ? accent : '#fff',
                        color: active ? '#fff' : TOKENS.inkSoft,
                        border: `1px solid ${active ? accent : TOKENS.line}`,
                        boxShadow: active ? `0 4px 10px ${accent}30` : 'none',
                        whiteSpace: 'nowrap',
                      }}>
                        {c.name}
                        <span style={{ opacity: 0.7, marginLeft: 4, fontSize: 11 }}>{c.items.length}</span>
                      </div>
                    );
                  })}
                </div>

                <div data-guide="product-grid" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

                  {activeItems.map((it) => {
                    const b = bestMap.get(it.sku);
                    if (it.is_group && b) {
                      return <GroupCard key={it.sku} it={it} best={b} accent={accent}
                        checked={picked.has(it.sku)} onToggle={toggle} />;
                    }
                    return <ProductCard key={it.sku} it={it} best={b ?? null} accent={accent}
                      checked={picked.has(it.sku)} onToggle={toggle} />;
                  })}
                </div>

              </>
            );
          })()}
        </div>
      </div>

      {/* Floating jobs FAB (positioned absolute inside this container) */}
      <JobsBadge accent={accent} bottomOffset={picked.size > 0 ? 100 : 24} />

      {/* Floating action bar */}
      {picked.size > 0 && (
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          padding: '12px 16px 24px',
          background: 'linear-gradient(180deg, rgba(250,247,242,0) 0%, rgba(250,247,242,0.95) 35%, #faf7f2 100%)',
          display: 'flex', gap: 10, alignItems: 'center',
        }}>
          <button onClick={() => setPicked(new Map())} style={{
            appearance: 'none', border: `1px solid ${TOKENS.line}`,
            background: '#fff', color: TOKENS.inkSoft,
            padding: '0 14px', height: 48, borderRadius: 24,
            fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            flexShrink: 0,
          }}>清空</button>
          <button data-guide="start-batch-btn" onClick={startBatch} style={{
            appearance: 'none', border: 0,
            flex: 1, height: 52, borderRadius: 26,
            background: accent, color: '#fff',
            fontSize: 16, fontWeight: 700, letterSpacing: 0.5,
            cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: `0 8px 24px ${accent}55`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Icon.Sparkles size={18} color="#fff" />
            已选 {picked.size}/{MAX_BATCH} · 开始做海报
          </button>
        </div>
      )}

      {showRecent && <RecentDrawer accent={accent} onClose={() => setShowRecent(false)} />}
    </div>
  );
}

function HistoryIcon({ size = 22, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 12a9 9 0 109-9 9 9 0 00-7.5 4M3 4v4h4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7v5l3 2" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="7" stroke={color} strokeWidth="2" />
      <path d="M20 20l-3.5-3.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
