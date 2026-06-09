import * as React from 'react';
import { TOKENS } from './tokens';
import { Icon } from './icons';
import { loadRecent, removeRecent, countThisWeek, type RecentPoster } from './recent';
import { loadSessionHistory, removeSession, type SessionHistory } from './sessionHistory';
import { saveImages } from './lib/download';
import { LongPressGallery } from './LongPressGallery';

type Tab = 'single' | 'session';

export function RecentDrawer({ accent, onClose }: { accent: string; onClose: () => void }) {
  const [tab, setTab] = React.useState<Tab>('session');
  const [recent, setRecent] = React.useState<RecentPoster[]>([]);
  const [sessions, setSessions] = React.useState<SessionHistory[]>([]);
  const [editing, setEditing] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [longPressUrls, setLongPressUrls] = React.useState<string[] | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setRecent(loadRecent());
    setSessions(loadSessionHistory());
  }, []);

  const weekCount = countThisWeek(recent);
  const expanded = sessions.find(b => b.id === expandedId) || null;

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
      else if (r.kind === 'failed') flashToast('下载失败，请重试');
      // 'shared' → system sheet handled feedback
    } finally {
      setBusy(false);
    }
  };
  const downloadOne = (url: string) => handleSave([url]);
  const downloadSession = (b: SessionHistory) => handleSave(b.items.map(it => it.imageUrl));

  // Default to session tab if there are sessions, otherwise single.
  React.useEffect(() => {
    if (sessions.length === 0 && recent.length > 0) setTab('single');
  }, [sessions.length, recent.length]);

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
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: TOKENS.ink }}>历史记录</div>
            <div style={{ fontSize: 11, color: TOKENS.inkMuted, marginTop: 2 }}>
              {sessions.length} 组活动 · 单张本周 {weekCount} · 共 {recent.length} 张
            </div>
          </div>
          {((tab === 'single' && recent.length > 0) || (tab === 'session' && sessions.length > 0)) && (
            <div onClick={() => setEditing(e => !e)} style={{
              fontSize: 13, color: accent, fontWeight: 600, cursor: 'pointer',
            }}>{editing ? '完成' : '管理'}</div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: '#f3f4f6', padding: 3, borderRadius: 10 }}>
          {([['session', '按组'], ['single', '单张']] as Array<[Tab, string]>).map(([id, label]) => {
            const active = tab === id;
            return (
              <button key={id} onClick={() => { setTab(id); setEditing(false); }} style={{
                flex: 1, appearance: 'none', border: 0, cursor: 'pointer',
                padding: '8px 0', borderRadius: 8,
                background: active ? '#fff' : 'transparent',
                color: active ? TOKENS.ink : TOKENS.inkMuted,
                fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}>{label}</button>
            );
          })}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {tab === 'single' ? (
            recent.length === 0 ? (
              <EmptyState text="还没做过单张海报" />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {recent.map((r) => (
                  <div key={r.id} onClick={() => { if (!editing) setPreviewUrl(r.imageUrl); }} style={{
                    aspectRatio: '3/4', borderRadius: 10, background: '#1a1a1a',
                    position: 'relative', overflow: 'hidden',
                    boxShadow: TOKENS.shadow1, cursor: editing ? 'default' : 'pointer',
                  }}>
                    <img src={r.imageUrl} alt={r.copy} style={{
                      position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                    }} />
                    {editing && (
                      <button onClick={(e) => { e.stopPropagation(); setRecent(removeRecent(r.id)); }}
                        aria-label="删除" style={delBtn}>×</button>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : (
            sessions.length === 0 ? (
              <EmptyState text="还没保存按组记录。生成完后点「保存到历史」就能存下来。" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {sessions.map(b => (
                  <SessionRow key={b.id} session={b} accent={accent} editing={editing}
                    onOpen={() => setExpandedId(b.id)}
                    onDelete={() => setSessions(removeSession(b.id))}
                  />
                ))}
              </div>
            )
          )}
        </div>

        {/* Session expanded view */}
        {expanded && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 12,
            background: TOKENS.bg,
            display: 'flex', flexDirection: 'column',
            padding: '20px 18px 28px',
            borderRadius: '24px 24px 0 0',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <button onClick={() => setExpandedId(null)} aria-label="返回" style={{
                appearance: 'none', border: 0, background: '#f3f4f6',
                width: 36, height: 36, borderRadius: 12, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, color: TOKENS.ink,
              }}>‹</button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: TOKENS.ink }}>
                  {new Date(expanded.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 的活动
                </div>
                <div style={{ fontSize: 11, color: TOKENS.inkMuted, marginTop: 2 }}>
                  共 {expanded.items.length} 张
                </div>
              </div>
              <button onClick={() => downloadSession(expanded)} style={{
                appearance: 'none', border: 0, background: accent, color: '#fff',
                padding: '8px 14px', borderRadius: 14,
                fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                <Icon.Download size={14} color="#fff" />
                全部下载
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {expanded.items.map((it, i) => (
                  <div key={i} onClick={() => setPreviewUrl(it.imageUrl)} style={{
                    aspectRatio: '3/4', borderRadius: 10, background: '#1a1a1a',
                    position: 'relative', overflow: 'hidden',
                    boxShadow: TOKENS.shadow1, cursor: 'pointer',
                  }}>
                    <img src={it.imageUrl} alt={it.copy || ''} style={{
                      position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                    }} />
                    <button onClick={(e) => { e.stopPropagation(); downloadOne(it.imageUrl); }} aria-label="下载" style={{
                      position: 'absolute', bottom: 6, right: 6,
                      appearance: 'none', border: 0, background: accent, color: '#fff',
                      width: 28, height: 28, borderRadius: '50%', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
                    }}>
                      <Icon.Download size={13} color="#fff" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

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

function SessionRow({ session, accent, editing, onOpen, onDelete }: {
  session: SessionHistory; accent: string; editing: boolean;
  onOpen: () => void; onDelete: () => void;
}) {
  const dt = new Date(session.startedAt);
  const dateLabel = dt.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  const timeLabel = dt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return (
    <div onClick={() => { if (!editing) onOpen(); }} style={{
      background: '#fff', borderRadius: 14, padding: 12,
      boxShadow: TOKENS.shadow1, cursor: editing ? 'default' : 'pointer',
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: TOKENS.ink }}>
          {dateLabel} <span style={{ fontWeight: 500, color: TOKENS.inkMuted, fontSize: 12, marginLeft: 4 }}>{timeLabel}</span>
        </div>
        <div style={{ fontSize: 12, color: accent, fontWeight: 700 }}>{session.items.length} 张</div>
      </div>
      <div style={{
        display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch',
        paddingBottom: 2,
      }}>
        {session.items.slice(0, 8).map((it, i) => (
          <img key={i} src={it.imageUrl} alt="" style={{
            width: 56, height: 75, objectFit: 'cover', borderRadius: 6,
            flexShrink: 0, background: '#1a1a1a',
          }} />
        ))}
        {session.items.length > 8 && (
          <div style={{
            width: 56, height: 75, borderRadius: 6, flexShrink: 0,
            background: '#f3f4f6', color: TOKENS.inkMuted,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700,
          }}>+{session.items.length - 8}</div>
        )}
      </div>
      {editing && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} aria-label="删除" style={{
          position: 'absolute', top: 8, right: 8,
          width: 24, height: 24, borderRadius: '50%',
          border: 0, padding: 0, cursor: 'pointer',
          background: 'rgba(0,0,0,0.7)', color: '#fff',
          fontSize: 15, lineHeight: '24px', textAlign: 'center',
          fontFamily: 'inherit', fontWeight: 700,
        }}>×</button>
      )}
    </div>
  );
}
