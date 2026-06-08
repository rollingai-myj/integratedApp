/**
 * 密码校验单元测试
 *
 * 老库有两种哈希格式同时存在：
 *   - bcrypt（store_accounts 走过来的）
 *   - SHA-256（auth_users 走过来的）
 * 这里两种都要走通，并且常见的失败情形要稳定 false。
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { verifyLegacyPassword } from './password.js';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs') as {
  hashSync: (s: string, salt: number) => string;
};

describe('verifyLegacyPassword', () => {
  it('matches bcrypt hash (store_accounts 路径)', async () => {
    const hash = bcrypt.hashSync('hunter2', 6);
    expect(await verifyLegacyPassword('hunter2', hash)).toBe(true);
    expect(await verifyLegacyPassword('hunter3', hash)).toBe(false);
  });

  it('matches sha256 hex hash (auth_users 路径)', async () => {
    const hash = createHash('sha256').update('hunter2', 'utf8').digest('hex');
    expect(await verifyLegacyPassword('hunter2', hash)).toBe(true);
    expect(await verifyLegacyPassword('hunter3', hash)).toBe(false);
  });

  it('matches sha256 case-insensitively (uppercase hex)', async () => {
    const hashUpper = createHash('sha256')
      .update('hunter2', 'utf8')
      .digest('hex')
      .toUpperCase();
    expect(await verifyLegacyPassword('hunter2', hashUpper)).toBe(true);
  });

  it('returns false for null/empty input', async () => {
    expect(await verifyLegacyPassword('', 'whatever')).toBe(false);
    expect(await verifyLegacyPassword('hunter2', null)).toBe(false);
    expect(await verifyLegacyPassword('hunter2', undefined)).toBe(false);
    expect(await verifyLegacyPassword('hunter2', '')).toBe(false);
  });

  it('returns false for unrecognized hash format', async () => {
    expect(await verifyLegacyPassword('hunter2', 'plaintext')).toBe(false);
    expect(await verifyLegacyPassword('hunter2', 'md5:abc123')).toBe(false);
    // 长度对、但全是非 hex 字符
    expect(
      await verifyLegacyPassword(
        'hunter2',
        'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
      ),
    ).toBe(false);
  });
});
