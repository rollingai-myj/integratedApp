/**
 * 活动海报 (/posters)
 *
 * 1:1 复用原 rollingai-myj/poster repo 的整套 PosterApp（手机壳 + 11 屏流程）。
 * 只做两件适配：
 *   1. 在 mount 时把 host 的 useMe() 结果灌进 host-bridge，让 poster-app 内部的
 *      vanilla 模块（auth-client、@/lib/*.functions 等）读到当前用户 + 当前门店。
 *   2. 没登录或没选门店时直接跳走；poster-app 本身不再触发自己的登录流程。
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { PosterApp } from '@/components/posters/App';
import { setHostContext } from '@/components/posters/host-bridge';
import { authClient } from '@/components/posters/auth-client';
import { IOSDevice } from '@/components/IOSDevice';
import { useMe } from '@/lib/auth';

export const Route = createFileRoute('/posters/')({
  component: PostersHostPage,
  head: () => ({
    meta: [
      { title: '活动海报 · 美宜佳' },
      { name: 'description', content: 'AI 生成活动促销海报' },
      {
        name: 'viewport',
        content:
          'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no',
      },
    ],
  }),
});

function PostersHostPage() {
  const meQuery = useMe();
  const navigate = useNavigate();
  const me = meQuery.data;

  // 把当前 session 灌进 host-bridge；切店 / 切人时通知 auth-client 的 listener
  useEffect(() => {
    if (!me?.user) {
      setHostContext(null);
      authClient.notifyHostContextChanged();
      return;
    }
    setHostContext({
      userId: me.user.id,
      userName: me.user.name,
      userEmail: me.user.email ?? null,
      storeId: me.currentStore?.id ?? null,
      storeCode: me.currentStore?.code ?? null,
      storeName: me.currentStore?.name ?? null,
      isSuperAdmin: me.user.roles.includes('super_admin'),
    });
    authClient.notifyHostContextChanged();
  }, [me]);

  // 未登录 → 跳 /login
  useEffect(() => {
    if (meQuery.isSuccess && !me?.user) {
      navigate({ to: '/login' });
    }
  }, [meQuery.isSuccess, me, navigate]);

  if (meQuery.isLoading) {
    return (
      <IOSDevice>
        <div className="h-full flex items-center justify-center text-sm text-ink-muted">
          载入中…
        </div>
      </IOSDevice>
    );
  }
  if (!me?.user) return null;

  // PosterApp 原 standalone repo 假设父容器铺满视口（自带 width/height: 100%），
  // 嵌到统一应用后必须给它一个有明确尺寸的壳，否则 100% × 100% 解析成 0 → 空白。
  // 沿用其它模块的 IOSDevice 容器（390 设计稿 + zoom 等比放大），视觉与首页一致。
  //
  // 主页键 ⌂ 和返回键由 PosterApp 内部承担:Home 屏 hero 右上挂第三枚圆角按钮 ⌂,
  // 其他屏的 AppBar 右侧也挂 ⌂(回 /),左侧 ← 走原本屏内 onBack(回上一屏)。
  // 不再用外层浮动胶囊 —— 它跟 PosterApp 原设计风格不协调,且会和 AppBar 双 ← 重叠。
  return (
    <IOSDevice>
      <PosterApp />
    </IOSDevice>
  );
}
