import { describe, expect, it } from 'vitest';
import { parseRow } from './schemas.js';

describe('admin upload schemas', () => {
  it('normalizes product SKU codes while staging CSV rows', () => {
    const result = parseRow(
      'products',
      ['sku_code', 'product_name', 'category_name'],
      ['1174953', '黄鹤楼(硬8度)香烟(包)', '麻薯'],
      2,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sku_code).toBe('01174953');
    }
  });

  it('normalizes snapshot SKU codes while staging CSV rows', () => {
    const result = parseRow(
      'snapshots',
      ['store_code', 'sku_code', 'snapshot_date'],
      ['粤15068', '9090828', '2026-02-13'],
      2,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sku_code).toBe('09090828');
    }
  });
});
