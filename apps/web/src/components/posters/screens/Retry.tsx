import * as React from 'react';
import { TOKENS } from '../tokens';
import { Icon } from '../icons';
import { AppBar, PrimaryBtn } from '../ui';
import { STYLES } from '../styles';
import type { PosterStyleId } from '../ai';

type PhotoSource = 'reuse' | 'retake';

export function ScreenRetry({
  accent, currentPhoto, currentCopy, currentStyleId, currentCustomStyle,
  onBack, onConfirm,
}: {
  accent: string;
  currentPhoto: string | null;
  currentCopy: string;
  currentStyleId: PosterStyleId | null;
  currentCustomStyle: string;
  onBack: () => void;
  onConfirm: (args: {
    copy: string;
    styleId: PosterStyleId;
    customStyle: string;
    photoSource: PhotoSource;
  }) => void;
}) {
  const [copy, setCopy] = React.useState(currentCopy);
  const [photoSource, setPhotoSource] = React.useState<PhotoSource>(
    currentPhoto ? 'reuse' : 'retake'
  );
  const [styleId, setStyleId] = React.useState<PosterStyleId>(currentStyleId ?? 'vibrant');
  const [customStyle, setCustomStyle] = React.useState(currentCustomStyle);

  const canGo =
    copy.trim().length >= 2 &&
    (styleId !== 'custom' || customStyle.trim().length >= 2) &&
    (photoSource === 'retake' || !!currentPhoto);

  return (
    <div style={{
      position: 'absolute', inset: 0, background: TOKENS.bg,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <AppBar title="重新生成" accent={accent} onBack={onBack} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 24px' }}>
        {/* Copy editor */}
        <div style={{
          background: '#fff', borderRadius: 14, padding: 12, marginBottom: 12,
          boxShadow: TOKENS.shadow1,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TOKENS.ink, marginBottom: 8 }}>
            海报文案（可改）
          </div>
          <textarea
            value={copy}
            onChange={e => setCopy(e.target.value.slice(0, 200))}
            rows={3}
            placeholder="写一句海报上的文案"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: TOKENS.bg, border: `1px solid ${TOKENS.line}`,
              borderRadius: 10, padding: '10px 12px',
              fontSize: 14, color: TOKENS.ink, fontFamily: 'inherit',
              resize: 'none', outline: 'none', lineHeight: 1.5,
            }}
          />
          <div style={{ fontSize: 11, color: TOKENS.inkMuted, textAlign: 'right', marginTop: 4 }}>
            {copy.length}/200
          </div>
        </div>

        {/* Photo source */}
        <div style={{
          background: '#fff', borderRadius: 14, padding: 12, marginBottom: 12,
          boxShadow: TOKENS.shadow1,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TOKENS.ink, marginBottom: 8 }}>
            照片来源
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              onClick={() => currentPhoto && setPhotoSource('reuse')}
              disabled={!currentPhoto}
              style={{
                appearance: 'none', cursor: currentPhoto ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                width: '100%', padding: 10, borderRadius: 12, textAlign: 'left',
                background: photoSource === 'reuse' ? `${accent}10` : '#fff',
                border: photoSource === 'reuse' ? `2px solid ${accent}` : `1px solid ${TOKENS.line}`,
                color: TOKENS.ink, opacity: currentPhoto ? 1 : 0.6,
                display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              {currentPhoto ? (
                <img src={currentPhoto} alt="" style={{
                  width: 48, height: 48, borderRadius: 8, objectFit: 'cover',
                  border: `1px solid ${TOKENS.line}`, flexShrink: 0,
                }} />
              ) : (
                <div style={{
                  width: 48, height: 48, borderRadius: 8, background: '#f3f4f6', flexShrink: 0,
                }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>用之前的照片</div>
                <div style={{ fontSize: 12, color: TOKENS.inkSoft, marginTop: 2 }}>
                  快，沿用刚才的拍摄
                </div>
              </div>
              {photoSource === 'reuse' && (
                <div style={{
                  width: 22, height: 22, borderRadius: 11, background: accent,
                  color: '#fff', fontSize: 13, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>✓</div>
              )}
            </button>

            <button
              onClick={() => setPhotoSource('retake')}
              style={{
                appearance: 'none', cursor: 'pointer', fontFamily: 'inherit',
                width: '100%', padding: 10, borderRadius: 12, textAlign: 'left',
                background: photoSource === 'retake' ? `${accent}10` : '#fff',
                border: photoSource === 'retake' ? `2px solid ${accent}` : `1px solid ${TOKENS.line}`,
                color: TOKENS.ink,
                display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: 8, flexShrink: 0,
                background: `${accent}18`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon.Camera size={22} color={accent} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>重新拍商品照</div>
                <div style={{ fontSize: 12, color: TOKENS.inkSoft, marginTop: 2 }}>
                  换个角度或光线再来一张
                </div>
              </div>
              {photoSource === 'retake' && (
                <div style={{
                  width: 22, height: 22, borderRadius: 11, background: accent,
                  color: '#fff', fontSize: 13, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>✓</div>
              )}
            </button>
          </div>
        </div>

        {/* Style picker */}
        <div style={{
          background: '#fff', borderRadius: 14, padding: 12, marginBottom: 12,
          boxShadow: TOKENS.shadow1,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TOKENS.ink, marginBottom: 8 }}>
            选风格
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
      </div>

      <div style={{
        padding: '12px 20px 24px', background: '#fff',
        borderTop: `1px solid ${TOKENS.lineSoft}`,
      }}>
        <PrimaryBtn accent={accent} disabled={!canGo}
          onClick={() => canGo && onConfirm({
            copy: copy.trim(),
            styleId,
            customStyle: customStyle.trim(),
            photoSource,
          })}>
          {photoSource === 'retake' ? '去重新拍照' : 'AI 重新生成'}
        </PrimaryBtn>
      </div>
    </div>
  );
}
