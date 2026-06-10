/**
 * 登录页 (/login)
 *
 * M1-PR3：
 *   - 飞书登录按钮：调 /auth/feishu/authorize 拿 URL → window.location.href 跳转
 *   - 账号 + 密码兜底（D2 决策的过渡期通路）
 *   - 飞书回跳：当 URL 上有 ?code=&state= 时自动调 /auth/feishu/exchange
 *
 * 视觉沿用门户 demo 的渐变 hero + 卡片样式。
 */
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { IOSDevice } from '@/components/IOSDevice';
import { BrandMark } from '@/components/BrandMark';
import {
  useLogin,
  useFeishuExchange,
  useMe,
  isAuthenticated,
} from '@/lib/auth';
import { authApi, ApiError } from '@/lib/api-client';

const searchSchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
});

export const Route = createFileRoute('/login')({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: '登录 · 美宜佳门店助手' },
      { name: 'description', content: '飞书登录或账号密码兜底登录。' },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: '/login' });
  const meQuery = useMe();
  const login = useLogin();
  const feishuExchange = useFeishuExchange();

  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [feishuStarting, setFeishuStarting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // 已登录 → 跳首页
  useEffect(() => {
    if (meQuery.isSuccess && isAuthenticated(meQuery.data)) {
      void navigate({ to: '/' });
    }
  }, [meQuery.isSuccess, meQuery.data, navigate]);

  // 飞书回跳：URL 有 code 时自动兑换
  useEffect(() => {
    if (!search.code) return;
    if (feishuExchange.isPending || feishuExchange.isSuccess) return;
    feishuExchange.mutate(
      { code: search.code, state: search.state },
      {
        onSuccess: () => {
          void navigate({ to: '/', search: undefined as never });
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            setErrMsg(err.message);
          } else {
            setErrMsg('飞书登录失败，请重试');
          }
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.code, search.state]);

  const onSubmitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg(null);
    login.mutate(
      { account: account.trim(), password },
      {
        onSuccess: () => {
          void navigate({ to: '/' });
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            setErrMsg(err.message);
          } else {
            setErrMsg('登录失败，请重试');
          }
        },
      },
    );
  };

  const onFeishuLogin = async () => {
    setErrMsg(null);
    setFeishuStarting(true);
    try {
      const redirectUri = `${window.location.origin}/login`;
      const { authorizeUrl } = await authApi.feishuAuthorize(redirectUri);
      window.location.href = authorizeUrl;
    } catch (err) {
      setFeishuStarting(false);
      if (err instanceof ApiError) {
        setErrMsg(err.message);
      } else {
        setErrMsg('飞书登录初始化失败');
      }
    }
  };

  const exchanging = feishuExchange.isPending;

  return (
    <IOSDevice>
      <div className="relative min-h-full bg-background pb-10">
        {/* Hero gradient */}
        <div
          className="absolute inset-x-0 top-0 h-[360px] overflow-hidden"
          style={{
            background:
              'linear-gradient(160deg, var(--primary) 0%, var(--primary-dark) 100%)',
          }}
        >
          <div
            className="absolute -top-20 -right-16 w-[260px] h-[260px] rounded-full"
            style={{
              background:
                'radial-gradient(circle at 30% 30%, oklch(0.78 0.13 70 / 0.35) 0%, transparent 70%)',
            }}
          />
        </div>

        {/* Brand block */}
        <div className="relative px-7 pt-6 text-white">
          <div className="flex items-center gap-3">
            <BrandMark size={44} bg="#fff" fg="var(--primary)" />
            <div>
              <div className="text-[18px] font-semibold tracking-wide">
                门店助手
              </div>
              <div className="text-[12px] opacity-75 mt-0.5 tracking-wide">
                MERCHANT PORTAL · 美宜佳
              </div>
            </div>
          </div>

          <h1 className="mt-14 text-[30px] font-semibold leading-tight tracking-wide">
            您好，
            <br />
            欢迎回来
          </h1>
          <p className="mt-2.5 text-[14px] opacity-80 leading-relaxed">
            登录后管理货盘、价格与门店活动
          </p>
        </div>

        {/* Login card */}
        <div
          className="relative mx-5 mt-10 rounded-3xl bg-surface p-6 pt-5"
          style={{
            boxShadow:
              '0 24px 60px -20px rgba(31,26,23,0.25), 0 2px 6px rgba(31,26,23,0.04)',
          }}
        >
          {exchanging ? (
            <div className="py-10 text-center text-ink-muted text-sm">
              正在验证飞书登录…
            </div>
          ) : (
            <>
              <div className="text-[18px] font-semibold text-ink mb-5 tracking-wide">
                登录方式
              </div>

              {/* 飞书登录 */}
              <button
                onClick={() => void onFeishuLogin()}
                disabled={feishuStarting}
                type="button"
                className="w-full h-[50px] rounded-2xl text-white text-[15px] font-semibold transition-transform active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'var(--primary)',
                  letterSpacing: '0.15em',
                }}
              >
                {feishuStarting ? '正在跳转…' : '飞书登录'}
              </button>

              <div className="flex items-center gap-3 my-5 text-[11px] text-ink-muted tracking-widest">
                <div className="flex-1 h-px bg-hairline" />
                或
                <div className="flex-1 h-px bg-hairline" />
              </div>

              {/* 账密兜底 */}
              <form onSubmit={onSubmitPassword} className="space-y-3">
                <input
                  type="text"
                  required
                  placeholder="账号（如 admin 或门店编号）"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  className="w-full h-[46px] px-4 rounded-xl border border-hairline text-[14px] focus:outline-none focus:border-primary"
                  autoComplete="username"
                />
                <input
                  type="password"
                  required
                  placeholder="密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-[46px] px-4 rounded-xl border border-hairline text-[14px] focus:outline-none focus:border-primary"
                  autoComplete="current-password"
                />
                <button
                  type="submit"
                  disabled={login.isPending}
                  className="w-full h-[50px] rounded-2xl border border-hairline text-ink text-[15px] font-medium transition-transform active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {login.isPending ? '登录中…' : '账号密码登录'}
                </button>
              </form>

              {errMsg && (
                <div className="mt-4 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-[12px] leading-snug">
                  {errMsg}
                </div>
              )}

              <div className="mt-5 text-[11.5px] text-ink-muted leading-relaxed tracking-wide">
                飞书登录是主路径；账号密码是过渡期兜底（飞书全量上线后会下线）。
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mt-10 text-center text-[11px] text-ink-muted leading-relaxed tracking-wide px-6">
          <div className="opacity-60">v 0.1.0-m1</div>
        </div>
      </div>
    </IOSDevice>
  );
}
