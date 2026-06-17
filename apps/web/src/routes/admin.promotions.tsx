// apps/web/src/routes/admin.promotions.tsx
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IOSDevice } from '@/components/IOSDevice';
import { promotionsApi } from '@/lib/api-client';

export const Route = createFileRoute('/admin/promotions')({ component: PromoUploadPage });

function PromoUploadPage() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const batchesQ = useQuery({ queryKey: ['promo','batches'], queryFn: () => promotionsApi.batches() });
  const uploadM = useMutation({
    mutationFn: (f: File) => promotionsApi.upload(f),
    onSuccess: () => { setFile(null); qc.invalidateQueries({ queryKey: ['promo','batches'] }); },
  });

  return (
    <IOSDevice>
      <div className="h-full bg-background flex flex-col">
        <header className="flex items-center gap-3 px-[22px] pt-3 pb-2">
          <Link to="/admin" className="w-[38px] h-[38px] rounded-xl bg-surface border border-hairline flex items-center justify-center">
            <ArrowLeft size={18} className="text-ink" />
          </Link>
          <div className="text-[16px] font-semibold text-ink">促销上传</div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 pb-6">
          <div className="bg-surface rounded-2xl p-4 border border-hairline">
            <input
              type="file" accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-[13px]"
            />
            <button
              disabled={!file || uploadM.isPending}
              onClick={() => file && uploadM.mutate(file)}
              className="mt-3 px-4 py-2 rounded-xl bg-primary text-white text-[13px] disabled:opacity-40"
            >
              {uploadM.isPending ? '解析中…' : '上传 + 解析'}
            </button>
            {uploadM.isError && <div className="mt-2 text-[12px] text-red-500">{(uploadM.error as Error).message}</div>}
            {uploadM.data && (
              <div className="mt-3 text-[12px] text-ink-2 space-y-1">
                <div>批次: {uploadM.data.batch.fileName}</div>
                <div>各 sheet 行数: {JSON.stringify(uploadM.data.batch.rowTotal)}</div>
                <div>各 sheet 入优惠数: {JSON.stringify(uploadM.data.batch.parsedTotal)}</div>
                {uploadM.data.warnings.length > 0 && (
                  <div className="text-amber-600">告警 {uploadM.data.warnings.length} 条</div>
                )}
              </div>
            )}
          </div>

          <div className="mt-5">
            <div className="text-[13px] font-semibold text-ink mb-2">历史批次</div>
            <div className="space-y-2">
              {(batchesQ.data?.batches ?? []).map((b) => (
                <div key={b.id} className="bg-surface rounded-xl p-3 border border-hairline text-[12px]">
                  <div className="font-medium text-ink truncate">{b.fileName}</div>
                  <div className="text-ink-2 mt-1">
                    {b.activityWindowStart} ~ {b.activityWindowEnd} · {b.isVoided ? '已作废' : '生效中'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </IOSDevice>
  );
}
