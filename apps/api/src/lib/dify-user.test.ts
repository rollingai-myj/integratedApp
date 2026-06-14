/**
 * buildDifyUser 单元测试：三种登录渠道 × 三种店号场景
 */
import { describe, it, expect } from 'vitest';
import { buildDifyUser } from './dify-user.js';
import type { AuthenticatedUser } from '../types/api.js';

const base: AuthenticatedUser = {
  id: '00000000-0000-0000-0000-000000000001',
  name: '测试',
  roles: ['store_owner'],
};

describe('buildDifyUser', () => {
  it('账密 admin + 粤28999 → admin-粤28999', () => {
    expect(
      buildDifyUser({
        ...base,
        legacyAccount: 'admin',
        authMethod: 'legacy_password',
        currentStoreCode: '粤28999',
      }),
    ).toBe('admin-粤28999');
  });

  it('账密 ops + 粤29790 → ops-粤29790', () => {
    expect(
      buildDifyUser({
        ...base,
        legacyAccount: 'ops',
        authMethod: 'legacy_password',
        currentStoreCode: '粤29790',
      }),
    ).toBe('ops-粤29790');
  });

  it('飞书 H5 + 粤28301 → lark-粤28301', () => {
    expect(
      buildDifyUser({
        ...base,
        legacyAccount: null,
        authMethod: 'feishu_h5',
        currentStoreCode: '粤28301',
      }),
    ).toBe('lark-粤28301');
  });

  it('飞书扫码 → lark-{store}', () => {
    expect(
      buildDifyUser({
        ...base,
        legacyAccount: null,
        authMethod: 'feishu_qr',
        currentStoreCode: '粤39128',
      }),
    ).toBe('lark-粤39128');
  });

  it('缺 store_code → 用 no-store 占位', () => {
    expect(
      buildDifyUser({
        ...base,
        legacyAccount: 'admin',
        authMethod: 'legacy_password',
        currentStoreCode: null,
      }),
    ).toBe('admin-no-store');
  });

  it('账密 + 缺 legacy_account（数据异常）→ 用 unknown 占位', () => {
    expect(
      buildDifyUser({
        ...base,
        legacyAccount: null,
        authMethod: 'legacy_password',
        currentStoreCode: '粤37893',
      }),
    ).toBe('unknown-粤37893');
  });
});
