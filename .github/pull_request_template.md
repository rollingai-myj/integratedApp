<!-- 📌 请按下面的模板填写。PR 描述清晰能让 review 快很多。 -->

## 这个 PR 做了什么

<!-- 一两句话说清楚。例："接入飞书 OAuth 登录，店长在登录页可以扫码登录"。 -->

## 为什么要做

<!-- 关联到 issue / milestone / 业务需求。例："Closes #12，对应 M1 里程碑"。 -->

## 改了哪些地方

<!-- 列出主要改动的文件 / 模块。让 reviewer 心里有数。 -->

- [ ] 后端（apps/api）
- [ ] 前端（apps/web）
- [ ] 数据库 schema（apps/api/src/db/migrations）
- [ ] 规划文档（docs/planning）
- [ ] 协作文档（README、CONTRIBUTING 等）
- [ ] 工程配置（依赖、CI、Docker 等）

## 怎么验证

<!-- 关键。reviewer 会跟着这个步骤走一遍。 -->

1.
2.
3.

## 截图 / 录屏（UI 改动必须有）

<!-- 直接拖图片到这里。 -->

## 检查清单

- [ ] 本地启动没问题（`npm run dev` 跑通）
- [ ] 改了接口同步更新了 [docs/planning/unified-api-spec.md](../docs/planning/unified-api-spec.md)
- [ ] 改了数据库同步更新了 [docs/planning/unified-database-spec.md](../docs/planning/unified-database-spec.md)，且用新的 migration 文件而不是改老文件
- [ ] PR 标题符合 [Conventional Commits](https://www.conventionalcommits.org/) 格式
- [ ] PR 不是巨型 PR（如果超过 500 行，考虑拆开）

## 其它备注

<!-- 任何 reviewer 应该知道的事情：兼容性、性能影响、待办事项等。 -->
