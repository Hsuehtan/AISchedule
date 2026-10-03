# API 契约

Base URL：`/api/v1`。JSON 字段使用 camelCase，枚举使用 UPPER_SNAKE。公开 DTO 的真源是 `packages/contracts` Zod Schema；Node/Python 内部契约的唯一规范工件是 `packages/contracts/internal-agent/v2/openapi.yaml`（v1 保留兼容）。

状态：Users、Tasks、Projects、Undo 与 Phase 3 Agent/Smart Inbox 路由已实现于当前分支。H3 尚未通过；`POST /voice/transcriptions`、提醒投递和生产公开访问尚未实现。

## 统一约定

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

- Cookie Session 认证；生产使用 `HttpOnly + Secure + SameSite=Lax`。
- 除注册、登录、退出外，公开写接口要求 `Idempotency-Key`。Key 非空、最长 128 字符；同 scope/key 但请求 Hash 不同返回 409。
- 对象更新、消息回答、Proposal 编辑/关闭/取消/确认携带正整数 `version`。
- 400 表示输入格式，401 未认证，403 Origin/权限，404 当前用户看不到对象，409 幂等/版本/状态/唯一冲突，428 缺幂等键，429 额度不足，503 智能能力不可用。
- 公开响应不泄露 Python、DeepSeek、Prompt、模型正文、Secret 或内部错误正文。

## Users

```text
POST /auth/username/register
POST /auth/username/login
POST /auth/logout
GET  /auth/session
GET  /users/me
```

注册输入是 `{ username, password, phone? }`。注册事务创建默认昵称“用户”、USERNAME Identity、密码凭证、选填未验证 PHONE Contact、新用户 grant 和 Session。手机号不能用于登录或找回密码。P0 不提供资料修改、C 端改密、找回密码或积分余额 HTTP 接口。

## Tasks

```text
GET    /tasks?projectId&status&cursor&limit
POST   /tasks
GET    /tasks/:id
PATCH  /tasks/:id
DELETE /tasks/:id?version=N
POST   /tasks/:id/complete
POST   /tasks/:id/restore
POST   /undo-operations/:id/execute
```

- `PATCH` 输入 `{ version, changes }`；complete/restore 输入 `{ version }`。
- Task 输出内嵌 `project: { id, name, colorKey, status } | null`。
- 列表返回 `{ items, pageInfo: { nextCursor }, counts: { todo, completed } }`。
- 优先级只有 HIGH/MEDIUM/LOW，默认 MEDIUM；三个时间字段可空。
- 只有软删除返回服务端生成、3 秒有效的 UndoOperation；创建、完成和恢复不提供短时撤销。

## Projects

```text
GET   /projects?status&cursor&limit
POST  /projects
PATCH /projects/:id
POST  /projects/:id/archive
```

创建只接收 `{ name }`，项目色由服务端分配。改名与归档携带版本；归档不解除 Task 关系，归档后原名称可以复用。

## Agent 公开 API

| 方法  | 路径                                             | 主要行为                                                                       |
| ----- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| POST  | `/agent/turns`                                   | 1–500 字普通文本或补充输入；固定 `agent.standardTurn`，成功 admission 返回 202 |
| POST  | `/agent/plan-generations`                        | 从 Message 或 Proposal 发起/重做计划；固定 `agent.planGeneration`，返回 202    |
| GET   | `/agent/requests/:id`                            | 轮询 Run；`SUCCEEDED` 前不返回可消费结果                                       |
| GET   | `/conversations/:id/messages?cursor&limit`       | 游标分页读取当前用户会话消息                                                   |
| POST  | `/conversations/:id/viewed`                      | 记录最后查看消息，用于未读回复派生                                             |
| POST  | `/conversations/:id/messages/:messageId/answers` | 提交服务端 optionId 或补充文本；确定性路径返回 200，需要模型时返回 202         |
| GET   | `/action-proposals/:id`                          | 读取当前用户 Proposal                                                          |
| PATCH | `/action-proposals/:id`                          | 严格白名单编辑计划草稿                                                         |
| POST  | `/action-proposals/:id/dismiss`                  | 只记录最近关闭时间，不改变待确认状态                                           |
| POST  | `/action-proposals/:id/cancel`                   | 明确取消 Proposal                                                              |
| POST  | `/action-proposals/:id/confirm`                  | 幂等、原子执行 Proposal                                                        |
| GET   | `/smart-inbox?projectId`                         | 派生当前 Smart Inbox 摘要；不调用模型、不扣分                                  |
| POST  | `/smart-inbox/organize`                          | 最多整理 20 个无项目未完成任务，按普通能力入队                                 |

### 发起与轮询

普通文本：

```json
{
  "conversationId": "可省略的 UUID",
  "input": {
    "mode": "TEXT",
    "text": "帮我整理今天要做的事",
    "replyTo": { "messageId": "UUID", "version": 1 }
  }
}
```

