import { Toaster as Sonner, toast as sonnerToast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

interface ToastInput {
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
}

function dispatch(input: ToastInput | string): void {
  if (typeof input === "string") {
    sonnerToast(input);
    return;
  }
  const title = input.title ?? "";
  const opts = input.description ? { description: input.description } : undefined;
  if (input.variant === "destructive") sonnerToast.error(title, opts);
  else sonnerToast(title, opts);
}

/**
 * 选品（shelves）模块从原 repo 1:1 移植，保留 `toast({title, description, variant})`
 * 调用形态；同时把 sonner 自带的 `.error / .warning / .success / ...` 方法挂上去，
 * 兼容原 repo 内 `toast.error("xx")` 的写法。
 */
type SonnerLike = typeof sonnerToast;
type ToastFn = ((input: ToastInput | string) => void) &
  Pick<SonnerLike, "success" | "error" | "warning" | "info" | "message" | "dismiss" | "loading" | "promise" | "custom">;

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

/** 成功态语义糖，便于上层 `toastSuccess("已保存")` */
export function toastSuccess(message: string): void {
  sonnerToast.success(message);
}

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
