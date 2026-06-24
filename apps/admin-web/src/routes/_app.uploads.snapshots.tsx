/**
 * 门店销售快照上传(占位)— PR 4 接 /admin/uploads/snapshots
 */
import { createFileRoute } from '@tanstack/react-router';
import { UploadPagePlaceholder } from '@/components/UploadPagePlaceholder';

export const Route = createFileRoute('/_app/uploads/snapshots')({
  component: () => (
    <UploadPagePlaceholder
      title="门店销售快照"
      description="上传各门店当期销售快照(SKU 维度的 30/90 天销量、库存、零售价)。同店同 SKU 同日期会以最后一次为准。"
      templateFields={[
        'store_code',
        'sku_code',
        'snapshot_date',
        'retail_price',
        'sales_qty_30d',
        'sales_realamt_30d',
        'sales_qty_90d',
        'sales_realamt_90d',
        'stock_qty',
      ]}
    />
  ),
});
