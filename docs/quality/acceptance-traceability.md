# 验收追踪

状态：H2 已于 2026-07-17 获得人类明确通过。T18–T24、Stub 全量验证、三视口截图和真实 DeepSeek Smoke 已完成，当前停在 T24 等待人工审查；H3 仍未通过，T25–T27 尚未开始。最终命令结果见 [`../../tasks/current.md`](../../tasks/current.md)。

## H2 已通过范围

| PRD/规则               | Figma/行为                                 | 实施任务          | 自动化证据                                                  | 状态                             |
| ---------------------- | ------------------------------------------ | ----------------- | ----------------------------------------------------------- | -------------------------------- |
| AC-06 手动任务闭环     | Login、All Todos、Task Edit、Done Expanded | T10、T13–T15、T17 | 服务端手工闭环集成、Picker 单测、`tests/e2e/phase2.spec.ts` | 已实现，H2 已通过                |
| AC-07 项目筛选和归档   | Work Project、Project Management           | T16               | DB 租户关系、服务端项目管理、浏览器主路径                   | 已实现，H2 已通过                |
| AC-09 进入不打断       | 登录后默认 Task Home                       | T10、T17          | App State 单测、浏览器注册/刷新恢复                         | 已实现，H2 已通过                |
| AC-11 手工失败回执     | Sheet 错误与草稿保留                       | T13–T17           | 5xx/409 E2E、API Client 单测                                | 已实现，H2 已通过                |
| AC-13 Phase 2 用户隔离 | 用户、项目、任务、Undo                     | T10–T17、T28      | 组合外键、认证和手工闭环跨用户集成                          | Phase 2 已通过；发布加固仍属 T28 |
| AC-17 非 AI 操作不扣分 | 手工 CRUD/刷新/撤销                        | T10、T13–T18      | 手工闭环与积分集成回归                                      | 已实现；Phase 3 回归通过         |
| AC-20 最终 UI 列表口径 | 项目/优先级/时间/空状态                    | T13–T17           | UI/Picker/Presentation 单测、H2 E2E                         | 已实现，H2 已通过                |
| AC-21 新用户积分发放   | 注册无可见积分 UI                          | T10、T18          | 认证集成、积分对账与并发测试                                | 已实现；Phase 3 集成通过         |
| AC-22 仅软删除撤销     | Toast Undo                                 | T15               | DB 精确 3 秒边界、服务端单次撤销、E2E                       | 已实现，H2 已通过                |
| AC-24 项目管理入口     | 横向项目栏、独立管理入口                   | T16               | 项目栏三视口、滚动、可访问名称 E2E                          | 已实现，H2 已通过                |
| AC-25 登录演示隔离     | Login 静态卡、退出清状态                   | T10               | API Client 401、App State reset、E2E                        | 已实现，H2 已通过                |
| Phase 2 身份约束       | 注册/登录/只读资料                         | T10–T12           | Contracts、认证集成、管理员改密测试                         | 已实现，H2 已通过                |
| 正式产品跳转           | Login/Register/Home/Sheet                  | T10–T17           | App State 单测、浏览器返回 E2E                              | 已实现，H2 已通过                |
| 项目/优先级语义        | 左侧项目；右侧高红/中黄/低绿               | T13–T17           | Presentation 单测、项目同源/三档 E2E                        | 已实现，H2 已通过                |
| 三个时间字段           | 选择、取消、回填、清空，无提醒触发         | T17               | Picker/时区单测、持久化集成、E2E                            | 已实现，H2 已通过                |

H2 最终历史证据保留在 [`h2-manual-loop-review.md`](h2-manual-loop-review.md)，不再作为 Phase 3 Agent 成功的替代证据。

## Phase 3 T18–T24 实现追踪

