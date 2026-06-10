/**
 * React Router DOM v6 → TanStack Router 适配垫片
 *
 * 整个 shelves 子树是从原 skuSelection 仓 1:1 移植的；原仓用 `react-router-dom`
 * 的 `useNavigate / useParams / useLocation`，这里把 import 替换到本文件后，
 * 转发到 TanStack Router 的等价 API，让上层组件代码零修改。
 *
 * 命名空间：整合 app 把整个模块挂到 `/shelves` 下，所以原路径 `/home` `/position/0/photo`
 * 会被自动加上 `/shelves` 前缀；`/`（去门户首页）保持不变。
 */
import {
  useNavigate as useTanstackNavigate,
  useParams as useTanstackParams,
  useRouterState,
} from '@tanstack/react-router';

export type ReactRouterNavigateOptions = {
  replace?: boolean;
  state?: unknown;
};

export type ReactRouterNavigate = {
  (to: string, options?: ReactRouterNavigateOptions): void;
  (delta: number): void;
};

/**
 * `navigate("/foo")` → TanStack `navigate({ to })`；`navigate(-1)` → 浏览器后退。
 * 原 repo 路径如 `/home`、`/position/0/index` 会自动前缀 `/shelves`。
 */
export function useNavigate(): ReactRouterNavigate {
  const nav = useTanstackNavigate();
  return ((arg: string | number, opts?: ReactRouterNavigateOptions) => {
    if (typeof arg === 'number') {
      window.history.go(arg);
      return;
    }
    let to = arg;
    if (to !== '/' && to.startsWith('/') && !to.startsWith('/shelves')) {
      to = `/shelves${to}`;
    }
    // 原 repo 用 /position/$code/index 做 hub；TanStack 把 shelves.position.$code.index.tsx
    // 解析为 /shelves/position/$code/（trailing slash），所以 /shelves/position/0/index
    // 会 404 —— 这里去掉 /index 后缀。
    to = to.replace(/\/index$/, '/');
    // TanStack 的强类型 to 在运行期就是字符串，这里用 any 跳过 typed-routes 校验
    nav({ to: to as never, replace: opts?.replace });
  }) as ReactRouterNavigate;
}

/**
 * 原 repo `useParams<{ code: string }>()` 返回扁平 string map；
 * TanStack 的 `useParams({ strict: false })` 形态完全一致。
 */
export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  return useTanstackParams({ strict: false }) as unknown as T;
}

/** 原 repo `useLocation()` 仅用到 `.pathname`，这里只暴露这一项。 */
export function useLocation(): { pathname: string; search: string; hash: string } {
  const loc = useRouterState({ select: (s) => s.location });
  return {
    pathname: loc.pathname,
    search: loc.searchStr ?? '',
    hash: loc.hash ?? '',
  };
}
