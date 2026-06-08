/**
 * 活动海报 占位页 (/posters)
 *
 * M4 里程碑实现完整业务功能：
 *   - 促销商品浏览（按品类、个性化推荐）
 *   - 单张同步生成
 *   - 批量入队
 *   - 海报历史
 */
import { createFileRoute } from '@tanstack/react-router';
import { ModulePlaceholder } from './shelves.index.js';

export const Route = createFileRoute('/posters/')({
  component: () => <ModulePlaceholder title="活动海报" milestone="M4" />,
});
