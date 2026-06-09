import * as React from 'react';
import { TOKENS } from '../tokens';
import { Icon } from '../icons';
import { PrimaryBtn } from '../ui';
import { compressImage } from '../lib/compressImage';

export function ScreenCamera({ accent, onBack, onCapture }: {
  accent: string; onBack: () => void; onCapture: (dataUrl?: string) => void;
}) {
  const [showTips, setShowTips] = React.useState(true);
  const [flash, setFlash] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const uploadRef = React.useRef<HTMLInputElement | null>(null);

  const handleShutter = () => {
    fileRef.current?.click();
  };
  const handleUpload = () => {
    uploadRef.current?.click();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    let dataUrl: string;
    try {
      dataUrl = await compressImage(f, { keepAlpha: false });
    } catch (err) {
      console.error('[camera] compress fail', err);
      return;
    }
    setFlash(true);
    setTimeout(() => {
      setFlash(false);
      onCapture(dataUrl);
    }, 280);
  };


  return (
    <div style={{
      position: 'absolute', inset: 0, background: '#0a0a0a',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Abstract cashier counter background with a product on it */}
      <CounterBackdrop accent={accent} />

      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 140,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.6), transparent)',
      }}/>
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 200,
        background: 'linear-gradient(0deg, rgba(0,0,0,0.7), transparent)',
      }}/>

      <div style={{
        position: 'relative', zIndex: 2,
        padding: '56px 18px 0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button onClick={onBack} style={{
          appearance: 'none', border: 0,
          width: 38, height: 38, borderRadius: 19,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(8px)',
          cursor: 'pointer',
        }}>
          <Icon.Close size={20} color="#fff" />
        </button>

        <div style={{
          fontSize: 13, fontWeight: 600, color: '#fff',
          background: 'rgba(0,0,0,0.45)',
          padding: '8px 14px', borderRadius: 16,
          backdropFilter: 'blur(8px)',
          letterSpacing: 0.5,
        }}>
          第 1 步 · 拍商品照片
        </div>

        <button onClick={() => setShowTips(true)} style={{
          appearance: 'none', border: 0,
          width: 38, height: 38, borderRadius: 19,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(8px)',
          color: '#fff', fontWeight: 700, fontSize: 16,
          cursor: 'pointer',
        }}>?</button>
      </div>

      <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: '78%', aspectRatio: '4/5',
          border: `2px dashed rgba(255,255,255,0.55)`,
          borderRadius: 16,
          position: 'relative',
          animation: 'pulse 2.4s ease-in-out infinite',
        }}>
          {([[0,0],[0,1],[1,0],[1,1]] as const).map(([x,y], i) => (
            <div key={i} style={{
              position: 'absolute',
              [x?'right':'left']: -2, [y?'bottom':'top']: -2,
              width: 22, height: 22,
              borderTop: y ? undefined : `3px solid ${TOKENS.yellow}`,
              borderBottom: y ? `3px solid ${TOKENS.yellow}` : undefined,
              borderLeft: x ? undefined : `3px solid ${TOKENS.yellow}`,
              borderRight: x ? `3px solid ${TOKENS.yellow}` : undefined,
            }}/>
          ))}
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%,-50%)',
            color: '#fff', fontSize: 13, fontWeight: 600,
            background: 'rgba(0,0,0,0.5)',
            padding: '6px 12px', borderRadius: 12,
            backdropFilter: 'blur(6px)',
            whiteSpace: 'nowrap',
            textAlign: 'center', lineHeight: 1.5,
          }}>
            把商品对准框内<br/>
            <span style={{ fontSize: 11, opacity: 0.85, fontWeight: 400 }}>背景带一点店内环境更自然</span>
          </div>
        </div>
      </div>

      <div style={{
        position: 'relative', zIndex: 2,
        paddingBottom: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-around',
      }}>
        <div style={{ width: 56 }} />

        <button onClick={handleShutter} style={{
          appearance: 'none', border: 0, background: 'transparent',
          cursor: 'pointer', padding: 0,
        }}>
          <div style={{
            width: 76, height: 76, borderRadius: '50%',
            border: '4px solid #fff', padding: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              width: '100%', height: '100%', borderRadius: '50%',
              background: '#fff',
            }}/>
          </div>
        </button>

        <button onClick={handleUpload} aria-label="从相册上传" style={{
          appearance: 'none', border: 0,
          width: 56, height: 56, borderRadius: 16,
          background: 'rgba(255,255,255,0.18)',
          backdropFilter: 'blur(8px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 2, cursor: 'pointer', color: '#fff',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <path d="M21 15l-5-5L5 21"/>
          </svg>
          <span style={{ fontSize: 10, fontWeight: 600 }}>相册</span>
        </button>

        <input ref={fileRef} type="file" accept="image/*" capture="environment"
          onChange={handleFile} style={{ display: 'none' }} />
        <input ref={uploadRef} type="file" accept="image/*"
          onChange={handleFile} style={{ display: 'none' }} />
      </div>

      {showTips && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(2px)',
          display: 'flex', alignItems: 'flex-end',
          animation: 'fadeIn 0.3s ease',
        }}>
          <div style={{
            background: '#fff',
            width: '100%',
            borderRadius: '24px 24px 0 0',
            padding: '28px 24px 36px',
            animation: 'slideUp 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) both',
          }}>
            <div style={{
              width: 40, height: 4, borderRadius: 2, background: '#ddd',
              margin: '-12px auto 18px',
            }}/>
            <div style={{ fontSize: 20, fontWeight: 800, color: TOKENS.ink, marginBottom: 6 }}>
              拍照小贴士
            </div>
            <div style={{ fontSize: 13, color: TOKENS.inkSoft, marginBottom: 18 }}>
              照片越真实，海报越好看
            </div>

            {[
              { ic: <Icon.Tag size={22} color={accent}/>, t: '商品要清晰',  d: '把要推的商品摆在画面中间' },
              { ic: <Icon.Store size={22} color={accent}/>, t: '带点店里的环境', d: '收银台、台面、货架背景都行' },
              { ic: <Icon.Sun size={22} color={accent}/>, t: '光线要充足',  d: '开店里的灯，避免逆光' },
            ].map((tip, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                padding: '14px 0',
                borderBottom: i < 2 ? `1px solid ${TOKENS.lineSoft}` : 'none',
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, background: TOKENS.redSoft,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>{tip.ic}</div>
                <div style={{ flex: 1, paddingTop: 2 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: TOKENS.ink }}>{tip.t}</div>
                  <div style={{ fontSize: 13, color: TOKENS.inkSoft, marginTop: 2 }}>{tip.d}</div>
                </div>
              </div>
            ))}

            <PrimaryBtn accent={accent} onClick={() => setShowTips(false)} style={{ marginTop: 20 }}>
              知道啦
            </PrimaryBtn>
          </div>
        </div>
      )}

      {flash && (
        <div style={{
          position: 'absolute', inset: 0, background: '#fff', zIndex: 20,
          animation: 'flashIn 0.28s ease',
        }}/>
      )}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes flashIn { 0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: 0; } }
      `}</style>
    </div>
  );
}

// Abstract counter / cashier surface with a product silhouette on top.
function CounterBackdrop({ accent }: { accent: string }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'linear-gradient(180deg, #1c1814 0%, #2a221c 40%, #4a3a2c 60%, #6b5440 100%)',
    }}>
      {/* Blurred shelf rows behind */}
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          position: 'absolute',
          top: `${8 + i * 14}%`, left: 0, right: 0,
          height: 50, opacity: 0.6 - i * 0.15,
          display: 'flex', gap: 6, padding: '0 12px',
          filter: 'blur(6px)',
        }}>
          {Array.from({ length: 9 }).map((_, j) => (
            <div key={j} style={{
              flex: 1, height: '100%',
              background: ['#7a2a2a', '#3a4a6a', '#6a5a3a', '#2a3a4a', '#5a3a2a', '#8a6a3a'][j % 6],
              borderRadius: 2,
              opacity: 0.85,
            }}/>
          ))}
        </div>
      ))}

      {/* Counter top — horizontal seam */}
      <div style={{
        position: 'absolute', top: '60%', left: 0, right: 0, height: 2,
        background: 'rgba(255,255,255,0.18)',
        boxShadow: '0 1px 0 rgba(0,0,0,0.3)',
      }}/>

      {/* Counter surface highlight */}
      <div style={{
        position: 'absolute', top: '60%', bottom: 0, left: 0, right: 0,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.06), transparent 30%), linear-gradient(180deg, #8b7159 0%, #6b533e 100%)',
      }}/>

      {/* Abstract product on the counter — yogurt-cup-ish silhouette */}
      <div style={{
        position: 'absolute',
        bottom: '10%', left: '50%', transform: 'translateX(-50%)',
        width: 120, height: 150,
      }}>
        {/* shadow */}
        <div style={{
          position: 'absolute', bottom: -8, left: '10%', right: '10%', height: 14,
          background: 'rgba(0,0,0,0.45)', borderRadius: '50%', filter: 'blur(6px)',
        }}/>
        {/* cup body */}
        <div style={{
          position: 'absolute', inset: 0, top: 22,
          background: 'linear-gradient(180deg, #f5f0e6 0%, #e6dcc8 100%)',
          borderRadius: '6px 6px 12px 12px',
          boxShadow: 'inset -10px 0 18px rgba(0,0,0,0.12)',
        }}>
          <div style={{
            position: 'absolute', top: 28, left: 12, right: 12,
            height: 30, background: 'rgba(0,0,0,0.05)', borderRadius: 4,
          }}/>
          <div style={{
            position: 'absolute', bottom: 22, left: 12, right: 12,
            height: 8, background: accent, borderRadius: 2, opacity: 0.85,
          }}/>
          <div style={{
            position: 'absolute', bottom: 10, left: 12, width: '50%',
            height: 5, background: 'rgba(0,0,0,0.2)', borderRadius: 2,
          }}/>
        </div>
        {/* cup lid */}
        <div style={{
          position: 'absolute', top: 0, left: -4, right: -4, height: 28,
          background: 'linear-gradient(180deg, #d9b066 0%, #b88a3a 100%)',
          borderRadius: '6px 6px 0 0',
          boxShadow: 'inset 0 -3px 6px rgba(0,0,0,0.2)',
        }}/>
      </div>

      {/* hint sticker */}
      <div style={{
        position: 'absolute', bottom: '6%', left: '50%', transform: 'translateX(-50%)',
        fontSize: 11, color: 'rgba(255,255,255,0.55)', letterSpacing: 1,
      }}>↑ 大概这样：把商品放台面上拍 ↑</div>
    </div>
  );
}
