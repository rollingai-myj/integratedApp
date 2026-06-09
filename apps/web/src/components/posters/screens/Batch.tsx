import * as React from 'react';
import { TOKENS } from '../tokens';
import { Icon } from '../icons';
import { AppBar, PrimaryBtn } from '../ui';
import type { SelectedPromotion } from '../PromotionContext';
import type { PosterStyleId, PosterResult } from '../ai';
import storeBgExample from '@/assets/store-bg-example.jpg';
import { compressImage } from '../lib/compressImage';
import { useJobs } from '../JobsContext';
import { ProductImg } from '../ProductImg';
import { stripSpec, stripLeadingProductName, stripLeadingPromoCodes } from '@/utils/promoDisplayText';


type UploadMode = 'product' | 'bg_only';
type ItemStatus = 'idle' | 'queued' | 'generating' | 'done' | 'error';

type BatchItem = {
  id: string;
  promo: SelectedPromotion | null;   // null in free mode
  copy: string;
  photo: string | null;              // per-item photo (used in product mode, or bg_only fallback when no official PNG)
  status: ItemStatus;
  poster: PosterResult | null;
  error: string | null;
};

import { STYLES } from '../styles';

const MAX_ITEMS = 10;
const BG_PHOTO_KEY = 'myj_bg_photo';
const PNG_PROBE_KEY = 'myj_png_probe';
const UPLOAD_MODE_REMEMBER_KEY = 'myj_upload_mode_remembered';
const OSS_BASE = 'https://rollingai-meiyijia.oss-cn-shanghai.aliyuncs.com/product_pic';

