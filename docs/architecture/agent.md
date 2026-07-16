# Agent 架构

状态：Phase 3 目标规格，尚未实施；H2 未通过前不得创建服务或调用真实 Provider。决策依据见 [`ADR-009`](../decisions/ADR-009-python-agent-service-boundary.md)。

## 能力与计费

- `agent.standardTurn`：普通回复、澄清和动作提案，默认 1 点。
- `agent.planGeneration`：计划拆解，默认 2 点。
- `speech.transcription`：语音转写，默认 1 点。

实际成本由 `config/product/points.yaml` 决定。一次产品级请求共享同一个 `requestId` 和预留；Python 内部结构修复不重复扣分。积分规则、余额和 `reservationId` 只存在于 NestJS 业务边界。

## 服务边界

| 能力                                  | NestJS 业务侧所有者                         | Python Agent 服务         |
| ------------------------------------- | ------------------------------------------- | ------------------------- |
| 客户端 API、Session、用户归属         | Users/Agent 公开边界                        | 不接收                    |
| 积分补足、预留、结算、释放、退款      | `Users/AiPointsPort` 独占                   | 不感知                    |
| 积分调用时机编排                      | Agent 只调用 `AiPointsPort`，不直写积分表   | 不感知                    |
| AgentRequestRun、pg-boss、业务幂等    | Agent 独占                                  | 不持久化                  |
| Conversation、Message、ActionProposal | Agent 独占持久化                            | 只返回草稿                |
| Task/Project 候选查询和真实 ID 映射   | Agent 调用 Tasks/Projects 公开查询          | 只使用临时 `candidateRef` |
| Prompt、模型路由、DeepSeek 调用       | 不感知具体实现                              | 独占                      |
| Provider 输出解析和结构修复           | Agent 最终二次校验                          | 首次校验与有限修复        |
| Action 确认和业务写入                 | Agent 编排，Tasks/Projects 执行公开业务操作 | 禁止                      |

Python 服务 P0 保持产品状态无状态、无 PostgreSQL 凭证。NestJS 每次只发送完成当前推理所需的有界对话、最小业务快照和请求内不可猜测的候选引用；不得发送密码、Session、手机号、积分余额、`reservationId` 或与本次推理无关的私人待办。

## 调用链

```text
POST /api/v1/agent/turns
  -> NestJS 原子创建积分预留、AgentRequestRun、幂等记录和 pg-boss Job
  <- 202 + requestId

pg-boss Worker
  -> 认领 QUEUED Run，并在 dispatch 前提交 dispatchAttemptedAt
  -> POST /internal/v1/agent/execute
       -> Python 校验请求、选择 Prompt/模型、调用 DeepSeek
       -> Python 校验/修复结构化输出
       <- 契约结果或稳定错误
  -> NestJS 二次校验结果、候选引用和业务限制
  -> NestJS 持久化 Message/Clarification/Plan/ActionProposal
  -> NestJS 幂等结算积分
  -> GET /api/v1/agent/requests/:id 才可返回 SUCCEEDED 结果
```

公开请求保持异步，内部 Python 执行端点保持同步。P0 不在 Python 中再建队列、回调协议或业务状态机。

## 请求状态机

```text
QUEUED
  -> RUNNING
       -> RESULT_PERSISTED
            -> SETTLING
                 -> SUCCEEDED
       -> FAILED
            -> RELEASED
```

不变量：