| PRD/规则                   | 产品行为                                              | 实施任务      | API/数据                                                                                            | 自动化证据                                   | 当前状态                  |
| -------------------------- | ----------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------- |
| AC-01 首次 AI 批量创建     | 普通理解后生成并编辑计划，确认后创建                  | T20、T22、T23 | `agent/turns`、`agent/plan-generations`、`action-proposals/:id/confirm`；Message/Proposal/Execution | Agent runtime/action 集成、Phase 3 E2E       | Stub 与真实 Smoke 均通过  |
| AC-02 取消不写入           | 关闭只 dismiss；明确取消才取消草稿                    | T22、T23      | Proposal `lastDismissedAt`/`CANCELLED`                                                              | Application/Action 单测与集成                | 自动化通过                |
| AC-03 模糊意图消歧         | 澄清卡、确定性回答或新推理请求                        | T21           | Message answer API、Question Message                                                                | Agent runtime 集成、Phase 3 E2E              | 自动化通过                |
| AC-04 对象候选选择         | 只提交随机 optionId，服务端复验归属/版本              | T21           | `AgentRequestCandidateRef`、Message answer API                                                      | Candidate/跨用户/陈旧版本集成                | 自动化通过                |
| AC-05 所有 AI 写操作确认   | 七类 Action 均先形成 Proposal                         | T22、T23      | Proposal/Mutation/Execution、Confirm API                                                            | Action Executor 单测与 PostgreSQL 集成       | 自动化通过                |
| AC-10 执行一致性           | 批量操作全成功或全回滚，重复确认复用结果              | T23           | 单一事务、唯一 ActionExecution                                                                      | 批量回滚、重复确认、项目冲突集成             | 自动化通过                |
| AC-11 Agent 失败回执       | 失败、额度不足、服务不可用分层降级                    | T19、T20、T24 | Run failure、公开 429/503                                                                           | Worker、Controller、客户端/E2E               | 自动化通过                |
| AC-13 Agent 用户隔离       | 会话、候选、提案、执行均按 userId 隔离                | T19–T24       | 组合关系、transaction-scoped Ports                                                                  | Agent Schema/runtime/action/Smart Inbox 集成 | 自动化通过                |
| AC-14 调用前积分网关       | 补足、预留、幂等、Run、Job 同事务                     | T18、T19      | `AiPointsPort`、UnitOfWork、pending Debit                                                           | Points/Admission/Queue 集成                  | 自动化通过                |
| AC-15 成功扣分与取消       | 可用结果持久化后结算；关闭/取消不退款                 | T18–T22       | `RESULT_PERSISTED`、settle CAS                                                                      | Points/Worker/runtime 集成                   | 自动化与真实 Smoke 均通过 |
| AC-16 失败不扣分           | 明确无结果释放；含糊失败冻结到恢复判断                | T18、T19      | Debit `CANCELLED`、Run recovery                                                                     | 非法结果、超时、断连、迟到响应测试           | 自动化通过                |
| AC-18 积分幂等与账实一致   | 并发不超卖、结算/释放互斥、退款追加流水               | T18、T19      | 账本硬约束、lease、CAS                                                                              | Points/迁移安全/Worker 集成                  | 自动化通过                |
| AC-21 新用户积分发放       | 注册时统一 grant                                      | T18           | AiPoints Service、Grant Transaction                                                                 | 认证与 Points 集成                           | 自动化通过                |
| AC-23 Smart Inbox 整理     | 只整理无项目 TODO，最多 20 项，确认后写入             | T24、T23      | `smart-inbox`、`smart-inbox/organize`、Proposal                                                     | Smart Inbox 服务/集成、Phase 3 E2E           | 自动化通过                |
| AC-26 每日体验额度补足     | 注册次日起按用户本地日期首次 AI 请求前评价一次        | T18           | daily top-up grant、零差额日标记                                                                    | 时区、零差额、同日消费后不再补足集成         | 自动化通过                |
| AC-27 Agent 服务与计费边界 | Python 无业务数据库/积分权限，NestJS 独占计费与持久化 | T18、T19      | Internal OpenAPI、Bearer Service Token                                                              | Contract 等价、容器/安全、服务负向测试       | 自动化通过                |
| AC-28 单次派发与恢复       | 每个 Run 最多一次 execute，持久化后只重试结算         | T19           | Run dispatch/deadline/recovery 字段                                                                 | Worker 状态机与故障集成                      | 自动化通过                |
| AC-29 Python 日志不持久化  | 仅白名单 stdout/stderr，logger 失败旁路               | T19           | 无日志 API/Sink/Exporter                                                                            | Python 安全日志与 OpenAPI 负向测试           | 自动化通过                |

### 真实 Provider 证据

| 链路                                                 | Harness                                   | 当前状态                  |
| ---------------------------------------------------- | ----------------------------------------- | ------------------------- |
| NestJS → Python → DeepSeek → REPLY 持久化 → 1 点结算 | `apps/server/test/deepseek.smoke.test.ts` | 通过；`deepseek-v4-flash` |
| NestJS → Python → DeepSeek → PLAN 持久化 → 2 点结算  | `apps/server/test/deepseek.smoke.test.ts` | 通过；`deepseek-v4-pro`   |

真实 Smoke 使用合成输入、隔离测试用户和本地环境变量 Secret；脱敏结果为 1/1 通过，Provider 链路约 25.3 秒。Python Stub 与契约测试仍保留为确定性回归证据。

## 尚未进入的 P0 范围

| PRD                             | 任务    | 状态                                             |
| ------------------------------- | ------- | ------------------------------------------------ |
| AC-08 语音降级                  | T25     | 未开始；语音入口继续显示暂不可用，不调用腾讯 ASR |
| AC-12 完整 Evaluation/审计收口  | T26     | 未开始；现有业务记录不替代最终 Evaluation 验收   |
| Provider 恢复演练与最终质量收口 | T26–T27 | 未开始；H3 仍未通过                              |
| 完整发布安全                    | T28–T30 | 未开始；无生产批准                               |

## 视觉与可访问性

| 范围                             | 证据                                               | 状态                          |
| -------------------------------- | -------------------------------------------------- | ----------------------------- |
| H1 Production V3 15 状态         | `tests/e2e/prototype.spec.ts`、H1 截图             | 历史视觉方向已通过            |
| H2 正式反馈与三视口              | H2 E2E、正式 H2/项目栏截图                         | H2 已通过                     |
| Phase 3 澄清/计划/确认闭环       | `tests/e2e/phase3-agent.spec.ts`                   | E2E 18/18 中通过              |
| Phase 3 320/390/480px、44px、axe | `phase3-agent-clarification-{320,390,480}x844.png` | 已生成、自动化与人工复核通过  |
| 真机 IME、安全区、地址栏、录音   | T25/T27                                            | 未开始；不属于 T24 审查完成项 |

Phase 3 审查入口为 [`phase3-agent-review.md`](phase3-agent-review.md)。该阶段检查点不会提前改变 H3 的定义：H3 仍在 T27 后，当前未通过。
