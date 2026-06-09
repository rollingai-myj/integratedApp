/**
 * use-toast shim → 转发到 sonner，让原 repo 的 `toast({title, description, variant})`
 * 形态保持不变；同时暴露 `toast.error(...)` `toast.warning(...)` 等方法形态，
 * 兼容老代码 `toast.error("xx")` 这种写法。
 */
import { toast as sonnerToast } from 'sonner';

interface ToastInput {
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
}

function dispatch(input: ToastInput | string) {
  if (typeof input === 'string') {
    sonnerToast(input);
    return;
  }
  const title = input.title ?? '';
  const desc = input.description ?? '';
  const opts = desc ? { description: desc } : undefined;
  if (input.variant === 'destructive') {
    sonnerToast.error(title, opts);
  } else {
    sonnerToast(title, opts);
  }
}

type SonnerLike = typeof sonnerToast;
type ToastFn = ((input: ToastInput | string) => void) & Pick<SonnerLike,
  'success' | 'error' | 'warning' | 'info' | 'message' | 'dismiss' | 'loading' | 'promise' | 'custom'
>;

// 把 sonner 方法挂到函数对象上：toast({...}) 仍工作，toast.error("xx") 也工作
const toastImpl = dispatch as ToastFn;
toastImpl.success = sonnerToast.success.bind(sonnerToast);
toastImpl.error = sonnerToast.error.bind(sonnerToast);
toastImpl.warning = sonnerToast.warning.bind(sonnerToast);
toastImpl.info = sonnerToast.info.bind(sonnerToast);
toastImpl.message = sonnerToast.message.bind(sonnerToast);
toastImpl.dismiss = sonnerToast.dismiss.bind(sonnerToast);
toastImpl.loading = sonnerToast.loading.bind(sonnerToast);
toastImpl.promise = sonnerToast.promise.bind(sonnerToast);
toastImpl.custom = sonnerToast.custom.bind(sonnerToast);

export const toast = toastImpl;

export function useToast() {
  return { toast: dispatch, dismiss: () => sonnerToast.dismiss() };
}
