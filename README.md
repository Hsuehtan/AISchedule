# AI 项目待办

移动端 H5 优先、后续扩展微信小程序的 Agent 增强待办产品。当前处于 H0 已批准后的实现阶段。

## 当前状态

- 当前任务：见 [`tasks/current.md`](tasks/current.md)
- 任务清单：见 [`tasks/todo.md`](tasks/todo.md)
- 完整实施计划：见 [`tasks/plan.md`](tasks/plan.md)
- 产品真源：[`product_doc/prd.md`](product_doc/prd.md)
- UI 真源：Figma Production V3 `229:2`（入口页 `210:2`）
- 当前门禁：H1 交互冻结；T01-T09 完成后暂停审查

## 模块

- `Users`：认证、用户资料、Session、积分和管理员操作
- `Tasks`：待办 CRUD、时间、完成、软删除和 3 秒撤销
- `Projects`：项目创建、改名、归档和筛选
- `Agent`：对话、澄清、计划、提案确认、Smart Inbox 和 Provider

## 工程命令

使用 Node.js 24 和 pnpm 11。安装依赖后使用以下稳定入口：

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e       # T09 前会主动失败
pnpm test:visual    # T09 前会主动失败
```

数据库本地启动与迁移见 [`docs/runbooks/local-development.md`](docs/runbooks/local-development.md)。Prisma 相关命令必须在 Node.js 24 下执行；仓库提供 `.node-version`、`.nvmrc` 和 `mise.toml`。

前五项命令已建立并验证；E2E 与视觉测试会在 T09 接入。最后一次真实验证记录在 `tasks/current.md`。

## 文档入口

- 架构：[`docs/architecture/overview.md`](docs/architecture/overview.md)
- 数据模型：[`docs/architecture/data-model.md`](docs/architecture/data-model.md)
- API：[`docs/architecture/api.md`](docs/architecture/api.md)
- Agent：[`docs/architecture/agent.md`](docs/architecture/agent.md)
- 安全：[`docs/architecture/security-threat-model.md`](docs/architecture/security-threat-model.md)
- 决策记录：[`docs/decisions/`](docs/decisions/)
- 设计资产：[`assets/README.md`](assets/README.md)

## 真源优先级

1. H0 已批准的 PRD 和后续显式产品决策
2. ADR 与 API/数据库契约
3. Figma Production V3
4. 自动化测试所表达的已批准行为
5. 实现代码

发生冲突时暂停相关切片，更新上游真源后再继续。
