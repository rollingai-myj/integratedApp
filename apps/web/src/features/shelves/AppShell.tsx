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
    if (meQuery.isSuccess && !me?.user) {
      void navigate({ to: '/login' });
      return;
    }
    if (meQuery.isSuccess && me?.user && !me.currentStore) {
      void navigate({ to: '/select-store' });
    }
  }, [meQuery.isSuccess, me?.user, me?.currentStore, navigate]);

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
