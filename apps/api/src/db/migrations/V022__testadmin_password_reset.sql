-- 同 V021，但作用于 testadmin 账号（团队 quickstart doc 里日常用的超管入口）
-- V021 只覆盖了 legacy_account='admin'，testadmin 当时还留着旧 changeme，对不上口令文档。

UPDATE users
   SET legacy_password_hash = crypt('rolling114514', gen_salt('bf'))
 WHERE legacy_account = 'testadmin'
   AND deleted_at IS NULL;
