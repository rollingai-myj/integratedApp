/**
 * 门户首页 (/)
 *
 * M1-PR3：
 *   - 未登录 → 跳 /login
 *   - 已登录 → 显示真实用户、当前门店、4 个模块卡（按 me.modules 控制是否可点）
 *   - 多门店 → 显示切店按钮 + 弹层
 *   - notice 不为空（飞书绑定但 0 门店） → 顶部黄色提示卡，模块卡片置灰
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { LogOut, ChevronDown } from 'lucide-react';
import { BrandMark } from '@/components/BrandMark';
import { IOSDevice } from '@/components/IOSDevice';
import {
  useMe,
  useLogout,
  useSwitchStore,
  isAuthenticated,
} from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import storefront from '@/assets/storefront-red.png';
import type { ModuleKey, StoreRef } from '@myj/shared';

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

interface ModuleDef {
  id: ModuleKey | 'radar';
  name: string;
  desc: string;
  to?: string;
  icon: React.ReactNode;
}

const MODULES: ModuleDef[] = [
  { id: 'shelves',  name: '货盘选品', desc: '新品上架 · 滞销下架', to: '/shelves/position', icon: <ShelvesIcon /> },
  { id: 'prices',   name: '价盘管理', desc: '智能调价 · 价格追踪', to: '/prices',  icon: <PriceIcon /> },
  { id: 'radar',    name: '竞品报告', desc: '商品结构 · 售价对比',                 icon: <RadarIcon /> }, // 竞品同事的模块，暂未启用
  { id: 'posters',  name: '活动海报', desc: '私域运营 · 海报生成', to: '/posters', icon: <PosterIcon /> },
];

function HomePage() {
  const navigate = useNavigate();
  const meQuery = useMe();
  const logout = useLogout();

  useEffect(() => {
    if (!meQuery.isSuccess) return;
    const me = meQuery.data;
    if (!isAuthenticated(me)) {
      void navigate({ to: '/login' });
      return;
    }
    // 没有 currentStore + 有可选门店 → 强制走选店页
    // 覆盖：超管首登、飞书/legacy 多店账号（auth.service 故意把 active_store_id 留 null）
    if (!me?.currentStore && (me?.stores.length ?? 0) > 0) {
      void navigate({ to: '/select-store' });
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
  if (!me?.user) {
    return (
      <IOSDevice>
        <div className="h-full flex items-center justify-center text-ink-muted text-sm">
          跳转登录中…
        </div>
      </IOSDevice>
    );
  }

  const user = me.user;
  const store = me.currentStore;
  const enabledModules = new Set<string>(me.modules);

  return (
    <IOSDevice>
      <div className="h-full bg-background flex flex-col pb-8">
        {/* Header */}
        <header className="flex items-center gap-3 px-[22px] pt-3">
          <BrandMark size={36} bg="var(--primary)" fg="#fff" />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] text-ink-muted tracking-wide leading-none mb-1">
              {user.name}
            </div>
            <StoreSelector store={store} stores={me.stores} />
          </div>
          <button
            onClick={() => void logout().then(() => navigate({ to: '/login' }))}
            aria-label="退出登录"
            className="w-[38px] h-[38px] rounded-xl bg-surface border border-hairline flex items-center justify-center"
          >
            <LogOut size={18} className="text-ink" />
          </button>
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

        {/* Notice（飞书绑定但 0 门店） */}
        {me.notice && (
          <div className="mx-[22px] mt-3 px-4 py-3 rounded-2xl border border-amber-200 bg-amber-50">
            <div className="text-[12.5px] font-semibold text-amber-900 mb-1">
              门店未匹配
            </div>
            <div className="text-[11.5px] text-amber-800 leading-snug">
              {me.notice.message}
            </div>
          </div>
        )}

        {/* Module cards */}
        <section className="px-[22px] mt-2 grid grid-cols-2 gap-3.5">
          {MODULES.map((m) => {
            const isEnabled =
              m.id === 'radar' ? false : enabledModules.has(m.id);
            const clickable = isEnabled && !!m.to && me.stores.length > 0;
            const card = (
              <button
                key={m.id}
                disabled={!clickable}
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
            return clickable ? (
              <Link key={m.id} to={m.to!} className="block">
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

// ---- 切店组件 ------------------------------------------------------------

interface StoreSelectorProps {
  store: StoreRef | null;
  stores: StoreRef[];
}

function StoreSelector({ store, stores }: StoreSelectorProps) {
  const [open, setOpen] = useState(false);
  const switchStore = useSwitchStore();

  const multiple = stores.length > 1;

  const onPick = (target: StoreRef) => {
    if (target.id === store?.id) {
      setOpen(false);
      return;
    }
    switchStore.mutate(
      { storeId: target.id },
      {
        onSettled: () => setOpen(false),
        onError: (err) => {
          // 失败保留 modal 让用户重试
          if (err instanceof ApiError) {
            // eslint-disable-next-line no-console
            console.error('切店失败', err.message);
          }
        },
      },
    );
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => multiple && setOpen((v) => !v)}
        disabled={!multiple}
        className="flex items-center gap-1.5 text-left max-w-full disabled:cursor-default"
      >
        <span className="text-[15px] font-semibold text-ink truncate">
          {store?.code ? `${store.code} · ${store.name}` : '尚未选择门店'}
        </span>
        {multiple && <ChevronDown size={14} className="text-ink-muted shrink-0" />}
      </button>

      {open && multiple && (
        <>
          <div
            className="fixed inset-0 z-10 bg-black/20"
            onClick={() => setOpen(false)}
          />
          <div className="absolute z-20 mt-2 left-0 right-0 max-h-[300px] overflow-y-auto rounded-2xl border border-hairline bg-surface shadow-lg">
            {stores.map((s) => {
              const active = s.id === store?.id;
              return (
                <button
                  key={s.id}
                  onClick={() => onPick(s)}
                  className={`w-full text-left px-4 py-2.5 text-[13px] border-b border-hairline last:border-b-0 ${
                    active ? 'bg-primary/10 text-primary font-semibold' : 'text-ink'
                  }`}
                >
                  <div className="font-medium">{s.code}</div>
                  <div className="text-[11px] text-ink-muted truncate">{s.name}</div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
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