function genId() {
  try { return crypto.randomUUID(); } catch { return `it-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
}

function emptyFreeItem(): BatchItem {
  return {
    id: genId(), promo: null, copy: '',
    photo: null,
    status: 'idle', poster: null, error: null,
  };
}

// 用 <img> 探测 PNG 是否存在。避免 HEAD 的 CORS 问题。
function probePng(sku: string): Promise<boolean> {
  return new Promise(resolve => {
    const img = new Image();
    const url = `${OSS_BASE}/${sku}.png`;
    let done = false;
    const finish = (ok: boolean) => { if (done) return; done = true; resolve(ok); };
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = url;
    // 15s 超时，按"无"处理（OSS 大图首次加载较慢，避免误判）
    setTimeout(() => finish(false), 15000);
  });
}

// 只缓存"有图"的正向结果；负向结果（404 / 超时）不缓存，下次重新探测，
// 避免一次网络抖动把商品永久标记为"无官方图"。
function loadPngProbeCache(): Record<string, boolean> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(PNG_PROBE_KEY) || '{}');
    const out: Record<string, boolean> = {};
    for (const k of Object.keys(raw)) if (raw[k] === true) out[k] = true;
    return out;
  } catch { return {}; }
}
function savePngProbeCache(cache: Record<string, boolean>) {
  try {
    const positives: Record<string, boolean> = {};
    for (const k of Object.keys(cache)) if (cache[k] === true) positives[k] = true;
    sessionStorage.setItem(PNG_PROBE_KEY, JSON.stringify(positives));
  } catch {}
}


export function ScreenBatch({
  accent, list, storeId, freeMode = false, onBack, onDone, onToast,
}: {
  accent: string;
  list: SelectedPromotion[];
  storeId: string | null;
  freeMode?: boolean;
  onBack: () => void;
  onDone: () => void;
  onToast: (text: string) => void;
}) {
  const [items, setItems] = React.useState<BatchItem[]>(() => {
    if (freeMode) return [emptyFreeItem()];
    return list.map(p => {
      const stripped = stripLeadingPromoCodes(stripLeadingProductName(p.displayText ?? '', p.productName));
      return {
        id: p.sku, promo: p,
        copy: stripped || '限时特价',
        photo: null,
        status: 'idle' as ItemStatus, poster: null, error: null,
      };
    });
  });
  const [styleId, setStyleId] = React.useState<PosterStyleId>('vibrant');
  const [customStyle, setCustomStyle] = React.useState<string>('');
  const rememberedMode: UploadMode | null = (() => {
    if (freeMode) return null;
    try {
      const v = localStorage.getItem(UPLOAD_MODE_REMEMBER_KEY);
      if (v === 'product' || v === 'bg_only') return v;
    } catch {}
    return null;
  })();
  const [uploadMode, setUploadMode] = React.useState<UploadMode>(rememberedMode ?? 'product');
  const [bgPhoto, setBgPhoto] = React.useState<string | null>(null);
  const [hasPng, setHasPng] = React.useState<Record<string, boolean>>({});
  const [pngProbing, setPngProbing] = React.useState(!freeMode);
  const [openTipsFor, setOpenTipsFor] = React.useState<{ kind: 'item' | 'bg'; id?: string } | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  // 非 freeMode 进入时弹出醒目的"怎么传照片"选择框（已记忆则跳过）
  const [showUploadModeModal, setShowUploadModeModal] = React.useState(!freeMode && rememberedMode === null);
  const { enqueueBatch } = useJobs();
  const fileRefs = React.useRef<Record<string, HTMLInputElement | null>>({});
  const bgFileRef = React.useRef<HTMLInputElement | null>(null);

  // 加载本地缓存的店内背景照
  React.useEffect(() => {
    try {
      const cached = localStorage.getItem(BG_PHOTO_KEY);
      if (cached) setBgPhoto(cached);
    } catch {}
  }, []);

  // 探测所有 SKU 是否有官方 PNG（含组合活动的每个成员）
  React.useEffect(() => {
    if (freeMode) { setPngProbing(false); return; }
    const skuSet = new Set<string>();
    for (const it of items) {
      if (!it.promo) continue;
      const members = it.promo.groupMembers;
      if (members && members.length >= 2) {
        for (const m of members) if (m.sku) skuSet.add(m.sku);
      } else if (it.promo.sku && !it.promo.sku.startsWith('group:')) {
        skuSet.add(it.promo.sku);
      }
    }
    const skus = [...skuSet];
    if (skus.length === 0) { setPngProbing(false); return; }
    let cancelled = false;
    const cache = loadPngProbeCache();
    const result: Record<string, boolean> = {};
    const toProbe: string[] = [];
    for (const sku of skus) {
      if (sku in cache) result[sku] = cache[sku];
      else toProbe.push(sku);
    }
    if (toProbe.length === 0) {
      setHasPng(result); setPngProbing(false); return;
    }
    setHasPng(result);
    Promise.all(toProbe.map(async sku => {
      const ok = await probePng(sku);
      cache[sku] = ok;
      result[sku] = ok;
    })).then(() => {
      if (cancelled) return;
      savePngProbeCache(cache);
      setHasPng({ ...result });
      setPngProbing(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (id: string, patch: Partial<BatchItem>) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));
  };

  const triggerItemUpload = (id: string) => {
    setOpenTipsFor(null);
    fileRefs.current[id]?.click();
  };
  const triggerBgUpload = () => {
    setOpenTipsFor(null);
    bgFileRef.current?.click();
  };

  const onItemFile = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const dataUrl = await compressImage(f, { keepAlpha: false });
      update(id, { photo: dataUrl });
    } catch (err) {
      console.error('[batch] compress fail', err);
    }
  };

  const onBgFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const dataUrl = await compressImage(f, { keepAlpha: false });
      setBgPhoto(dataUrl);
      try { localStorage.setItem(BG_PHOTO_KEY, dataUrl); } catch {}
    } catch (err) {
      console.error('[batch] bg compress fail', err);
    }
  };

  const addItem = () => {
    if (items.length >= MAX_ITEMS) { onToast(`最多 ${MAX_ITEMS} 张`); return; }
    setItems(prev => [...prev, emptyFreeItem()]);
  };
  const removeItem = (id: string) => {
    setItems(prev => prev.length > 1 ? prev.filter(it => it.id !== id) : prev);
  };

  // 可混搭组：使用 N 张成员官方 PNG，视为"有官方图"
  const isGroup = (it: BatchItem) => !!(it.promo?.groupMembers && it.promo.groupMembers.length >= 2);
  // 组合活动里缺图的成员
  const groupMissingMembers = (it: BatchItem) => {
    if (!isGroup(it)) return [] as { sku: string; productName: string }[];
    return (it.promo!.groupMembers ?? []).filter(m => !hasPng[m.sku]);
  };
  // 组合活动统计：总数 / 已有官方图数
  const groupCounts = (it: BatchItem) => {
    const members = it.promo?.groupMembers ?? [];
    const total = members.length;
    const have = members.filter(m => hasPng[m.sku]).length;
    return { total, have };
  };
  // 单品视角：是否可以走 bg_only（用官方图合成）
  // - 单品：必须有自己那张 PNG
  // - 组合：可用 ≥ 2，且缺图占比 ≤ 50%
  const itemHasPng = (it: BatchItem) => {
    if (isGroup(it)) {
      if (pngProbing) return false;
      const { total, have } = groupCounts(it);
      return have >= 2 && (total - have) <= Math.floor(total / 2);
    }
    return !!(it.promo && hasPng[it.promo.sku]);
  };
  // 在 bg_only 模式下，该 item 是否仍需要自己传图（即缺官方 PNG）
  const itemNeedsOwnPhoto = (it: BatchItem) =>
    uploadMode === 'product' || !itemHasPng(it);

  const allWithoutPng = !freeMode && items.length > 0 && items.every(it => !itemHasPng(it));
  const bgOnlyDisabled = freeMode || pngProbing || allWithoutPng;

  const allReady = (() => {
    if (items.length === 0) return false;
    if (!items.every(it => it.copy.trim().length >= 2)) return false;
    if (styleId === 'custom' && customStyle.trim().length < 2) return false;
    if (uploadMode === 'product') {
      return items.every(it => !!it.photo);
    }
    // bg_only
    if (!bgPhoto) return false;
    // 缺 PNG 的条目必须自己有 photo
    return items.every(it => itemHasPng(it) || !!it.photo);
  })();

  const submit = async () => {
    if (!allReady || submitting) return;
    setSubmitting(true);
    try {
      const items_payload = items.map(it => {
        const useBgOnly = uploadMode === 'bg_only' && itemHasPng(it);
        const group = isGroup(it);
        const memberUrls = group
          ? (it.promo!.groupMembers ?? [])
              .filter(m => hasPng[m.sku])
              .map(m => `${OSS_BASE}/${m.sku}.png`)
          : null;
        // Group items always go through the multi-image "group" pipeline.
        // - bg_only mode: use shared bgPhoto as background
        // - product mode: user-uploaded per-item photo serves as background
        if (group) {
          return {
            photoBase64: useBgOnly ? bgPhoto! : it.photo!,
            copy: stripLeadingPromoCodes(it.copy),
            styleId,
            customStyle: styleId === 'custom' ? customStyle.trim() : null,
            mode: 'group' as const,
            productImageUrl: null,
            productImageUrls: memberUrls,
            brandLabel: stripSpec(it.promo?.brandLabel ?? '') || null,
            storeId, sku: it.promo?.sku ?? null, category: it.promo?.category ?? null,
          };
        }
        return {
          photoBase64: useBgOnly ? bgPhoto! : it.photo!,
          copy: stripLeadingPromoCodes(it.copy),
          styleId,
          customStyle: styleId === 'custom' ? customStyle.trim() : null,
          mode: (useBgOnly ? 'bg_only' : 'normal') as 'bg_only' | 'normal',
          productImageUrl: useBgOnly && it.promo ? `${OSS_BASE}/${it.promo.sku}.png` : null,
          productImageUrls: null,
          brandLabel: null,
          storeId, sku: it.promo?.sku ?? null, category: it.promo?.category ?? null,
        };
      });
      await enqueueBatch(items_payload);
      onToast(`已提交 ${items.length} 张，正在后台生成`);
      onDone();
    } catch (err: any) {
      console.error('[batch submit]', err);
      onToast(err?.message || '提交失败，请重试');
      setSubmitting(false);
    }
  };

  const title = freeMode ? `做海报 · ${items.length}/${MAX_ITEMS}` : `批量做海报 · ${items.length}`;

  return (
    <div style={{
      position: 'absolute', inset: 0, background: TOKENS.bg,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <AppBar title={title} accent={accent} onBack={onBack} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 120px' }}>
        {freeMode && (
          <div style={{
            background: `linear-gradient(135deg, ${accent}, ${TOKENS.redDark})`,
            color: '#fff', borderRadius: 14, padding: '12px 14px', marginBottom: 12,
            display: 'flex', alignItems: 'flex-start', gap: 10,
            boxShadow: `0 6px 16px ${accent}30`,
          }}>
            <div style={{ fontSize: 20, lineHeight: 1 }}>💡</div>
            <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 800, marginBottom: 2 }}>后台生成</div>
              <div style={{ opacity: 0.95 }}>
                提交后会自动回到首页，可在右上角进度按钮查看实时进度。
                即使关闭网页，下次登录也会继续完成。
              </div>
            </div>
          </div>
        )}

        {!freeMode && (
          <div data-guide="upload-mode-card" style={{
            background: '#fff', borderRadius: 14, padding: 12, marginBottom: 12,
            boxShadow: TOKENS.shadow1,
          }}>

            <div style={{ fontSize: 13, fontWeight: 700, color: TOKENS.ink, marginBottom: 8 }}>
              怎么传照片？
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <ModeBtn
                active={uploadMode === 'product'} accent={accent}
                title="每个商品都拍一张"
                subtitle={items.length > 0
                  ? `拿出商品放在店里拍真实照片，发 ${items.length} 张海报就拍 ${items.length} 次，效果最好`
                  : '拿出商品放在店里拍真实照片，发 N 张海报就拍 N 次，效果最好'}
                onClick={() => setUploadMode('product')}
              />
              <ModeBtn
                active={uploadMode === 'bg_only'} accent={accent}
                disabled={bgOnlyDisabled}
                title="只拍一张店里的桌面"
                subtitle={pngProbing ? '检查官方商品图中…'
                  : allWithoutPng ? '本次活动暂无官方商品图'
                  : '商品由 AI 自动 P 上去，省事'}
                onClick={() => setUploadMode('bg_only')}
              />
            </div>
            {allWithoutPng && !pngProbing && (
              <div style={{ marginTop: 8, fontSize: 11, color: TOKENS.inkMuted }}>
                本次活动暂无官方商品图，只能上传商品照
              </div>
            )}
          </div>
        )}

        {!freeMode && uploadMode === 'bg_only' && !bgOnlyDisabled && (
          <BgPhotoCard
            accent={accent}
            bgPhoto={bgPhoto}
            count={items.filter(itemHasPng).length}
            onPick={() => setOpenTipsFor({ kind: 'bg' })}
            onChange={() => bgFileRef.current?.click()}
          />
        )}

        <div data-guide="style-card" style={{
          background: '#fff', borderRadius: 14, padding: 12, marginBottom: 12,
          boxShadow: TOKENS.shadow1,
        }}>

          <div style={{ fontSize: 13, fontWeight: 700, color: TOKENS.ink, marginBottom: 8 }}>
            所有海报统一风格
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
            {STYLES.map(s => {
              const active = styleId === s.id;
              return (
                <button key={s.id} onClick={() => setStyleId(s.id)} style={{
                  appearance: 'none', cursor: 'pointer', padding: 0,
                  borderRadius: 10, overflow: 'hidden', background: '#fff',
                  border: active ? `2.5px solid ${accent}` : `1px solid ${TOKENS.line}`,
                  fontFamily: 'inherit',
                }}>
                  <div style={{ aspectRatio: '3/4', background: '#eee' }}>
                    <img src={s.img} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <div style={{ padding: '6px 0', fontSize: 12, fontWeight: 700, color: active ? accent : TOKENS.ink }}>
                    {s.name}
                  </div>
                </button>
              );
            })}
            <button onClick={() => setStyleId('custom')} style={{
              appearance: 'none', cursor: 'pointer', padding: 0,
              borderRadius: 10, overflow: 'hidden', background: '#fff',
              border: styleId === 'custom' ? `2.5px solid ${accent}` : `1px solid ${TOKENS.line}`,
              fontFamily: 'inherit', display: 'flex', flexDirection: 'column',
            }}>
              <div style={{
                aspectRatio: '3/4',
                background: 'linear-gradient(135deg, #f3f4f6, #e5e7eb)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22,
              }}>✨</div>
              <div style={{ padding: '6px 0', fontSize: 12, fontWeight: 700,
                color: styleId === 'custom' ? accent : TOKENS.ink }}>
                自定义
              </div>
            </button>
          </div>
          {styleId === 'custom' && (
            <>
              <textarea
                value={customStyle}
                onChange={e => setCustomStyle(e.target.value.slice(0, 200))}
                placeholder="比如：日系清新风、ins 风的奶油色、少女心粉色、复古港风…"
                rows={3}
                style={{
                  marginTop: 10, width: '100%', boxSizing: 'border-box',
                  background: '#fff', border: `1.5px solid ${accent}`,
                  borderRadius: 10, padding: '10px 12px',
                  fontSize: 13, color: TOKENS.ink, fontFamily: 'inherit',
                  resize: 'none', outline: 'none', lineHeight: 1.5,
                }}
              />
              <div style={{ fontSize: 11, color: TOKENS.inkMuted, textAlign: 'right', marginTop: 4 }}>
                {customStyle.length}/200
              </div>
            </>
          )}
        </div>


        {items.map((it, i) => {
          const needOwn = itemNeedsOwnPhoto(it);
          const bgOnlyOk = uploadMode === 'bg_only' && itemHasPng(it);
          const group = isGroup(it);
          const counts = group ? groupCounts(it) : { total: 0, have: 0 };
          const missing = group ? groupMissingMembers(it) : [];

          // 提示分两类：
          // - warn：bg_only 模式下不能用官方图（要用户传商品照）
          // - info：bg_only 能用，但组合活动有部分口味缺图
          let noticeText = '';
          let noticeTone: 'warn' | 'info' = 'warn';
          if (uploadMode === 'bg_only' && !!it.promo) {
            if (!itemHasPng(it)) {
              noticeTone = 'warn';
              if (group) {
                const names = missing.map(m => m.productName).join('、');
                noticeText = `${names} 暂无官方图，缺图过多，请改为上传商品照`;
              } else {
                noticeText = '此商品系统暂无官方图，请改为上传商品照';
              }
            } else if (group && missing.length > 0) {
              noticeTone = 'info';
              const names = missing.map(m => m.productName).join('、');
              noticeText = `已用其余 ${counts.have}/${counts.total} 款官方图合成；${names} 无官方图，仅在文案中提及`;
            }
          }

          const row = (
            <ItemRow key={it.id} accent={accent}
              item={it} index={i} freeMode={freeMode}
              canRemove={items.length > 1}
              showUpload={needOwn}
              bgOnlyHandled={bgOnlyOk}
              bgOnlySubtitle={group && bgOnlyOk
                ? `✓ 使用 ${counts.have}/${counts.total} 款官方商品图 + 共享店内背景，无需单独上传`
                : '✓ 使用官方商品图 + 共享店内背景，无需单独上传'}
              noticeText={noticeText}
              noticeTone={noticeTone}
              isGroup={group}
              groupMemberSkus={group ? (it.promo!.groupMembers ?? []).map(m => m.sku) : []}
              onRemove={() => removeItem(it.id)}
              onCopyChange={(v) => update(it.id, { copy: v })}
              onPickPhoto={() => setOpenTipsFor({ kind: 'item', id: it.id })}
              onReupload={() => update(it.id, { photo: null })}
              fileInputRef={(el) => { fileRefs.current[it.id] = el; }}
              onFile={(e) => onItemFile(it.id, e)}
            />
          );
          return i === 0 ? <div key={it.id} data-guide="item-card">{row}</div> : row;
        })}


        {freeMode && items.length < MAX_ITEMS && (
          <button onClick={addItem} style={{
            appearance: 'none', cursor: 'pointer', fontFamily: 'inherit',
            width: '100%', padding: '14px', borderRadius: 14,
            background: '#fff', border: `1.5px dashed ${accent}`,
            color: accent, fontSize: 14, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            + 再加一张（{items.length}/{MAX_ITEMS}）
          </button>
        )}
      </div>

      <div data-guide="submit-btn" style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        padding: '12px 20px 24px', background: '#fff',
        borderTop: `1px solid ${TOKENS.lineSoft}`,
      }}>

        {submitting ? (
          <button disabled style={{
            appearance: 'none', border: 0,
            width: '100%', height: 56, borderRadius: 28,
            color: '#fff', fontSize: 18, fontWeight: 600, letterSpacing: 1,
            cursor: 'wait', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            background: `linear-gradient(110deg, ${accent} 30%, ${accent}cc 45%, #ffffff66 50%, ${accent}cc 55%, ${accent} 70%)`,
            backgroundSize: '300% 100%',
            animation: 'batch-submit-shimmer 1.6s linear infinite',
            boxShadow: `0 8px 24px ${accent}40, 0 2px 6px ${accent}30`,
          }}>
            <span style={{
              width: 18, height: 18, borderRadius: '50%',
              border: '2.5px solid rgba(255,255,255,0.35)',
              borderTopColor: '#fff',
              animation: 'batch-submit-spin 0.8s linear infinite',
              display: 'inline-block',
            }} />
            <span>提交中 · 上传照片…</span>
            <style>{`
              @keyframes batch-submit-spin { to { transform: rotate(360deg); } }
              @keyframes batch-submit-shimmer {
                0% { background-position: 100% 0; }
                100% { background-position: -100% 0; }
              }
            `}</style>
          </button>
        ) : (
          <PrimaryBtn accent={accent} disabled={!allReady} onClick={submit}>
            {allReady
              ? (uploadMode === 'bg_only' ? `开始生成 ${items.length} 张（共用此背景）` : `开始生成 ${items.length} 张（后台）`)
              : (uploadMode === 'bg_only'
                  ? (bgPhoto ? '请补全缺图商品或文案' : '请先上传一张店内背景')
                  : '请为每张海报完成上传和文案')}
          </PrimaryBtn>
        )}
      </div>

      <input ref={bgFileRef} type="file" accept="image/*"
        onChange={onBgFile} style={{ display: 'none' }} />

      {openTipsFor && (
        <TipsSheet
          accent={accent}
          mode={openTipsFor.kind === 'bg' ? 'bg_only' : 'product'}
          onClose={() => setOpenTipsFor(null)}
          onConfirm={() => {
            if (openTipsFor.kind === 'bg') triggerBgUpload();
            else if (openTipsFor.id) triggerItemUpload(openTipsFor.id);
          }}
        />
      )}

      {showUploadModeModal && (
        <UploadModeModal
          accent={accent}
          bgOnlyDisabled={bgOnlyDisabled}
          pngProbing={pngProbing}
          allWithoutPng={allWithoutPng}
          itemsCount={items.length}
          onBack={() => { setShowUploadModeModal(false); onBack(); }}
          onConfirm={(mode, remember) => {
            setUploadMode(mode);
            setShowUploadModeModal(false);
            if (remember) {
              try { localStorage.setItem(UPLOAD_MODE_REMEMBER_KEY, mode); } catch {}
            }
          }}
        />
      )}
    </div>
  );
}

