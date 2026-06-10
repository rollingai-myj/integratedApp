/**
 * 海报 · 品牌头
 *
 * 视觉规范 1:1 复制 prices/BrandHeader（glass-card 长椭圆 + 返回箭头），
 * 让 posters / prices / shelves 三个功能模块顶部条保持一致。
 * 文案换成 "Poster · 促销海报"。
 *
 * 暂未提取为共享组件：shelves 也是 inline 写一份，三处是 source-of-truth 冗余；
 * 后续如果再多一个模块复用，再统一抽到 components/ModuleHeader。
 */
import { Link } from '@tanstack/react-router';
import { useMe } from '@/lib/auth';

interface Props {
  /** 显示左上角返回箭头。默认指向 /posters；从 PostersHostPage 传 '/' 回到门户 */
  backTo?: '/' | '/posters';
}

export function BrandHeader({ backTo }: Props) {
  const meQuery = useMe();
  const storeCode = meQuery.data?.currentStore?.code ?? '';

  return (
    <header className="absolute left-0 right-0 top-0 z-30">
      <div className="glass-card mx-3 mt-3 flex h-14 items-center justify-between rounded-full px-2.5 pl-3 pr-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {backTo && (
            <Link
              to={backTo}
              className="icon-btn h-9 w-9 text-base"
              aria-label="返回"
            >
              ←
            </Link>
          )}
          <Link to="/posters" className="flex min-w-0 items-center gap-2.5">
            <div className="min-w-1 leading-tight">
              <div className="label-eyebrow" style={{ color: 'var(--brand)' }}>
                Poster · 促销海报
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
