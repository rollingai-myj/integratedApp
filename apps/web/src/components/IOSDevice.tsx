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
 *   - 内层 width: 390px（local）  → 视觉 = 390 * zoom = viewportWidth ✓
 *   - 内层 height: (100/zoom)vh   → 视觉 = (100/zoom)vh * zoom = 100vh ✓
 *   这样内层"一屏"的视觉尺寸 = 视口大小，页面里 h-full / min-h-full 就能正常工作。
 *
 * 浏览器支持：CSS `zoom` Chrome/Safari 长年支持，Firefox 126+。会同步影响 layout box
 *           （和 transform: scale 不同），所以 100vh 等单位会正确传导。
 *
 * SSR：首屏 zoom=1（设计稿原始 390 宽，会在左上一闪），hydrate 后 useEffect 锁定真实比例。
 */
const DESIGN_WIDTH = 390;

export function IOSDevice({ children }: Props) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const update = () => setZoom(window.innerWidth / DESIGN_WIDTH);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return (
    <Ctx.Provider value={{ zoom, designWidth: DESIGN_WIDTH }}>
      <div className="w-full bg-background overflow-x-hidden">
        <div
          style={{
            width: `${DESIGN_WIDTH}px`,
            height: `${100 / zoom}vh`,
            zoom,
          }}
        >
          <div className="relative h-full overflow-y-auto">{children}</div>
        </div>
      </div>
    </Ctx.Provider>
  );
}
