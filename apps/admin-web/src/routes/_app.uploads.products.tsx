/**
 * 产品主数据上传(占位)— PR 4 接 /admin/uploads/products
 */
import { createFileRoute } from '@tanstack/react-router';
import { UploadPagePlaceholder } from '@/components/UploadPagePlaceholder';

export const Route = createFileRoute('/_app/uploads/products')({
  component: () => (
    <UploadPagePlaceholder
      title="产品主数据"
      description="上传 SKU 主数据(商品名 / 品牌 / 规格 / 品类等)。系统按 sku_code 比对:新 SKU 入库,已有 SKU 更新字段。"
      templateFields={[
        'sku_code',
        'product_name',
        'brand',
        'spec',
        'unit',
        'category_name',
        'wholesale_price',
        'suggested_retail_price',
        'barcode',
        'tags',
      ]}
    />
  ),
});
