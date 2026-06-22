# 在本地还原数据库

把当前 myj_dev 数据库完整移植到另一台开发机的步骤。

> `dumps/` 被 `.gitignore` 排除(含飞书 `open_id` / OSS key / 手机号等敏感字段)。dump 文件必须**离线传输**,不要塞进公共群。

---

## 一、原机:确认 dump 文件

```bash
ls -lh dumps/full-*.sql dumps/full-*.dump
```

推荐传给同事的格式:

| 文件 | 大小级别 | 优点 | 缺点 |
|---|---|---|---|
| `full-<ts>.sql` | ~3 MB | 可读 SQL,灌库出错可直接 grep 看到具体行 | 体积稍大 |
| `full-<ts>.dump` | ~0.7 MB | 体积小,`pg_restore` 速度更快 | 二进制,排查麻烦 |

如果同事是第一次还原,**推荐用 plain SQL (`.sql`) 那份**。

传输方式任选:scp / 飞书 / 钉钉 / 网盘。

---

## 二、目标机:还原(全新 mac,从未跑过本项目)

```bash
# 1. clone 仓库 + 切到 main
git clone git@github.com:rollingai-myj/integratedApp.git
cd integratedApp

# 2. 准备 .env(找原作者要,或参照 .env.example;只灌 DB 时 DIFY/OSS 等密钥可空)
cp .env.example .env

# 3. 把 dump 文件放进本地 dumps/
mkdir -p dumps
cp ~/Downloads/full-<ts>.sql dumps/

# 4. 只起 postgres,不要起 api(API 启动时会跑 migrate.ts,与 dump 冲突)
docker compose --profile dev up -d postgres
docker exec myj-postgres pg_isready -U myj -t 10

# 5. 清空 myj_dev 后灌库
docker exec myj-postgres psql -U myj -d postgres -c "DROP DATABASE IF EXISTS myj_dev;"
docker exec myj-postgres psql -U myj -d postgres -c "CREATE DATABASE myj_dev OWNER myj;"
docker exec -i myj-postgres psql -U myj -d myj_dev < dumps/full-<ts>.sql

# 6. 自检
docker exec myj-postgres psql -U myj -d myj_dev \
  -c "SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema='public';"
docker exec myj-postgres psql -U myj -d myj_dev \
  -c "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 5;"
# tables 应 ≥ 34;migrations 顶部应是 V031(或更新)

# 7. 起完整服务
docker compose --profile dev up -d
```

---

## 三、目标机:还原(已经跑过本项目,有 myj-postgres 容器)

不用 `docker compose down -v` 删卷。第 5 步的 `DROP DATABASE IF EXISTS` 已经把库内对象清光,直接执行:

```bash
docker exec myj-postgres psql -U myj -d postgres -c "DROP DATABASE IF EXISTS myj_dev;"
docker exec myj-postgres psql -U myj -d postgres -c "CREATE DATABASE myj_dev OWNER myj;"
docker exec -i myj-postgres psql -U myj -d myj_dev < dumps/full-<ts>.sql
```

如果 API 容器正在跑,先停一下避免它在你灌库时打架:

```bash
docker stop myj-api && \
  docker exec myj-postgres psql ...   # 上面三条
docker start myj-api
```

---

## 四、用二进制 dump 还原(可选,更快)

如果用的是 `.dump` 文件:

```bash
docker exec myj-postgres psql -U myj -d postgres -c "DROP DATABASE IF EXISTS myj_dev;"
docker exec myj-postgres psql -U myj -d postgres -c "CREATE DATABASE myj_dev OWNER myj;"
docker exec -i myj-postgres pg_restore -U myj -d myj_dev --no-owner --no-privileges \
  < dumps/full-<ts>.dump
```

---

## 关键提醒

| 项 | 说明 |
|---|---|
| **不要在灌库前启动 API 容器** | API 的 `startup` 会跑 `migrate.ts`,把空库重新建表,跟 dump 里的 DDL 冲突 |
| **不需要先跑 V001-V031 迁移** | dump 已经把完整 schema 一起带了,灌完直接到 V031 |
| **`schema_migrations` 表必须随 dump 一起灌** | 否则后续叠 V032 时会从 V001 开始重跑,直接撞库 |
| **postgres 大版本必须 16** | docker-compose.yml 已经锁 `postgres:16-alpine`,默认就对 |
| **数据敏感性** | 含 `user_feishu_identities.open_id`、`stores.phone`、OSS bucket key 等;只在内部分享 |

---

## 故障排查

**症状:第 5 步报 `database "myj_dev" is being accessed by other users`**
→ 有连接没断。先 `docker stop myj-api`,或:
```bash
docker exec myj-postgres psql -U myj -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='myj_dev' AND pid<>pg_backend_pid();"
```

**症状:第 6 步表数 < 34**
→ dump 灌到一半失败了。看 `docker exec -i myj-postgres psql ...` 的最后几行,通常是某条 INSERT 撞唯一约束(同事的库可能有残留数据)。修法:再做一次 DROP/CREATE,确保库是空的再灌。

**症状:灌完后 API 起来不能登录**
→ 默认密码 hash 已经在 dump 里。如果 .env 的 `JWT_SECRET` 跟原机不同,旧 cookie 会失效;但用户名/密码登录还是有效。

**症状:`pg_restore` 报一堆 WARNING/ERROR 但库看上去也对**
→ 正常。`--no-owner --no-privileges` 会跳过 owner/grant,这些 warning 可以忽略;真正失败的是 `relation already exists` —— 出现这种说明库不空,回到方案三。