function ModeBtn({ active, disabled, accent, title, subtitle, onClick }: {
  active: boolean; disabled?: boolean; accent: string;
  title: string; subtitle: string; onClick: () => void;
}) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{
      appearance: 'none', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
      padding: '10px 10px', borderRadius: 12,
      background: disabled ? '#f3f3f3' : (active ? `${accent}12` : '#fafafa'),
      border: active ? `2px solid ${accent}` : `1px solid ${TOKENS.line}`,
      color: disabled ? '#9aa0a6' : (active ? accent : TOKENS.ink),
      textAlign: 'left', opacity: disabled ? 0.7 : 1,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>{subtitle}</div>
    </button>
  );
}

function BgPhotoCard({ accent, bgPhoto, count, onPick, onChange }: {
  accent: string; bgPhoto: string | null; count: number;
  onPick: () => void; onChange: () => void;
}) {
  if (!bgPhoto) {
    return (
      <button onClick={onPick} style={{
        appearance: 'none', cursor: 'pointer', fontFamily: 'inherit',
        width: '100%', padding: '20px 16px', marginBottom: 12,
        background: '#fff', borderRadius: 14,
        border: `1.5px dashed ${accent}`, color: accent,
        boxShadow: TOKENS.shadow1,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      }}>
        <Icon.Camera size={22} color={accent} />
        <div style={{ fontSize: 14, fontWeight: 800 }}>拍 / 上传店内背景照</div>
        <div style={{ fontSize: 11, color: TOKENS.inkSoft, fontWeight: 500 }}>
          一张就够，{count} 张海报共用
        </div>
      </button>
    );
  }
  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: 12, marginBottom: 12,
      boxShadow: TOKENS.shadow1, display: 'flex', gap: 10, alignItems: 'center',
    }}>
      <img src={bgPhoto} alt="" style={{
        width: 64, height: 64, borderRadius: 10, objectFit: 'cover',
        border: `1px solid ${TOKENS.line}`,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: TOKENS.ink, marginBottom: 2 }}>
          店内背景照
        </div>
        <div style={{ fontSize: 11, color: TOKENS.inkSoft }}>
          已上传 · {count} 张海报共用
        </div>
      </div>
      <button onClick={onChange} style={{
        appearance: 'none', border: `1px solid ${accent}`,
        background: '#fff', color: accent,
        padding: '6px 12px', borderRadius: 14,
        fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
      }}>换一张</button>
    </div>
  );
}

