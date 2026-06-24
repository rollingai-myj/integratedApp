/**
 * 3 个 kind 的 CSV 字段定义 + 模板生成 + 行校验
 *
 * 设计:
 *   - 每个 kind 都是 ColumnDef[],描述列名、必填、类型、可选枚举。
 *   - parseRow(headers, raw) 用 def 把 raw cell 转成强类型对象,
 *     不合规返回 {error: '...'},合规返回 {ok: data}。
 *   - templateOf(kind) 返回模板 CSV(BOM + 表头 + 一个示例行)。
 *
 * 字段值都是人类友好的(store_code / category_name 而不是 UUID),
 * 后端解析时做 FK lookup,把 store_code → store_id 等。
 */

export type UploadKind = 'promotions' | 'products' | 'snapshots';

type FieldType = 'string' | 'number' | 'integer' | 'date' | 'enum';

export interface ColumnDef {
  name: string;
  required: boolean;
  type: FieldType;
  /** type='enum' 时的可选值 */
  enumValues?: string[];
  /** 字段说明,展示在模板下载页 */
  description: string;
  /** 模板示例行的值 */
  sample: string;
  /** 给 staging_data 里 key 的字段名(可与 CSV 列名不同;默认 = name) */
  key?: string;
}

export interface ColumnSpec {
  kind: UploadKind;
  /** 给前端展示的 kind 名 */
  label: string;
  description: string;
  columns: ColumnDef[];
}

// =============================================================================
// products — 产品主数据
// =============================================================================

const PRODUCTS_SPEC: ColumnSpec = {
  kind: 'products',
  label: '产品主数据',
  description:
    '按 sku_code 比对,新 SKU 入库,已有 SKU 更新字段。category_name 必须对应已有的 hq_categories.category_name(叶子节点),否则该行报错。',
  columns: [
    { name: 'sku_code',               required: true,  type: 'string',  description: '商品编码(必填,唯一)', sample: '22033344' },
    { name: 'product_name',           required: true,  type: 'string',  description: '商品名',              sample: '怡宝纯净水 555ml' },
    { name: 'brand',                  required: false, type: 'string',  description: '品牌',                sample: '怡宝' },
    { name: 'spec',                   required: false, type: 'string',  description: '规格',                sample: '555ml' },
    { name: 'unit',                   required: false, type: 'string',  description: '单位',                sample: '瓶' },
    { name: 'category_name',          required: true,  type: 'string',  description: '品类名(叶子节点)',    sample: '瓶装饮用水' },
    { name: 'wholesale_price',        required: false, type: 'number',  description: '进货价(元)',          sample: '1.50' },
    { name: 'suggested_retail_price', required: false, type: 'number',  description: '建议零售价(元)',      sample: '2.00' },
    { name: 'barcode',                required: false, type: 'string',  description: '条码',                sample: '6901285991213' },
    { name: 'tags',                   required: false, type: 'string',  description: '标签(英文逗号分隔)',   sample: '饮料,大单品' },
  ],
};

// =============================================================================
// snapshots — 销售快照
// =============================================================================

const SNAPSHOTS_SPEC: ColumnSpec = {
  kind: 'snapshots',
  label: '门店销售快照',
  description:
    '同店同 SKU 同日期同来源(manual)以最后一次为准。store_code 必须命中 stores.store_code,sku_code 必须命中 hq_products.sku_code。',
  columns: [
    { name: 'store_code',         required: true,  type: 'string',  description: '门店编号',         sample: '粤37893' },
    { name: 'sku_code',           required: true,  type: 'string',  description: '商品编码',         sample: '22033344' },
    { name: 'snapshot_date',      required: true,  type: 'date',    description: '快照日期(YYYY-MM-DD)', sample: '2026-06-20' },
    { name: 'retail_price',       required: false, type: 'number',  description: '售价(元)',         sample: '2.00' },
    { name: 'sales_qty_30d',      required: false, type: 'integer', description: '近 30 天销量',     sample: '128' },
    { name: 'sales_realamt_30d', required: false, type: 'number',  description: '近 30 天销售额',    sample: '256.00' },
    { name: 'sales_qty_90d',      required: false, type: 'integer', description: '近 90 天销量',     sample: '420' },
    { name: 'sales_realamt_90d', required: false, type: 'number',  description: '近 90 天销售额',    sample: '840.00' },
    { name: 'stock_qty',          required: false, type: 'integer', description: '当前库存',         sample: '36' },
  ],
};

// =============================================================================
// promotions — 活动数据(简化 CSV,正式上传仍推荐用 xlsx 流程)
// =============================================================================

const PROMO_ACTIVITY_TYPES = [
  'member_price',
  'weekend_beer',
  'brand_coupon',
  'regular_coupon',
  'tuesday_member',
] as const;

