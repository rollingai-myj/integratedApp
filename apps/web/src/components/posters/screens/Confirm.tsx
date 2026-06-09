import { TOKENS } from '../tokens';
import { Icon } from '../icons';
import { AppBar, GhostBtn, PrimaryBtn } from '../ui';

export function ScreenConfirm({ accent, photo, onRetake, onConfirm }: {
  accent: string; photo?: string | null; onRetake: () => void; onConfirm: () => void;
}) {
  return (
    <div style={{
      position: 'absolute', inset: 0, background: TOKENS.bg,
      display: 'flex', flexDirection: 'column',
    }}>
      <AppBar title="预览照片" accent={accent} onBack={onRetake} />

      <div style={{ flex: 1, padding: '24px 20px 16px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ fontSize: 14, color: TOKENS.inkSoft, textAlign: 'center', marginBottom: 16 }}>
          这张照片满意吗？满意就用它做海报背景
        </div>

        <div style={{
          flex: 1,
          background: photo
            ? `#000`
            : `linear-gradient(180deg, #d8c9b8 0%, #b59a82 45%, #8c6f57 46%, #6b4f3a 100%)`,
          borderRadius: 20,
          boxShadow: TOKENS.shadow2,
          position: 'relative',
          overflow: 'hidden',
          marginBottom: 20,
        }}>
          {photo ? (
            <img src={photo} alt="照片预览" style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
            }}/>
          ) : (
            <>
              <div style={{ position: 'absolute', top: '32%', left: '14%', width: 32, height: 70, background: 'rgba(80,40,40,0.7)', borderRadius: 4 }}/>
              <div style={{ position: 'absolute', top: '36%', left: '28%', width: 26, height: 60, background: 'rgba(40,80,80,0.7)', borderRadius: 4 }}/>
              <div style={{ position: 'absolute', top: '30%', right: '22%', width: 36, height: 74, background: 'rgba(160,40,40,0.65)', borderRadius: 4 }}/>
              <div style={{ position: 'absolute', top: '38%', right: '12%', width: 24, height: 54, background: 'rgba(80,60,30,0.7)', borderRadius: 4 }}/>
              <div style={{ position: 'absolute', top: '45%', left: 0, right: 0, height: 2, background: 'rgba(0,0,0,0.25)' }}/>
            </>
          )}

        </div>

        <div style={{
          background: '#fff', borderRadius: 14, padding: '14px 16px',
          marginBottom: 16, boxShadow: TOKENS.shadow1,
        }}>
          {[{ t: '光线充足' }, { t: '画面清晰' }, { t: '识别到店内台面' }].map((c, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '6px 0',
              fontSize: 14, color: TOKENS.ink,
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                background: '#10b981',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon.Check size={14} color="#fff" />
              </div>
              {c.t}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <GhostBtn accent={accent} onClick={onRetake} style={{ flex: 1 }}>
            重拍
          </GhostBtn>
          <PrimaryBtn accent={accent} onClick={onConfirm} style={{ flex: 1.4, height: 52 }}>
            用这张
          </PrimaryBtn>
        </div>
      </div>
    </div>
  );
}
