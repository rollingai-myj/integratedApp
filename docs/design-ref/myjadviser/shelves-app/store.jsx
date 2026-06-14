// 本地状态 —— localStorage 持久化（刷新不丢），并预置演示数据
// sceneState[id] = { config: ShelfGroup[]|null, records: [], lastSnapshot, virtual: 'none'|'generating'|'ready', draft }

const LS_KEY = 'shv-proto-state-v5';

function seedState() {
  return {
    scenes: {
      // 糖巧：完整老用户 —— 已配置、有2次记录、有上次快照、虚拟货架已生成
      0: {
        config: [{ shelf_type: '标准货架', shelf_width: 75, shelf_layers: 5, category: '糖果&巧克力' }],
        records: SEED_RECORDS,
        lastSnapshot: {
          at: '2026-05-28T15:42:00',
          summary: '上架了3个品，停止进货了2个品',
          photoCount: 2,
          diagnosis: DIAGNOSIS,
          items: SEED_RECORDS[0].items,
        },
        virtual: 'ready',
        draft: null,
        qaDone: true,
        env: {
          crowd: '写字楼底商，主力客群为 25–35 岁上班族，下午茶与加班时段为高峰。',
          competitor: '300 米内 2 家连锁便利店、1 家零食量贩店；量贩店主打大包装低价散糖。',
        },
      },
      // 小零食：有未完成的调改草稿（演示"继续"路径：方案确认到一半）
      3: {
        config: [{ shelf_type: '标准货架', shelf_width: 90, shelf_layers: 4, category: '蜜饯果干' }],
        records: [],
        lastSnapshot: null,
        virtual: 'none',
        draft: { stage: 'review', photoCount: 1, reviewIndex: 4, decisions: ['accept', 'accept', 'skip', 'accept'], skipReasons: [null, null, '还有库存要卖完', null], note: '方案确认到一半' },
        qaDone: true,
        env: null,
      },
      // 方便速食：已登记货架但还没聊过、没做过调改（演示「聊一聊」前置环节）
      6: {
        config: [
          { shelf_type: '标准货架', shelf_width: 75, shelf_layers: 5, category: '方便面' },
          { shelf_type: '端架', shelf_width: 60, shelf_layers: 4, category: '自热食品' },
        ],
        records: [],
        lastSnapshot: null,
        virtual: 'none',
        draft: null,
        qaDone: false,
        env: null,
      },
    },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return seedState();
}

function emptyScene() {
  return { config: null, records: [], lastSnapshot: null, virtual: 'none', draft: null, qaDone: false, env: null };
}

// useAppState：单一全局 store，setState 自动持久化
function useAppState() {
  const [state, setStateRaw] = React.useState(loadState);
  const setState = React.useCallback((updater) => {
    setStateRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
      return next;
    });
  }, []);

  const getScene = (id) => state.scenes[id] ?? emptyScene();

  const patchScene = (id, patch) => {
    setState((prev) => ({
      ...prev,
      scenes: { ...prev.scenes, [id]: { ...(prev.scenes[id] ?? emptyScene()), ...patch } },
    }));
  };

  const resetDemo = () => {
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
    setStateRaw(seedState());
  };

  return { state, getScene, patchScene, resetDemo };
}

// 陈列示意图生成中 → 到时自动完成（哪个页面挂着都能跑完）
function useVirtualAutoReady(app, sceneId) {
  const sc = app.getScene(sceneId);
  React.useEffect(() => {
    if (sc.virtual !== 'generating') return;
    const elapsed = Date.now() - (sc.virtualStartedAt || Date.now());
    const remain = Math.max(600, 8000 - elapsed);
    const t = setTimeout(() => app.patchScene(sceneId, { virtual: 'ready' }), remain);
    return () => clearTimeout(t);
  }, [sc.virtual]);
}

Object.assign(window, { useAppState, emptyScene, useVirtualAutoReady });
