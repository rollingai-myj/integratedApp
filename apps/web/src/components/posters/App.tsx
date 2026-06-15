import * as React from 'react';
import { Toast } from './ui';
import { ScreenWelcome } from './screens/Welcome';
import { ScreenHome } from './screens/Home';
import { ScreenCamera } from './screens/Camera';
import { ScreenConfirm } from './screens/Confirm';
import { ScreenCopyInput } from './screens/CopyInput';
import { ScreenStyleSelect } from './screens/StyleSelect';
import { ScreenLoading } from './screens/Loading';
import { ScreenResult } from './screens/Result';
import { ScreenBatch } from './screens/Batch';
import { ScreenRetry } from './screens/Retry';
import { generatePoster, type PosterResult, type PosterStyleId } from './ai';
import { StorePrompt } from './StorePrompt';
import { addRecent } from './recent';
import { authClient } from './auth-client';
import { getHostContext } from './host-bridge';
import { recordLogin } from '@/lib/auth.functions';
import { startSession, heartbeat } from '@/lib/usage.functions';
import { stripLeadingProductName, stripLeadingPromoCodes } from '@/utils/promoDisplayText';
import { PromotionProvider, usePromotion } from './PromotionContext';
import { JobsProvider } from './JobsContext';
import { GuideProvider, useGuide } from './GuideContext';
import { GuideOverlay } from './GuideOverlay';


type ScreenId =
  | 'welcome' | 'home' | 'camera' | 'confirm'
  | 'copy' | 'style' | 'loading' | 'result' | 'batch' | 'retry';

const ACCENT = '#E11D2A';

export function PosterApp() {
  return (
    <PromotionProvider>
      <JobsProvider>
        <GuideProvider>
          <PosterAppInner />
        </GuideProvider>
      </JobsProvider>
    </PromotionProvider>
  );
}


