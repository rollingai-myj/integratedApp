/**
 * 选品模块外壳
 *
 * 比旧版精简：只负责登录/选店守卫 + IOSDevice 包裹，所有数据走 P3 后端。
 */
import { useEffect, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMe } from '@/lib/auth';
import { IOSDevice } from '@/components/IOSDevice';

export function ShelvesAppShell({ children }: { children: ReactNode }) {
  const meQuery = useMe();
  const navigate = useNavigate();
  const me = meQuery.data;

  useEffect(() => {
    if (!meQuery.isSuccess) return;
    if (!me?.user) {
      void navigate({ to: '/login' });
      return;
    }
    if (!me.currentStore) {
      // 0 店（无门店权限）→ 没东西可选，回首页（首页会显示 notice）
      // 多店但未选 → 才去 /select-store
      // 单店 auth.service 已自动落到唯一一家，正常不会进这分支
      if (me.stores.length > 1) void navigate({ to: '/select-store' });
      else void navigate({ to: '/' });
    }
  }, [meQuery.isSuccess, me?.user, me?.currentStore, me?.stores.length, navigate]);

  if (meQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中…
      </div>
    );
  }
  if (!me?.user || !me.currentStore) return null;

  return <IOSDevice>{children}</IOSDevice>;
}