function ItemRow({
  accent, item, index, freeMode, canRemove,
  showUpload, bgOnlyHandled, bgOnlySubtitle,
  noticeText, noticeTone,
  isGroup, groupMemberSkus,
  onRemove, onCopyChange,
  onPickPhoto, onReupload,
  fileInputRef, onFile,
}: {
  accent: string; item: BatchItem; index: number;
  freeMode: boolean;
  canRemove: boolean;
  showUpload: boolean;
  bgOnlyHandled: boolean;
  bgOnlySubtitle: string;
  noticeText: string;
  noticeTone: 'warn' | 'info';
  isGroup: boolean;
  groupMemberSkus: string[];
  onRemove: () => void;
  onCopyChange: (v: string) => void;
  onPickPhoto: () => void;
  onReupload: () => void;
  fileInputRef: (el: HTMLInputElement | null) => void;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: 12, marginBottom: 10,
      boxShadow: TOKENS.shadow1, position: 'relative',
    }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
        {item.promo ? (
          <>
            <ProductImg
              sku={isGroup && groupMemberSkus[0] ? groupMemberSkus[0] : item.promo.sku}
              fallbackSkus={isGroup ? groupMemberSkus.slice(1) : undefined}
              size={48} radius={8}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: TOKENS.ink, marginBottom: 2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{index + 1}. {item.promo.productName}</div>
              <div style={{ fontSize: 11, color: TOKENS.inkSoft }}>
                ¥{(item.promo.bestEffectivePrice ?? 0).toFixed(2)}
                {item.promo.originalPrice && item.promo.originalPrice > 0 && (
                  <span style={{ marginLeft: 6, textDecoration: 'line-through', color: TOKENS.inkMuted }}>
                    ¥{item.promo.originalPrice.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
            {canRemove && <RemoveBtn onClick={onRemove} />}
          </>
        ) : (
          <>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: `${accent}15`, color: accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 15, fontWeight: 800, flexShrink: 0,
            }}>{index + 1}</div>
            <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: TOKENS.ink }}>
              海报 {index + 1}
            </div>
            {canRemove && <RemoveBtn onClick={onRemove} />}
          </>
        )}
      </div>

      <textarea value={item.copy} onChange={e => onCopyChange(e.target.value.slice(0, 200))}
        rows={2} placeholder={freeMode ? '写一句海报上的文案' : '海报上的促销文案（可改）'}
        style={{
          width: '100%', boxSizing: 'border-box',
          background: TOKENS.bg, border: `1px solid ${TOKENS.line}`,
          borderRadius: 10, padding: '10px 12px',
          fontSize: 13, color: TOKENS.ink, fontFamily: 'inherit',
          resize: 'none', outline: 'none', lineHeight: 1.5, marginBottom: 10,
        }} />


      {noticeText && (
        <div style={noticeTone === 'warn' ? {
          background: '#fff7e6', border: '1px solid #ffd591', color: '#ad6800',
          borderRadius: 10, padding: '8px 10px', fontSize: 12, fontWeight: 600,
          marginBottom: 10, display: 'flex', alignItems: 'flex-start', gap: 6,
        } : {
          background: '#f0f7ff', border: '1px solid #bae0ff', color: '#0958d9',
          borderRadius: 10, padding: '8px 10px', fontSize: 12, fontWeight: 600,
          marginBottom: 10, display: 'flex', alignItems: 'flex-start', gap: 6,
        }}>
          <span>{noticeTone === 'warn' ? '⚠' : 'ℹ'}</span>
          <span>{noticeText}</span>
        </div>
      )}

      {bgOnlyHandled ? (
        <div style={{
          fontSize: 12, color: TOKENS.inkSoft,
          background: '#f6faf6', border: '1px solid #d9ead9',
          borderRadius: 10, padding: '8px 10px',
        }}>
          {bgOnlySubtitle}
        </div>
      ) : showUpload && (
        item.photo ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <img src={item.photo} alt="" style={{
              width: 64, height: 64, borderRadius: 8, objectFit: 'cover',
              border: `1px solid ${TOKENS.line}`,
            }} />
            <div style={{ flex: 1, fontSize: 12, color: TOKENS.inkSoft }}>
              已上传商品照
            </div>
            <button onClick={onReupload} style={{
              appearance: 'none', border: `1px solid ${TOKENS.line}`,
              background: '#fff', color: TOKENS.inkSoft,
              padding: '6px 12px', borderRadius: 14,
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>重传</button>
          </div>
        ) : (
          <button onClick={onPickPhoto} style={{
            width: '100%', position: 'relative',
            appearance: 'none', cursor: 'pointer', fontFamily: 'inherit',
            padding: '12px 8px', borderRadius: 12,
            background: `${accent}10`,
            border: `1.5px solid ${accent}`,
            color: accent,
            fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Icon.Camera size={18} color={accent} />
            <span>{freeMode ? '上传商品照' : '拍 / 上传商品照'}</span>
          </button>
        )
      )}

      <input ref={fileInputRef} type="file" accept="image/*"

        onChange={onFile} style={{ display: 'none' }} />
    </div>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="删除" style={{
      appearance: 'none', cursor: 'pointer', fontFamily: 'inherit',
      flexShrink: 0, width: 28, height: 28, borderRadius: 14,
      background: '#f5f5f7', border: `1px solid ${TOKENS.line}`,
      color: TOKENS.inkMuted, padding: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 14, lineHeight: 1,
    }}>✕</button>
  );
}

function TipsSheet({ accent, mode, onClose, onConfirm }: {
  accent: string; mode: UploadMode;
  onClose: () => void; onConfirm: () => void;
}) {
  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 20,
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'flex-end',
      animation: 'fadeIn 0.25s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', width: '100%',
        borderRadius: '24px 24px 0 0',
        padding: '24px 22px 30px',
        animation: 'slideUp 0.3s cubic-bezier(0.2,0.8,0.2,1) both',
        maxHeight: '85%', overflowY: 'auto',
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: '#ddd', margin: '-10px auto 16px' }} />

        {mode === 'product' ? (
          <>
            <div style={{ fontSize: 19, fontWeight: 800, color: TOKENS.ink, marginBottom: 4 }}>拍/传商品照</div>
            <div style={{ fontSize: 13, color: TOKENS.inkSoft, marginBottom: 16 }}>照片越真实，海报越好看</div>
            {[
              { ic: <Icon.Tag size={20} color={accent} />, t: '商品要清晰', d: '把要推的商品摆在画面中间' },
              { ic: <Icon.Store size={20} color={accent} />, t: '带点店里的环境', d: '收银台、台面、货架背景都行' },
              { ic: <Icon.Sun size={20} color={accent} />, t: '光线要充足', d: '开店里的灯，避免逆光' },
            ].map((tip, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0',
                borderBottom: i < 2 ? `1px solid ${TOKENS.lineSoft}` : 'none',
              }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 10, background: TOKENS.redSoft,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>{tip.ic}</div>
                <div style={{ flex: 1, paddingTop: 2 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: TOKENS.ink }}>{tip.t}</div>
                  <div style={{ fontSize: 12, color: TOKENS.inkSoft, marginTop: 2 }}>{tip.d}</div>
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div style={{ fontSize: 19, fontWeight: 800, color: TOKENS.ink, marginBottom: 4 }}>只传店内背景</div>
            <div style={{ fontSize: 13, color: TOKENS.inkSoft, marginBottom: 14 }}>
              AI 会把商品自动摆到你拍的台面上
            </div>

            <div style={{
              borderRadius: 12, overflow: 'hidden', marginBottom: 12,
              border: `1px solid ${TOKENS.line}`, position: 'relative',
            }}>
              <img src={storeBgExample} alt="示例" style={{ width: '100%', display: 'block', maxHeight: 220, objectFit: 'cover' }} />
              <div style={{
                position: 'absolute', bottom: 8, left: 8,
                background: 'rgba(0,0,0,0.7)', color: '#fff',
                fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 8,
              }}>✓ 像这样：光线足 + 留出台面</div>
            </div>

            {[
              { t: '光线一定要充足', d: '开亮店里的灯，画面整体偏亮' },
              { t: '画面必须有桌面/台面', d: '收银台、货架前的台面都行，AI 会把商品摆在上面' },
              { t: '台面要干净', d: '清掉杂物，给商品留出位置' },
            ].map((tip, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0',
              }}>
                <div style={{
                  flexShrink: 0, width: 22, height: 22, borderRadius: 11,
                  background: accent, color: '#fff', fontSize: 12, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{i + 1}</div>
                <div style={{ flex: 1, paddingTop: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: TOKENS.ink }}>{tip.t}</div>
                  <div style={{ fontSize: 12, color: TOKENS.inkSoft, marginTop: 1 }}>{tip.d}</div>
                </div>
              </div>
            ))}
          </>
        )}

        <PrimaryBtn accent={accent} onClick={onConfirm} style={{ marginTop: 18 }}>
          {mode === 'product' ? '去拍/选商品照' : '去拍/选店内背景'}
        </PrimaryBtn>

        <style>{`
          @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
          @keyframes slideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
        `}</style>
      </div>
    </div>
  );
}

