# 数据模型

物理模型使用 PostgreSQL 16、UUID 主键和 UTC `timestamptz`。应用业务表包含 `created_at`、`updated_at` 和 `extra jsonb not null default '{}'`。Phase 3 采用 expand-first Migration；旧积分枚举值和可回滚列暂时保留，新代码不得继续写旧语义。

## 关系概览

```text
User
├── Identity / PasswordCredential / Contact / AuthSession
├── AiPointTransaction ── AiCapability
├── Project ──< Task
├── ConversationSession ──< Message
├── AgentRequestRun ──< AgentRequestCandidateRef
├── ActionProposal ──< ActionMutation ── ActionExecution
├── UndoOperation
└── AgentEvaluationEvent
```

Python Agent 服务没有 Prisma Model、业务数据库或第二套 Run 存储。以下 Agent、积分和业务事实全部由 NestJS/Prisma 写入。

## Users

- `users`：`nickname`、状态、locale、timezone、`ai_points`、`credential_version`。
- `user_identities`：登录身份；`(type, identifier_normalized)` 全局唯一。P0 只创建 USERNAME Identity。
- `user_password_credentials`：每个用户一条 Argon2id Hash 与凭证版本。
- `user_contacts`：P0 仅 PHONE；同一用户同类型唯一，未验证手机号不创建登录 Identity，也不做跨用户唯一。
- `auth_sessions`：只保存 Session Token 的 SHA-256 Hash；凭证版本不一致、过期或撤销时拒绝。
- `admin_audit_events`：管理员改密与积分调账审计，不保存明文密码、Session 或完整私人内容。

用户名比较前执行 NFKC、trim 和 ASCII 小写化；昵称默认“用户”、非唯一，P0 不提供昵称修改接口。管理员改密在同一事务中更新 Hash、递增 User/Credential 两处版本、撤销全部 Session 并写审计事件。

## Projects 与 Tasks

- `projects`：`user_id`、规范化名称、身份色、状态、来源、`source_action_id`、归档时间和版本；活跃名称按 `(user_id, name_normalized)` 条件唯一。
- `tasks`：`user_id`、`project_id`、标题、描述、状态、HIGH/MEDIUM/LOW 优先级、三个时间字段、完成/删除时间、来源、`source_action_id` 和版本。
- Projects 的 `(id, user_id)` 唯一键与 Tasks 组合外键阻止跨用户项目归属。

项目色只表达项目身份；任务优先级只映射为红/黄/绿。`scheduled_at`、`deadline_at`、`reminder_at` 独立存 UTC；当前不建立提醒任务、通知或已读表。Agent 确认后新建的业务记录使用 `source = AGENT` 并关联 Action 来源，手工创建保持 `MANUAL`。

## 积分配置与能力版本

`config/product/points.yaml` v2 是规则真源：Grant 保存 `points + ruleVersion`，能力保存 `capabilityCode`、`endpointCode`、名称、是否调用模型、成本、成本规则版本与启用状态。

`ai_capabilities` 是从 YAML 派生的不可变历史注册表：

- 启动时在 PostgreSQL advisory lock 和事务中同步。
- `(capability_code, cost_rule_version)` 唯一；同一规则版本内容变化会拒绝启动。
- 同一 `(capability_code, endpoint_code)` 最多一个 ACTIVE 版本。
- 数据库只提供历史关联和成本快照，不能反向覆盖 YAML。

默认规则是新用户 20 点、注册次日起每日懒补足至 10 点、普通 Agent 1 点、计划生成 2 点、语音转写 1 点。语音能力只注册规则，T25 前没有 ASR 调用路径。

## 积分账本

`ai_point_transactions` 保存用户、类型、状态、差额、配置版本/Hash、能力版本、端点、规则版本、幂等键、请求/结果关联、预留 lease 和余额快照。

Phase 3 的 succeeded debit 必须且只能引用一个同 Run 的 Message 或 ActionProposal：AiPointsPort 同时校验 reservation 原始 `request_id`、Worker 提交的 `runId` 与结果记录的 `request_run_id`。`session_id` 仅为 expand/rollback 兼容保留，新代码停止写入。

新代码只使用：

- 类型：`GRANT | DEBIT | REFUND | ADJUSTMENT | EXPIRE`。
- 状态：`PENDING | SUCCEEDED | FAILED | CANCELLED`。
- 预留：创建一条 `DEBIT/PENDING`，此时余额快照为空。
- 结算：通过 CAS 原地转为 `SUCCEEDED`，锁定 User 后实际扣减并写 `balance_before/after`。
- 释放：通过互斥 CAS 原地转为 `CANCELLED`，不改变余额。
- 退款：引用唯一原流水，不能重复退款。

旧 `NEW_USER_GRANT / DAILY_TOP_UP / RESERVATION / RELEASE / ADMIN_ADJUSTMENT` 等枚举值仅为 expand/rollback 兼容而保留，应用停止写入。物理收缩必须在后续独立 Migration 完成。