function PosterAppInner() {
  const guide = useGuide();

  const [authed, setAuthed] = React.useState<boolean | null>(null);
  const [storeId, setStoreId] = React.useState<string | null>(null);
  const [needsStore, setNeedsStore] = React.useState(false);
  const [sessionTick, setSessionTick] = React.useState(0);

  React.useEffect(() => {
    const { subscription } = authClient.onAuthStateChange((session) => {
      setAuthed(!!session);
      if (!session) { setStoreId(null); setNeedsStore(false); }
    });
    const sess = authClient.getSession();
    setAuthed(!!sess);
    return () => subscription.unsubscribe();
  }, []);

  // After login: read current store from host-bridge, then record login + start usage session.
  React.useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let sessionId: string | null = null;
    (async () => {
      // host (/posters 路由) 已经通过 setHostContext 灌了当前门店；这里直接读。
      const resolvedStore = getHostContext()?.storeCode ?? null;

      if (cancelled) return;
      if (!resolvedStore) {
        setNeedsStore(true);
        return; // wait for user to submit store number
      }
      setStoreId(resolvedStore);

      try { await recordLogin({ data: { storeId: resolvedStore } }); } catch (e) { console.warn('[recordLogin]', e); }
      try {
        const { id } = await startSession({ data: { storeId: resolvedStore } });
        sessionId = id;
        timer = setInterval(async () => {
          if (!sessionId) return;
          // Guard: skip heartbeat if user has signed out.
          const sess = authClient.getSession();
          if (!sess) return;
          heartbeat({ data: { sessionId } }).catch(() => {});
        }, 30_000);
      } catch (e) { console.warn('[startSession]', e); }
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [authed, sessionTick]);

  const handleStoreSubmit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    // 用户在 PosterApp 里输入门店编号（如"粤37893"）→ 解析成 UUID → 切店
    try {
      const listRes = await fetch('/api/v1/portal/stores', { credentials: 'include' });
      if (!listRes.ok) throw new Error(`portal/stores ${listRes.status}`);
      const { stores } = (await listRes.json()) as { stores: Array<{ id: string; code: string }> };
      const match = stores.find((s) => s.code === trimmed);
      if (!match) throw new Error(`门店编号 ${trimmed} 不在你的可见范围内`);
      const switchRes = await fetch('/api/v1/portal/active-store', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: match.id }),
      });
      if (!switchRes.ok) throw new Error(`active-store ${switchRes.status}`);
    } catch (e) {
      console.error('[switch-store]', e);
      return;
    }
    setStoreId(trimmed);
    setNeedsStore(false);
    // Re-trigger the post-login effect so startSession + heartbeat run with proper cleanup.
    setSessionTick(t => t + 1);
  };

  const { selected: selectedPromo, setSelected: setSelectedPromo, batch: batchList, setBatch: setBatchList } = usePromotion();

  const [screen, setScreen] = React.useState<ScreenId>('home');
  const [batchFree, setBatchFree] = React.useState(false);
  const [photo, setPhoto] = React.useState<string | null>(null);
  const [copy, setCopy] = React.useState<string>('');
  const [styleIdSel, setStyleIdSel] = React.useState<PosterStyleId | null>(null);
  const [customStyle, setCustomStyle] = React.useState<string>('');
  const [poster, setPoster] = React.useState<PosterResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [retakeMode, setRetakeMode] = React.useState(false);

  const [toast, setToast] = React.useState<{ visible: boolean; text: string; icon: React.ReactNode }>(
    { visible: false, text: '', icon: null }
  );
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = ({ text, icon }: { text: string; icon?: React.ReactNode }) => {
    setToast({ visible: true, text, icon: icon ?? null });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(s => ({ ...s, visible: false })), 1600);
  };

  const go = (next: ScreenId) => setScreen(next);

  React.useEffect(() => {
    if (screen !== 'loading') return;
    if (!photo || !styleIdSel || !copy) return;
    let cancelled = false;
    setPoster(null);
    setError(null);
    generatePoster({
      photo, copy, styleId: styleIdSel, customStyle, storeId,
      sku: selectedPromo?.sku ?? null,
      category: selectedPromo?.category ?? null,
    })
      .then((res) => {
        if (cancelled) return;
        setPoster(res);
        if (res?.imageUrl) addRecent({ imageUrl: res.imageUrl, copy });
      })
      .catch((err: unknown) => {
        console.error('[poster] generate failed', err);
        if (!cancelled) setError(err instanceof Error ? err.message : '生成失败');
      });
    return () => { cancelled = true; };
  }, [screen, photo, copy, styleIdSel, customStyle, storeId, selectedPromo]);


  const reset = () => {
    setPhoto(null); setCopy(''); setStyleIdSel(null); setCustomStyle('');
    setPoster(null); setError(null);
  };

  return (
    <div className="poster-phone" style={{
      position: 'relative', width: '100%', height: '100%',
      background: '#000', overflow: 'hidden',
      fontFamily: '-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
    }}>
      {!authed ? null : <>
      {needsStore && <StorePrompt accent={ACCENT} onSubmit={handleStoreSubmit} />}
      {!needsStore && <>
      {/* 顶部"门店 / 返回首页 / 退出"三按钮已下线：
           - 门店号 → 由外层 BrandHeader 展示
           - 返回首页 → 由 BrandHeader 的 ← 箭头承担
           - 退出 → 走门户右上角统一退出，不再有 posters 自有登录流程 */}
      {screen === 'welcome' && (<ScreenWelcome accent={ACCENT} onDone={() => go('home')} />)}
      {screen === 'home' && (<ScreenHome accent={ACCENT}
        onStart={(promo) => {
          reset();
          if (promo) {
            setSelectedPromo(promo);
            if (promo.displayText) setCopy(stripLeadingPromoCodes(stripLeadingProductName(promo.displayText, promo.productName)) || '限时特价');
            go('camera');
          } else {
            // 直接做海报 → 进入与批量一致的多张上传页（free mode）
            setSelectedPromo(null);
            setBatchList([]);
            setBatchFree(true);
            go('batch');
          }
        }}
        onStartBatch={(list) => { setBatchFree(false); setBatchList(list); go('batch'); }}
        onShowGuide={() => guide.start()}
        onToast={(text) => showToast({ text })}
      />)}
      {screen === 'batch' && (<ScreenBatch accent={ACCENT} list={batchList} storeId={storeId}
        freeMode={batchFree}
        onBack={() => go('home')}
        onDone={() => { setBatchList([]); setBatchFree(false); go('home'); }}
        onToast={(text) => showToast({ text })}
      />)}
      {screen === 'camera' && (<ScreenCamera accent={ACCENT} onBack={() => go('home')} onCapture={(dataUrl?: string) => { if (dataUrl) setPhoto(dataUrl); go('confirm'); }} />)}
      {screen === 'confirm' && (<ScreenConfirm accent={ACCENT} photo={photo} onRetake={() => go('camera')} onConfirm={() => {
        if (retakeMode) { setRetakeMode(false); go('loading'); }
        else { go('copy'); }
      }} />)}
      {screen === 'copy' && (<ScreenCopyInput accent={ACCENT} value={copy} onBack={() => go('confirm')} onNext={(text) => { setCopy(text); go('style'); }} />)}
      {screen === 'style' && (<ScreenStyleSelect accent={ACCENT} value={styleIdSel} customValue={customStyle} onBack={() => go('copy')} onConfirm={(sid, custom) => { setStyleIdSel(sid); setCustomStyle(custom); go('loading'); }} />)}
      {screen === 'loading' && (<ScreenLoading accent={ACCENT} ready={!!poster || !!error} error={error}
          onDone={() => { if (error) { go('style'); } else { go('result'); } }}
          onRetry={() => { setError(null); setPoster(null); go('loading'); }} />)}
      {screen === 'retry' && (<ScreenRetry accent={ACCENT}
          currentPhoto={photo} currentCopy={copy}
          currentStyleId={styleIdSel} currentCustomStyle={customStyle}
          onBack={() => go('result')}
          onConfirm={({ copy: newCopy, styleId, customStyle: newCustom, photoSource }) => {
            setCopy(newCopy);
            setStyleIdSel(styleId);
            setCustomStyle(newCustom);
            setPoster(null);
            setError(null);
            if (photoSource === 'retake') {
              setPhoto(null);
              setRetakeMode(true);
              go('camera');
            } else {
              go('loading');
            }
          }} />)}
      {screen === 'result' && (<ScreenResult accent={ACCENT} poster={poster} copy={copy}
          onBack={() => go('style')}
          onNew={() => { if (poster?.imageUrl) addRecent({ imageUrl: poster.imageUrl, copy }); setSelectedPromo(null); reset(); go('home'); }}
          onReselectStyle={() => { if (poster?.imageUrl) addRecent({ imageUrl: poster.imageUrl, copy }); go('retry'); }}
          onToast={showToast} />)}
      <Toast visible={toast.visible} text={toast.text} icon={toast.icon} />
      <GuideOverlay />

      </>}
      </>}
    </div>
  );
}
