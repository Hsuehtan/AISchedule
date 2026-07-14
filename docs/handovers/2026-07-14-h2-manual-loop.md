# H2 真实手工闭环接管快照

> 不可覆盖快照。后续实现、验证或产品结论变化时，应新建带日期/用途的 handover，不得改写本文件表达的 2026-07-14 状态。

## 快照状态

- 日期：2026-07-14
- 分支：`codex/phase2-manual-loop`
- 已实现：T10–T17 真实手工闭环
- 当前门禁：H2 待人工审查，尚未通过
- 审查包：[`../quality/h2-manual-loop-review.md`](../quality/h2-manual-loop-review.md)
- 唯一允许的后续：完成最终质量结果回填并等待人类给出“通过”或修改清单
- 禁止：开始 T18、连接 Agent/ASR、实现提醒触发、生产部署或导入真实用户数据

## 产品不变量

- 用户名 + 密码是 P0 过渡认证；手机号选填且未验证，不建立 PHONE Identity。
- 昵称保持默认“用户”，不提供修改入口、资料 PATCH、C 端改密或找回密码。
- 优先级只有 HIGH/MEDIUM/LOW，新任务默认 MEDIUM；右侧语义固定为红/黄/绿。
- 任务左侧显示真实项目名称和项目身份色；项目色与优先级色完全分离。
- 只有 Task 软删除创建服务端 3 秒 UndoOperation；完成任务通过已完成区长期恢复。
- `scheduledAt`、`deadlineAt`、`reminderAt` 可独立保存、编辑、清空和展示；没有提醒调度或通知副作用。
- H1 `?screen=` 只服务 Fixture Gallery；正式页面由 Session、`projectId`、`taskId` 和对象 `version` 驱动。

理由与覆盖关系见 [`ADR-008`](../decisions/ADR-008-phase2-scope-supersession.md)。

## 已落地实现

### Users

- 注册事务原子创建 User、USERNAME Identity、Argon2id Credential、选填 PHONE Contact、Session 和 `NEW_USER_GRANT`。
- Session Token 为 256-bit 随机值，数据库只存 SHA-256 Hash；默认 30 天绝对有效，不滑动续期。
- Cookie 写请求校验 Origin；登录/注册按独立 IP 和规范化用户名维度限流。
- `GET /users/me` 只读；退出返回 `{ loggedOut: true }` 并撤销当前 Session。
- 管理员 CLI 使用隐藏双输入、凭证版本并发保护、全 Session 撤销和脱敏审计。

### Tasks

- 创建、详情、游标分页、当前筛选计数、稳定排序和内嵌 Project 摘要。
- 更新、完成、恢复和删除均校验租户归属与对象版本；冲突不覆盖数据。
- 软删除与 UndoOperation 在同一事务提交；3 秒有效期由服务端生成，过期/重复/版本变化均拒绝。
- 认证后的 Task/Undo 写入使用 `Idempotency-Key`；业务写入与响应快照在同一事务，记录 24 小时后可回收。

### Projects

- 项目创建只接受名称；服务端按“当前使用最少，同数按固定顺序”自动分配身份色。
- 同一用户配色分配串行化；Task 创建/改归属与 Project 归档通过数据库锁避免竞态。
- 活跃项目名称唯一，归档后可复用；归档不删除任务或解除归属。

### Client

- 正式 Login/Register/Task Home 页面与 H1 Fixture Gallery 分离。
- 顶部加号始终打开手动创建；独立项目管理入口负责项目生命周期和退出登录。
- Query 与账户级本地状态在 logout/401 时清空；浏览器返回优先关闭当前 Sheet 并保留进入前筛选。
- 表单按用户意图复用幂等键，使用打开时捕获的版本提交；失败/409 保留草稿。
- Agent、Smart Inbox 和语音在 H2 只呈现明确不可用状态。

## 关键路径

