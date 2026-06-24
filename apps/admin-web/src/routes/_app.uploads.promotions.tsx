import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { CsvUploadPage } from '@/components/CsvUploadPage';
import { fetchSpecs } from '@/lib/uploads';
import { TOKENS } from '@/tokens';

export const Route = createFileRoute('/_app/uploads/promotions')({
  component: PromotionsUploadPage,
});

function PromotionsUploadPage() {
  const specsQ = useQuery({
    queryKey: ['uploads', 'specs'],
    queryFn: fetchSpecs,
    staleTime: 5 * 60_000,
  });
  const spec = specsQ.data?.find(s => s.kind === 'promotions');
  if (!spec) {
    return (
      <div style={{ padding: 32, color: TOKENS.inkMuted }}>
        {specsQ.isLoading ? '加载字段定义…' : '字段定义加载失败'}
      </div>
    );
  }
  return <CsvUploadPage kind="promotions" spec={spec} />;
}
