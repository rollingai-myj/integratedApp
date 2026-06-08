/**
 * 门户首页 (/)
 *
 * - 未登录 → 引导去 /login
 * - 已登录 → 显示 4 个模块卡片（货盘选品 / 价盘管理 / 竞品报告（占位）/ 活动海报）
 *
 * M0：模块卡片直接列出，点击跳转到对应模块的占位页。
 *      门店信息使用 /auth/me 返回的 currentStore；M0 后端返回 null，前端显示"未选门店"。
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { LogOut } from 'lucide-react';
import { BrandMark } from '@/components/BrandMark';
import { IOSDevice } from '@/components/IOSDevice';
import { useMe, useLogout, isAuthenticated } from '@/lib/auth';
import storefront from '@/assets/storefront-red.png';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '凌晨好';
  if (h < 11) return '早上好';
  if (h < 13) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

interface Module {
  id: 'shelves' | 'prices' | 'radar' | 'posters';
  name: string;
  desc: string;
  to?: string;
  icon: React.ReactNode;
}

const MODULES: Module[] = [
  { id: 'shelves',  name: '货盘选品', desc: '新品上架 · 滞销下架', to: '/shelves', icon: <ShelvesIcon /> },
  { id: 'prices',   name: '价盘管理', desc: '智能调价 · 价格追踪', to: '/prices',  icon: <PriceIcon /> },
  { id: 'radar',    name: '竞品报告', desc: '商品结构 · 售价对比',                 icon: <RadarIcon /> },
  { id: 'posters',  name: '活动海报', desc: '私域运营 · 海报生成', to: '/posters', icon: <PosterIcon /> },
];

function HomePage() {
  const navigate = useNavigate();
  const meQuery = useMe();
  const logout = useLogout();

  // 未登录 → 跳转登录页（M1 接通后这里改成"登录后回跳"）
  useEffect(() => {
    if (meQuery.isSuccess && !isAuthenticated(meQuery.data)) {
      void navigate({ to: '/login' });
    }
  }, [meQuery.isSuccess, meQuery.data, navigate]);

  if (meQuery.isLoading) {
    return (
      <IOSDevice>
        <div className="h-full flex items-center justify-center text-ink-muted text-sm">
          载入中…
        </div>
      </IOSDevice>
    );
  }

  const me = meQuery.data;
  const user = me?.user;
  const store = me?.currentStore;

  return (
    <IOSDevice>
      <div className="h-full bg-background flex flex-col pb-8">
        {/* Header */}
        <header className="flex items-center gap-3 px-[22px] pt-3">
          <BrandMark size={36} bg="var(--primary)" fg="#fff" />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] text-ink-muted tracking-wide leading-none mb-1">
              {store?.storeId ?? '尚未选择门店'}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[15px] font-semibold text-ink truncate">
                {store?.storeLabel ?? (user?.displayName ?? '门店助手')}
              </span>
              {store?.storeType && (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{
                    background: 'var(--primary-soft)',
                    color: 'var(--primary-dark)',
                    letterSpacing: '0.05em',
                  }}
                >
                  {store.storeType}
                </span>
              )}
            </div>
          </div>
          {user && (
            <button
              onClick={() => void logout().then(() => navigate({ to: '/login' }))}
              aria-label="退出登录"
              className="w-[38px] h-[38px] rounded-xl bg-surface border border-hairline flex items-center justify-center"
            >
              <LogOut size={18} className="text-ink" />
            </button>
          )}
        </header>

        {/* Greeting */}
        <section className="px-[22px] pt-3.5 pb-1.5">
          <h1 className="text-[26px] font-semibold text-ink leading-tight tracking-wide">
            {greeting()}
          </h1>
          <div className="text-[13px] text-ink-muted mt-1.5 tracking-wide">
            欢迎回到美宜佳门店助手
          </div>
        </section>

        {/* Module cards */}
        <section className="px-[22px] mt-2 grid grid-cols-2 gap-3.5">
          {MODULES.map((m) => {
            const card = (
              <button
                key={m.id}
                disabled={!m.to}
                className="relative text-left bg-surface border border-hairline rounded-2xl p-4 active:scale-[0.97] transition-transform overflow-hidden flex flex-col gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed w-full"
                style={{
                  boxShadow: '0 1px 0 rgba(31,26,23,0.02)',
                  aspectRatio: '1 / 1.08',
                }}
              >
                <div
                  className="w-11 h-11 rounded-[14px] flex items-center justify-center mb-1"
                  style={{ background: 'var(--primary-soft)' }}
                >
                  {m.icon}
                </div>
                <div className="text-[17px] font-semibold text-ink mt-1.5 tracking-wide">
                  {m.name}
                </div>
                <div className="text-[12px] text-ink-muted leading-snug tracking-wide">
                  {m.desc}
                </div>
              </button>
            );
            return m.to ? (
              <Link key={m.id} to={m.to} className="block">
                {card}
              </Link>
            ) : (
              <div key={m.id}>{card}</div>
            );
          })}
        </section>

        {/* Illustration */}
        <div className="flex-1 min-h-0 mt-2 px-4 flex justify-center items-center">
          <img
            src={storefront}
            alt="美宜佳门店插画"
            className="max-w-full max-h-full w-auto h-auto object-contain"
          />
        </div>
      </div>
    </IOSDevice>
  );
}