每日补足在注册次日起、用户本地日期首次发起 Agent admission 前懒执行。低于目标时补差，高于目标时不扣；即使差额为 0 也写一条 `daily_allowance_top_up` 成功审计流水。条件唯一索引确保同一用户、本地日期最多评价一次。

可用余额是账面余额减去有效 `DEBIT/PENDING` 预留。负向管理员调账不得侵占预留；`set` 转换为差额 `ADJUSTMENT`，不直接覆盖历史。

`Users/AiPointsPort` 提供 `reserve`、`extendLease`、`settle`、`release`、`refund` 等能力。调用方不能传成本或余额；成本由 ACTIVE `AiCapability` 解析。余额变化先对 User 执行 `FOR NO KEY UPDATE`，Port 不开启嵌套事务。

## Agent 会话与运行

### Conversation 与 Message

- `conversation_sessions` 保存首次输入、可选上下文摘要、最后查看消息与时间；P0 不提供完整历史会话列表。
- `messages` 保存角色、消息类型、输入模式、回复关系、结构化内容、交互状态、Run/Proposal 关联和版本。
- Conversation、Message 以及所有 Agent 子对象的关系均包含 `user_id` 组合外键，数据库层拒绝跨用户串联。

上下文构建最多使用 20 条消息、合计 12 KiB。消息按纯文本与严格结构数据持久化；不存模型 HTML、完整 Prompt 或 Chain of Thought。

### AgentRequestRun 与 CandidateRef

`agent_request_runs` 保存能力/端点、契约版本、允许结果、幂等键、预留、dispatch、超时/deadline/恢复时间、结果类型与 Payload、Node 计算的 `result_hash`、稳定错误，以及结果产生后填写的 Provider/模型/Prompt/Provider Schema/结构修复元数据。

状态机：

```text
QUEUED -> RUNNING -> RESULT_PERSISTED -> SETTLING -> SUCCEEDED
                 \-> FAILED -> RELEASED
```

`agent_request_candidate_refs` 为单次 Run 生成随机临时引用，保存 Task/Project 目标、版本、最小快照与到期时间。单次最多 50 个 Task 和 30 个活跃 Project。Python 只看到临时引用，不能看到或返回真实业务 ID；NestJS 在使用前重新检查用户归属和版本。

Run 与预留通过 `(reservation_id, user_id)` 约束关联。同一端点幂等键只产生一个 Run；同一预留只关联一个 Run。可用结果先持久化并计算 Hash，之后才结算积分；`RESULT_PERSISTED` 后不得释放或再次 dispatch。

## Action Proposal 与执行

`action_proposals` 生命周期为：

```text
DRAFT -> AWAITING_CONFIRMATION -> EXECUTING -> EXECUTED
                             \-> SUPERSEDED | CANCELLED | FAILED | EXPIRED
```

- `action_mutations` 按 sequence 保存 operation、目标类型/ID/版本、前后快照和字段来源。
- `action_executions.proposal_id` 唯一；一个 Proposal 最多执行一次，幂等重放返回相同结果。
- 支持创建任务、创建项目及任务、整理任务、修改、完成、恢复、软删除七类 Action。
- 确认时重新校验用户归属、Proposal/Task/Project 版本、项目状态与名称唯一性；全部 Mutation 通过 transaction-scoped Tasks/Projects Port 在一个事务执行。
- 计划不建独立表，直接保存为 `CREATE_PROJECT_TASKS` Proposal；单个计划 1–10 项，草稿惰性 7 天过期。
- `dismiss` 只更新 `last_dismissed_at`；`cancel` 才改变 Proposal 状态。重新生成计划成功后才用 `supersedes_proposal_id` 替换旧草稿。

只有软删除 Action 生成 3 秒批量 `undo_operations`；创建、完成和恢复不生成短时撤销。手工软删除继续生成单任务 Undo。Undo 保存来源执行、目标集合、逆向变化、期望版本和服务端到期时间。

## Smart Inbox 与评测

Smart Inbox 是基于 Proposal、Message、Run、Task 和当前筛选实时派生的读模型，不建立主表，不调用模型、不扣分。固定优先级是：待确认、待澄清、处理中、执行失败、未读回复、无项目待办整理、当前/空状态入口、默认入口。

`agent_evaluation_events` 是留给 T26 的产品评测表基线；T18–T24 的业务正确性不依赖它，当前也不把 Python 运行细节复制进去。未来启用时只能由 NestJS 记录用户修正、确认、取消和执行结果等产品事实。Python MVP 不持久化模型调用、工具调用、Token usage、延迟或算法日志，也不建立日志数据库、文件或跨库关系。

## 幂等、删除与保留

- `idempotency_records` 使用 `(user_id, scope, key)` 唯一键，保存请求 Hash、稳定响应快照和到期时间。
- 手工业务写入、Agent admission 与 Proposal 操作的幂等记录都和对应业务变化在同一事务提交。
- Task 使用软删除；积分流水、ActionExecution 和评测事件不物理删除。
- 原始语音不持久化；T25 尚未实现语音采集与转写。
- `pg-boss` 内部表由 pg-boss 管理，不并入 Prisma Schema。
