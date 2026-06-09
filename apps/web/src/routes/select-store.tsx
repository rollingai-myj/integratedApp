/**
 * 超管选店页 (/select-store)
 *
 * 超管登录后 currentStore 为 null（auth.service.ts 不再 fallback 到 stores[0]）。
 * HomePage 检测到这种情况会重定向到这里。普通账号 user_stores 里有 primary 记录，
 * pickCurrentStore 会自动选中，跳不到这里。
 *
 * 流程：搜索过滤（按门店编号或名称）→ 点击门店 → 调 switchStore → 跳 /
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { LogOut, Search } from 'lucide-react';
import { BrandMark } from '@/components/BrandMark';
import { IOSDevice } from '@/components/IOSDevice';
import {
  isAuthenticated,
  useLogout,
  useMe,
  useSwitchStore,
} from '@/lib/auth';
import type { StoreRef } from '@myj/shared';

export const Route = createFileRoute('/select-store')({
  component: SelectStorePage,
  head: () => ({
    meta: [
      { title: '选择门店 · 美宜佳门店助手' },
      { name: 'description', content: '超管登录后选择目标门店再进入功能页' },
    ],
  }),
});

function SelectStorePage() {
  const navigate = useNavigate();
  const meQuery = useMe();
  const logout = useLogout();
  const switchStore = useSwitchStore();

  const [keyword, setKeyword] = useState('');
  const [pickingId, setPickingId] = useState<string | null>(null);

  // 未登录 → 回登录页；已选好门店（currentStore 不空）→ 回首页
  useEffect(() => {
    if (!meQuery.isSuccess) return;
    const me = meQuery.data;
    if (!isAuthenticated(me)) {
      void navigate({ to: '/login' });
      return;
    }
    if (me?.currentStore) {
      void navigate({ to: '/' });
    }
  }, [meQuery.isSuccess, meQuery.data, navigate]);

  const me = meQuery.data;
  const stores: StoreRef[] = me?.stores ?? [];

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return stores;
    return stores.filter(
      (s) =>
        s.code.toLowerCase().includes(kw) ||
        s.name.toLowerCase().includes(kw),
    );
  }, [keyword, stores]);

  const onPick = (target: StoreRef) => {
    if (pickingId) return;
    setPickingId(target.id);
    switchStore.mutate(
      { storeId: target.id },
      {
        onSuccess: () => {
          void navigate({ to: '/' });
        },
        onSettled: () => setPickingId(null),
      },
    );
  };

  if (meQuery.isLoading || !me?.user) {
    return (
      <IOSDevice>
        <div className="h-full flex items-center justify-center text-ink-muted text-sm">
          载入中…
        </div>
      </IOSDevice>
    );
  }

  return (
    <IOSDevice>
      <div className="h-full bg-background flex flex-col">
        {/* Header */}
        <header className="flex items-center gap-3 px-[22px] pt-3">
          <BrandMark size={36} bg="var(--primary)" fg="#fff" />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] text-ink-muted tracking-wide leading-none mb-1">
              {me.user.name}
            </div>
            <div className="text-[15px] font-semibold text-ink truncate">
              请选择门店
            </div>
          </div>
          <button
            onClick={() => void logout().then(() => navigate({ to: '/login' }))}
            aria-label="退出登录"
            className="w-[38px] h-[38px] rounded-xl bg-surface border border-hairline flex items-center justify-center"
          >
            <LogOut size={18} className="text-ink" />
          </button>
        </header>

        {/* Intro */}
        <section className="px-[22px] pt-3.5 pb-1.5">
          <h1 className="text-[24px] font-semibold text-ink leading-tight tracking-wide">
            进入哪家门店？
          </h1>
          <div className="text-[12.5px] text-ink-muted mt-1.5 tracking-wide">
            选中后进入功能选择页 · 共 {stores.length} 家
          </div>
        </section>

        {/* Search */}
        <div className="px-[22px] mt-3">
          <label className="relative block">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
            />
            <input
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="按门店编号或名称搜索"
              autoFocus
              className="w-full h-11 pl-9 pr-3 rounded-2xl border border-hairline bg-surface text-[14px] text-ink placeholder:text-ink-muted outline-none focus:border-primary"
            />
          </label>
        </div>

        {/* List */}
        <section className="flex-1 min-h-0 mt-3 px-[22px] pb-6 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="mt-10 text-center text-[13px] text-ink-muted">
              没有匹配 “{keyword}” 的门店
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {filtered.map((s) => {
                const picking = pickingId === s.id;
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => onPick(s)}
                      disabled={!!pickingId}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface border border-hairline text-left active:scale-[0.99] transition-transform disabled:opacity-50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-semibold text-ink truncate">
                          {s.code}
                        </div>
                        <div className="text-[12px] text-ink-muted truncate">
                          {s.name}
                        </div>
                      </div>
                      <span
                        className="text-[12px] font-medium"
                        style={{ color: 'var(--primary)' }}
                      >
                        {picking ? '进入中…' : '进入 →'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </IOSDevice>
  );
}
