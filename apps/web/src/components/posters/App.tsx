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
import { LoginScreen } from './Login';
import { StorePrompt } from './StorePrompt';
import { addRecent } from './recent';
import { authClient } from './auth-client';
import { recordLogin, getMyRole } from '@/lib/auth.functions';
import { startSession, heartbeat } from '@/lib/usage.functions';
import { getStoreForDevice, bindStoreToDevice } from '@/lib/store.functions';
import { stripLeadingProductName, stripLeadingPromoCodes } from '@/utils/promoDisplayText';
import { PromotionProvider, usePromotion } from './PromotionContext';
import { JobsProvider } from './JobsContext';
import { GuideProvider, useGuide } from './GuideContext';
import { GuideOverlay } from './GuideOverlay';


type ScreenId =
  | 'welcome' | 'home' | 'camera' | 'confirm'
  | 'copy' | 'style' | 'loading' | 'result' | 'batch' | 'retry';

const ACCENT = '#E11D2A';
const DEVICE_ID_KEY = 'myj_device_id';

function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

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
  const [isSuperAdmin, setIsSuperAdmin] = React.useState(false);
  const [storeId, setStoreId] = React.useState<string | null>(null);
  const [needsStore, setNeedsStore] = React.useState(false);
  const [sessionTick, setSessionTick] = React.useState(0);
  const deviceIdRef = React.useRef<string>('');

  React.useEffect(() => {
    deviceIdRef.current = getOrCreateDeviceId();
    const { subscription } = authClient.onAuthStateChange((session) => {
      setAuthed(!!session);
      if (!session) { setStoreId(null); setNeedsStore(false); setIsSuperAdmin(false); }
    });
    const sess = authClient.getSession();
    setAuthed(!!sess);
    return () => subscription.unsubscribe();
  }, []);

  // After login: get role, check device store binding, then record login + start usage session.
  React.useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let sessionId: string | null = null;
    (async () => {
      let admin = false;
      try {
        const { roles } = await getMyRole();
        admin = roles.includes('super_admin');
        if (!cancelled) setIsSuperAdmin(admin);
        // 注意：原 standalone repo 在这里会 window.location.href='/admin' 让超管去后台；
        // 整合后超管也能直接用海报功能（且 currentStore 已在 /select-store 选好），
        // 不再 redirect。"进入后台"角标改成回首页（功能选择页）。
      } catch (e) { console.warn('[getMyRole]', e); }

      // Non-admin: ensure device has a store binding before continuing.
      let resolvedStore: string | null = null;
      try {
        const { storeId: bound } = await getStoreForDevice({ data: { deviceId: deviceIdRef.current } });
        resolvedStore = bound;
      } catch (e) { console.warn('[getStoreForDevice]', e); }

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
    try {
      await bindStoreToDevice({ data: { deviceId: deviceIdRef.current, storeId: trimmed } });
    } catch (e) {
      console.error('[bindStoreToDevice]', e);
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
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      background: '#000', overflow: 'hidden',
      fontFamily: '-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
    }}>
      {authed === null ? null : !authed ? <LoginScreen onLogin={() => setAuthed(true)} /> : <>
      {needsStore && <StorePrompt accent={ACCENT} onSubmit={handleStoreSubmit} />}
      {!needsStore && <>
      {isSuperAdmin && (
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 100,
          background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '4px 10px',
          borderRadius: 12, fontSize: 11, cursor: 'pointer',
        }} onClick={() => { window.location.href = '/'; }}>返回首页</div>
      )}
      {storeId && (
        <div style={{
          position: 'absolute', top: 8, left: 8, zIndex: 100,
          background: 'rgba(0,0,0,0.5)', color: '#fff', padding: '4px 10px',
          borderRadius: 12, fontSize: 11,
        }}>门店：{storeId}</div>
      )}
      <div
        onClick={async () => {
          if (!confirm('确认退出登录？')) return;
          authClient.signOut();
        }}
        style={{
          position: 'absolute', top: 8, right: isSuperAdmin ? 80 : 8, zIndex: 100,
          background: 'rgba(0,0,0,0.5)', color: '#fff', padding: '4px 10px',
          borderRadius: 12, fontSize: 11, cursor: 'pointer',
        }}
      >退出</div>
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
