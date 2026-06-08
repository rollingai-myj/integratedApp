/**
 * 后台管理 占位页 (/admin)
 *
 * M5 里程碑实现完整业务功能（仅超管可访问）：
 *   - 账号 / 角色 / 门店分配
 *   - 审计事件查询
 *   - 用户使用时长统计
 *   - 门店综合统计 / 实时大屏
 *   - AI 模型切换 / 压测
 *   - 促销 Excel 上传
 */
import { createFileRoute } from '@tanstack/react-router';
import { ModulePlaceholder } from './shelves.index.js';

export const Route = createFileRoute('/admin/')({
  component: () => <ModulePlaceholder title="后台管理" milestone="M5" />,
});
