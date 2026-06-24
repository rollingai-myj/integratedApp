/**
 * 登录页 — 账号密码(legacy_account)
 *
 * 复用后端 POST /api/v1/auth/login。session cookie 由服务端写入,
 * 登录成功后跳 / (Dashboard);非 super_admin 角色会被 AppShell 拒之门外。
 */
import * as React from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { login, isSuperAdmin } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { TOKENS } from '@/tokens';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [account, setAccount] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPwd, setShowPwd] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const m = useMutation({
    mutationFn: () => login(account.trim(), password),
    onSuccess: (user) => {
      if (!isSuperAdmin(user)) {
        setError('账号无超管权限,无法访问后台');
        return;
      }
      qc.setQueryData(['me'], user);
      navigate({ to: '/' });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) setError(err.message);
      else setError('登录失败,请稍后再试');
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (m.isPending) return;
    setError(null);
    if (!account.trim() || !password) {
      setError('请输入账号和密码');
      return;
    }
    m.mutate();
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      background: TOKENS.bg,
    }}>
      {/* 左:品牌氛围 */}
      <div style={{
        background: `linear-gradient(135deg, ${TOKENS.red} 0%, ${TOKENS.redDark} 100%)`,
        color: '#fff',
        padding: '64px 56px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 18,
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: 'rgba(255,255,255,0.18)',
              backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 20, letterSpacing: 1,
            }}>美</div>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: 1 }}>
              美宜佳
            </div>
          </div>
          <h1 style={{
            fontSize: 42, fontWeight: 800, lineHeight: 1.2, margin: '12px 0 18px',
            letterSpacing: 1,
          }}>
            超管控制台
          </h1>
          <p style={{
            fontSize: 16, lineHeight: 1.7, opacity: 0.9, maxWidth: 380,
          }}>
            门店调改一目了然,数据上传一键完成。<br />
            为运营决策提供更清晰的视图。
          </p>
        </div>
        <div style={{
          fontSize: 12, opacity: 0.7, position: 'relative', zIndex: 2,
        }}>
          © 2026 美宜佳 · 内部系统
        </div>

        {/* 装饰圆 */}
        <div style={{
          position: 'absolute',
          right: -160, top: -160,
          width: 480, height: 480, borderRadius: '50%',
          background: 'rgba(255,255,255,0.06)',
        }} />
        <div style={{
          position: 'absolute',
          right: -80, bottom: -80,
          width: 280, height: 280, borderRadius: '50%',
          background: 'rgba(255,255,255,0.06)',
        }} />
      </div>

      {/* 右:表单 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px',
      }}>
        <form onSubmit={submit} style={{
          width: '100%',
          maxWidth: 380,
        }}>
          <div style={{
            fontSize: 28, fontWeight: 800, color: TOKENS.ink, marginBottom: 6,
          }}>
            欢迎回来
          </div>
          <div style={{
            fontSize: TOKENS.fBase, color: TOKENS.inkMuted, marginBottom: 32,
          }}>
            请使用超管账号登录
          </div>

          <Field label="账号">
            <input
              type="text"
              value={account}
              onChange={e => setAccount(e.target.value)}
              autoComplete="username"
              placeholder="邮箱 / 手机号 / 登录名"
              style={inputStyle}
            />
          </Field>

          <Field label="密码">
            <div style={{ position: 'relative' }}>
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="密码"
                style={{ ...inputStyle, paddingRight: 64 }}
              />
              <button
                type="button"
                onClick={() => setShowPwd(s => !s)}
                style={{
                  position: 'absolute',
                  right: 8, top: '50%',
                  transform: 'translateY(-50%)',
                  appearance: 'none',
                  border: 0,
                  background: 'transparent',
                  color: TOKENS.inkMuted,
                  fontSize: 12,
                  padding: '4px 10px',
                  borderRadius: 6,
                }}
              >
                {showPwd ? '隐藏' : '显示'}
              </button>
            </div>
          </Field>

          {error && (
            <div style={{
              marginTop: 12,
              padding: '10px 14px',
              borderRadius: 8,
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              color: TOKENS.danger,
              fontSize: TOKENS.fSm,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={m.isPending}
            style={{
              marginTop: 24,
              width: '100%',
              appearance: 'none',
              border: 0,
              borderRadius: 10,
              padding: '14px 16px',
              fontSize: TOKENS.fMd,
              fontWeight: 700,
              color: '#fff',
              background: m.isPending
                ? TOKENS.inkDisabled
                : `linear-gradient(135deg, ${TOKENS.red}, ${TOKENS.redDark})`,
              boxShadow: m.isPending ? 'none' : TOKENS.shadow3,
              cursor: m.isPending ? 'default' : 'pointer',
              transition: 'transform 0.1s',
            }}
          >
            {m.isPending ? '登录中…' : '登录'}
          </button>

          <div style={{
            marginTop: 24,
            fontSize: TOKENS.fXs,
            color: TOKENS.inkMuted,
            textAlign: 'center',
          }}>
            如忘记密码,请联系系统管理员
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{
        fontSize: TOKENS.fSm,
        fontWeight: 600,
        color: TOKENS.inkSoft,
        marginBottom: 6,
      }}>
        {label}
      </div>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  appearance: 'none',
  border: `1px solid ${TOKENS.line}`,
  borderRadius: 10,
  padding: '12px 14px',
  fontSize: TOKENS.fBase,
  color: TOKENS.ink,
  background: TOKENS.card,
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s, box-shadow 0.15s',
};