- API 真源：[`../architecture/api.md`](../architecture/api.md)
- 物理模型：[`../architecture/data-model.md`](../architecture/data-model.md)
- 安全边界：[`../architecture/security-threat-model.md`](../architecture/security-threat-model.md)
- 追踪矩阵：[`../quality/acceptance-traceability.md`](../quality/acceptance-traceability.md)
- 管理员改密：[`../runbooks/admin-cli.md`](../runbooks/admin-cli.md)
- 当前任务：[`../../tasks/current.md`](../../tasks/current.md)

主要实现目录：

```text
apps/client/src/
apps/server/src/modules/users/
apps/server/src/modules/tasks/
apps/server/src/modules/projects/
apps/server/src/platform/{database,http,idempotency}/
apps/server/src/admin/
packages/contracts/src/
packages/db/prisma/
packages/db/src/
tests/e2e/phase2.spec.ts
```

## 恢复与验证

```bash
pnpm install
docker compose -f compose.yaml up -d postgres
cp .env.example .env
pnpm db:generate
pnpm db:migrate:deploy
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
pnpm test:visual
```

最终门禁实测：PostgreSQL 数据库集成 11/11、服务端集成 14/14、单元/契约 82/82、E2E 14/14、视觉命令 3/3；TypeScript、Lint、Format 和 7/7 Workspace Build 均通过。H5 构建转换 807 modules，约 5.88s。最终命令口径见 [`../../tasks/current.md`](../../tasks/current.md) 和 H2 审查包。

## 数据库与迁移注意事项

- `20260714120000_phase2_manual_loop` 是不可覆盖 Migration。
- 旧通用 Undo 数据无法无损解释成 TASK_DELETE；Migration 在旧 `undo_operations` 非空时主动拒绝，不能伪造回填。未发布开发库应明确重置后再迁移。
- 项目活跃名使用条件唯一索引；不得改成全状态唯一。
- `user_contacts` 只约束同一用户同类型唯一，未验证手机号不做全局唯一。
- 所有业务写入必须保留 `userId` 租户边界、组合外键、版本与幂等语义。

## 已知边界与风险

- 本阶段未连接 DeepSeek、腾讯 ASR 或真实 Provider Secret。
- 本阶段未创建提醒 Worker、通知表、已读状态或 Push。
- 当前单进程认证限流不适用于未来多副本部署；T28/T29 前必须换成网关或共享存储方案。
- Task 列表项与范围计数是 `READ COMMITTED` 下的连续查询，并发写入瞬间可能来自不同快照；游标也应在 T28 前增加用户/筛选范围校验。
- 含历史数据的首次部署应在 Migration 前预检同一用户重复 Contact；H2 未获得生产迁移授权。
- Taro/Rspack 在受限 macOS 沙箱内会因 system-configuration `dynamic_store` NULL panic 挂起；相同 Node.js 24 构建在受控沙箱外成功，接管者应使用上文命令在允许访问该系统能力的环境复验，不要把沙箱 panic 误判为源码构建失败。
- 真机 IME、安全区、地址栏、录音权限和音频编码矩阵未在 H2 完成。
- H2 不是发布批准；域名、公网、生产数据库、备份恢复和真实用户接入均要等 H4。

## 工作区保护

- `Electric_Ink_UI_review_keyboard_icons.png` 和 `design/` 是用户提供的本地设计资料；未经明确授权不得纳入提交或改写。
- 不提交 `.env`、数据库数据、Session、密码、Provider Secret、原始语音或完整私人待办。
- 当前工作区可能包含尚未提交的 Phase 2 实现；接管者先运行 `git status --short --branch`，不得重置或覆盖不明变更。

## 接管结论

T10–T17 产品范围和自动化门禁已经完成，H2 仍是未通过状态。接管者不得自行把 H2 勾选为完成，也不得以“代码已完成”替代人工审查。唯一下一步是让人类按 H2 审查包验收并明确回复“通过”或提交修改清单。
