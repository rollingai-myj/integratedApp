/**
 * 价盘 · 品牌头(玻璃胶囊样式,沿用原 priceChange repo 视觉)
 *
 * 交互规则(全站三模块统一):
 *   - 左 ← 返回键:**始终显示**。传 `upTo` 跳指定路由(回模块内上一级);
 *     不传时跳 `/`(回功能选择)。
 *   - 右 ⌂ 主页键:**始终显示**,跳 `/`。
 *   - 入口页 ← 与 ⌂ 同趋(都跳 /),两键始终在 —— 三模块习惯一致。
 */
import { Link } from '@tanstack/react-router';
import { useMe } from '@/lib/auth';

interface Props {
  /** 模块内上一级路由。`/prices` 入口不传 = ← 默认跳 `/` 退出模块。 */
  upTo?: '/prices';
}

export function BrandHeader({ upTo }: Props) {
  const meQuery = useMe();
  const storeCode = meQuery.data?.currentStore?.code ?? '';
  const backTarget = upTo ?? '/';

  return (
    <header className="sticky top-0 z-30 w-full">
      <div className="glass-card mx-3 mt-3 flex h-14 items-center justify-between rounded-full px-2.5 pl-3 pr-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Link
            to={backTarget}
            className="icon-btn h-9 w-9 text-base"
            aria-label="返回"
          >
            ←
          </Link>
          <Link to="/prices" className="flex min-w-0 items-center gap-2.5">
            <div className="min-w-1 leading-tight">
              <div className="label-eyebrow" style={{ color: 'var(--brand)' }}>
                Price · 调价模拟器
              </div>
              <div className="truncate text-[13px] font-bold text-foreground">
                {storeCode ? `门店 ${storeCode}` : '未选择门店'}
              </div>
            </div>
          </Link>
        </div>
        <Link
          to="/"
          className="icon-btn h-9 w-9 shrink-0"
          aria-label="回到主页"
        >
          {/* 14×14 房子,描边 1.8,跟选品/海报 home icon 视觉对齐 */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M3 11.5L12 4l9 7.5M5 10.5V20h14V10.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
      </div>
    </header>
  );
}
