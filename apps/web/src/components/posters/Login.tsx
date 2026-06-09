import * as React from 'react';
import { authClient } from './auth-client';

const ACCENT = '#E11D2A';

export function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [raw, setRaw] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const trimmed = raw.trim().toLowerCase();
    const email = trimmed.includes('@') ? trimmed : `${trimmed}@myj.app`;
    const { error: err } = await authClient.signIn(email, password);
    setLoading(false);
    if (err) {
      setError(err.message.includes('Invalid') || err.message.includes('账号') ? '账号或密码错误' : err.message);
      return;
    }
    onLogin();
  };

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'linear-gradient(160deg, #1a1a1a 0%, #000 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '0 32px', color: '#fff',
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: 16,
        background: ACCENT, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        marginBottom: 20, fontSize: 28, fontWeight: 800,
      }}>美</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>美宜佳促销海报设计师 Ver 0.5</div>
      <div style={{ fontSize: 13, color: '#999', marginBottom: 32 }}>内测截止日：6月15日</div>

      <form onSubmit={submit} style={{ width: '100%', maxWidth: 320 }}>
        <input
          type="text" placeholder="账号" value={raw} autoComplete="username"
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={e => setRaw(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password" placeholder="密码" value={password} autoComplete="current-password"
          onChange={e => setPassword(e.target.value)}
          style={{ ...inputStyle, marginTop: 12 }}
        />
        {error && <div style={{ color: ACCENT, fontSize: 13, marginTop: 12, textAlign: 'center' }}>{error}</div>}
        <button type="submit" disabled={loading} style={{
          width: '100%', marginTop: 20, height: 48,
          background: ACCENT, color: '#fff', border: 'none',
          borderRadius: 12, fontSize: 16, fontWeight: 600,
          cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1,
        }}>{loading ? '登录中…' : '登录'}</button>
        <div style={{ fontSize: 11, color: '#777', marginTop: 20, textAlign: 'center', lineHeight: 1.6 }}>
          内测阶段，AI生成内容仅供参考<br/>如有异常请联系管理员
        </div>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 48, padding: '0 16px',
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 12, color: '#fff', fontSize: 15,
  outline: 'none', boxSizing: 'border-box',
};
