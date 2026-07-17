# API 契约

Base URL：`/api/v1`。JSON 字段使用 camelCase，枚举使用 UPPER_SNAKE。认证后的 Task、Project、Undo 等业务写接口要求 `Idempotency-Key`，版本化写入要求 `version`。注册、登录和退出是明确例外。

状态：下文 Users、Tasks、Projects 与 Undo 是 H2 已实现接口；Agent 与语音部分是后续契约，不代表 H2 已有可调用端点。

## 统一错误

```json
{
  "error": {
    "code": "TASK_VERSION_CONFLICT",
    "message": "待办已发生变化，请刷新后重试",
    "requestId": "req_xxx",
    "details": {}
  }
}
```

错误映射：400 输入格式、401 未认证、403 越权、404 不存在、409 幂等/版本/唯一冲突、422 语义校验、428 缺少必需的 `Idempotency-Key`、429 限流或额度、5xx 服务端/Provider。

## Users

```text
POST  /auth/username/register
POST  /auth/username/login
POST  /auth/logout
GET   /auth/session
GET   /users/me
```

注册：`{ username, password, phone? }`。密码为 8-128 个 Unicode 字符，不做隐式 trim；服务端使用 Argon2id 保存 Hash。注册事务创建默认昵称“用户”和选填的未验证 PHONE Contact；手机号不创建登录 Identity。

`GET /users/me` 返回用户 ID、用户名、昵称、选填手机号及验证状态、locale 和 timezone。P0 不提供资料修改、用户侧改密或找回密码接口。

认证响应：

- 注册成功：201 `{ user }`，同时写入 Session Cookie。
- 登录成功：200 `{ user }`，同时写入新的 Session Cookie。
- 退出：200 `{ loggedOut: true }`，撤销当前 Session 并清除 Cookie；未携带 Session 时结果相同。
- Session：200 `{ authenticated: true, user, expiresAt }` 或 `{ authenticated: false, user: null, expiresAt: null }`。
- 只读资料：200 `{ user }`。

注册、登录和退出不要求 `Idempotency-Key`：注册通过规范化用户名唯一约束和单事务防止重复账号/重复 grant；登录每次成功创建新 Session；退出对当前 Session 天然幂等。

注册与登录分别按 IP 和规范化用户名独立限流，避免更换用户名绕过 IP 限制或更换 IP 绕过单一用户名限制。限流容量是单进程 H2 基线，多副本前必须迁移到网关或共享存储。

`packages/contracts` 是客户端 Fixture 与 NestJS 公开 DTO 的契约真源。公开对象默认使用 strict schema，所有权、积分和验证状态字段不得由客户端写入。Node/Python 的 Agent 内部协议以计划在 T19.1 创建的 `packages/contracts/internal-agent/v1/openapi.yaml` 为唯一规范工件，使用 OpenAPI 3.1 / JSON Schema 2020-12；Zod、Pydantic 和 FastAPI 运行 Schema 必须由其生成或完整等价，不得让任一语言实现单方面覆盖已评审契约。Golden Fixtures 只补充行为测试。

## Tasks

```text
GET    /tasks?projectId&status&cursor&limit
POST   /tasks
GET    /tasks/:id
PATCH  /tasks/:id
DELETE /tasks/:id
POST   /tasks/:id/complete
POST   /tasks/:id/restore
POST   /undo-operations/:id/execute
```

Task 写入契约：

- `PATCH /tasks/:id`：`{ version, changes }`
- `POST /tasks/:id/complete`：`{ version }`
- `POST /tasks/:id/restore`：`{ version }`
- `DELETE /tasks/:id?version=N`
- 创建、编辑、完成和恢复返回 `{ task }`；只有 DELETE 返回 `{ task, undoOperation: { id, expiresAt } }`
- `POST /undo-operations/:id/execute` 不接收 body，只接受仍在服务端 3 秒有效期内的 TASK_DELETE 撤销，并返回执行后的 `{ task, undoOperation }`

Task 输出内嵌只读项目摘要：`project: { id, name, colorKey, status } | null`。列表响应统一为 `{ items, pageInfo: { nextCursor }, counts: { todo, completed } }`；项目筛选不返回无项目任务。

优先级只允许 HIGH、MEDIUM、LOW，缺省为 MEDIUM。`scheduledAt`、`deadlineAt`、`reminderAt` 分别可空；本阶段不提供提醒投递或已读 API。

## Projects

```text
GET   /projects?status&cursor&limit
POST  /projects
PATCH /projects/:id
POST  /projects/:id/archive
```

`POST /projects` 只接收 `{ name }`，项目身份色由服务端自动分配。`PATCH` 改名与 `archive` 均携带 `version`；归档不解除任务关系。

