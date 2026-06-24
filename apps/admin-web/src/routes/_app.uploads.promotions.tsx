/**
 * 活动数据上传(占位)— PR 4 接 /admin/uploads/promotions
 */
import { createFileRoute } from '@tanstack/react-router';
import { UploadPagePlaceholder } from '@/components/UploadPagePlaceholder';

export const Route = createFileRoute('/_app/uploads/promotions')({
  component: () => (
    <UploadPagePlaceholder
      title="活动数据"
      description="上传促销活动配置(满减券 / 会员价 / 周末啤酒日 等)。上传后会自动比对活动池,新增的入库,过期的标记下线。"
      templateFields={[
        'sku_code',
        'activity_type',
        'mechanic',
        'mechanic_params_json',
        'valid_from',
        'valid_to',
        'pool_label',
      ]}
    />
  ),
});
