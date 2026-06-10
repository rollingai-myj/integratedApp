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
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { IOSDevice } from '@/components/IOSDevice';

export const Route = createFileRoute('/admin/')({
  component: AdminPlaceholder,
});

function AdminPlaceholder() {
  return (
    <IOSDevice>
      <div className="h-full bg-background flex flex-col">
        <header className="flex items-center gap-3 px-[22px] pt-3 pb-2">
          <Link
            to="/"
            className="w-[38px] h-[38px] rounded-xl bg-surface border border-hairline flex items-center justify-center"
          >
            <ArrowLeft size={18} className="text-ink" />
          </Link>
          <div className="text-[16px] font-semibold text-ink">后台管理</div>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="text-[42px] font-bold text-primary">M5</div>
          <div className="text-[14px] text-ink-2 mt-2">即将开放</div>
        </div>
      </div>
    </IOSDevice>
  );
}