// ---- Module icons (沿用门户 demo 的风格) ----

function ShelvesIcon() {
  return (
    <svg viewBox="0 0 48 48" width="30" height="30" fill="none">
      <rect x="8" y="10" width="32" height="28" rx="3" stroke="var(--primary)" strokeWidth="2" />
      <path d="M8 20h32M8 28h32" stroke="var(--primary)" strokeWidth="2" />
      <rect x="12" y="13" width="5" height="5" rx="1" fill="var(--primary)" opacity="0.85" />
      <rect x="20" y="13" width="5" height="5" rx="1" fill="var(--primary)" opacity="0.5" />
      <rect x="12" y="22" width="5" height="5" rx="1" fill="var(--primary)" opacity="0.5" />
      <rect x="28" y="22" width="5" height="5" rx="1" fill="var(--primary)" opacity="0.85" />
      <rect x="12" y="30" width="5" height="5" rx="1" fill="var(--primary)" opacity="0.85" />
    </svg>
  );
}
function PriceIcon() {
  return (
    <svg viewBox="0 0 48 48" width="30" height="30" fill="none">
      <path d="M25 6h13a2 2 0 012 2v13L21 41 7 27 25 6z" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" fill="var(--primary)" fillOpacity="0.12" />
      <circle cx="32" cy="14" r="2.5" fill="var(--primary)" />
      <text x="17" y="30" fontSize="13" fontWeight="700" fill="var(--primary)" fontFamily="system-ui">¥</text>
    </svg>
  );
}
function RadarIcon() {
  return (
    <svg viewBox="0 0 48 48" width="30" height="30" fill="none">
      <rect x="8" y="22" width="6" height="18" rx="1.5" fill="var(--primary)" opacity="0.6" />
      <rect x="18" y="14" width="6" height="26" rx="1.5" fill="var(--primary)" opacity="0.85" />
      <rect x="28" y="18" width="6" height="22" rx="1.5" fill="var(--primary)" opacity="0.5" />
      <rect x="38" y="10" width="6" height="30" rx="1.5" fill="var(--primary)" />
    </svg>
  );
}
function PosterIcon() {
  return (
    <svg viewBox="0 0 48 48" width="30" height="30" fill="none">
      <rect x="8" y="6" width="32" height="36" rx="3" stroke="var(--primary)" strokeWidth="2" fill="var(--primary)" fillOpacity="0.1" />
      <circle cx="17" cy="16" r="3" fill="var(--primary)" />
      <path d="M8 32l9-9 8 8 6-5 9 9" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
