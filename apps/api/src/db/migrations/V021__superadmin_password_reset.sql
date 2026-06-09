-- 把超管账号 admin 的兜底密码改成 rolling114514
-- 原 V015 seed 用的是 changeme，仅在账号不存在时插入，所以已 seed 的实例需要这次 UPDATE。
-- 用 pgcrypto crypt() + bf salt，与 lib/password.ts 的 verifyLegacyPassword 校验一致。

UPDATE users
   SET legacy_password_hash = crypt('rolling114514', gen_salt('bf'))
 WHERE legacy_account = 'admin'
   AND deleted_at IS NULL;
