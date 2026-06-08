# 贡献指南

欢迎贡献。这份文档说明我们怎么协作开发——**所有团队成员（无论是人还是 AI 工具）都必须遵守**。

不熟悉 git / GitHub？没关系，本文档假设你只会用 GitHub 网页 + 一个写代码的 AI 工具（Claude Code / Cursor 等）就足够。

---

## 总原则

1. **`main` 分支永远是"能用的版本"**——不允许任何人直接往 main 提交代码
2. **每个任务用一根独立分支**——任务之间互不打架
3. **改动通过 Pull Request 进入 main**——至少 1 人审核通过才能合并
4. **小步快跑**——一个 PR 解决一件事，不要一个 PR 改 50 个文件

---

## 工作流（GitHub Flow）

```
       main 分支（生产可用）
        │
        ├── feat/feishu-login     ← 张三 / AI 在做：飞书登录
        │
        ├── feat/sku-list-api     ← 李四 / AI 在做：商品列表接口
        │
        └── fix/poster-timeout    ← 王五 / AI 在做：海报超时 bug

任务完成 → Pull Request → 评审 → 合并到 main → 删分支
```

### 步骤详解

#### 1. 认领一个任务

从 [Issues](https://github.com/rollingai-myj/integratedApp/issues) 或 [milestones.md](docs/milestones.md) 里挑一个你想做的任务。在 issue 上评论"我来做这个"，避免和别人撞车。

#### 2. 从 main 拉一个分支

分支命名规则（必须遵守）：

| 前缀 | 用途 | 例子 |
|---|---|---|
| `feat/` | 新功能 | `feat/feishu-login`、`feat/sku-correction-ui` |
| `fix/` | 修 bug | `fix/poster-timeout`、`fix/login-redirect-loop` |
| `docs/` | 改文档 | `docs/api-clarify-pagination` |
| `chore/` | 工程杂事（依赖升级、配置调整等） | `chore/upgrade-react-19`、`chore/add-eslint` |
| `refactor/` | 重构（不改业务行为） | `refactor/extract-store-context` |
| `test/` | 添加测试 | `test/auth-middleware` |

> **不要**用 `update/`、`change/`、`xxx-modify` 这种含糊的前缀。

#### 3. 在分支上完成任务

- 改代码、改文档、加测试……
- 每完成一个有意义的小步骤就**提交一次**（git commit），不要把所有改动堆到一次提交
- 提交信息按 [Conventional Commits](https://www.conventionalcommits.org/) 写：

  | 例子 | 说明 |
  |---|---|
  | `feat(auth): add feishu OAuth callback` | 新功能 |
  | `fix(posters): handle empty job queue gracefully` | 修 bug |
  | `docs(api): correct shelves endpoint description` | 改文档 |
  | `chore(deps): upgrade pino to 9.x` | 杂事 |

#### 4. 推送分支到 GitHub

```bash
git push -u origin <你的分支名>
```

或者用 AI 工具一键推。

#### 5. 开一个 Pull Request

在 GitHub 网页上，点 "Compare & pull request" 按钮。**必须填 PR 模板**——模板会自动出现，按提示填即可。

要点：
- **标题**：用一句话说清楚这个 PR 做了什么。例 "feat(auth): 接入飞书 OAuth 登录"
- **关联 issue**：在描述里写 `Closes #123`，合并后 issue 会自动关闭
- **测试方式**：清楚地写"怎么验证这个改动是对的"。让 reviewer 能跟着步骤走

#### 6. 等评审

- 至少需要 1 个人 review 通过才能合并
- review 中如果有评论 / 改动建议，你直接在分支上提交修正，PR 会自动更新
- 不要在 review 中和 reviewer 争吵——讨论问题、达成共识、改进代码

#### 7. 合并

review 通过后点 "Squash and merge"（推荐）：把分支上所有提交压成一个，合并到 main。这样 main 的历史很干净。

合并后：**删除分支**（GitHub 上会提示"Delete branch"按钮）。

---

## PR 的标准

一个合格的 PR：

✅ **小**：尽量在 300 行以下。超过 500 行的 PR 拆成多个
✅ **聚焦一件事**：不要在一个 PR 里同时改登录 + 修海报 bug + 升级依赖
✅ **测试方式清晰**：reviewer 能 5 分钟内验证你的改动是对的
✅ **不破坏现有功能**：合并前确认本地启动、关键流程跑通
✅ **遵守规划**：和 [unified-api-spec.md](docs/planning/unified-api-spec.md)、[unified-database-spec.md](docs/planning/unified-database-spec.md) 一致；如果要偏离规划，先在 PR 描述里说明理由

❌ 一个 PR 几千行
❌ 标题写 "更新"、"修改"、"优化代码"
❌ 描述空白或只有 "see code"
❌ 改了规划但没更新对应的文档
❌ 直接修改 main 上的文件（被分支保护规则拦截）

---

## 数据库改动的特别规则

数据库 schema 改动**风险高**，单独拎出来说：

1. **不允许**直接改已有的 migration 文件（如 `V001__extensions.sql`）——已经跑过的 migration 是历史，不能改
2. **要新增字段或表**：写一个新的 migration 文件 `V0XX__描述.sql`
3. **要修改已有字段类型**：在新 migration 里用 `ALTER TABLE`，不要回去改老文件
4. **要删字段或表**：写新 migration 用 `DROP COLUMN` / `DROP TABLE`，并在 PR 描述里**明确写出**这会丢失什么数据
5. **改了 schema 必须同步更新** [docs/planning/unified-database-spec.md](docs/planning/unified-database-spec.md)

> 12 个决策点的默认实现，将来如果要改（比如从 D7 选项 C 改成选项 B），按上面步骤新增 migration + 更新规划文档即可。

---

## 接口改动的特别规则

1. **新增接口**：直接加路由、加文档
2. **改已有接口**：
   - 如果是新增字段（不影响已有调用方）→ 直接改
   - 如果是改字段含义、删字段、改路径 → 这是破坏性改动，必须先在 issue 里讨论
3. **改了接口必须同步更新** [docs/planning/unified-api-spec.md](docs/planning/unified-api-spec.md)

---

## 紧急修复（hotfix）

线上出 bug 需要紧急修：

1. 从 main 拉 `fix/紧急bug名` 分支
2. 修完开 PR，标题加 `[HOTFIX]` 前缀
3. 走正常的 review 流程，但 reviewer 优先处理
4. 合并后立即发布

---

## 我（业务方）应该怎么 review 代码？

你不会写代码——没关系，你的 review 重点是**业务正确性**，不是代码风格：

1. **看 PR 描述**：作者说了这个 PR 解决什么业务问题？合不合理？
2. **看测试方式**：按"怎么验证"的步骤跑一遍，业务流程是不是对的？
3. **看截图 / 录屏**：如果是 UI 改动，PR 里应该有截图或录屏。看上去对不对？
4. **如果不确定**：在 PR 里 @ 其他人帮你看技术细节，你专注"业务对不对"

技术正确性可以交给：
- 另一个团队成员
- AI 工具（让 Claude / Cursor 帮你看代码、找潜在问题）
- 自动化检查（CI 跑通就说明语法和基础质量没问题）

---

## 常见问题

**Q：我用 AI 工具写代码，怎么开 PR？**
A：AI 工具（Claude Code 等）通常内置了 PR 创建命令，让 AI 直接帮你开。或者你把代码改完，AI 帮你 push 到分支，你在 GitHub 网页上手动开 PR。

**Q：reviewer 一直不回我怎么办？**
A：先在 PR 上 @ 对方提醒；超过 1 天还没回就直接群里说一下，可能 reviewer 错过了。

**Q：我合并错了，main 坏了怎么办？**
A：立刻在群里说，让懂技术的人或 AI 工具帮你"revert"（撤销那次合并）。不要自己慌乱乱改。

**Q：分支保护规则拦截了我的合并，说"Required check failing"**
A：意味着自动化检查（CI）没跑通，比如代码语法错、测试没过。打开 PR 看 "Checks" 标签页，里面会写具体哪里失败。让 AI 工具帮你修。

---

## 联系方式

有任何不清楚的，在仓库里开 issue，或者在团队群里问。
