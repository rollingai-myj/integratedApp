import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

interface Props {
  children: ReactNode;
}

/**
 * 通过 React Context 把 zoom 暴露给 portal 内的弹窗用。
 *
 * Radix Dialog 默认 portal 到 document.body，DOM 上跳出了 IOSDevice 的 `zoom` 容器，
 * 不会被等比缩放，所以字号在桌面端看起来特别小。弹窗组件读 context 拿到当前 zoom，
 * 直接给自己加 inline `zoom` 样式即可保持与页面同比。
 *
 * 不在 IOSDevice 树内时返回 null → 弹窗 fallback 到默认 zoom=1 行为不变。
 */
interface IOSDeviceCtx {
  zoom: number;
  designWidth: number;
}
const Ctx = createContext<IOSDeviceCtx | null>(null);
export const useIOSDeviceZoom = (): IOSDeviceCtx | null => useContext(Ctx);

/**
 * 视口容器：把 390×844（iPhone 14 视口）设计稿整层 zoom 等比放大到撑满视口宽度。
 *
 * 为什么这样而不是改成 100% 宽？
 *   全站 UI 用的是 `text-[26px]`、`px-[22px]` 这种针对 390 宽度设计的固定像素值。
 *   若只把容器拉到 100%，里面元素不会跟着大，看起来比例错乱。
 *   把 zoom 设成 viewportWidth / 390，让所有字号、间距、卡片、图标按同一比例放大，
 *   视觉等同于"原 390 设计稿被等比放大撑满屏幕"。
 *
 * 关键尺寸换算：
 *   - 内层 width: 390px（local）   → 视觉 = 390 * zoom = viewportWidth ✓
 *   - 内层 height: (viewportH/zoom)px → 视觉 = (viewportH/zoom) * zoom = viewportH ✓
 *
 * 为什么 height 用 px 而不是 (100/zoom)vh？
 *   iOS 18+ Safari (iPhone 16/17) 下 vh 在 CSS `zoom` 容器内的解析不再等价于
 *   viewportHeight，(100/zoom)vh 实测会算成"上半部分"，下方留大片空白。
 *   直接读 visualViewport.height（fallback innerHeight）然后除 zoom 转 px，
 *   绕开浏览器各自的 vh-under-zoom 差异，结果可预测。
 *
 * 为什么读 visualViewport 而不是 innerWidth/Height？
 *   iOS Safari 的 URL bar 折叠/展开不一定触发 window 的 resize，只触发
 *   visualViewport 的 resize/scroll。listen 它的事件 + 读它的尺寸 → URL bar
 *   状态变化时 zoom 和 height 都能跟上，避免"页面只占上半"。
 *
 * 浏览器支持：CSS `zoom` Chrome/Safari 长年支持，Firefox 126+。会同步影响 layout box
 *           （和 transform: scale 不同），所以子层 h-full 等单位会正确传导。
 *
 * SSR：首屏用 390×844 兜底（设计稿原始尺寸，会在左上一闪），hydrate 后 useEffect 锁定真实比例。
 */
const DESIGN_WIDTH = 390;

/**
 * Context 里的 zoom 给 portal 弹窗用（弹窗 portal 到 body，跳出 IOSDevice 的 zoom 容器，
 * 自己加 zoom 同比缩放）。首屏由 __root.tsx 的早期内联脚本写好 CSS 变量，所以这里 React
 * 状态只服务于 portal 弹窗 + resize/URL-bar-collapse 后的实时跟随。
 */
export function IOSDevice({ children }: Props) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const update = () => {
      const vv = window.visualViewport;
      const w = vv?.width ?? window.innerWidth;
      const h = vv?.height ?? window.innerHeight;
      const z = w / DESIGN_WIDTH;
      // 把 CSS 变量同步到 documentElement，inline style 通过 var() 读取，
      // 避免 React 重渲染 → DOM 写入的延迟，URL bar 折叠时 zoom 容器立刻跟随。
      const de = document.documentElement;
      de.style.setProperty('--iod-zoom', String(z));
      de.style.setProperty('--iod-h', `${h / z}px`);
      setZoom(z);
    };
    update();
    window.addEventListener('resize', update);
    // iOS Safari URL bar 折叠触发的是 visualViewport.resize/scroll，不是 window.resize
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, []);

  return (
    <Ctx.Provider value={{ zoom, designWidth: DESIGN_WIDTH }}>
      {/* position: fixed + inset:0 把容器钉死在视口，body 上下左右的 rubber-band
         在 iOS Safari 上 overflow:hidden 拦不住，必须配合 fixed 才能彻底锁死。 */}
      <div
        className="bg-background overflow-hidden"
        style={{ position: 'fixed', inset: 0 }}
      >
        <div
          style={{
            width: `${DESIGN_WIDTH}px`,
            // SSR HTML 用 var() 读 __root.tsx 提前注入的 CSS 变量，浏览器首帧就是正确比例
            height: 'var(--iod-h, 844px)',
            zoom: 'var(--iod-zoom, 1)',
          }}
        >
          {/* 全站唯一的"业务滚动器"：
             - overflow-y-auto：列表/长页面用得到
             - overscroll-behavior: contain：到顶/到底不再向外冒泡触发 body bounce
             横向锁定靠外层 fixed + overflow:hidden 实现；这里不设 touch-action: pan-y，
             否则页内合法的横滑组件（海报/货架横滑列表）也会被禁用。 */}
          <div
            className="relative h-full overflow-y-auto"
            style={{ overscrollBehavior: 'contain' }}
          >
            {children}
          </div>
        </div>
      </div>
    </Ctx.Provider>
  );
}