1. Agent admission 通过平台 `UnitOfWork` 开启唯一事务；transaction-scoped `AiPointsPort.reserve(...)`、AgentRequestRun/Idempotency Repository 和 pg-boss Prisma Adapter 共享不透明 `TransactionScope`，使 `QUEUED`、有效积分预留、幂等记录和 Job 原子创建。Agent 不直写积分表，`AiPointsPort` 不自行开启事务或创建 AgentRun。
2. Worker 使用同一条件事务确认预留仍为 pending 且未过期、写入 Run 截止时间、延长预留 lease，并提交 `QUEUED -> RUNNING` 与 `dispatchAttemptedAt`；CAS 失败或预留已过期的 Worker 不得发送 HTTP，同一产品请求最多一次 NestJS → Python execute dispatch。
3. `RUNNING -> RESULT_PERSISTED` 必须在业务 PostgreSQL 中原子写入一个通过验证的产品结果及其 `resultHash`；`resultHash` 由 NestJS 对规范化后的已验证结果计算，不能信任 Python 提供值。
4. `RESULT_PERSISTED` 已形成计费义务；之后只能重试结算，不能释放预留或再次调用 Python。
5. `FAILED -> RELEASED` 只允许在没有持久化可用结果时发生；`FAILED` 不得与 `resultPersistedAt` 同时存在。
6. 结果持久化与预留回收通过条件更新竞争：结果只有在预留仍有效时可提交；回收只有在 Run 已过截止时间、预留已过期且无结果时可提交，先成功者决定最终状态。
7. `SUCCEEDED` 必须同时具备已持久化结果和唯一成功 debit；此前结果不向客户端开放。
8. 队列重放遇到 `RUNNING` 且已记录 dispatch、`RESULT_PERSISTED`、`SETTLING` 或 `SUCCEEDED` 时不得再次调用 Python。

## 内部契约

唯一规范工件是计划在 T19.1 创建的 `packages/contracts/internal-agent/v1/openapi.yaml`，使用 OpenAPI 3.1 与 JSON Schema 2020-12。Node Zod、Python Pydantic 和 FastAPI 实际暴露的 Schema 必须由该工件生成或在 CI 做完整规范化等价比较；Golden Fixtures 只补充正反例行为，不能作为唯一一致性证明。任一端产生不兼容变更时 CI 失败。

P0 端点：

```text
POST /internal/v1/agent/execute
GET  /internal/health/live
GET  /internal/health/ready
```

执行请求至少包含：

```text
requestId
capabilityCode
contractVersion
locale / timezone
allowedResultTypes
boundedMessages
minimalContext
candidateRefs
```

NestJS 不指定具体 Provider、模型或 Prompt。执行响应必须回显 `requestId` 和 `contractVersion`，返回实际使用的 `provider/model/promptVersion/providerSchemaVersion` 元数据，并只返回以下联合类型之一：

```text
REPLY
CLARIFICATION
CANDIDATES
PLAN
ACTION_PROPOSAL
```

结果引用只能取自请求给出的 `candidateRef`；NestJS 负责映射回当前用户的真实对象并重新检查归属和版本。Python 或模型返回的数据库 ID、额外字段、未知结果类型和超出限制的内容一律视为无效外部输入。

`contractVersion` 是 Node/Python 共同冻结的内部 HTTP 协议版本；`providerSchemaVersion` 是 Python 内部 Provider 输出与 Prompt 配套版本。两者不得混用，后者只作为结果审计元数据返回，不控制 NestJS 业务分支。

稳定错误至少区分契约错误、未授权、请求过大、Provider 限流、Provider 超时、Provider 不可用、空结果和结果 Schema 无效。错误响应不包含 Prompt、原始 Provider 正文、Secret 或完整用户上下文。

## 什么情况下扣积分

“Agent 正常返回结果”同时满足以下条件才构成扣分：

1. Python 返回成功响应；
2. `requestId` 和契约版本匹配；
3. 结果通过共享 Schema 与 NestJS 二次校验；
4. 结果类型属于本次能力允许列表；
5. 候选引用来自本次请求且仍可解析到当前用户对象；
6. 内容通过长度、安全和业务规则；
7. 对应 Message、澄清卡、候选卡、计划或 ActionProposal 已在 NestJS PostgreSQL 持久化。

满足后由 NestJS 按 `reservationId` 幂等结算一次。Python 不返回 `billable`，也不能影响积分决策。HTTP 2xx、DeepSeek 已产生费用、空内容、非法 JSON、未知结果、伪造引用、超时、断连或持久化失败都不能单独触发扣分。

用户在有效结果结算后关闭对话、忽略回复、取消 Action 或拒绝写入，不退款；因为本次购买的是已经交付的推理结果，而不是后续业务写入成功。

## 失败与重试

