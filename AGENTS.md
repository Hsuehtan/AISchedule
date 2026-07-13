# Agent 工作约定

## 项目概览

本项目是移动端 H5 优先、后续扩展微信小程序的 Agent 增强待办产品。当前处于 H0 已批准后的实现阶段。

### 当前状态入口

- 当前任务：[`tasks/current.md`](tasks/current.md)
- 任务清单：[`tasks/todo.md`](tasks/todo.md)
- 完整实施计划：[`tasks/plan.md`](tasks/plan.md)
- 产品真源：[`product_doc/prd.md`](product_doc/prd.md)
- UI 真源：Figma Production V3 `229:2`（入口页 `210:2`）
- 当前门禁：H1 交互冻结；T01-T09 完成后暂停审查
- H1 审查包：[`docs/quality/h1-interaction-review.md`](docs/quality/h1-interaction-review.md)

### 模块

- `Users`：认证、用户资料、Session、积分和管理员操作
- `Tasks`：待办 CRUD、时间、完成、软删除和 3 秒撤销
- `Projects`：项目创建、改名、归档和筛选
- `Agent`：对话、澄清、计划、提案确认、Smart Inbox 和 Provider

### 工程命令

使用 Node.js 24 和 pnpm 11。安装依赖后使用以下稳定入口：

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:visual
```

数据库本地启动与迁移见 [`docs/runbooks/local-development.md`](docs/runbooks/local-development.md)。Prisma 相关命令必须在 Node.js 24 下执行；仓库提供 `.node-version`、`.nvmrc` 和 `mise.toml`。

E2E 会构建 H5、启动隔离本地服务并使用 Chrome 验证；截图输出到 `docs/quality/screenshots/`。最后一次真实验证记录在 `tasks/current.md`。

### 文档入口

- 架构：[`docs/architecture/overview.md`](docs/architecture/overview.md)
- 数据模型：[`docs/architecture/data-model.md`](docs/architecture/data-model.md)
- API：[`docs/architecture/api.md`](docs/architecture/api.md)
- Agent：[`docs/architecture/agent.md`](docs/architecture/agent.md)
- 安全：[`docs/architecture/security-threat-model.md`](docs/architecture/security-threat-model.md)
- 决策记录：[`docs/decisions/`](docs/decisions/)

### 真源优先级

1. H0 已批准的 PRD 和后续显式产品决策
2. ADR 与 API/数据库契约
3. Figma Production V3
4. 自动化测试所表达的已批准行为
5. 实现代码

发生冲突时暂停相关切片，更新上游真源后再继续。

## 设计资产

设计资产来源、用途和授权约束统一记录在本文件，不再维护独立资产索引文档。

### 真源

- Figma 文件：`dryFtYbit291732gktHIqZ`
- 页面：`210:2`
- Production V3 画板：`229:2`
- 设计基线：390 × 844

### 本地资料

- `design/AI_Project_Todo_P0_HiFi_V2_ElectricInk_Full_UI_Screenshot.png`
- `design/AI_Project_Todo_P0_HiFi_V2_ElectricInk_Tokens.json`
- `design/ComponentsDesign.md`

本地截图只用于离线对照；实现前必须以 Figma 当前 Production V3 节点复核。第三方字体和图标不得复制进仓库，除非已记录授权来源。

## 开始前

1. 阅读 `tasks/current.md`、产品真源和当前任务关联 ADR；需要全局任务顺序时再阅读 `tasks/plan.md`。
2. 运行 `git status --short --branch`，不得覆盖未说明的用户改动。
3. 一个任务只处理一个可验收目标；大于 M 的任务继续拆分。

## 实现纪律

- 采用 Contract -> Schema -> Service/API -> UI -> Test -> Docs 的纵向切片。
- 新行为先写失败测试，再写最小实现。
- 每个切片必须保持构建和已有测试可用。
- 模块仅允许通过公开 Service/Contract 协作，禁止跨模块直写数据表。
- 业务对象只引用 `user_id`，不得把用户名作为业务外键。
- 所有 Agent 写操作必须经过确认；模型输出不能直接执行数据写入。
- 不记录密码、Session、API Key、完整私人待办、原始音频或完整 Prompt。
- 不引入 P1/P2 或未在 PRD/ADR 中批准的功能。

## 命名

- 业务模块统一使用 `Users`、`Tasks`、`Projects`、`Agent`。
- 禁止新增 `AIAgent` 命名。
- 公开 API 使用 `/api/v1`，字段 camelCase，枚举值 UPPER_SNAKE。

## 完成定义

- 验收条件、受影响测试、lint、typecheck、build 全部通过。
- API、数据库、配置或 UI 行为变化已同步对应文档。
- 更新 `tasks/todo.md` 与 `tasks/current.md`。
- 形成原子 Conventional Commit，且不提交 Secret、构建产物或用户未授权文件。

## 人类门禁

- H1：T09 后审查交互壳。
- H2：T17 后审查真实手工闭环。
- H3：T27 后审查 Agent/积分/语音。
- H4：T30 后批准生产发布。

到达门禁必须暂停。涉及不可逆数据操作、生产部署、新付费服务、安全降级或明显偏离 Figma 时提前暂停。
