# AI Schedule

移动端 H5 优先、后续可扩展微信小程序的 Agent 增强待办产品。客户端使用 Taro/React，NestJS/Fastify 是业务服务与唯一公开 API，PostgreSQL 是业务数据和后台任务的持久化基础；私有 Python/FastAPI 服务隔离 Agent 推理与 DeepSeek 调用，MVP 不持久化 Python 算法日志。

> 当前状态：H2 曾获人工通过，T18–T24 已实施并停在 T24。2026-09-27 [独立验收](docs/quality/2026-09-27-phase0-3-acceptance.md)发现的 D01–D03 已按[最新复验](docs/quality/2026-09-27-d01-d03-revalidation.md)修复，完整浏览器回归 19/19、无缓存工程门禁 40/40。T24 仍待人工审查，H3 未通过；不进入 T25–T27 或生产发布。

## 快速开始

前置条件：Node.js 24、pnpm 11，以及 Docker Desktop 或 OrbStack。

```bash
pnpm install
docker compose -f compose.yaml up -d postgres
cp .env.example .env
pnpm db:generate
pnpm db:migrate:deploy
set -a
source ./.env
set +a
pnpm --parallel --filter @ai-schedule/server --filter @ai-schedule/client dev
```

上述无 Secret 路径只启动手工功能；客户端会把 `/api/v1` 代理到本地 `3000`。启动 Python/DeepSeek、生成服务 Token和环境变量说明见 [`docs/runbooks/local-development.md`](docs/runbooks/local-development.md)。

## 常用命令

| 命令                        | 用途                                                    |
| --------------------------- | ------------------------------------------------------- |
| `pnpm dev`                  | 并行启动可开发的 Workspace                              |
| `pnpm build`                | 构建客户端、服务端和共享包                              |
| `pnpm lint`                 | 运行 ESLint                                             |
| `pnpm typecheck`            | 运行 TypeScript 类型检查                                |
| `pnpm test`                 | 运行单元、契约和组件测试                                |
| `pnpm test:integration`     | 使用真实 PostgreSQL/Testcontainers 验证集成边界         |
| `pnpm test:e2e`             | 构建 H5，并用真实 NestJS/PostgreSQL/Chrome 验证用户路径 |
| `pnpm test:visual`          | 执行标记为视觉基线的 Playwright 用例                    |
| `pnpm format:check`         | 检查 Prettier 格式                                      |
| `pnpm admin:password-set`   | 交互式管理员改密；见管理员 Runbook                      |
| `pnpm admin:points-add`     | 管理员增加积分；subtract/set/history 同组               |
| `pnpm agent:contract:check` | 检查 Node/Python 内部契约生成物无漂移                   |
| `pnpm smoke:deepseek`       | 使用本地 Secret 与合成数据执行非默认 CI 真实 Smoke      |

`compose.yaml` 提供隔离的本地 PostgreSQL 16 与 Python Agent 服务拓扑，不是生产部署资产。项目要求 Node.js 24、Python 3.11.15 与 uv；本机默认 Node 版本不一致时，使用 `mise exec -- corepack pnpm <command>`。

## 工程结构

```text
apps/
  client/        Taro H5 与未来小程序客户端
  server/        NestJS API、管理员 CLI、积分与 pg-boss Worker
  agent-service/ 私有 Python/FastAPI 推理服务；无业务数据库权限
packages/
  contracts/     跨端 DTO、枚举、错误和校验真源
  db/            Prisma Schema、Migration 与 Repository
  ui/            Electric Ink Token 和基础组件
  config/        产品/Provider 配置校验
  testkit/       Provider Stub、Fixture 与测试工具
config/          可版本化产品和 Provider 配置
docs/            架构、ADR、Runbook、质量报告与接管快照
product_doc/     PRD 与历史实施拆分
tasks/           当前状态、计划和清单
tests/e2e/       正式产品与视觉浏览器验收
assets/          设计资源入口说明
```

模块统一命名为 `Users`、`Tasks`、`Projects`、`Agent`。NestJS 业务模块通过公开 Service/Contract 协作，禁止跨模块直接写表。Python Agent 只负责 Prompt、模型调用和结构化推理，不访问业务数据库、不判断积分或执行 Action；MVP 只输出不落库的最小结构化运行日志。服务边界见 [`ADR-009`](docs/decisions/ADR-009-python-agent-service-boundary.md)，MVP 日志范围见 [`ADR-011`](docs/decisions/ADR-011-defer-agent-log-persistence.md)。

## 当前能力

- 用户名注册/登录/退出、Session 恢复、只读资料与选填未验证手机号。
- 管理员交互式改密、全 Session 撤销与脱敏审计。
- 待办创建、编辑、完成、恢复、软删除及服务端 3 秒撤销。
- 项目创建、改名、归档、真实筛选和归档后任务归属保留。
- 计划时间、截止时间、提醒时间的保存、清空、时区转换与展示。
- 项目身份色和高/中/低红黄绿优先级的独立表达。
- YAML v2 积分规则、不可变能力版本、每日懒补足、预留/结算/释放和管理员调账。
- Python Agent 私有服务、跨语言 OpenAPI 契约、一次 dispatch 与 DeepSeek Provider。
- 真实文本对话、澄清/候选消歧、二阶段计划、七类 Action 提案和原子确认。
- Smart Inbox 派生状态、未读恢复、无项目任务整理和额度/故障降级。

当前仍不包含语音/腾讯 ASR（T25）、提醒触发、完整历史会话、生产发布或真实用户接入。H3 仍需在 T27 后人工审查；Python/Provider 故障不影响手工任务和项目功能。

## 文档与接管

- 当前唯一下一步：[`tasks/current.md`](tasks/current.md)
- 产品真源：[`product_doc/prd.md`](product_doc/prd.md)
- 完整计划：[`tasks/plan.md`](tasks/plan.md)
- 工作约定：[`AGENTS.md`](AGENTS.md)
- 系统架构：[`docs/architecture/overview.md`](docs/architecture/overview.md)
- Agent 服务决策：[`docs/decisions/ADR-009-python-agent-service-boundary.md`](docs/decisions/ADR-009-python-agent-service-boundary.md)
- Agent 日志范围：[`docs/decisions/ADR-011-defer-agent-log-persistence.md`](docs/decisions/ADR-011-defer-agent-log-persistence.md)
- API：[`docs/architecture/api.md`](docs/architecture/api.md)
- 数据模型：[`docs/architecture/data-model.md`](docs/architecture/data-model.md)
- H2 审查包：[`docs/quality/h2-manual-loop-review.md`](docs/quality/h2-manual-loop-review.md)
- H2 接管快照：[`docs/handovers/2026-07-14-h2-manual-loop.md`](docs/handovers/2026-07-14-h2-manual-loop.md)
- Phase 3 规划快照：[`docs/handovers/2026-07-17-python-algorithm-logging-deferred.md`](docs/handovers/2026-07-17-python-algorithm-logging-deferred.md)
- Phase 3 T24 接管快照：[`docs/handovers/2026-07-17-phase3-t24-review-ready.md`](docs/handovers/2026-07-17-phase3-t24-review-ready.md)
- 管理员改密：[`docs/runbooks/admin-cli.md`](docs/runbooks/admin-cli.md)
- 设计资源：[`assets/README.md`](assets/README.md)

每次中断先更新 `tasks/current.md`，并在 `docs/handovers/` 新建不可覆盖的日期快照。API、数据语义、安全规则或产品边界变化时，必须同步 Contract、ADR/架构文档、追踪矩阵和相关测试。
