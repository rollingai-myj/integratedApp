import { TOKENS } from '../tokens';
import { Icon } from '../icons';
import { AppBar, GhostBtn, PrimaryBtn } from '../ui';
import type { PosterResult } from '../ai';

type ToastPayload = { text: string; icon?: React.ReactNode };

export function ScreenResult({ accent, poster, copy, onBack, onNew, onReselectStyle, onToast }: {
  accent: string;
  poster: PosterResult | null;
  copy: string;
  onBack: () => void;
  onNew: () => void;
  onReselectStyle: () => void;
  onToast: (p: ToastPayload) => void;
}) {
  const triggerDownload = async () => {
    if (!poster?.imageUrl) return;
    try {
      const a = document.createElement('a');
      a.href = poster.imageUrl;
      a.download = `poster-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      onToast({ text: '已开始下载', icon: <Icon.Check size={16} color="#fff" /> });
    } catch {
      onToast({ text: '请长按图片保存', icon: <Icon.Download size={16} color="#fff" /> });
    }
  };

  const triggerCopy = async () => {
    if (!poster?.imageUrl) return;
    try {
      const blob = await (await fetch(poster.imageUrl)).blob();
      // @ts-ignore — ClipboardItem exists in modern browsers
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      onToast({ text: '图片已复制，去微信粘贴吧', icon: <Icon.WeChat size={16} color="#fff" /> });
    } catch {
      onToast({ text: '请长按图片复制', icon: <Icon.Copy size={16} color="#fff" /> });
    }
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, background: TOKENS.bgWarm,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <AppBar title="海报做好啦" accent={accent} onBack={onBack}
        right={<button onClick={onNew} style={{
          appearance:'none', border:0,
          background:'rgba(255,255,255,0.2)', color:'#fff',
          padding: '6px 12px', borderRadius: 14,
          fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
          whiteSpace: 'nowrap',
          backdropFilter: 'blur(8px)',
        }}>再做一张</button>}
      />

      <div style={{
        padding: '12px 20px 4px', textAlign: 'center',
        fontSize: 13, color: TOKENS.inkSoft,
      }}>
        <span style={{ color: '#10b981', fontWeight: 600 }}>✓</span> 已生成 · 长按图片也可保存
      </div>

      <div style={{
        flex: 1, padding: '8px 20px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          maxHeight: '100%', maxWidth: '100%',
          aspectRatio: '3/4',
          borderRadius: 14, overflow: 'hidden',
          boxShadow: '0 20px 50px rgba(0,0,0,0.22), 0 6px 20px rgba(0,0,0,0.12)',
          background: '#1a1a1a',
          animation: 'posterIn 0.6s cubic-bezier(0.2, 1, 0.3, 1) both',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {poster?.imageUrl ? (
            <img src={poster.imageUrl} alt={copy} style={{
              width: '100%', height: '100%', objectFit: 'contain', display: 'block',
            }}/>
          ) : (
            <div style={{ color: '#fff', fontSize: 13 }}>无图片</div>
          )}
        </div>
      </div>

      <div style={{
        padding: '12px 20px 32px',
        background: 'rgba(255,255,255,0.6)',
        backdropFilter: 'blur(10px)',
        borderTop: `1px solid ${TOKENS.lineSoft}`,
      }}>
        <div style={{
          textAlign: 'center', fontSize: 12, color: TOKENS.inkMuted, marginBottom: 12,
        }}>
          下载到相册发朋友圈，或者复制直接发微信群
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <button onClick={onReselectStyle} style={{
            flex: 1, height: 40, appearance: 'none', border: `1px solid ${TOKENS.line}`,
            background: '#fff', color: TOKENS.ink, borderRadius: 12,
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
          }}>重选风格</button>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <GhostBtn accent={accent} onClick={triggerCopy} style={{ flex: 1 }}
            icon={<Icon.Copy size={18} color={accent} />}
          >一键复制</GhostBtn>
          <PrimaryBtn accent={accent} onClick={triggerDownload} style={{ flex: 1.2, height: 52 }}
            icon={<Icon.Download size={20} color="#fff" />}
          >一键下载</PrimaryBtn>
        </div>
      </div>

      <style>{`
        @keyframes posterIn {
          from { opacity: 0; transform: scale(0.9) translateY(20px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
