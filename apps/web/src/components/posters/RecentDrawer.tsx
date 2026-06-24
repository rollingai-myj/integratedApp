/**
 * 海报历史抽屉:三个 tab
 *   - 生成记录(默认):近 30 天所有成功生成的海报,平铺,按创建时间倒序
 *   - 收藏:用户主动收藏(后端 store_poster_favorites 表)
 *   - 销量跟踪:沿用 SalesTrackingView,数据源换成 recentJobs
 *
 * 顶部固定一行「仅展示近 30 天」提示,与后端 status=recent 的 30 天窗口对齐。
 */
import * as React from 'react';
import { TOKENS } from './tokens';
import { Icon } from './icons';
import { useJobs, type Job } from './JobsContext';
import {
  listFavorites,
  addFavorite,
  removeFavorite,
  type PosterFavorite,
} from '@/lib/poster-favorites.functions';
import { saveImages } from './lib/download';
import { LongPressGallery } from './LongPressGallery';
import { SalesTrackingView } from './SalesTrackingView';
import { getHostContext } from './host-bridge';

type Tab = 'history' | 'favorites' | 'sales-tracking';

interface HistoryItem {
  generationId: string;
  imageUrl: string;
  copy: string;
  sku: string | null;
  ts: number;
}

export function RecentDrawer({ accent, onClose }: { accent: string; onClose: () => void }) {
  const { recentJobs } = useJobs();
  const [tab, setTab] = React.useState<Tab>('history');
  const [favorites, setFavorites] = React.useState<PosterFavorite[]>([]);
  const [favBusyId, setFavBusyId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [longPressUrls, setLongPressUrls] = React.useState<string[] | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // 生成记录:从 recentJobs 抽出 done 行,平铺
  const historyItems = React.useMemo<HistoryItem[]>(() => {
    return recentJobs
      .filter((j) => j.status === 'done' && j.result_image_url)
      .map((j) => ({
        generationId: j.id,
        imageUrl: j.result_image_url!,
        copy: typeof j.params?.copy === 'string' ? j.params.copy : '',
        sku: typeof j.params?.sku === 'string' ? j.params.sku : null,
        ts: new Date(j.created_at).getTime(),
      }))
      .sort((a, b) => b.ts - a.ts);
  }, [recentJobs]);

  // 收藏:首次进入 + 切到 tab 时拉
  React.useEffect(() => {
    if (tab !== 'favorites') return;
    let cancelled = false;
    (async () => {
      try {
        const { items } = await listFavorites();
        if (!cancelled) setFavorites(items);
      } catch (e) {
        console.warn('[favorites] list', e);
      }
    })();
    return () => { cancelled = true; };
  }, [tab]);

  // 收藏的 generationId 集合(给生成记录里的"心"图标用)
  const favoritedIds = React.useMemo(() => {
    const s = new Set<string>();
    for (const f of favorites) s.add(f.generationId);
    return s;
  }, [favorites]);

  const flashToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 1800);
  };

  const handleSave = async (urls: string[]) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await saveImages(urls, 'poster');
      if (r.kind === 'longpress') setLongPressUrls(r.urls);
      else if (r.kind === 'downloaded') flashToast(`已下载 ${r.count} 张`);
      else if (r.kind === 'failed') flashToast('下载失败,请重试');
    } finally {
      setBusy(false);
    }
  };

  const toggleFavorite = async (generationId: string) => {
    if (favBusyId) return;
    setFavBusyId(generationId);
    try {
      if (favoritedIds.has(generationId)) {
        await removeFavorite(generationId);
        setFavorites((prev) => prev.filter((f) => f.generationId !== generationId));
      } else {
        const { favorite } = await addFavorite(generationId);
        setFavorites((prev) => [favorite, ...prev]);
        flashToast('已添加到收藏');
      }
    } catch (e) {
      flashToast((e as Error).message || '操作失败');
    } finally {
      setFavBusyId(null);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.55)',
      animation: 'fadeIn 0.25s ease',
      display: 'flex', alignItems: 'flex-end',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: TOKENS.bg, width: '100%', maxHeight: '85%',
        borderRadius: '24px 24px 0 0',
        padding: '20px 18px 28px',
        display: 'flex', flexDirection: 'column',
        animation: 'slideUp 0.32s cubic-bezier(0.2, 0.8, 0.2, 1) both',
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: '#ddd', margin: '-6px auto 14px' }} />

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: TOKENS.ink }}>历史</div>
            <div style={{ fontSize: 11, color: TOKENS.inkMuted, marginTop: 2 }}>
              生成记录 {historyItems.length} 张 · 收藏 {favorites.length} 张
            </div>
          </div>
          {tab === 'favorites' && favorites.length > 0 && (
            <div onClick={() => setEditing(e => !e)} style={{
              fontSize: 13, color: accent, fontWeight: 600, cursor: 'pointer',
            }}>{editing ? '完成' : '管理'}</div>
          )}
        </div>

        {/* 「仅展示近 30 天」全局提示 */}
        <div style={{
          background: '#fff7ed', color: '#9a3412',
          borderRadius: 8, padding: '6px 10px',
          fontSize: 11, fontWeight: 500,
          marginBottom: 10,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span>仅展示近 30 天 · 收藏的海报永久保留</span>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: '#f3f4f6', padding: 3, borderRadius: 10 }}>
          {([
            ['history', '生成记录'],
            ['favorites', '收藏'],
            ['sales-tracking', '销量跟踪'],
          ] as Array<[Tab, string]>).map(([id, label]) => {
            const isActive = tab === id;
            return (
              <button key={id} onClick={() => { setTab(id); setEditing(false); }} style={{
                flex: 1, appearance: 'none', border: 0, cursor: 'pointer',
                padding: '8px 0', borderRadius: 8,
                background: isActive ? '#fff' : 'transparent',
                color: isActive ? TOKENS.ink : TOKENS.inkMuted,
                fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}>{label}</button>
            );
          })}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {tab === 'history' && (
            historyItems.length === 0 ? (
              <EmptyState text="近 30 天还没有成功生成的海报。" />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {historyItems.map((it) => {
                  const fav = favoritedIds.has(it.generationId);
                  return (
                    <div key={it.generationId} onClick={() => setPreviewUrl(it.imageUrl)} style={{
                      aspectRatio: '3/4', borderRadius: 10, background: '#1a1a1a',
                      position: 'relative', overflow: 'hidden',
                      boxShadow: TOKENS.shadow1, cursor: 'pointer',
                    }}>
                      <img src={it.imageUrl} alt={it.copy} style={{
                        position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                      }} />
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(it.generationId); }}
                        aria-label={fav ? '取消收藏' : '收藏'}
                        disabled={favBusyId === it.generationId}
                        style={{
                          position: 'absolute', top: 6, right: 6,
                          width: 28, height: 28, borderRadius: '50%',
                          appearance: 'none', border: 0, padding: 0, cursor: 'pointer',
                          background: 'rgba(0,0,0,0.55)',
                          color: fav ? '#ef4444' : '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          backdropFilter: 'blur(4px)',
                          fontSize: 16, lineHeight: 1, fontFamily: 'inherit',
                        }}
                      >
                        {fav ? '♥' : '♡'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSave([it.imageUrl]); }}
                        aria-label="下载"
                        style={{
                          position: 'absolute', bottom: 6, right: 6,
                          width: 28, height: 28, borderRadius: '50%',
                          appearance: 'none', border: 0, cursor: 'pointer',
                          background: accent, color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
                        }}
                      >
                        <Icon.Download size={13} color="#fff" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {tab === 'favorites' && (
            favorites.length === 0 ? (
              <EmptyState text="还没收藏。在生成记录或结果页点 ♡ 把喜欢的海报留下来。" />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {favorites.map((f) => {
                  if (!f.posterImageUrl) return null;
                  const imageUrl = f.posterImageUrl;
                  return (
                    <div key={f.id} onClick={() => { if (!editing) setPreviewUrl(imageUrl); }} style={{
                      aspectRatio: '3/4', borderRadius: 10, background: '#1a1a1a',
                      position: 'relative', overflow: 'hidden',
                      boxShadow: TOKENS.shadow1, cursor: editing ? 'default' : 'pointer',
                    }}>
                      <img src={imageUrl} alt={f.copyText} style={{
                        position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                      }} />
                      {editing ? (
                        <button onClick={(e) => { e.stopPropagation(); toggleFavorite(f.generationId); }}
                          aria-label="移除收藏" style={delBtn}>×</button>
                      ) : (
                        <button onClick={(e) => { e.stopPropagation(); handleSave([imageUrl]); }}
                          aria-label="下载"
                          style={{
                            position: 'absolute', bottom: 6, right: 6,
                            width: 28, height: 28, borderRadius: '50%',
                            appearance: 'none', border: 0, cursor: 'pointer',
                            background: accent, color: '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
                          }}>
                          <Icon.Download size={13} color="#fff" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {tab === 'sales-tracking' && (
            <SalesTrackingView
              accent={accent}
              jobs={recentJobs}
              currentStoreId={getHostContext()?.storeId ?? null}
              onPreviewPoster={(url) => setPreviewUrl(url)}
            />
          )}
        </div>

        {previewUrl && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 20,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }} onClick={() => setPreviewUrl(null)}>
            <button onClick={(e) => { e.stopPropagation(); setPreviewUrl(null); }} style={{
              position: 'absolute', top: 12, right: 12, zIndex: 21,
              appearance: 'none', border: 0, background: 'rgba(255,255,255,0.15)',
              color: '#fff', width: 36, height: 36, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', backdropFilter: 'blur(4px)',
            }}><Icon.Close size={20} color="#fff" /></button>
            <img src={previewUrl} alt="预览" style={{
              maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
            }} onClick={(e) => e.stopPropagation()} />
          </div>
        )}

        {toast && (
          <div style={{
            position: 'absolute', left: '50%', bottom: 80,
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.82)', color: '#fff',
            padding: '8px 16px', borderRadius: 18,
            fontSize: 12, fontWeight: 600,
            zIndex: 30, pointerEvents: 'none',
          }}>{toast}</div>
        )}

        <style>{`
          @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
          @keyframes slideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
        `}</style>
      </div>
      {longPressUrls && (
        <LongPressGallery urls={longPressUrls} onClose={() => setLongPressUrls(null)} />
      )}
    </div>
  );
}

const delBtn: React.CSSProperties = {
  position: 'absolute', top: 4, right: 4,
  width: 22, height: 22, borderRadius: '50%',
  border: 0, padding: 0, cursor: 'pointer',
  background: 'rgba(0,0,0,0.65)', color: '#fff',
  fontSize: 14, lineHeight: '22px', textAlign: 'center',
  fontFamily: 'inherit', fontWeight: 700,
};

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{
      border: `1.5px dashed ${TOKENS.line}`, borderRadius: 12,
      padding: '36px 16px', textAlign: 'center', color: TOKENS.inkMuted,
      fontSize: 13, lineHeight: 1.5,
    }}>{text}</div>
  );
}
