# Agent 工作约定

## 项目概览

本项目是移动端 H5 优先、后续扩展微信小程序的 Agent 增强待办产品。T10–T17 已通过 H2；T18–T24 与全部完成证据已通过，当前停在 T24 等待人工审查。

### 当前状态入口

- 当前任务：[`tasks/current.md`](tasks/current.md)
- 任务清单：[`tasks/todo.md`](tasks/todo.md)
- 完整实施计划：[`tasks/plan.md`](tasks/plan.md)
- 产品真源：[`product_doc/prd.md`](product_doc/prd.md)
- UI 真源：Figma Production V3 `229:2`（入口页 `210:2`）
- 当前门禁：H2 已通过；T24 Phase 3 审查包已就绪并暂停，H3 仍在 T27 后
- H1 结论：视觉方向通过；交互壳跳转不作为正式逻辑，T10-T17 随真实 Session/API 修正
- Phase 2 决策：[`ADR-008`](docs/decisions/ADR-008-phase2-scope-supersession.md)
- Phase 3 Agent 服务决策：[`ADR-009`](docs/decisions/ADR-009-python-agent-service-boundary.md)（T19–T24 已实施）
- Agent MVP 日志范围：[`ADR-011`](docs/decisions/ADR-011-defer-agent-log-persistence.md)（T19 已实施）
- Phase 2 接管快照：[`docs/handovers/2026-07-14-phase2-start.md`](docs/handovers/2026-07-14-phase2-start.md)
- H2 接管快照：[`docs/handovers/2026-07-14-h2-manual-loop.md`](docs/handovers/2026-07-14-h2-manual-loop.md)
- Phase 3 最新规划快照：[`docs/handovers/2026-07-17-python-algorithm-logging-deferred.md`](docs/handovers/2026-07-17-python-algorithm-logging-deferred.md)
- 已取代的遥测规划快照：[`docs/handovers/2026-07-17-agent-observability-boundary.md`](docs/handovers/2026-07-17-agent-observability-boundary.md)
- Phase 3 初次规划快照：[`docs/handovers/2026-07-16-phase3-python-agent-planning.md`](docs/handovers/2026-07-16-phase3-python-agent-planning.md)
- Phase 3 T24 接管快照：[`docs/handovers/2026-07-17-phase3-t24-review-ready.md`](docs/handovers/2026-07-17-phase3-t24-review-ready.md)
- H1 审查包：[`docs/quality/h1-interaction-review.md`](docs/quality/h1-interaction-review.md)
- H2 审查包：[`docs/quality/h2-manual-loop-review.md`](docs/quality/h2-manual-loop-review.md)

### 模块

- `Users`：认证、用户资料、Session、积分和管理员操作
- `Tasks`：待办 CRUD、时间、完成、软删除和 3 秒撤销
- `Projects`：项目创建、改名、归档和筛选
- `Agent`：对话、澄清、计划、提案确认、Smart Inbox 和 Provider

### Phase 2 固定边界

- 优先级只有 HIGH/MEDIUM/LOW，新任务默认 MEDIUM；任务右侧只使用红/黄/绿优先级点。
- 任务左侧项目标签与项目筛选使用同一项目数据；项目身份色不得用于表达优先级。
- 昵称保持默认“用户”，P0 暂不提供昵称修改入口或接口。
- `reminderAt` 可保存、编辑、清空和展示；站内到期提示延期，不创建提醒调度。
- 只有软删除生成 3 秒 UndoOperation；创建、完成和恢复不生成撤销记录。
- T10 随注册事务完成最小新用户积分 grant；T18 已升级为 YAML v2、能力版本、正式账本状态机和管理员调账。

### Phase 3 固定边界

