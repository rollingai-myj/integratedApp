# 已归档:历史 plans / specs

这下面的文档都是**做完或被推翻的实施计划 / 设计草案**,留下来仅作历史溯源。

⚠️ **不要按这里的描述判断当前系统状态**。每份文档顶部都有日期,代表"那个时间点的工作计划",不一定还在做、不一定还有效。

- 当前接口契约:见 [../../api-contracts.md](../../api-contracts.md)
- 当前数据库结构:见 [../../database-schema.md](../../database-schema.md)
- 当前在做的事的设计 / 计划:`docs/superpowers/plans/` 和 `docs/superpowers/specs/`(若有,这次都已清空,新工作随用随建)

## 已归档清单

### plans/

- `2026-06-15-dify-workflows-to-backend-background.md` — Dify 工作流后端化(部分已落地,后端化 detect/align/selection bootstrap)
- `2026-06-15-mix-groups-integration-and-dead-chain-cleanup.md` — ⚠️ 已被 V029 整体推翻(mix_groups 表 / hq_promo_sku_texts 都不存在了)
- `2026-06-15-promo-upload-admin-module.md` — 已完成,体现在 admin-web `/uploads/promotions`
- `2026-06-17-promo-data-redesign.md` — 已完成,V029 + 后续促销 4 类机制

### specs/

- `2026-06-15-mix-groups-integration-and-dead-chain-cleanup-design.md` — 同上,已被推翻
- `2026-06-17-promo-data-redesign-design.md` — 已完成

## 加新 plan / spec 放哪儿?

新工作:`docs/superpowers/plans/<date>-<name>.md` + `docs/superpowers/specs/<date>-<name>-design.md`

做完或决定不做后,`git mv` 到 `docs/superpowers/archive/{plans,specs}/`,并更新本 README 加一条说明它的"最终状态"。