| 场景                                   | 用户积分       | 是否自动再次调用 Python/模型 | 处理                                                 |
| -------------------------------------- | -------------- | ---------------------------- | ---------------------------------------------------- |
| 余额不足或配置非法                     | 不变           | 否                           | 不入队，返回不可用                                   |
| 同幂等键、同请求重试                   | 至多结算一次   | 否                           | 返回原 Run                                           |
| 预留与入队事务失败                     | 不变           | 否                           | 全部回滚                                             |
| Worker 在记录 dispatch 前崩溃          | 保持预留       | 可以                         | Job 重放后首次调用                                   |
| 排队至预留已过期                       | 释放           | 否                           | 禁止 dispatch，条件更新为失败并回收                  |
| 已记录 dispatch 后崩溃/断连/超时       | 到期后释放     | 否                           | 宽限期后核对为无结果才释放，平台承担可能成本         |
| HTTP 2xx 但空内容/非法 Schema/伪造引用 | 释放           | 否                           | 拒绝结果并记录稳定错误                               |
| 合法结果持久化成功                     | 结算一次       | 否                           | 只重试结算，成功后开放                               |
| 持久化提交结果不确定                   | 保持预留       | 否                           | 持续按 `requestId/resultHash` 核对，未知期间禁止释放 |
| 结果已持久化但结算失败                 | 保持预留       | 否                           | 幂等重试结算                                         |
| 释放后收到迟到响应                     | 不变           | 否                           | 丢弃，不重新进入结算                                 |
| 用户主动重试已失败请求                 | 新请求重新预留 | 新 `requestId` 可调用一次    | 不复用失败 Run                                       |

Node HTTP Client 不自动重试执行端点。Python 对一次主调用只允许在已明确收到内容、但结构可修复时进行同请求内最多一次结构修复；Provider 超时、连接重置和其他执行结果不确定的错误不自动重放。

持久化事务结果不确定时必须持续保留预留并核对，不能把数据库暂时不可查询或“暂未查到”解释为失败。确认事务已提交则进入结算；确认未提交且 Worker 仍持有已验证响应时可重试持久化；只有明确没有持久化结果且超过 Run 截止时间，才可进入释放流程。

## 截止时间与回收

时间配置必须满足：

```text
executeTimeoutAt < runDeadlineAt < reservationExpiresAt < recoveryEligibleAt
```

- `executeTimeoutAt`：NestJS 等待 Python 响应的最晚时间。
- `runDeadlineAt`：本 Run 不再接受新推理结果的时间。
- `reservationExpiresAt`：积分预留进入故障核对的时间，必须晚于 Run 截止时间。
- `recoveryEligibleAt`：预留过期并经过宽限期后，回收器可以尝试处理的时间。

超时协调/对账任务只在 `recoveryEligibleAt` 之后处理卡死 `RUNNING`：有持久化结果则继续结算；无结果且事务状态已明确时，通过互斥条件更新执行 `FAILED -> RELEASED`。Python 响应在 Run 截止或预留释放后到达时必须丢弃。

如果未来要求含糊超时也能透明恢复，应另立 ADR，把 Python 升级为带持久化幂等结果的 Run API。P0 不引入第二个数据库来解决这一问题。

## Provider 与安全

Python 内部定义 Provider Port，P0 默认 DeepSeek：普通能力默认 `deepseek-v4-flash`，计划能力默认 `deepseek-v4-pro`。模型、Base URL、超时、Prompt 和 Schema 版本均配置化；DeepSeek Secret 只注入 Python 服务。

内部服务只在私有网络开放并校验服务身份；限制请求体、并发和超时，贯穿 `requestId/traceId`。日志只记录白名单元数据和错误分类，不记录完整私人待办、原始 Prompt、Chain of Thought、原始 Provider 正文或 Secret。

DeepSeek JSON Output 可能出现空内容，因此 Provider 成功响应仍需执行产品 Schema 校验：[官方 JSON Output 说明](https://api-docs.deepseek.com/guides/json_mode)。

## 写入边界

1. NestJS 查询当前用户允许操作的候选对象，并生成请求内临时引用。
2. Python 只做语义判断，返回引用和结构化草稿，不持有 Repository。
3. NestJS 校验结果后生成 ActionProposal，不修改业务数据。
4. 用户确认时再次校验归属、对象版本、提案状态和幂等键。
5. ActionMutation 在一个业务事务中原子执行。
6. ActionExecution 和评测事件记录实际结果。

手工 CRUD 不经过 Agent 确认，也不调用 Python 或扣积分。