function UploadModeModal({ accent, bgOnlyDisabled, pngProbing, allWithoutPng, itemsCount, onBack, onConfirm }: {
  accent: string;
  bgOnlyDisabled: boolean;
  pngProbing: boolean;
  allWithoutPng: boolean;
  itemsCount: number;
  onBack: () => void;
  onConfirm: (mode: UploadMode, remember: boolean) => void;
}) {
  const [picked, setPicked] = React.useState<UploadMode | null>(null);
  const [remember, setRemember] = React.useState(false);
  const productSubtitle = itemsCount > 0
    ? `拿出商品放在店里拍真实照片，发 ${itemsCount} 张海报就拍 ${itemsCount} 次，效果最好`
    : '拿出商品放在店里拍真实照片，发 N 张海报就拍 N 次，效果最好';

  const renderOption = (mode: UploadMode, opts: {
    title: string; subtitle: string; icon: React.ReactNode; disabled?: boolean;
  }) => {
    const active = picked === mode;
    const disabled = !!opts.disabled;
    return (
      <button
        onClick={disabled ? undefined : () => setPicked(mode)}
        disabled={disabled}
        style={{
          appearance: 'none', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
          width: '100%', padding: '16px 16px', borderRadius: 16,
          background: disabled ? '#f3f3f5' : (active ? `${accent}10` : '#fff'),
          border: active ? `2px solid ${accent}` : `1px solid ${TOKENS.line}`,
          color: disabled ? '#9aa0a6' : TOKENS.ink,
          textAlign: 'left', opacity: disabled ? 0.85 : 1,
          display: 'flex', alignItems: 'center', gap: 12,
          position: 'relative',
        }}
      >
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: disabled ? '#e8e8ea' : `${accent}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{opts.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2 }}>{opts.title}</div>
          <div style={{ fontSize: 12, color: disabled ? '#9aa0a6' : TOKENS.inkSoft }}>{opts.subtitle}</div>
        </div>
        {active && (
          <div style={{
            width: 24, height: 24, borderRadius: 12, background: accent,
            color: '#fff', fontSize: 14, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>✓</div>
        )}
      </button>
    );
  };

  const canConfirm = picked !== null;

  return (
    <div data-guide-suppress style={{
      position: 'absolute', inset: 0, zIndex: 30,
      background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
      animation: 'fadeIn 0.25s ease',
    }}>

      <div style={{
        background: '#fff', width: '100%', maxWidth: 380,
        borderRadius: 22, padding: '24px 20px 22px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
        animation: 'popIn 0.28s cubic-bezier(0.2,0.8,0.2,1) both',
      }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: TOKENS.ink, textAlign: 'center', marginBottom: 18 }}>
          怎么准备商品照片？
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {renderOption('product', {
            title: '每个商品都拍一张',
            subtitle: productSubtitle,
            icon: <Icon.Camera size={22} color={accent} />,
          })}
          {renderOption('bg_only', {
            title: '只拍一张店里的桌面',
            subtitle: pngProbing ? '检查官方商品图中…'
              : allWithoutPng ? '本次活动暂无官方商品图'
              : '商品由 AI 自动 P 上去，省事',
            icon: <Icon.Store size={22} color={bgOnlyDisabled ? '#9aa0a6' : accent} />,
            disabled: bgOnlyDisabled,
          })}
        </div>

        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginTop: 16, padding: '4px 2px',
          cursor: 'pointer', userSelect: 'none',
        }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={e => setRemember(e.target.checked)}
            style={{
              width: 18, height: 18, accentColor: accent, cursor: 'pointer', margin: 0,
            }}
          />
          <span style={{ fontSize: 13, color: TOKENS.inkSoft }}>以后不再询问</span>
        </label>

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            onClick={onBack}
            style={{
              flex: 1, height: 46, appearance: 'none', cursor: 'pointer',
              border: `1px solid ${TOKENS.line}`, background: '#fff',
              color: TOKENS.ink, borderRadius: 12,
              fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
            }}
          >返回</button>
          <button
            onClick={canConfirm ? () => onConfirm(picked!, remember) : undefined}
            disabled={!canConfirm}
            style={{
              flex: 1.4, height: 46, appearance: 'none',
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              border: 0,
              background: canConfirm ? accent : '#d4d4d8',
              color: '#fff', borderRadius: 12,
              fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
              boxShadow: canConfirm ? `0 6px 16px ${accent}40` : 'none',
            }}
          >确认</button>
        </div>

        <style>{`
          @keyframes popIn {
            from { opacity: 0; transform: scale(0.92); }
            to { opacity: 1; transform: scale(1); }
          }
        `}</style>
      </div>
    </div>
  );
}
