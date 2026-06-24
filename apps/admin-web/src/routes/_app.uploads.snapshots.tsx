import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { CsvUploadPage } from '@/components/CsvUploadPage';
import { fetchSpecs } from '@/lib/uploads';
import { TOKENS } from '@/tokens';

export const Route = createFileRoute('/_app/uploads/snapshots')({
  component: SnapshotsUploadPage,
});

function SnapshotsUploadPage() {
  const specsQ = useQuery({
    queryKey: ['uploads', 'specs'],
    queryFn: fetchSpecs,
    staleTime: 5 * 60_000,
  });
  const spec = specsQ.data?.find(s => s.kind === 'snapshots');
  if (!spec) {
    return (
      <div style={{ padding: 32, color: TOKENS.inkMuted }}>
        {specsQ.isLoading ? '加载字段定义…' : '字段定义加载失败'}
      </div>
    );
  }
  return <CsvUploadPage kind="snapshots" spec={spec} />;
}
