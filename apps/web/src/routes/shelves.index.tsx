/**
 * 货盘选品 占位页 (/shelves)
 *
 * M2 里程碑实现完整业务功能：
 *   - 场景选择
 *   - 拍照检测
 *   - AI 诊断与选品
 *   - 一键调改
 *   - 虚拟货架生成
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { IOSDevice } from '@/components/IOSDevice';

export const Route = createFileRoute('/shelves/')({
  component: ShelvesPlaceholder,
});

function ShelvesPlaceholder() {
  return <ModulePlaceholder title="货盘选品" milestone="M2" />;
}

export function ModulePlaceholder({
  title,
  milestone,
}: {
  title: string;
  milestone: string;
}) {
  return (
    <IOSDevice>
      <div className="h-full bg-background flex flex-col">
        <header className="flex items-center gap-3 px-[22px] pt-3 pb-2">
          <Link
            to="/"
            className="w-[38px] h-[38px] rounded-xl bg-surface border border-hairline flex items-center justify-center"
            aria-label="返回门户首页"
          >
            <ArrowLeft size={18} className="text-ink" />
          </Link>
          <div className="text-[16px] font-semibold text-ink tracking-wide">{title}</div>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="text-[42px] font-bold text-primary tracking-tight">{milestone}</div>
          <div className="mt-3 text-[14px] text-ink-muted leading-relaxed tracking-wide">
            「{title}」模块的完整业务功能
            <br />
            将在里程碑 {milestone} 中实现
          </div>
          <div className="mt-8 text-[11.5px] text-ink-muted/60 leading-relaxed tracking-wide">
            查看 docs/milestones.md 了解开发计划
            <br />
            或在 GitHub 仓库认领该里程碑下的任务
          </div>
        </div>
      </div>
    </IOSDevice>
  );
}
