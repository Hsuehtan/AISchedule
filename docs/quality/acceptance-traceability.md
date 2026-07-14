# 验收追踪

状态：T10–T17 已实现，H2 待人工审查。H1 只证明视觉方向；下表用真实 API、数据库和正式 Taro 页面追踪 Phase 2 行为。最终测试命令结果见 [`../../tasks/current.md`](../../tasks/current.md)。

## H2 已实现范围

| PRD/规则               | Figma/行为                                 | 实施任务          | 自动化证据                                                                              | 状态                              |
| ---------------------- | ------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------- | --------------------------------- |
| AC-06 手动任务闭环     | Login、All Todos、Task Edit、Done Expanded | T10、T13–T15、T17 | `apps/server/test/manual-loop.integration.test.ts`；`tests/e2e/phase2.spec.ts` 主路径   | 已实现，H2 待审                   |
| AC-07 项目筛选和归档   | Work Project、Project Management           | T16               | DB `tenant-safe project relations`、服务端 `manages projects...`、浏览器主路径          | 已实现，H2 待审                   |
| AC-09 进入不打断       | 登录后默认 Task Home                       | T10、T17          | `apps/client/src/app-state.test.ts`；浏览器注册/刷新恢复                                | 已实现，H2 待审                   |
| AC-11 手工失败回执     | Sheet 错误与草稿保留                       | T13–T17           | E2E `5xx retry`、`409 keeps local draft`；API Client 单测                               | 已实现，H2 待审                   |
| AC-13 Phase 2 用户隔离 | 用户、项目、任务、Undo                     | T10–T17、T28      | DB 组合外键；认证与手工闭环跨用户集成测试                                               | Phase 2 已实现；Agent/积分待后续  |
| AC-17 非 AI 操作不扣分 | 手工 CRUD/刷新/撤销                        | T10、T13–T17      | 服务端手工闭环测试；H2 无模型/积分网关调用                                              | 已实现，H2 待审                   |
| AC-19 Phase 2 扩展字段 | User/Project/Task/Undo                     | T04、T10–T17      | Prisma Migration 与数据库集成测试                                                       | 已实现；完整对象随后续阶段复验    |
| AC-20 最终 UI 列表口径 | 标题计数、左项目、右优先级、时间、空状态   | T13–T17           | Contract/客户端 presentation 单测；浏览器主路径与响应式                                 | 已实现，H2 待审                   |
| AC-21 新用户积分发放   | 注册无可见积分 UI                          | T10、T18          | 认证集成 `registers...grants points atomically` 与并发注册测试                          | 最小 grant 已实现；完整积分待 T18 |
| AC-22 仅软删除撤销     | Toast Undo                                 | T15               | DB 3 秒内/精确边界测试；服务端单次撤销；E2E 过期撤销                                    | 已实现，H2 待审                   |
| AC-24 项目管理入口     | 项目栏独立管理按钮；顶部加号新建任务       | T16               | E2E 主路径；App State 导航单测                                                          | 已实现，H2 待审                   |
| AC-25 登录演示隔离     | Login 静态卡、退出清状态                   | T10               | API Client 401、App State reset、E2E 退出/重新登录                                      | 已实现，H2 待审                   |
| Phase 2 身份约束       | 注册/登录/只读资料                         | T10–T12           | `packages/contracts/src/contracts.test.ts`；`apps/server/test/auth.integration.test.ts` | 已实现，H2 待审                   |
| 管理员改密             | 无 C 端入口                                | T12               | `apps/server/src/admin/password-set.test.ts`；并发改密集成测试                          | 已实现，H2 待审                   |
| 正式产品跳转           | Login/Register/Home/Sheet                  | T10–T17           | `apps/client/src/app-state.test.ts`；E2E 浏览器返回                                     | 已实现，H2 待审                   |
| 业务幂等与版本         | Task/Project/Undo 写入                     | T13–T16           | 手工闭环 `requires idempotency`、`commits ... atomically`；WriteIntent 单测             | 已实现，H2 待审                   |
| 项目/优先级语义        | 左侧项目；右侧高红/中黄/低绿               | T13–T17           | `task-presentation.test.ts`；E2E 项目同源/三档断言                                      | 已实现，H2 待审                   |
| 提醒收敛范围           | 保存/清空/展示，无到期触发                 | T17               | 客户端时区单测、Task 持久化集成与 E2E 时间编辑                                          | 已实现，H2 待审                   |

## H2 数据库/安全边界

| 边界                                   | 自动化证据                                             |
| -------------------------------------- | ------------------------------------------------------ |
| 用户名 NFKC、大小写碰撞和并发注册      | Contracts；`apps/server/test/auth.integration.test.ts` |
| Session Token/Hash、绝对过期和改密撤销 | `auth-security.test.ts`；认证集成测试                  |
| IP 与用户名独立限流、状态容量          | `auth-security.test.ts`                                |
| 项目色并发、创建/改归属与归档竞态      | `packages/db/test/database.integration.test.ts`        |
| Undo 迁移不伪造旧数据                  | `packages/db/test/migration-safety.test.ts`            |
| 业务写入与幂等响应快照同事务           | `apps/server/test/manual-loop.integration.test.ts`     |
| logout/401 不泄漏前一账户 UI 状态      | App State/API Client 单测；正式 E2E                    |

2026-07-14 门禁实测：数据库集成 11/11、服务端集成 14/14、单元/契约 82/82、E2E 14/14、视觉命令 3/3；TypeScript、Lint、7/7 Build 和 Format 均通过。

## 后续 P0 范围

| PRD                               | 实施任务     | 当前状态                          |
| --------------------------------- | ------------ | --------------------------------- |
| AC-01–05、AC-10、AC-12            | T19–T23、T26 | 未实现；不得用 H1 Fixture 代替    |
| AC-08 语音降级                    | T25          | 未实现；H2 不调用 ASR             |
| AC-14–16、AC-18、AC-26            | T18–T24      | 仅 T10 初始 grant；完整积分未实现 |
| AC-23 Smart Inbox 多字段整理      | T24          | 未实现；H2 只显示暂不可用         |
| 完整用户/Agent/积分隔离与发布安全 | T28–T30      | 未实现；没有生产批准              |

## 视觉与可访问性

| 范围                       | 证据                                   | 状态                      |
| -------------------------- | -------------------------------------- | ------------------------- |
| H1 Production V3 15 状态   | `tests/e2e/prototype.spec.ts`、H1 截图 | 历史视觉方向已通过        |
| H2 正式 320/390/480px      | `tests/e2e/phase2.spec.ts`、H2 截图    | 自动化通过，H2 待人工审查 |
| 44px、axe、Sheet 焦点/恢复 | UI/客户端测试与正式 E2E                | 自动化通过，H2 待人工审查 |
| 真机 IME、安全区、地址栏   | T25/T27                                | 未实现，不属于 H2         |

自动化通过不等于 H2 人工通过。只有人类依据 [`h2-manual-loop-review.md`](h2-manual-loop-review.md) 明确回复“通过”后才能标记门禁完成。
