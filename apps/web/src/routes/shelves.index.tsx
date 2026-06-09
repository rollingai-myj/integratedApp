/**
 * /shelves —— 重定向到场景列表
 *
 * 旧 M5-PR1 的三 tab 占位页（场景/货架/SKU）已下线；移植 skuSelection v2 后，
 * 不再有"开始调改"中间欢迎页，进入模块直接到 /shelves/position/ 选场景。
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/shelves/')({
  beforeLoad: () => {
    throw redirect({ to: '/shelves/position', replace: true });
  },
  head: () => ({ meta: [{ title: '选品助手 · 美宜佳' }] }),
});
