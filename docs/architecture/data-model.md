# 数据模型

物理模型使用 PostgreSQL 16、UUID 主键和 UTC `timestamptz`。所有应用表包含 `created_at`、`updated_at` 和 `extra jsonb not null default '{}'`。

## 关系

```text
User
├── UserIdentity
├── UserPasswordCredential
├── UserContact
├── AuthSession
├── Project ──< Task
├── ConversationSession ──< Message
├── AgentRequestRun
├── ActionProposal ──< ActionMutation ── ActionExecution
├── UndoOperation
└── AiPointTransaction
```

## Users

- `users`：nickname、status、locale、timezone、ai_points、credential_version。
- `user_identities`：type、identifier、identifier_normalized、status、verified_at、last_used_at；`(type, identifier_normalized)` 唯一。
- `user_password_credentials`：每用户一条 Argon2id Hash 与 credential_version。
- `user_contacts`：P0 仅 PHONE；未验证联系方式不创建登录 Identity。
- `auth_sessions`：只保存 token_hash；密码版本不一致或 revoked_at 非空时拒绝。
- `admin_audit_events`：管理员改密、调账及结果。

昵称非唯一，默认“用户”，仅允许 1-10 个中英文字母。用户名经 NFKC、trim 和 ASCII 小写化后比较，允许 3-32 个中英文、数字、下划线和短横线。

## Projects 与 Tasks

- `projects`：user_id、name、name_normalized、color_key、status、source、source_action_id、archived_at。
- 活跃项目使用条件唯一索引 `(user_id, name_normalized) where status = 'ACTIVE'`。
- `tasks`：user_id、project_id、title、description、status、priority、scheduled_at、deadline_at、reminder_at、completed_at、deleted_at、source、source_action_id、version。
- Projects 建立 `(id, user_id)` 唯一键，Tasks 通过 `(project_id, user_id)` 组合外键阻止跨用户归属。

任务列表索引：`(user_id, status, scheduled_at, priority, created_at, id)`；列表游标包含排序字段和 id。

## Agent

- `conversation_sessions`、`messages`
- `agent_request_runs`
- `action_proposals`、`action_mutations`、`action_executions`
- `undo_operations`、`agent_evaluation_events`

`action_executions.proposal_id` 唯一。提案确认必须校验 user_id、提案状态和目标版本，批量 Mutation 在一个事务中执行。

## 积分与幂等

- `ai_point_transactions` 保存类型、金额、请求、关联预留、配置版本/Hash、前后余额和状态。
- `idempotency_records` 使用 `(user_id, scope, key)` 唯一键，保存请求 Hash 与稳定响应。
- 余额更新、积分流水和 Agent 请求创建必须在同一事务完成。
- 管理员 `set` 余额转换为差额流水，不直接覆盖历史。

## 删除与保留

- Task 使用软删除；删除同时产生 3 秒有效的 UndoOperation。
- 积分流水、Action 执行和评估事件不物理删除。
- 原始语音不持久化；转写完成或失败后立即清理临时数据。