- NestJS 保留唯一公开 Agent API、鉴权、积分、pg-boss、会话/提案持久化、候选查询、确认和最终业务写入；积分账本属于 `Users/AiPointsPort`，Agent 模块不得直写积分表。
- Python Agent 是私有、无业务数据库权限的推理服务，只负责 Prompt、模型调用和结构化输出；客户端不得直连。
- Python 在 MVP 只输出不落库的最小白名单结构化日志；不持久化模型/工具调用、Token usage 或 Trace，不得让日志影响响应、积分和 dispatch。
- 调用 Python 前由 NestJS 原子预留积分。只有契约有效且由 NestJS 持久化的可用结果才结算；HTTP 2xx 本身不构成扣分。
- Node/Python 内部协议以 `packages/contracts/internal-agent/v1/openapi.yaml` 为唯一规范工件，Zod/Pydantic/FastAPI Schema 必须生成自它或完整等价；Golden Fixtures 只作补充。
- 同一产品请求最多一次 NestJS → Python execute dispatch；含糊超时不自动重派。Python 在同一 execute 内可按批准策略执行一次结构修复，仍只结算一次；`RESULT_PERSISTED` 后只能重试结算，不能释放或再调用 Provider。
- Admission 原子链路必须用平台 `UnitOfWork` 的不透明 `TransactionScope` 组合 `AiPointsPort`、Run/幂等 Repository 和 pg-boss Adapter；不得由 Agent 直写积分表，也不得由 Port 自开嵌套事务。
- P0 不新增 Python 业务/Run 数据库、算法日志持久化后端、远程 Exporter、Redis、Kubernetes、服务网格或第二套任务队列。

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
pnpm agent:contract:check
pnpm smoke:deepseek
```

数据库本地启动与迁移见 [`docs/runbooks/local-development.md`](docs/runbooks/local-development.md)。Prisma 相关命令必须在 Node.js 24 下执行；仓库提供 `.node-version`、`.nvmrc` 和 `mise.toml`。默认 Node 版本不一致时使用 `mise exec -- corepack pnpm <command>`。

E2E 会构建 H5、启动隔离本地服务并使用 Chrome 验证；截图输出到 `docs/quality/screenshots/`。最后一次真实验证记录在 `tasks/current.md`。

`pnpm smoke:deepseek` 不属于默认 CI，只允许本地环境变量注入 `DEEPSEEK_API_KEY` 和使用合成数据；输出不得包含 Prompt、响应正文或 Secret。T25 前不需要腾讯 ASR Secret。

### 文档入口

- 架构：[`docs/architecture/overview.md`](docs/architecture/overview.md)
- 数据模型：[`docs/architecture/data-model.md`](docs/architecture/data-model.md)
- API：[`docs/architecture/api.md`](docs/architecture/api.md)
- 当前后端接口手册：[`product_doc/backend-api.md`](product_doc/backend-api.md)
- Agent：[`docs/architecture/agent.md`](docs/architecture/agent.md)
- 安全：[`docs/architecture/security-threat-model.md`](docs/architecture/security-threat-model.md)
- 决策记录：[`docs/decisions/`](docs/decisions/)
- 设计资源：[`assets/README.md`](assets/README.md)
- 管理员 CLI：[`docs/runbooks/admin-cli.md`](docs/runbooks/admin-cli.md)

### 真源优先级

1. H0 已批准的 PRD 和后续显式产品决策
2. ADR 与 API/数据库契约
3. Figma Production V3
4. 自动化测试所表达的已批准行为
5. 实现代码

发生冲突时暂停相关切片，更新上游真源后再继续。

## 设计资产

本节记录必须进入 Agent 上下文的设计约束；可浏览的资源路由和授权提醒见 [`assets/README.md`](assets/README.md)。

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
- Python Agent 不得持有业务数据库、Session 或积分凭证；不得返回计费决策或可信业务 ID。
- Python stdout/stderr 日志只允许白名单字段且不可落盘/远程导出；NestJS 不得解析日志或将其用于 Run、积分、幂等、dispatch 和恢复。
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

H2 已于 2026-07-17 获得人类明确通过。T18–T24、全部自动化与真实 DeepSeek Smoke 已完成，当前按计划停在 T24 等待人工审查；不得提前进入 T25–T27、部署生产、开放公网或使用真实用户数据。
