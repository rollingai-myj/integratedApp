/**
 * /shelves/position 父布局
 *
 * TanStack 文件路由约定：当 shelves.position.$code.*.tsx 存在时，它们会自动挂到
 * 同名层级的父路由下。所以本文件必须存在并渲染 <Outlet/>，否则 /shelves/position/0/*
 * 路径会跳到父路由空壳页 —— 看不到子组件。
 * 真正的列表页放在 shelves.position.index.tsx。
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/shelves/position')({
  component: Outlet,
});