成功 admission 返回：

```json
{
  "requestId": "UUID",
  "conversationId": "UUID",
  "status": "QUEUED",
  "pollAfterMs": 1000
}
```

请求状态是 `QUEUED | RUNNING | RESULT_PERSISTED | SETTLING | SUCCEEDED | FAILED | RELEASED`。只有 `SUCCEEDED` 返回 `result`，类型为 `REPLY | CLARIFICATION | CANDIDATES | PLAN | ACTION_PROPOSAL`；失败终态只返回稳定公开错误和 `canRetry`。

所有公开 Proposal 响应包含服务端推导的 `presentation: PLAN | ACTION`；分类以关联 Run 的实际结果类型为准，独立于 `actionCode`。历史提案与幂等重放按同一规则返回。

普通请求固定预留 1 点。计划采用二阶段计费：普通理解/澄清 1 点；用户明确发起计划生成后新建 2 点请求。客户端不能提交能力、成本、Provider 或模型。

### 澄清与候选

回答输入：

```json
{
  "version": 1,
  "answer": { "type": "OPTION", "optionId": "opt_xxx" }
}
```

也可提交 `{ "type": "TEXT", "text": "补充说明" }`。客户端只能回传服务端 optionId；NestJS 重新校验消息版本、候选归属和目标版本。确定性答案不调用模型、不扣分；需要继续推理时创建新的计费 Run。

### Proposal

Proposal 状态：`DRAFT | AWAITING_CONFIRMATION | SUPERSEDED | CANCELLED | EXECUTING | EXECUTED | FAILED | EXPIRED`。支持七类 Action：`CREATE_TASK`、`CREATE_PROJECT_TASKS`、`ORGANIZE_TASKS`、`UPDATE_TASK`、`COMPLETE_TASK`、`RESTORE_TASK`、`DELETE_TASK`。

`PATCH` 只接受 `SET_PROJECT`、`UPDATE_TASK_DRAFT`、`REMOVE_MUTATION`、`REMOVE_FIELD_SUGGESTION` 命令。确认输入是 `{ version }`；确认不再扣分，并在单一事务中执行全部 Mutation。重复确认返回同一 ActionExecution。软删除可返回批量 3 秒 Undo，其他动作不返回短时撤销。

### Smart Inbox

Smart Inbox 固定优先级：待确认、待澄清、处理中、执行失败、未读回复、无项目待办整理、当前/空状态入口、默认入口。前五类是账户全局状态，不受项目筛选隐藏；整理只由无项目未完成任务触发。

额度确实耗尽使用 429；能力停用、Python/Provider 故障或内部异常使用 503。客户端文案分别为“明天可继续”和“智能处理暂不可用”，不展示积分数字、模型、Token、成本或充值入口。

## Python Agent 内部 API

内部路径不带公开 `/api/v1` 前缀，不经 Caddy 或客户端暴露：

```text
POST /internal/v2/agent/execute
POST /internal/v2/agent/context/read # NestJS 私有读取端点
POST /internal/v1/agent/execute # 兼容端点
GET  /internal/health/live
GET  /internal/health/ready
```

唯一契约真源是 OpenAPI 3.1 工件；提交的 Node Zod/Python Pydantic 模型由生成脚本维护，CI 使用 `pnpm agent:contract:check` 防止漂移，FastAPI Schema 另做规范化等价测试。

Execute 请求包含 Run UUID、契约版本、能力、截止时间、locale/timezone、允许结果类型；v2 不包含消息或候选。Python 使用独立服务凭证按 requestId、resource、limit、cursor 读取来源/消息/任务/项目，候选只导出临时引用。禁止包含用户 ID、真实业务 ID、Session、余额、成本、reservation 或 Provider 选择。

成功响应回显请求和契约版本，并返回实际 `provider/model/promptVersion/providerSchemaVersion/repairAttempts` 与严格结果；不返回 `billable`。NestJS 把 Python 输出始终视为不可信输入，再次校验 Schema、引用、用户归属、版本和业务上限。

内部服务使用至少 256-bit Bearer Token，限制请求体为 256 KiB、默认并发 4。健康检查不调用 DeepSeek。Node 对 execute 不做自动 HTTP 重试；Python 只在获得非空但结构非法的内容时，在同一 execute 内最多结构修复一次。

## 当前未提供

- `POST /voice/transcriptions` 与腾讯 ASR（T25）。
- `reminderAt` 到期调度、通知、Push 与提醒已读。
- 完整历史会话列表、昵称修改、C 端改密/找回密码、手机号验证码身份、项目取消归档。
- Python Run 查询/回放、Callback、算法日志上传/查询、Token usage API。
- 生产公网 API；H3/H4 均未通过。
