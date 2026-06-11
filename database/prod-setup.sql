-- =============================================================================
-- 美宜佳门店助手 · 生产 RDS 一次性初始化
--
-- 此脚本在 RDS 首次部署时由运维手动执行一次,完成:
--   1. 建数据库 myj_prod
--   2. 建专用用户 myj_app(应用连库用,弱权限)
--   3. 授权 myj_app 在 myj_prod 上做日常 CRUD + DDL(应用迁移需要)
--
-- 用法(在 RDS 控制台或 psql 中以 RDS 主账号登录后):
--   psql -h <RDS_HOST> -U <RDS_ADMIN> -d postgres -f prod-setup.sql
--
-- 后续 schema 演化由 apps/api/src/db/migrations/*.sql 管理,
-- deploy.sh --migrate 会调用 `node dist/db/migrate.js up` 跑增量迁移
-- =============================================================================

-- 1) 建专用用户(密码占位 → 实际部署前替换为强口令并同步到 .env.production 的 DATABASE_URL)
CREATE USER myj_app WITH PASSWORD 'CHANGE_ME_BEFORE_DEPLOY';

-- 2) 建数据库,owner 给 myj_app(后续 DDL/迁移都用此账号)
CREATE DATABASE myj_prod
  WITH OWNER = myj_app
       ENCODING = 'UTF8'
       LC_COLLATE = 'en_US.UTF-8'
       LC_CTYPE = 'en_US.UTF-8'
       TEMPLATE = template0;

-- 3) 连入新库,授权 schema 权限
\c myj_prod

GRANT ALL PRIVILEGES ON DATABASE myj_prod TO myj_app;
GRANT ALL ON SCHEMA public TO myj_app;
ALTER SCHEMA public OWNER TO myj_app;

-- 4) 启用 gen_random_uuid() —— 迁移文件可能用到
CREATE EXTENSION IF NOT EXISTS pgcrypto;
