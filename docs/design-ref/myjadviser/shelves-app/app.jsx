// App 壳 —— 屏幕栈路由 + 全局 toast（刷新后停留在原页面）

const NAV_KEY = 'shv-proto-nav-v3';

function loadNav() {
  try {
    const raw = localStorage.getItem(NAV_KEY);
    if (raw) {
      const st = JSON.parse(raw);
      if (Array.isArray(st) && st.length > 0 && st[0].name === 'home') return st;
    }
  } catch (e) { /* ignore */ }
  return [{ name: 'home' }];
}

function App() {
  const app = useAppState();
  const [stack, setStack] = React.useState(loadNav);
  const [toastState, setToastState] = React.useState({ visible: false, text: '' });
  const toastTimer = React.useRef(null);

  React.useEffect(() => {
    try { localStorage.setItem(NAV_KEY, JSON.stringify(stack)); } catch (e) { /* ignore */ }
  }, [stack]);

  const toast = (text) => {
    clearTimeout(toastTimer.current);
    setToastState({ visible: true, text });
    toastTimer.current = setTimeout(() => setToastState((t) => ({ ...t, visible: false })), 2200);
  };

  const nav = {
    push: (screen) => setStack((s) => [...s, screen]),
    pop: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    replace: (screen) => setStack((s) => [...s.slice(0, -1), screen]),
    popTo: (name) => setStack((s) => {
      const idx = s.map((x) => x.name).lastIndexOf(name);
      return idx >= 0 ? s.slice(0, idx + 1) : [s[0]];
    }),
    reset: () => setStack([{ name: 'home' }]),
  };

  const top = stack[stack.length - 1];
  const props = { app, nav, toast, ...top };

  // 转场动画：仅在入场瞬间挂载，结束后移除（避免静态渲染停在第 0 帧）
  const screenKey = stack.length + ':' + top.name;
  const [entering, setEntering] = React.useState(false);
  React.useEffect(() => { setEntering(true); }, [screenKey]);

  let screen = null;
  switch (top.name) {
    case 'home': screen = <HomeScreen {...props} />; break;
    case 'workspace': screen = <WorkspaceScreen {...props} />; break;
    case 'setup': screen = <SetupWizard {...props} />; break;
    case 'qa': screen = <QAScreen {...props} />; break;
    case 'flow': screen = <FlowScreen {...props} />; break;
    case 'records': screen = <RecordsScreen {...props} />; break;
    case 'last': screen = <LastRecordScreen {...props} />; break;
    case 'virtual': screen = <LastRecordScreen {...props} />; break; // 虚拟货架已并入调改清单页
    case 'info': screen = <InfoScreen {...props} />; break;
    default: screen = <HomeScreen {...props} />;
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: TOKENS.bg }}>
      <div
        key={screenKey}
        onAnimationEnd={() => setEntering(false)}
        style={{ position: 'absolute', inset: 0, animation: entering ? 'shv-screen-in 0.22s ease' : 'none' }}
      >
        {screen}
      </div>
      <Toast visible={toastState.visible} text={toastState.text} icon={<I.Check size={16} color="#fff" />} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
