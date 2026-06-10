export interface SkuRow {
  /** 大类编号 */
  majorCategoryCode?: string;
  /** 大类名称 */
  majorCategory: string;
  /** 中类编号 */
  midCategoryCode?: string;
  /** 中类名称 */
  midCategory?: string;
  /** 小类编号 */
  subCategoryCode?: string;
  /** 小类名称 */
  subCategory: string;
  /** 商品编号 */
  skuCode: string;
  /** 商品名称 */
  skuName: string;
  /** 品牌 */
  brandName: string;
  /** 规格 */
  spec: string;
  /** 计量单位 */
  unit?: string;
  /** 上架日期 */
  createDate: string;
  /** 30 日销售额 */
  sales30d: string;
  /** 30 日销售额环比 */
  salesChange30d: string;
  /** 30 日销量 */
  salesVolume30d: string;
  /** 90 日销售额 */
  sales90d?: string;
  /** 90 日销售额环比 */
  salesChange90d?: string;
  /** 90 日销量 */
  salesVolume90d?: string;
  /** 保质期（天） */
  shelfLifeDays?: number;
  /** 商品高度（cm） */
  height?: number;
  /** 商品宽度（cm） */
  width?: number;
  /** 商品深度（cm） */
  depth?: number;
}
