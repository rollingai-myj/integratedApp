/**
 * 老库密码哈希校验
 *
 * 老库里有两种密码哈希格式：
 *   - bcrypt（选品 store_accounts）：`$2a$..` / `$2b$..` / `$2y$..`，长度 60
 *   - SHA-256（海报 auth_users）：64 位 hex，无前缀
 *
 * legacy-data-migration.md 里有写明这个细节，迁过来时都原样保留在 users.legacy_password_hash。
 * 这里按哈希前缀分流校验。
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

// bcryptjs 仍是 CJS 包，在 NodeNext ESM 下命名导入会失败；
// 用 createRequire 拿到 CJS 模块对象后解构最稳。
const require = createRequire(import.meta.url);
const bcryptjs = require('bcryptjs') as {
  compare: (plain: string, hash: string) => Promise<boolean>;
  hash: (plain: string, rounds: number) => Promise<string>;
};
const bcryptCompare = bcryptjs.compare;

/** 生成密码哈希（bcrypt cost=10）——后台账号管理建号/重置密码用 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcryptjs.hash(plaintext, 10);
}

const BCRYPT_PREFIX = /^\$2[aby]\$/;
const SHA256_HEX = /^[0-9a-f]{64}$/i;

export async function verifyLegacyPassword(
  plaintext: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!plaintext || !hash) return false;

  if (BCRYPT_PREFIX.test(hash)) {
    return bcryptCompare(plaintext, hash);
  }

  if (SHA256_HEX.test(hash)) {
    const candidate = createHash('sha256').update(plaintext, 'utf8').digest('hex');
    // 老库的 hex 可能是大写或小写，先 normalize 到小写再比对
    return constantTimeEqualsHex(candidate, hash.toLowerCase());
  }

  return false;
}

function constantTimeEqualsHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
