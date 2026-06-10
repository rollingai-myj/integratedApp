/**
 * 选品模块外壳
 *
 * 所有 /shelves/* 路由都套这一层：
 *   - useMe() 校验登录态；未登录 → /login；未选门店 → /select-store
 *   - 把当前 currentStore.code 注入 AppContext（原 repo 的 selectedStore）
 *   - 首次拉一遍 /api/v1/skus 写入内存缓存，让同步的 getStoreSkuData() 能读到
 *   - 首次拉 /portal/stores 装门店坐标 cache，让 useShelfQuestions /
 *     useEnvironmentInsight 同步取到 GCJ02 "lng,lat"
 *   - 注入最小 AuthContext，避免任何残留组件挂载时抛错
 */
import { useEffect, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useMe } from '@/lib/auth';
import { IOSDevice } from '@/components/IOSDevice';
import { AppProvider } from '@/components/shelves/contexts/AppContext';
import { AuthProvider, type AuthUser } from '@/components/shelves/contexts/AuthContext';
import { loadStoreSkus } from '@/components/shelves/data/skuDataByStore';
import { loadStoreCoordinates } from '@/components/shelves/data/storeCoordinates';

interface Props {
  children: ReactNode;
  /** 跳过 currentStore 校验（HomePage 才用得到——理论上 useMe 保证此时有店，但开发期不强校） */
  allowNoStore?: boolean;
}

export function ShelvesAppShell({ children, allowNoStore = false }: Props) {
  const meQuery = useMe();
  const navigate = useNavigate();
  const me = meQuery.data;

  useEffect(() => {
    if (meQuery.isSuccess && !me?.user) {
      navigate({ to: '/login' });
      return;
    }
    if (!allowNoStore && meQuery.isSuccess && me?.user && !me.currentStore) {
      navigate({ to: '/select-store' });
    }
  }, [meQuery.isSuccess, me?.user, me?.currentStore, navigate, allowNoStore]);

  const storeCode = me?.currentStore?.code ?? '';
  // 进入模块后并发拉 SKU；失败不阻塞渲染（页面里会显示空数据）
  useQuery({
    queryKey: ['shelves', 'skus', storeCode],
    queryFn: () => loadStoreSkus(storeCode),
    enabled: !!storeCode,
    staleTime: 5 * 60_000,
  });
  // 装门店坐标 cache（/portal/stores 一次性给全部可访问门店的 lat/lng/address）；
  // 必须在用户进 SurveyPage 触发问题生成前装好，否则 getStoreCoordinates 返回
  // undefined → useShelfQuestions 抛"门店未配置经纬度"。
  // staleTime 30 分钟够长：门店地址几乎不变，避免反复拉。
  useQuery({
    queryKey: ['shelves', 'store-coordinates'],
    queryFn: async () => {
      await loadStoreCoordinates();
      return true;
    },
    enabled: !!me?.user,
    staleTime: 30 * 60_000,
  });

  if (meQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中…
      </div>
    );
  }
  if (!me?.user) return null;

  const authUser: AuthUser = {
    account: me.user.email ?? me.user.name,
    storeId: me.currentStore?.id ?? '',
    storeLabel: me.currentStore?.name ?? '',
    isAdmin: me.user.roles.includes('super_admin'),
  };

  return (
    <AuthProvider user={authUser}>
      <AppProvider
        selectedStore={storeCode}
        storeName={me.currentStore?.name ?? ''}
        storeAddress={''}
      >
        {/* 整层 zoom: viewportW/390 把原 iPhone 设计稿等比放大撑满桌面浏览器；
            不包 IOSDevice → 桌面上字号/间距视觉缩成原 1/3，比例错乱。
            前车之鉴：posters/prices 都遇到过同样问题，见 memory/feedback-iosdevice-wrap */}
        <IOSDevice>{children}</IOSDevice>
      </AppProvider>
    </AuthProvider>
  );
}
