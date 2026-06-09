import * as React from 'react';

export type GuideStep = {
  id: string;
  text: string;
  /** Hint for where to place the tooltip. Auto-flipped if not enough room. */
  prefer?: 'top' | 'bottom';
  /** 'click-target' = 必须真点击高亮处推进，不渲染"下一步"按钮 */
  action?: 'click-target';
};

export const GUIDE_STEPS: GuideStep[] = [
  { id: 'mode-toggle', text: '先选模式：默认「允许叠券」会自动算出价格最低的方案；选「只用会员价」更简单。', prefer: 'bottom' },
  { id: 'filter-bar', text: '可以搜商品名，也可以只看「今明有效」或「不可退」的商品。', prefer: 'bottom' },
  { id: 'product-grid', text: '点商品卡左上角的勾选框，挑出要做海报的商品（最多 10 个）。勾上后底部会出现红色按钮。', prefer: 'top' },
  { id: 'start-batch-btn', text: '选好商品后，点这个红色按钮进入下一步。', prefer: 'top', action: 'click-target' },
  { id: 'upload-mode-card', text: '选拍照方式：每个商品都拍一张更真实；或只拍一张店里桌面，AI 自动把商品摆上去。', prefer: 'bottom' },
  { id: 'style-card', text: '选一个统一的海报风格，所有海报都会用这个风格。', prefer: 'bottom' },
  { id: 'item-card', text: '给商品拍照或上传图片；文案已自动填好，需要可以改。', prefer: 'bottom' },
  { id: 'submit-btn', text: '一切准备好后，点这里提交。1-2 分钟后台自动生成，可在首页右下角看进度。', prefer: 'top' },
];

type Ctx = {
  step: number; // -1 表示未激活
  isActive: boolean;
  start: () => void;
  next: () => void;
  skip: () => void;
};

const GuideCtx = React.createContext<Ctx | null>(null);

export function useGuide() {
  const v = React.useContext(GuideCtx);
  if (!v) throw new Error('useGuide must be used inside GuideProvider');
  return v;
}

const SEEN_KEY = 'myj_guide_seen_v1';

export function hasSeenGuide(): boolean {
  try { return !!localStorage.getItem(SEEN_KEY); } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch {}
}

export function GuideProvider({ children }: { children: React.ReactNode }) {
  const [step, setStep] = React.useState(-1);

  const start = React.useCallback(() => setStep(0), []);
  const next = React.useCallback(() => {
    setStep(s => {
      const n = s + 1;
      if (n >= GUIDE_STEPS.length) { markSeen(); return -1; }
      return n;
    });
  }, []);
  const skip = React.useCallback(() => { markSeen(); setStep(-1); }, []);

  const value = React.useMemo(() => ({
    step, isActive: step >= 0, start, next, skip,
  }), [step, start, next, skip]);

  return <GuideCtx.Provider value={value}>{children}</GuideCtx.Provider>;
}
