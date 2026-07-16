# ADR-009：Python Agent 内部服务边界

- 状态：已批准，等待 H2 通过后实施
- 日期：2026-07-16
- 取代：ADR-005 的 Node 进程内 AgentProvider 实现
- 部分修订：ADR-002 的“单一服务端部署制品”约束

## 背景

P0 原计划由 NestJS Worker 直接调用 DeepSeek。Phase 3 开始前重新评估后，Agent 的 Prompt 编排、模型适配、结构修复与评测更适合独立使用 Python 生态演进；认证、积分、任务、项目、会话和写入确认仍必须由现有业务服务统一控制。

物理拆分会引入跨进程超时、契约漂移、部署和可观测性成本。对个人开发者而言，只有在边界足够窄、仍采用同一仓库和同一发布节奏时，这个成本才可接受。

## 决策

在 Monorepo 中新增私有的 Python Agent 服务，建议路径为 `apps/agent-service`，采用 FastAPI、Pydantic v2、HTTPX 和 pytest。它是一个面向 NestJS 的内部推理服务，不是客户端可访问的公开业务 API，也不拥有业务数据库。

完整调用链为：

```text
Taro Client
    -> NestJS /api/v1/agent/*
        -> 积分原子预留 + AgentRequestRun + pg-boss Job
            -> NestJS Worker
                -> AgentRuntimePort / HttpAgentRuntimeAdapter
                    -> Python Agent Service
                        -> DeepSeek
                <- 契约有效的结构化结果
            -> NestJS 持久化结果
            -> 积分幂等结算
        <- 结果对客户端可见
```

### NestJS 业务服务职责

- 唯一面向 H5/小程序的 Agent API 与鉴权入口。
- 用户、任务、项目、会话、消息、提案、评测和积分的唯一事实源。
- `Users/AiPointsPort` 独占每日补足、积分校验、原子预留、幂等结算、释放、退款和管理员调账；Agent 编排只调用该 Port，不直写积分表。
- `requestId`、`reservationId`、业务幂等、pg-boss Job 与 AgentRequestRun 状态机。
- 按当前用户查询候选对象，并把最小必要上下文转换为临时、不可猜测的 `candidateRef`。
- 对 Python 返回值执行第二次契约校验，持久化可用结果，并在用户确认后执行最终业务写入。

NestJS 应用层只依赖语言无关的 `AgentRuntimePort`；私有 HTTP 细节由 `HttpAgentRuntimeAdapter` 实现，避免业务 Service 感知 FastAPI、URL 或 Provider。

Agent admission 应用服务通过平台层 `UnitOfWork` 开启唯一 PostgreSQL 事务，并把不透明的 `TransactionScope` 依次交给 transaction-scoped `AiPointsPort.reserve(...)`、AgentRequestRun/Idempotency Repository 和 pg-boss Prisma Adapter。`AiPointsPort` 仍独占积分规则和积分表，不暴露 Prisma Client，也不自行开启嵌套事务或创建 AgentRun；任一步失败时预留、Run、幂等记录和 Job 整体回滚。

### Python Agent 服务职责

- Prompt、模型、Provider、超时、结构化输出和 Schema 版本选择。
- DeepSeek 调用、同一次服务请求内的有限结构修复和 Provider 错误归一化。
- 只返回白名单中的结构化结果类型：`REPLY`、`CLARIFICATION`、`CANDIDATES`、`PLAN` 或 `ACTION_PROPOSAL`。
- 返回最小调用元数据供评测和追踪，不记录 Secret、完整私人待办或原始 Prompt。

Python 服务不得：

- 访问 PostgreSQL、Prisma Repository 或积分余额。
- 接收 Session Cookie、密码、手机号、`reservationId` 或管理员身份。
- 直接创建、修改或删除 Task/Project。
- 把模型生成的字符串当作可信业务 ID。
- 自行判断是否扣积分、退款或开放结果。

### 契约

- `packages/contracts/internal-agent/v1/openapi.yaml` 是唯一语言中立规范工件，使用 OpenAPI 3.1 / JSON Schema 2020-12；不允许由 FastAPI 或 Zod 实现反向覆盖。
- Node Zod、Python Pydantic 和 FastAPI 实际 Schema 必须由规范工件生成或在 CI 做完整规范化等价比较；Golden Fixtures 只作为行为补充。
- P0 内部执行端点为同步 `POST /internal/v1/agent/execute`；公开请求仍是 `202 + requestId` 的异步流程。
- 请求必须携带 `requestId`、`capabilityCode`、`contractVersion`、允许的结果类型、最小对话上下文和临时候选引用。
- 响应必须回显 `requestId` 和 `contractVersion`，并返回一个契约有效的结果联合类型或稳定错误码。
- 内部接口只在私有网络开放，使用服务身份认证、固定超时、请求大小限制和贯穿两端的 `requestId`。
- NestJS 只发送 capability 与 `contractVersion`，不指定具体 Provider、模型或 Prompt；Python 在成功响应中返回实际使用的 `provider/model/promptVersion/providerSchemaVersion` 元数据，由 NestJS 校验后记录。跨服务 `contractVersion` 与 Python 内部 `providerSchemaVersion` 是两个独立版本。

