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

// promotions 不走这套简化 CSV staging 框架,继续用 hq_promo_batches 的 xlsx 工作流
// (POST /promotions/batches:upload),因为它需要多 sheet 解析 + 库内联表 + 凑单池
// 等业务概念,跟 products/snapshots 的"一表一上传"模型差太远。
export type UploadKind = 'products' | 'snapshots' | 'stores';

type FieldType = 'string' | 'number' | 'integer' | 'date' | 'enum' | 'bool';

export interface ColumnDef {
  name: string;
  required: boolean;
  type: FieldType;
  /** type='enum' 时的可选值(中文,展示给用户) */
  enumValues?: string[];
  /** type='enum' 时,中文值 → 实际入库值的映射(为空则原样入库) */
  enumDbMap?: Record<string, string>;
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
    '美宜佳所有在售商品的基础信息库。同一个「商品编码」在系统里已经存在时,本次上传会自动更新原有信息;不存在则新增。「商品品类」必须填到最末一级(例如「瓶装饮用水」,而不是「饮料」),否则该行无法生效。布尔字段(是/否)留空表示不修改、保留原值。',
  columns: [
    // ---- 基础信息 ---------------------------------------------------------
    { name: 'sku_code',               required: true,  type: 'string',  description: '商品编码,每个商品唯一',          sample: '22033344' },
    { name: 'product_name',           required: true,  type: 'string',  description: '商品名称',                       sample: '怡宝纯净水 555ml' },
    { name: 'brand',                  required: false, type: 'string',  description: '品牌',                           sample: '怡宝' },
    { name: 'series',                 required: false, type: 'string',  description: '系列(同品牌下的子系列名)',         sample: '怡宝矿泉水' },
    { name: 'spec',                   required: false, type: 'string',  description: '规格',                           sample: '555ml' },
    { name: 'unit',                   required: false, type: 'string',  description: '单位',                           sample: '瓶' },
    { name: 'category_name',          required: true,  type: 'string',  description: '商品品类(填最末一级,如「瓶装饮用水」)', sample: '瓶装饮用水' },
    { name: 'barcode',                required: false, type: 'string',  description: '条码',                           sample: '6901285991213' },

    // ---- 在售状态 ---------------------------------------------------------
    {
      name: 'status',                 required: false, type: 'enum',
      enumValues: ['在售', '已下架'],
      enumDbMap: { '在售': 'active', '已下架': 'delisted' },
      description: '在售状态(默认为「在售」)',
      sample: '在售',
    },

    // ---- 尺寸 / 规格 ------------------------------------------------------
    { name: 'length_cm',              required: false, type: 'number',  description: '商品深(cm)',                     sample: '6.5' },
    { name: 'width_cm',               required: false, type: 'number',  description: '商品宽(cm)',                     sample: '6.5' },
    { name: 'height_cm',              required: false, type: 'number',  description: '商品高(cm)',                     sample: '21.0' },
    { name: 'shelf_life_days',        required: false, type: 'integer', description: '保质期(天)',                     sample: '365' },
    { name: 'allocation_unit',        required: false, type: 'integer', description: '配货单位:一次最少配货的整包数量', sample: '24' },

    // ---- 价格 -------------------------------------------------------------
    { name: 'wholesale_price',        required: false, type: 'number',  description: '进货价(元)',                     sample: '1.50' },
    { name: 'suggested_retail_price', required: false, type: 'number',  description: '建议零售价(元)',                 sample: '2.00' },
    { name: 'market_min_price',       required: false, type: 'number',  description: '外部市场最低零售价(元)',          sample: '1.80' },
    { name: 'market_min_price_source',required: false, type: 'string',  description: '市场最低价的来源(如「好享来」)',  sample: '好享来' },

    // ---- 标签 / 标记 ------------------------------------------------------
    { name: 'tags',                   required: false, type: 'string',  description: '标签,多个用英文逗号 , 分开',      sample: '饮料,大单品' },
    { name: 'is_new_product',         required: false, type: 'bool',    description: '是否新品(是/否)',                 sample: '否' },
    { name: 'is_private_label',       required: false, type: 'bool',    description: '是否自有品牌(是/否)',             sample: '否' },
    { name: 'is_returnable',          required: false, type: 'bool',    description: '是否可退(是/否)',                 sample: '是' },
    { name: 'is_whitelisted',         required: false, type: 'bool',    description: '是否进入上架待选池(是/否)',       sample: '是' },

    // ---- 时间 -------------------------------------------------------------
    { name: 'introduced_at',          required: false, type: 'date',    description: '上市日期(格式:年-月-日)',         sample: '2020-03-15' },
  ],
};

// =============================================================================
// snapshots — 销售快照
// =============================================================================

