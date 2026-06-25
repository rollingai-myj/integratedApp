# 数据库 Dump 说明

> 本目录被 `.gitignore` 排除(`dumps/` + `*.dump`)—— 含 `user_feishu_identities.open_id` 等敏感字段,不入仓库。

> ⚠️ **下面列的 dump 是 V001-V031 的快照,已经滞后于当前 schema(V038)**。
> 灌库后需要再跑增量 migration:`docker exec myj-api npx tsx src/db/migrate.ts up` 把 V032-V038 补上。
> 想要"刚出炉的对齐 dump",按下方"重新 dump"流程生成一份新的。

## 当前 dump(历史快照)

时间戳:**2026-06-23T042758Z**
PostgreSQL 版本:**16.14** (Alpine, aarch64)
迁移版本:**V001 → V031**(灌库后需再补 V032-V038 共 7 个 migration)
源容器:`myj-postgres` (database: `myj_dev`, user: `myj`)

> 本次 dump 前已清空所有店的:调改状态(`store_scene_state` / `store_scene_adjustments` / `store_scene_remakes` / `store_scene_virtual_history`、级联清掉 `store_assortment_changes`)、货架登记(`store_scene_shelves`)、问答(`store_survey_questions` / `store_survey_answers`)。其他业务数据保持原状。

| 文件 | 大小 | 用途 |
|---|---|---|
| `schema-2026-06-23T042758Z.sql` | 86K | 只导出结构(表/视图/函数/枚举/索引),不含数据;复盘 schema 用 |
| `full-2026-06-23T042758Z.sql` | 3.0M | 完整 SQL 形式(结构 + 数据),可读;`psql -f` 直接灌新库 |
| `full-2026-06-23T042758Z.dump` | 735K | 压缩二进制(custom format);`pg_restore` 恢复,体积小 |

## 恢复命令

**用 plain SQL 文件灌新库**(可直接看到每条 SQL):

```bash
docker exec -i myj-postgres psql -U myj -d myj_dev_restore < dumps/full-2026-06-23T042758Z.sql
```

**用压缩 dump 恢复**(更快,但需要 `pg_restore`):

```bash
docker exec -i myj-postgres pg_restore -U myj -d myj_dev_restore --no-owner --no-privileges < dumps/full-2026-06-23T042758Z.dump
```

## 重新 dump 当前库

```bash
TS=$(date -u +%Y-%m-%dT%H%M%SZ)
docker exec myj-postgres pg_dump -U myj -d myj_dev --schema-only --no-owner --no-privileges > dumps/schema-${TS}.sql
docker exec myj-postgres pg_dump -U myj -d myj_dev --no-owner --no-privileges > dumps/full-${TS}.sql
docker exec myj-postgres pg_dump -U myj -d myj_dev --no-owner --no-privileges -Fc > dumps/full-${TS}.dump
```

## 注意

- 历史 dump(如 `myj_dev_20260610_175641.sql`、`myj_dev_pre_baseline_20260612.sql.gz`)是 baseline 之前的旧版本,保留作回滚备份,不要混用。
- 文件大小若突然变大(单次 dump 超 100MB),先确认是否误把 `pg_data` 目录里的二进制日志一起 dump 了。
