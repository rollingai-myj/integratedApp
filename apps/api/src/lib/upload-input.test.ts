import { describe, expect, it } from 'vitest';
import { decodeUploadFileName, normalizeSkuCode } from './upload-input.js';

describe('upload input normalization', () => {
  it('pads 7-digit SKU codes to 8 digits', () => {
    expect(normalizeSkuCode('1174953')).toBe('01174953');
    expect(normalizeSkuCode(' 9090828 ')).toBe('09090828');
    expect(normalizeSkuCode('01174953')).toBe('01174953');
    expect(normalizeSkuCode('ABC1234')).toBe('ABC1234');
  });

  it('decodes mojibake multipart filenames and keeps normal names intact', () => {
    const mojibake = Buffer.from('调价后.csv', 'utf8').toString('latin1');
    expect(decodeUploadFileName(mojibake, 'fallback.csv')).toBe('调价后.csv');
    expect(decodeUploadFileName('products-template.csv', 'fallback.csv')).toBe('products-template.csv');
    expect(decodeUploadFileName('', 'fallback.csv')).toBe('fallback.csv');
  });
});
