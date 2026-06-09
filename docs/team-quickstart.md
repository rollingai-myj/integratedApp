# 团队上手指南（30 分钟跑通）

> 这份文档是给**第一次接手本仓的同事**看的。读完你能：把项目跑起来、提交一段代码、在别人正在做的分支上接着干、看懂常见报错。
>
> 假定你**只会用 GitHub 网页 + 一个会写代码的 AI 工具**（[Claude Code](https://claude.com/claude-code) / Cursor / Copilot 都行），不熟 git 命令也没关系。
>
> 如果你想看更系统的规则（命名约定、PR 标准、DB 改动规则），看 [CONTRIBUTING.md](../CONTRIBUTING.md)。

---

## 0. 第一次：先把工具装好

只需要装一次，以后都不用再做。

### 0.1 装这 4 个软件

| 软件 | 下载 | 干什么用 |
|---|---|---|
| **Git** | [git-scm.com](https://git-scm.com/downloads) | 把代码从 GitHub 拉到电脑、把改动推回去 |
| **Node.js 22+** | [nodejs.org](https://nodejs.org/) | 装项目依赖、跑前后端 |
| **Docker Desktop** | [docker.com](https://www.docker.com/products/docker-desktop) | 本地起 PostgreSQL 数据库 |
| **AI 写代码工具** | Claude Code / Cursor 任选 | 让 AI 帮你改代码、开 PR、修报错 |

> Windows 用户：装完 Git 用"Git Bash"打开终端跑命令，不要用 cmd / PowerShell。

### 0.2 装一个 GitHub CLI（强烈推荐）

```bash
# Mac
brew install gh

# Windows（Git Bash 里跑）
winget install --id GitHub.cli
```

装完做一次登录：

```bash
gh auth login
# 选 GitHub.com → HTTPS → Login with browser → 浏览器会弹出来让你授权
```

授权过以后，开 PR、看 PR 状态都能在终端搞，不用切浏览器。

### 0.3 让别人加你进组织

把你的 GitHub 用户名发给项目负责人，让对方在 [rollingai-myj 组织](https://github.com/rollingai-myj) 里加你。加完你才能 push 代码。

---

## 1. 把项目跑起来（5 分钟）

**复制粘贴这 6 行，按顺序在终端跑**（在你想放代码的目录下，比如 `~/code/`）：

```bash
# 1. 把代码下载到本地（在你电脑上多了一个 integratedApp/ 文件夹）
git clone https://github.com/rollingai-myj/integratedApp.git
cd integratedApp

# 2. 装依赖（前后端、共享类型一起装；第一次会下几百 MB）
npm install

# 3. 起本地数据库（Docker 起一个 Postgres 容器，监听 5432）
docker compose up -d

# 4. 拷贝环境变量模板（默认值已经配好本地能跑）
cp apps/api/.env.example apps/api/.env

# 5. 初始化数据库（按顺序跑 apps/api/src/db/migrations/ 下的 V001~V020 SQL）
npm run -w apps/api migrate

# 6. 启动后端 + 前端（开两个终端窗口，各跑一条）
npm run -w apps/api dev    # 终端 1：后端 8787 端口
npm run -w apps/web dev    # 终端 2：前端 5173 端口
```

跑完打开 [http://localhost:5173](http://localhost:5173)，账密 `testadmin` / `changeme` 登录，能看到首页就说明跑通了。

### 1.1 关键脚本说明（你以后会反复用）

| 命令 | 干什么 | 什么时候用 |
|---|---|---|
| `npm install` | 装/更新依赖 | 第一次拉代码后、`git pull` 拉到了 `package.json` 改动后 |
| `docker compose up -d` | 起本地数据库 | 重启电脑后 |
| `docker compose down` | 关数据库 | 不用了 / 想清干净 |
| `npm run -w apps/api migrate` | 跑没执行过的 SQL 迁移 | `git pull` 拉到了新 migration 后 |
| `npm run -w apps/api migrate status` | 看哪些 migration 跑过/没跑过 | 不确定库是不是最新 |
| `npm run -w apps/api dev` | 起后端（自动 reload） | 开发期间一直开着 |
| `npm run -w apps/web dev` | 起前端（自动 reload） | 开发期间一直开着 |
| `npm run -w apps/api test` | 跑后端测试 | 改完代码 / 开 PR 前 |
| `npm run -w apps/api typecheck` | 检查 TypeScript 类型 | 改完代码 / 开 PR 前 |

### 1.2 数据库怎么看里面的数据

直接命令行查：

```bash
docker exec myj-postgres psql -U myj -d myj_dev -c "SELECT count(*) FROM stores;"
```

或者装个图形化工具：[DBeaver](https://dbeaver.io/)（免费）或 [TablePlus](https://tableplus.com/)。连接信息：

```
host:     localhost
port:     5432
user:     myj
password: myj_dev_password
database: myj_dev
```

---

## 2. 提交你的第一段代码（从改文件到合并进 main）

**整套流程示例**：假设你要修一个错别字。

### 2.1 从最新 main 拉一根分支

```bash
# 切到 main 并把最新代码拉下来
git checkout main
git pull

# 开一根新分支（名字按 CONTRIBUTING.md 的命名规则）
git checkout -b docs/fix-typo
```

分支命名规则速查：

| 前缀 | 什么时候用 | 例子 |
|---|---|---|
| `feat/` | 加新功能 | `feat/store-search` |
| `fix/` | 修 bug | `fix/login-redirect-loop` |
| `docs/` | 改文档 | `docs/api-clarify-pagination` |
| `chore/` | 工程杂事（升依赖、调配置） | `chore/upgrade-react` |
| `refactor/` | 重构（不改业务行为） | `refactor/extract-store-context` |

### 2.2 改代码

随便用什么编辑器都行——Cursor / VS Code / WebStorm。强烈推荐你边写边问 AI，例如：

> 我在 `apps/web/src/routes/index.tsx` 第 23 行有个错别字"门店店"应该是"门店"，帮我改掉。

AI 改完，你回到终端：

```bash
# 看看到底改了什么（按 q 退出）
git diff

# 没问题就把改动暂存
git add apps/web/src/routes/index.tsx

# 写提交信息（按 Conventional Commits）
git commit -m "docs: fix typo in home page header"
```

提交信息的写法：

```
docs:      → 改文档
fix:       → 修 bug
feat:      → 加新功能
chore:     → 杂事
refactor:  → 重构
```

### 2.3 推到 GitHub

```bash
git push -u origin docs/fix-typo
```

第一次 push 会让你登录 GitHub（如果之前 `gh auth login` 做过就不用再登）。

### 2.4 开 Pull Request

最简单：

```bash
gh pr create --base main --title "docs: 修首页错别字" --body "把'门店店'改成'门店'。"
```

或者打开终端输出里的 GitHub 链接，在网页上点 "Create pull request" 按钮，按模板填。

### 2.5 自检 + 合并

按 [CONTRIBUTING.md "评审规则"](../CONTRIBUTING.md#评审规则的当前阶段) 当前阶段是"允许自合并"，但合并前你**必须**：

1. 打开 PR 的 "Files changed" 标签页，从头到尾看一遍 diff
2. 跑一遍你在 PR 描述里写的"怎么验证"
3. 如果心里没底，让 AI 帮你看：

   > 帮我评审这个 PR：https://github.com/rollingai-myj/integratedApp/pull/XX
   > 找出潜在问题、命名是不是清楚、有没有破坏现有功能

确认 OK 后，回到 PR 页面，点绿色按钮 **Squash and merge**（推荐方式，把分支上多次小提交压成一个）。合并后点 **Delete branch** 把分支删掉。

### 2.6 把改动同步回本地

合并到 main 后，你本地还在分支上。回到 main、拉最新：

```bash
git checkout main
git pull
git branch -d docs/fix-typo    # 把本地分支也删掉
```

---

## 3. 在别人正在做的分支上协作

经常会遇到："小张在做飞书登录，但他的分支还没合 main，我要在他基础上加个'退出登录'按钮。"

### 3.1 把别人的分支拉到本地

```bash
git fetch origin                     # 拉最新远程信息（不改任何文件）
git checkout feat/feishu-login       # 切到小张的分支
```

切完你本地就是小张分支的最新状态。

### 3.2 从他的分支开你的子分支

**不要直接在他的分支上改**，开你自己的子分支：

```bash
git checkout -b feat/logout-button   # 基于 feat/feishu-login 创建
```

改完按 [2.2 ~ 2.4](#22-改代码) 的流程提交。开 PR 时**把 base 改成他的分支**，不是 main：

```bash
gh pr create --base feat/feishu-login --title "feat: 加退出登录按钮"
```

这样你的改动会合到他的分支，他再统一合 main。

### 3.3 他把分支 push 了新提交，你想拉下来

```bash
# 在你的子分支上
git fetch origin
git rebase origin/feat/feishu-login
```

如果跑 `rebase` 时报"CONFLICT"，**别慌**，让 AI 帮你：

> 我在 rebase 时遇到冲突，文件是 `apps/web/src/lib/auth.ts`。把冲突内容给你看，帮我决定怎么合。

AI 看完会告诉你怎么改，改完：

```bash
git add apps/web/src/lib/auth.ts
git rebase --continue
```

### 3.4 想直接看别人 PR 的代码不下载到本地

```bash
gh pr view 11        # 看 PR 描述 + 状态
gh pr diff 11        # 看 PR 完整 diff
gh pr checkout 11    # 把 PR 的代码 checkout 到本地分支
```

---

## 4. 用 AI 工具高效干活

### 4.1 该让 AI 做的事

- **写代码**：把任务目标告诉 AI，让它写 + 解释，你看完确认
- **改报错**：把报错信息原文 + 文件路径丢给 AI，让它定位 + 修
- **开 PR**：让 AI 帮你写 commit message + PR 描述（按模板填好）
- **看别人的代码**：粘贴 diff 让 AI 解释这段代码做了什么、有没有坑
- **review 自己的 PR**：合并前让 AI 扮演 reviewer 找问题

### 4.2 不该让 AI 做的事

- **直接合并 PR** — 这是有副作用的操作，必须你自己点
- **`git push --force`** — 会覆盖远程历史，可能毁掉别人的工作
- **改 `main` 上的文件** — 仓库分支保护会拦，但别试
- **跑 `npm run -w apps/api migrate` 在生产数据库上** — 没人确认就不能跑生产迁移
- **改 .env 文件提交进 git** — 里面有密钥，泄露就糟了

### 4.3 给 AI 的好提示模板

> **任务**：我要在 `apps/web/src/routes/prices.index.tsx` 加一个"按销量排序"的开关。
> **当前状态**：列表默认按商品名排，开关在搜索框右边。
> **要求**：开关用 shadcn 的 `Switch` 组件，状态用 useState 存。
> **验证**：开后调价 Sheet 里点商品再回来开关状态保留。

越具体越省时间。差的提示："帮我改价盘页面" → AI 不知道改什么。

---

## 5. 常见报错速查

### 报错 1：`docker: command not found`

Docker Desktop 没装 / 没启动。装完打开应用，等鲸鱼图标变稳定（不再转圈）。

### 报错 2：`Error: Cannot find module 'xxx'`

依赖没装好。在项目根目录跑：

```bash
npm install
```

### 报错 3：`ECONNREFUSED 127.0.0.1:5432`

数据库没起来。跑：

```bash
docker compose up -d
docker ps      # 看 myj-postgres 应该是 Up 状态
```

### 报错 4：`relation "xxx" does not exist`

库没初始化 / 没拉最新 migration：

```bash
npm run -w apps/api migrate
```

### 报错 5：`git push` 报 `Permission denied (publickey)` 或 `403 Forbidden`

GitHub 没登录 / 没加进组织：

```bash
gh auth login                  # 重新登一次
# 然后让组织管理员把你加进 rollingai-myj
```

### 报错 6：合并 PR 时报 "Required check failing"

自动化检查（CI）没过。点 PR 页面的 **Checks** 标签页看具体哪步失败，把报错原文丢给 AI：

> 我的 PR 自动化检查失败了，报错是 ... 帮我定位问题。

### 报错 7：`git pull` 报 "You have uncommitted changes"

你有改了没提交的文件。两种处理：

```bash
# 方案 A：先提交（如果改动有用）
git add . && git commit -m "wip: 还没写完的改动"
git pull

# 方案 B：先暂存（如果只是临时改动）
git stash
git pull
git stash pop    # 改动找回来
```

### 报错 8：分支落后 main 太多，PR 提示 "This branch is out-of-date"

```bash
git checkout 你的分支
git fetch origin
git rebase origin/main
# 如果有冲突，让 AI 帮你处理
git push --force-with-lease    # 注意是 --force-with-lease，不是 --force
```

### 报错 9：改完代码运行没生效

- 改前端：浏览器硬刷（Mac: Cmd+Shift+R / Win: Ctrl+Shift+R）
- 改后端：看跑 `npm run -w apps/api dev` 的终端，应该自动重启；如果没动，Ctrl+C 然后重跑
- 改 .env：必须重启 dev 进程才能读到新值

### 报错 10：`port 5173 / 8787 is already in use`

端口被占了，可能上次没关干净：

```bash
# Mac/Linux 找占用端口的进程
lsof -i :5173
kill -9 <进程号>

# Windows
netstat -ano | findstr :5173
taskkill /PID <进程号> /F
```

---

## 6. 常用关键文档

| 我想知道 | 看哪里 |
|---|---|
| 项目要做什么、当前进度 | [README.md](../README.md) + [docs/milestones.md](milestones.md) |
| 所有接口的设计 | [docs/planning/unified-api-spec.md](planning/unified-api-spec.md) |
| **接口交互式文档（可点 Try it out 直接调）** | 启动后端后访问 <http://localhost:8787/api/v1/docs> |
| 所有数据库表的设计 + 决策点（业务视角） | [docs/planning/unified-database-spec.md](planning/unified-database-spec.md) |
| **每张表 / 每个字段 / 索引 / 外键的真实定义**（工程视角） | [docs/planning/database-schema-reference.md](planning/database-schema-reference.md) |
| 协作详细规则 | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| 后端代码 / 启动 / 调试 | [apps/api/README.md](../apps/api/README.md) |
| 前端代码 / 启动 / 调试 | [apps/web/README.md](../apps/web/README.md) |
| 竞品采集模块同事看的 | [docs/modules/competitor-collector.md](modules/competitor-collector.md) |

---

## 7. 卡住了找谁

1. 报错信息 / 概念不懂 → 丢给 AI（90% 能解决）
2. 业务逻辑 / 规划不清楚 → 在 [GitHub issue](https://github.com/rollingai-myj/integratedApp/issues) 开问题
3. 紧急的事 → 团队群里 at
