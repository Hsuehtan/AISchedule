# 数据模型

物理模型使用 PostgreSQL 16、UUID 主键和 UTC `timestamptz`。所有应用表包含 `created_at`、`updated_at` 和 `extra jsonb not null default '{}'`。

状态：Users、Tasks、Projects、Undo、幂等和最小注册积分流水已在 H2 使用；Agent 相关表是已迁移的后续结构基线，H2 没有 Agent/ASR 业务写入。

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
- `user_contacts`：P0 仅 PHONE；同一用户同类型唯一，未验证联系方式不创建登录 Identity，也不要求跨用户唯一。
- `auth_sessions`：只保存 token_hash；密码版本不一致或 revoked_at 非空时拒绝。
- `admin_audit_events`：管理员改密、调账及结果。

User 与 UserPasswordCredential 各自保存同一 credential_version。管理员改密使用旧版本条件更新，只允许一个并发操作成功；新 Hash、双版本递增、全 Session 撤销和审计事件在同一事务提交。

昵称非唯一，默认“用户”，仅允许 1-10 个中英文字母；P0 不提供修改入口或写接口。用户名经 NFKC、trim 和 ASCII 小写化后比较，允许 3-32 个中英文、数字、下划线和短横线。

## Projects 与 Tasks

- `projects`：user_id、name、name_normalized、color_key、status、source、source_action_id、archived_at、version。
- 活跃项目使用条件唯一索引 `(user_id, name_normalized) where status = 'ACTIVE'`。
- `tasks`：user_id、project_id、title、description、status、priority、scheduled_at、deadline_at、reminder_at、completed_at、deleted_at、source、source_action_id、version。
- Projects 建立 `(id, user_id)` 唯一键，Tasks 通过 `(project_id, user_id)` 组合外键阻止跨用户归属。

项目色从固定色板自动分配，只表达项目身份。Task priority 仅有 HIGH/MEDIUM/LOW，默认 MEDIUM；客户端映射为红/黄/绿，不能从项目色推导。Task 查询内嵌只读 Project 摘要，归档项目仍保留在其任务上。

项目创建会锁定当前 User 行，使“当前使用最少、同数按固定顺序”的配色在同一用户并发创建时保持确定。Task 创建/重新归属会锁定目标 Project 并再次检查 ACTIVE，避免与归档并发时把新关系写入已归档项目。

`scheduled_at`、`deadline_at`、`reminder_at` 均使用 UTC `timestamptz` 独立保存；P0 当前不建立提醒调度、通知或已读表。

P0 任务列表基线索引：`(user_id, deleted_at, status, scheduled_at)`；项目筛选索引：`(user_id, project_id, status)`。列表使用服务端确定性排序和 ID 游标，结果同时返回当前筛选范围的 TODO/COMPLETED 数量。

## Agent

- `conversation_sessions`、`messages`
- `agent_request_runs`
- `action_proposals`、`action_mutations`、`action_executions`
- `undo_operations`、`agent_evaluation_events`

`action_executions.proposal_id` 唯一。提案确认必须校验 user_id、提案状态和目标版本，批量 Mutation 在一个事务中执行。

Conversation、Message、AgentRequestRun、ActionProposal、ActionExecution、UndoOperation 和 Evaluation 的父子关系均把 `user_id` 纳入组合外键，数据库层拒绝跨用户串联。

Agent 表在 H2 只提供未来结构约束，没有模型请求、提案或执行记录；不得把“表存在”解释为 Agent 功能已经交付。

## 积分与幂等

- `ai_point_transactions` 保存类型、金额、请求、关联预留、配置版本/Hash、前后余额和状态。
- `idempotency_records` 使用 `(user_id, scope, key)` 唯一键，保存请求 Hash、响应状态、稳定响应和过期时间。
- 余额更新、积分流水和 Agent 请求创建必须在同一事务完成。
- 管理员 `set` 余额转换为差额流水，不直接覆盖历史。
- T10 注册事务先交付最小 `NEW_USER_GRANT`：User 余额从 0 开始，与唯一成功 grant 流水原子更新；每日补足、预留/结算和管理员调账在 T18 完成。

H2 Task/Project/Undo 写入把业务 Mutation 与 idempotency response snapshot 放在同一事务；默认 24 小时 TTL 到期后 key 可重新认领。失败事务不保留部分业务状态或伪成功响应。

## 物理约束

- Prisma 使用 `partialIndexes` 生成活跃项目名、每日补足条件唯一索引。
- 初始 Migration 追加非负余额、正版本号、完成/归档状态一致性、Undo 有效期等 CHECK。
- Phase 2 Migration 增加 `TASK_DELETE` 来源/目标/逆向变化/期望版本与执行状态约束。旧通用 Undo 无法无损回填；若未发布开发库已有旧记录，Migration 主动拒绝并要求显式重置，不伪造历史。
- Prisma 7 客户端使用 `@prisma/adapter-pg`；运行时必须显式传入连接串，生成代码不提交版本库。
- `pg-boss` 的内部队列表由其自身版本管理，不并入业务 Prisma Schema。

## 删除与保留

- Task 使用软删除；只有删除同时产生 3 秒有效的 UndoOperation。创建、完成和恢复不创建撤销记录，完成任务通过已完成区长期恢复。
- Phase 2 UndoOperation 只允许 `TASK_DELETE`，保存来源操作、目标引用、逆向变化、期望版本、状态和服务端 `expires_at`；到期、重复执行或版本变化不能回滚。删除与 Undo 创建原子提交，执行撤销也只允许一次。
- 积分流水、Action 执行和评估事件不物理删除。
- 原始语音不持久化；转写完成或失败后立即清理临时数据。