列表默认只返回 ACTIVE 项目，并带服务端派生的未完成 `taskCount` 与游标；归档项目不会再出现在首页 Chip，但通过 Task 内嵌摘要继续可见。活跃名称冲突返回 409，归档后同名可以重新创建。

## 幂等与版本冲突

- Task、Project、Undo 写接口必须同时校验登录用户归属和 `Idempotency-Key`；同一 scope/key 但请求 Hash 不同返回 409。
- `Idempotency-Key` 必填、非空且最多 128 个字符；缺失返回 428，格式非法返回 400。
- 幂等记录默认保留 24 小时；同一 key 的业务写入和响应快照在同一数据库事务提交。事务失败不会留下“成功快照”，到期 key 可重新认领。
- 更新、完成、恢复、删除、项目改名和归档使用乐观锁；版本不一致返回 409，不能覆盖后续修改。
- 软删除与 UndoOperation 在同一事务创建；撤销到期、重复执行或目标版本已变化时返回稳定冲突错误。

## Agent 与语音（H2 未实现）

```text
POST  /agent/turns
GET   /agent/requests/:id
GET   /conversations/:id/messages?cursor&limit
PATCH /action-proposals/:id
POST  /action-proposals/:id/confirm
POST  /action-proposals/:id/dismiss
GET   /smart-inbox
POST  /voice/transcriptions
```

Agent/语音请求成功入队返回 202。结果只有在持久化并完成积分结算后才返回 `SUCCEEDED`。

以上路径属于 T19–T25 的目标契约。H2 不注册真实 Agent/语音业务端点，不调用 DeepSeek、腾讯 ASR 或积分预留/结算；客户端只显示明确不可用状态。

### Python Agent 内部接口（Phase 3 目标）

客户端和 Caddy 不暴露以下路径；只有 NestJS Worker 可以通过私有网络和服务身份调用：

```text
POST /internal/v1/agent/execute
GET  /internal/health/live
GET  /internal/health/ready
```

执行请求包含 `requestId`、`capabilityCode`、`contractVersion`、允许结果类型、有界对话、最小上下文和临时 `candidateRef`。不得包含具体 Provider、模型、Prompt 版本、Session Cookie、密码、手机号、积分余额、`reservationId` 或数据库凭证。

NestJS Worker 必须传播 W3C `traceparent`/`tracestate` 和稳定 `requestId`。Trace Context 只用于链路关联，不授予身份、幂等、扣费或恢复权限；Python 不得通过遥测后端读回历史请求。

成功响应必须回显 `requestId` 与 `contractVersion`，返回 resolved `provider/model/promptVersion/providerSchemaVersion` 审计元数据，并返回 `REPLY | CLARIFICATION | CANDIDATES | PLAN | ACTION_PROPOSAL` 中的一个严格结果。`contractVersion` 与 Python 内部 `providerSchemaVersion` 不得混用。NestJS 必须再次校验 Schema、结果类型、候选引用、用户归属和业务限制；Python 响应中不允许出现 `billable` 决策字段。

内部稳定错误至少包括：

```text
AGENT_CONTRACT_INVALID
AGENT_SERVICE_UNAUTHORIZED
AGENT_REQUEST_TOO_LARGE
AGENT_PROVIDER_RATE_LIMITED
AGENT_PROVIDER_TIMEOUT
AGENT_PROVIDER_UNAVAILABLE
AGENT_RESULT_EMPTY
AGENT_RESULT_INVALID
```

内部 HTTP 2xx 只表示服务返回了一个候选结果，不代表用户积分已扣除。只有 NestJS 校验并持久化可用结果、再完成幂等积分结算后，公开请求才能进入 `SUCCEEDED`。错误 Envelope、版本兼容策略和字段级 Schema 在 T19.1 冻结。

P0 只有上述同步 execute 和健康检查端点，不提供 Python Run create/status、结果回放、callback 或 telemetry query API。遥测写入成功与否不得出现在业务结果 Schema 中，也不得成为 `billable`、重试或状态迁移条件。

## 认证 Cookie

H5 使用同域 HttpOnly、SameSite=Lax 的不透明 Session Cookie，生产环境额外启用 Secure。Session 默认 30 天绝对有效期，不滑动续期；`SESSION_TTL_DAYS` 只接受 1–365 的完整正整数字符串。数据库仅保存 Token Hash，客户端不访问 Token。

所有 Cookie 写请求校验 Origin。生产环境必须显式配置 `ALLOWED_ORIGINS`，缺失时服务拒绝启动；代理地址只信任 `TRUSTED_PROXY_ADDRESSES` 中的显式 IP，不能用宽泛的 `trust proxy`。
