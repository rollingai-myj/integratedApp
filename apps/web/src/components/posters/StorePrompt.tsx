import * as React from 'react';

export function StorePrompt({ accent, onSubmit }: { accent: string; onSubmit: (value: string) => Promise<void> | void }) {
  const [value, setValue] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try { await onSubmit(trimmed); } finally { setSubmitting(false); }
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 200,
      background: 'linear-gradient(160deg, #1a1a1a 0%, #000 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '0 32px', color: '#fff',
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: 16,
        background: accent, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        marginBottom: 20, fontSize: 28, fontWeight: 800,
      }}>店</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>请填写门店号</div>
      <div style={{ fontSize: 13, color: '#999', marginBottom: 28, textAlign: 'center', lineHeight: 1.6 }}>
        首次在此设备登录需要绑定门店<br/>填写后此浏览器将自动记住
      </div>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 320 }}>
        <input
          type="text" inputMode="text" placeholder="例如 G1234"
          autoFocus autoCapitalize="characters" autoCorrect="off" spellCheck={false}
          value={value} onChange={e => setValue(e.target.value)}
          maxLength={50}
          style={{
            width: '100%', height: 48, padding: '0 16px',
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 12, color: '#fff', fontSize: 15,
            outline: 'none', boxSizing: 'border-box',
          }}
        />
        <button type="submit" disabled={submitting || !value.trim()} style={{
          width: '100%', marginTop: 20, height: 48,
          background: accent, color: '#fff', border: 'none',
          borderRadius: 12, fontSize: 16, fontWeight: 600,
          cursor: submitting ? 'wait' : 'pointer',
          opacity: submitting || !value.trim() ? 0.6 : 1,
        }}>{submitting ? '提交中…' : '确认'}</button>
        <div style={{ fontSize: 12, color: '#666', marginTop: 16, textAlign: 'center', lineHeight: 1.6 }}>
          如填错请联系超级管理员协助修正
        </div>
      </form>
    </div>
  );
}
