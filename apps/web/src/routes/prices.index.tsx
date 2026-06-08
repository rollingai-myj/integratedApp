/**
 * 价盘管理 占位页 (/prices)
 *
 * M3 里程碑实现完整业务功能：
 *   - 商品列表（含当前价、原价、销量）
 *   - 价格曲线
 *   - 竞品对标
 *   - 调价提交
 *   - AI 价盘诊断
 */
import { createFileRoute } from '@tanstack/react-router';
import { ModulePlaceholder } from './shelves.index.js';

export const Route = createFileRoute('/prices/')({
  component: () => <ModulePlaceholder title="价盘管理" milestone="M3" />,
});
