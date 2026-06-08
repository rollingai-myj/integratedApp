/**
 * 登录页 (/login)
 *
 * M0：占位页。
 *   - 飞书登录按钮（M1 实现，当前禁用）
 *   - 账号 + 密码兜底（M1 实现，当前禁用）
 *
 * 视觉沿用门户 demo 的渐变 hero + 卡片样式。
 */
import { createFileRoute } from '@tanstack/react-router';
import { IOSDevice } from '@/components/IOSDevice';
import { BrandMark } from '@/components/BrandMark';

export const Route = createFileRoute('/login')({
  head: () => ({
    meta: [
      { title: '登录 · 美宜佳门店助手' },
      { name: 'description', content: '飞书登录或账号密码兜底登录。' },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  return (
    <IOSDevice>
      <div className="relative min-h-full bg-background pb-10">
        {/* Hero gradient */}
        <div
          className="absolute inset-x-0 top-0 h-[360px] overflow-hidden"
          style={{
            background: 'linear-gradient(160deg, var(--primary) 0%, var(--primary-dark) 100%)',
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
              <div className="text-[18px] font-semibold tracking-wide">门店助手</div>
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
          <div className="text-[18px] font-semibold text-ink mb-5 tracking-wide">登录方式</div>

          {/* 飞书登录（M1 启用） */}
          <button
            disabled
            type="button"
            className="w-full h-[50px] rounded-2xl text-white text-[15px] font-semibold transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'var(--primary)',
              letterSpacing: '0.15em',
            }}
          >
            飞书登录（M1 接入）
          </button>

          {/* 分隔 */}
          <div className="flex items-center gap-3 my-5 text-[11px] text-ink-muted tracking-widest">
            <div className="flex-1 h-px bg-hairline" />
            或
            <div className="flex-1 h-px bg-hairline" />
          </div>

          {/* 账密兜底（M1 启用） */}
          <button
            disabled
            type="button"
            className="w-full h-[50px] rounded-2xl border border-hairline text-ink text-[15px] font-medium transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
          >
            账号 + 密码登录（M1 接入）
          </button>

          <div className="mt-5 text-[11.5px] text-ink-muted leading-relaxed tracking-wide">
            当前为 M0 骨架阶段，登录功能将在 M1 里程碑实现。
            <br />
            如需查看可点击的功能，请前往 GitHub 仓库的 docs/milestones.md。
          </div>
        </div>

        {/* Footer */}
        <div className="mt-10 text-center text-[11px] text-ink-muted leading-relaxed tracking-wide px-6">
          <div className="opacity-60">v 0.1.0-m0</div>
        </div>
      </div>
    </IOSDevice>
  );
}
