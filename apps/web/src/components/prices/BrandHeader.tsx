/**
 * 价盘 · 品牌头（来自原 priceChange repo）
 *
 * 唯一适配：门店号从 session（/auth/me 的 currentStore）取，而非原版的写死 "32826"。
 */
import { Link } from '@tanstack/react-router';
import { useMe } from '@/lib/auth';

export function BrandHeader({ showBack }: { showBack?: boolean }) {
  const meQuery = useMe();
  const storeCode = meQuery.data?.currentStore?.code ?? '';

  return (
    <header className="sticky top-0 z-30 w-full">
      <div className="glass-card mx-3 mt-3 flex h-14 items-center justify-between rounded-full px-2.5 pl-3 pr-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {showBack && (
            <Link
              to="/prices"
              className="icon-btn h-9 w-9 text-base"
              aria-label="返回"
            >
              ←
            </Link>
          )}
          <Link to="/prices" className="flex min-w-0 items-center gap-2.5">
            <div className="min-w-1 leading-tight">
              <div className="label-eyebrow" style={{ color: 'var(--brand)' }}>
                Price · 价盘助手
              </div>
              <div className="truncate text-[13px] font-bold text-foreground">
                {storeCode ? `门店 ${storeCode}` : '未选择门店'}
              </div>
            </div>
          </Link>
        </div>
      </div>
    </header>
  );
}