FastAPI 可以从 Pydantic 输入/输出模型生成 OpenAPI 和 JSON Schema，适合作为 Python 端边界校验；但生成能力不替代仓库中的评审后契约真源。参考：[FastAPI OpenAPI](https://fastapi.tiangolo.com/tutorial/first-steps/)、[FastAPI 响应模型](https://fastapi.tiangolo.com/tutorial/response-model/)。

### 积分结算语义

“Agent 服务正常返回结果”必须定义为：Python 执行端点返回与当前契约版本一致、属于允许结果类型且通过 Node 二次校验的可用结果，并且 NestJS 已将该结果持久化成功。

- 调用前必须原子预留积分，禁止“先查余额、再调用”的竞态实现。
- 满足上述可用结果条件后，NestJS 按 `reservationId` 幂等结算一次；用户随后关闭、忽略、取消提案或拒绝执行，不退款。
- 单纯 HTTP 2xx、Provider 已产生费用、空内容、非法 JSON、Schema 不匹配、超时、断连或 5xx 都不构成扣分条件。
- 没有形成并持久化可用结果时释放预留，用户余额不减少。
- 结果已持久化但结算暂时失败时保持预留，只重试结算，不再次调用 Python 或 DeepSeek。
- Python 服务不返回 `billable` 字段；是否结算只能由 NestJS 根据能力配置、请求状态和持久化结果判断。

DeepSeek 官方说明 JSON Output 仍可能返回空内容，因此“HTTP 成功”不能等同于“产品可用结果”。参考：[DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode)。

### P0 超时与重试

公开 Agent 请求仍由 pg-boss 异步处理；Worker 对 Python 发起一次同步 execute 请求。Python 可以在该 execute 内执行受限的结构修复，但 Node 不在收到含糊超时或断连后盲目重派 execute，以免产生重复结果和不可控 Provider 成本。

P0 遇到含糊超时时：

1. AgentRequestRun 记录稳定失败原因；
2. 到达回收时间且确认没有持久化可用结果后，才释放积分预留；
3. 用户可以显式重新发起新的产品级请求；
4. 监控 Provider 成本与此类失败率。

执行时间必须满足 `executeTimeoutAt < runDeadlineAt < reservationExpiresAt < recoveryEligibleAt`。Worker dispatch 前必须确认预留仍为 pending，并在同一条件事务中写入截止时间、把预留 lease 延长到 Run 截止时间之后；过期预留不得 dispatch。回收器只有在 `recoveryEligibleAt` 之后且没有持久化结果时，才可通过条件更新执行 `FAILED -> RELEASED`。

`QUEUED -> RUNNING` 与 `dispatchAttemptedAt` 必须先通过已提交的条件更新，再发送内部 HTTP；CAS 失败的 Worker 不得调用 Python。数据库提交结果不确定时保持预留并持续核对，不能把“暂时查不到”当作“明确未持久化”。

如果真实运行证明含糊超时不可接受，再新增带持久化幂等结果的 Python Run API；P0 不为此引入第二个数据库、Redis、消息总线或分布式事务。

## 结果

### 正面

- Agent 实现、Prompt 和 Provider 演进不污染业务模块。
- Python AI 生态可以独立测试和替换，DeepSeek Secret 只进入 Agent 服务。
- 积分与业务写入继续由单一事实源控制，Agent 无法绕过确认或伪造扣费。
- 内部契约明确后，未来可独立扩缩 Agent 服务，而不改变客户端 API。

### 代价

- 增加 Python 工具链、一个内部 HTTP 跳点和一个部署进程。
- 必须维护跨语言契约测试、服务认证、超时预算和链路追踪。
- P0 对含糊超时采用“用户不扣分、Provider 成本可能损失”的保守策略。

## 运维约束

- 仍保持单一仓库、单一发布版本和 Docker Compose 开发/部署入口。
- P0 不引入 Kubernetes、服务网格、Redis、独立 Agent 数据库或公开 Agent 域名。
- Agent 服务不可用时，所有手工待办与项目能力必须继续可用。
- H2 未通过前只允许本 ADR 与相关计划/文档变更，不得创建 Python 服务或连接真实 Provider。