const SNAPSHOTS_SPEC: ColumnSpec = {
  kind: 'snapshots',
  label: '门店销售快照',
  description:
    '每家门店、每个商品、每一天的销售和库存记录。同一门店、同一商品、同一天如果重复上传,以最新一次为准(覆盖)。「门店编号」必须是已开店的门店,「商品编码」必须已存在于产品主数据,否则该行无法生效。',
  columns: [
    { name: 'store_code',         required: true,  type: 'string',  description: '门店编号',                     sample: '粤37893' },
    { name: 'sku_code',           required: true,  type: 'string',  description: '商品编码',                     sample: '22033344' },
    { name: 'snapshot_date',      required: true,  type: 'date',    description: '日期(格式:年-月-日,如 2026-06-20)', sample: '2026-06-20' },
    { name: 'retail_price',       required: false, type: 'number',  description: '售价(元)',                     sample: '2.00' },
    { name: 'sales_qty_30d',      required: false, type: 'integer', description: '近 30 天销量(件)',             sample: '128' },
    { name: 'sales_realamt_30d', required: false, type: 'number',  description: '近 30 天销售额(元)',            sample: '256.00' },
    { name: 'sales_qty_90d',      required: false, type: 'integer', description: '近 90 天销量(件)',             sample: '420' },
    { name: 'sales_realamt_90d', required: false, type: 'number',  description: '近 90 天销售额(元)',            sample: '840.00' },
    { name: 'stock_qty',          required: false, type: 'integer', description: '当前库存(件)',                 sample: '36' },
  ],
};

// =============================================================================
// stores — 门店档案
// =============================================================================

const STORES_SPEC: ColumnSpec = {
  kind: 'stores',
  label: '门店信息',
  description:
    '美宜佳所有门店的基础档案。同一个「门店编号」在系统里已存在时,本次上传会自动更新原有信息;不存在则新增。「在用状态」留空时,新增门店默认为「在用」。布尔字段(是/否)留空表示不修改、保留原值。',
  columns: [
    { name: 'store_code',       required: true,  type: 'string',  description: '门店编号,每家门店唯一(如「粤37893」)', sample: '粤37893' },
    { name: 'store_name',       required: true,  type: 'string',  description: '门店名称(挂牌名)',               sample: '东莞莞城旗峰店' },
    { name: 'province',         required: false, type: 'string',  description: '省',                              sample: '广东省' },
    { name: 'city',             required: false, type: 'string',  description: '市',                              sample: '东莞市' },
    { name: 'address',          required: false, type: 'string',  description: '详细地址',                         sample: '东莞市莞城区旗峰路 12 号' },
    { name: 'latitude',         required: false, type: 'number',  description: '纬度(可留空,系统不强制填写)',    sample: '23.043532' },
    { name: 'longitude',        required: false, type: 'number',  description: '经度(可留空,系统不强制填写)',    sample: '113.751765' },
    { name: 'opened_at',        required: false, type: 'date',    description: '开店日期(格式:年-月-日)',         sample: '2018-09-01' },
    {
      name: 'status',           required: false, type: 'enum',
      enumValues: ['在用', '已停用'],
      enumDbMap: { '在用': 'active', '已停用': 'disabled' },
      description: '在用状态(默认为「在用」)',
      sample: '在用',
    },
    { name: 'is_project_store', required: false, type: 'bool',    description: '是否项目店(是/否)',               sample: '否' },
    { name: 'store_area_sqm',   required: false, type: 'number',  description: '门店面积(㎡)',                    sample: '65.5' },
    { name: 'poi_category',     required: false, type: 'string',  description: '商圈类型(如「商业区/学校/居民区」)', sample: '居民区' },
  ],
};

// =============================================================================
// 总注册表
// =============================================================================

const SPECS: Record<UploadKind, ColumnSpec> = {
  products: PRODUCTS_SPEC,
  snapshots: SNAPSHOTS_SPEC,
  stores: STORES_SPEC,
};

export function specOf(kind: UploadKind): ColumnSpec {
  return SPECS[kind];
}

export function allSpecs(): ColumnSpec[] {
  return [PRODUCTS_SPEC, SNAPSHOTS_SPEC, STORES_SPEC];
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

/** 宽松解析布尔值:支持中英文常见写法,无法识别返回 null */
function parseBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (['是', 'y', 'yes', 'true', '1', 't'].includes(v)) return true;
  if (['否', 'n', 'no', 'false', '0', 'f'].includes(v)) return false;
  return null;
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
        errors.push({ row: rowNumber, col: col.name, msg: '此项必填,不能为空', raw: cells });
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
          errors.push({ row: rowNumber, col: col.name, msg: '请填数字(可带小数点)', raw: cells });
        } else {
          data[col.key ?? col.name] = n;
        }
        break;
      }
      case 'integer': {
        if (!/^-?\d+$/.test(raw)) {
          errors.push({ row: rowNumber, col: col.name, msg: '请填整数,不能有小数点', raw: cells });
        } else {
          data[col.key ?? col.name] = parseInt(raw, 10);
        }
        break;
      }
      case 'date': {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          errors.push({ row: rowNumber, col: col.name, msg: '日期格式不对,应为「年-月-日」如 2026-06-20', raw: cells });
        } else {
          data[col.key ?? col.name] = raw;
        }
        break;
      }
      case 'enum': {
        if (!col.enumValues?.includes(raw)) {
          errors.push({
            row: rowNumber, col: col.name,
            msg: `只能填以下之一:${col.enumValues?.join(' / ')}`,
            raw: cells,
          });
        } else {
          // 有 enumDbMap 则映射成入库值,否则原样
          data[col.key ?? col.name] = col.enumDbMap?.[raw] ?? raw;
        }
        break;
      }
      case 'bool': {
        const b = parseBool(raw);
        if (b === null) {
          errors.push({ row: rowNumber, col: col.name, msg: '请填「是」或「否」', raw: cells });
        } else {
          data[col.key ?? col.name] = b;
        }
        break;
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data };
}
