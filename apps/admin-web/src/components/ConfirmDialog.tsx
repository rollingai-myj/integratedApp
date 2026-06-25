/**
 * 应用内自定义确认弹窗 — 替代浏览器原生的 confirm()。
 *
 * 用法:
 *   const { confirm, dialog } = useConfirmDialog();
 *
 *   const onDelete = async () => {
 *     if (await confirm({
 *       title: '确认删除「东莞旗峰店」?',
 *       description: '删除后该门店将从列表中移除…',
 *       confirmLabel: '🗑 删除',
 *       danger: true,
 *     })) {
 *       deleteM.mutate();
 *     }
 *   };
 *
 *   return <>{...}{dialog}</>;
 *
 * 特点:
 *   - 应用内 modal,样式跟 ConflictDialog / CsvUploadPage 一致
 *   - 点遮罩或按 Escape = 取消
 *   - 危险操作 danger=true → 主按钮变红色
 *   - confirm() 返回 Promise<boolean>,跟原生 confirm() 一样直观
 */
import * as React from 'react';
import { TOKENS } from '@/tokens';

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** 主按钮文字,默认「确认」 */
  confirmLabel?: string;
  /** 次按钮文字,默认「取消」 */
  cancelLabel?: string;
  /** 危险操作 → 主按钮变红 */
  danger?: boolean;
}

interface PendingState {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

export function useConfirmDialog(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  dialog: React.ReactNode;
} {
  const [pending, setPending] = React.useState<PendingState | null>(null);

  const confirm = React.useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPending({ options: opts, resolve });
    });
  }, []);

  const close = React.useCallback((ok: boolean) => {
    if (pending) {
      pending.resolve(ok);
      setPending(null);
    }
  }, [pending]);

  // Escape 关闭
  React.useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, close]);

  const dialog = pending ? (
    <ConfirmDialog
      options={pending.options}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  ) : null;

  return { confirm, dialog };
}

function ConfirmDialog({
  options, onCancel, onConfirm,
}: {
  options: ConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmBtnRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    confirmBtnRef.current?.focus();
  }, []);

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15, 12, 8, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: 440, maxWidth: 'calc(100vw - 32px)',
          background: TOKENS.card,
          borderRadius: 12,
          boxShadow: TOKENS.shadow2,
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '20px 24px 12px' }}>
          <div style={{
            fontSize: TOKENS.fLg, fontWeight: 700, color: TOKENS.ink,
            lineHeight: 1.4,
          }}>
            {options.title}
          </div>
          {options.description && (
            <div style={{
              fontSize: TOKENS.fSm, color: TOKENS.inkSoft,
              marginTop: 10, lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
            }}>
              {options.description}
            </div>
          )}
        </div>

        <div style={{
          padding: '14px 24px 20px',
          display: 'flex', gap: 10, justifyContent: 'flex-end',
        }}>
          <button
            onClick={onCancel}
            style={btnStyle('ghost')}
          >
            {options.cancelLabel ?? '取消'}
          </button>
          <button
            ref={confirmBtnRef}
            onClick={onConfirm}
            style={btnStyle(options.danger ? 'danger' : 'primary')}
          >
            {options.confirmLabel ?? '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}

function btnStyle(variant: 'primary' | 'danger' | 'ghost'): React.CSSProperties {
  const base: React.CSSProperties = {
    appearance: 'none',
    padding: '8px 18px',
    borderRadius: 6,
    fontSize: TOKENS.fSm,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
  if (variant === 'primary') {
    return { ...base, border: `1px solid ${TOKENS.red}`, background: TOKENS.red, color: '#fff' };
  }
  if (variant === 'danger') {
    return { ...base, border: `1px solid ${TOKENS.danger}`, background: TOKENS.danger, color: '#fff' };
  }
  return { ...base, border: `1px solid ${TOKENS.line}`, background: TOKENS.card, color: TOKENS.ink };
}