const PROMO_MECHANICS = [
  'flat_price',
  'percent_discount',
  'pool_threshold',
  'bundle_price',
] as const;

const PROMOTIONS_SPEC: ColumnSpec = {
  kind: 'promotions',
  label: '活动数据',
  description:
    '简化 CSV 版,字段较底层。如果要上传整套促销日历(含会员价 + 凑单池 + 满减券),仍推荐用 xlsx 工作流。',
  columns: [
    { name: 'sku_code',             required: true,  type: 'string', description: '商品编码',                                 sample: '22033344' },
    { name: 'activity_type',        required: true,  type: 'enum',   description: '活动类型',                                 sample: 'member_price', enumValues: [...PROMO_ACTIVITY_TYPES] },
    { name: 'mechanic',             required: true,  type: 'enum',   description: '玩法',                                      sample: 'flat_price',   enumValues: [...PROMO_MECHANICS] },
    { name: 'mechanic_params_json', required: true,  type: 'string', description: '玩法参数(JSON 字符串)',                    sample: '{"kind":"flat_price","target_price":2.00}' },
    { name: 'valid_from',           required: true,  type: 'date',   description: '生效起(YYYY-MM-DD)',                       sample: '2026-06-01' },
    { name: 'valid_to',             required: true,  type: 'date',   description: '生效止(YYYY-MM-DD)',                       sample: '2026-06-30' },
    { name: 'pool_label',           required: false, type: 'string', description: '凑单池标签(brand_coupon 用)',              sample: '怡宝饮料' },
  ],
};

// =============================================================================
// 总注册表
// =============================================================================

const SPECS: Record<UploadKind, ColumnSpec> = {
  products: PRODUCTS_SPEC,
  snapshots: SNAPSHOTS_SPEC,
  promotions: PROMOTIONS_SPEC,
};

export function specOf(kind: UploadKind): ColumnSpec {
  return SPECS[kind];
}

export function allSpecs(): ColumnSpec[] {
  return [PROMOTIONS_SPEC, PRODUCTS_SPEC, SNAPSHOTS_SPEC];
}

// =============================================================================
// 模板 CSV 生成
// =============================================================================

export function templateOf(kind: UploadKind): string {
  const spec = specOf(kind);
  const headers = spec.columns.map((c) => c.name);
  const sample = spec.columns.map((c) => c.sample);
  // BOM + 表头 + 一个示例行
  return '﻿' + [headers.join(','), sample.map(csvCell).join(',')].join('\n');
}

function csvCell(v: string): string {
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

// =============================================================================
// 行级校验
// =============================================================================

export interface RowError {
  row: number;       // 1-based,把表头算第 1 行,第一条数据是第 2 行
  col?: string;
  msg: string;
  /** 原始整行,前端展示用 */
  raw?: string[];
}

export type RowParseResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; errors: RowError[] };

export function parseRow(
  kind: UploadKind,
  headers: string[],
  cells: string[],
  rowNumber: number,
): RowParseResult {
  const spec = specOf(kind);
  const data: Record<string, unknown> = {};
  const errors: RowError[] = [];

  // 把 headers 转成 lookup(列名 → 索引)
  const headerIdx = new Map<string, number>();
  headers.forEach((h, i) => headerIdx.set(h.trim(), i));

  for (const col of spec.columns) {
    const idx = headerIdx.get(col.name);
    const raw = idx === undefined ? '' : (cells[idx] ?? '').trim();

    if (raw === '') {
      if (col.required) {
        errors.push({ row: rowNumber, col: col.name, msg: '必填', raw: cells });
      }
      data[col.key ?? col.name] = null;
      continue;
    }

    switch (col.type) {
      case 'string':
        data[col.key ?? col.name] = raw;
        break;
      case 'number': {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          errors.push({ row: rowNumber, col: col.name, msg: '不是合法数字', raw: cells });
        } else {
          data[col.key ?? col.name] = n;
        }
        break;
      }
      case 'integer': {
        if (!/^-?\d+$/.test(raw)) {
          errors.push({ row: rowNumber, col: col.name, msg: '不是整数', raw: cells });
        } else {
          data[col.key ?? col.name] = parseInt(raw, 10);
        }
        break;
      }
      case 'date': {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          errors.push({ row: rowNumber, col: col.name, msg: '日期格式必须是 YYYY-MM-DD', raw: cells });
        } else {
          data[col.key ?? col.name] = raw;
        }
        break;
      }
      case 'enum': {
        if (!col.enumValues?.includes(raw)) {
          errors.push({
            row: rowNumber, col: col.name,
            msg: `值必须是 ${col.enumValues?.join(' / ')}`,
            raw: cells,
          });
        } else {
          data[col.key ?? col.name] = raw;
        }
        break;
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data };
}
