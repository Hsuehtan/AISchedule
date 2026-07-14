# 测试策略

## 分层原则

- 单元/契约：输入规范化、Schema、排序、时间转换、导航 Reducer、幂等意图和安全原语。
- PostgreSQL 集成：正式 Migration、约束、锁、事务、鉴权、幂等、乐观锁和跨用户隔离。
- E2E：构建后的 Taro H5 + 真实 NestJS + 隔离 PostgreSQL 16 Testcontainer + Chrome。
- 视觉：390 × 844 主基线，补充 320/480px；H1 Fixture 与 H2 正式路径分开。
- 可访问性：axe、44px 命中区、键盘 TaskRow、Sheet 焦点陷阱与关闭后焦点恢复。

外部付费 Provider 不作为 CI 前提。H2 不调用 DeepSeek 或腾讯 ASR；后续 CI 使用确定性 Stub，真实 Provider 只允许在受控环境冒烟。

## H2 必测边界与证据

| 边界                                                         | 证据                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 用户名 NFKC/大小写、输入约束、只读资料                       | `packages/contracts/src/contracts.test.ts`                             |
| 并发等价用户名注册、初始 grant 原子性、Session、Origin       | `apps/server/test/auth.integration.test.ts`                            |
| 256-bit Token、SHA-256 Hash、独立 IP/用户名限流、容量上限    | `apps/server/src/modules/users/auth-security.test.ts`                  |
| 隐藏密码输入、禁止明文参数、管理员并发改密和全 Session 撤销  | `apps/server/src/admin/password-set.test.ts`、认证集成测试             |
| 项目配色并发、归档竞态、组合租户外键、稳定排序               | `packages/db/test/database.integration.test.ts`                        |
| 旧通用 Undo 不被伪造回填                                     | `packages/db/test/migration-safety.test.ts`                            |
| Task/Project/Undo API、幂等事务、版本冲突和跨用户隔离        | `apps/server/test/manual-loop.integration.test.ts`                     |
| 三档优先级与项目色分离、时区格式化、时间清空                 | `apps/client/src/task-presentation.test.ts`、`task-form-model.test.ts` |
| logout/401 账户状态清空、浏览器返回保留筛选                  | `apps/client/src/app-state.test.ts`、`api-client.test.ts`              |
| 同一用户意图重试复用 Idempotency-Key                         | `apps/client/src/write-intent.test.ts`                                 |
| 真实注册到重新登录、项目/任务/时间/撤销、409/401/5xx、响应式 | `tests/e2e/phase2.spec.ts`                                             |

## Phase 2 业务不变量

- 未登录页面不请求或显示真实任务；退出和任意受保护请求 401 会清空 Query 与账户级 UI 状态。
- Task/Project/Undo 每个认证写操作都要求 `Idempotency-Key`；同一用户意图重试复用 key，业务结果与快照原子提交。
- 更新使用表单打开时捕获的版本；后台刷新不能偷偷替换版本，409 后草稿保留。
- 只有删除生成 3 秒 Undo；创建、完成、恢复不生成 Undo，已完成任务可长期恢复。
- 项目标签与 Chip 同源；项目身份色不影响 HIGH/MEDIUM/LOW 的红/黄/绿，新任务默认 MEDIUM。
- 归档项目从 Chip 隐藏，但其既有任务仍显示项目摘要并允许编辑非归属字段。
- `scheduledAt`、`deadlineAt`、`reminderAt` 独立保存、清空和展示，不产生到期通知、调度或已读状态。
- E2E 由真实 Session、projectId、taskId 和 API 驱动，不使用 H1 `?screen=` 证明业务闭环。

## H2 浏览器场景

`tests/e2e/phase2.spec.ts` 至少覆盖：

1. 注册、刷新恢复、退出和重新登录。
2. 顶部加号打开手动创建，不进入 Agent。
3. 无项目/项目筛选、项目标签同源、三档优先级。
4. 创建、编辑、时间清空、完成、恢复、删除及 3 秒内外撤销。
5. 项目创建、重名冲突、改名、归档、归档任务保留和名称复用。
6. 409 保留草稿、5xx 重试、401 清空认证状态。
7. 浏览器返回关闭 Sheet 并保留筛选。
8. 390 × 844 主路径截图、320/480px 无溢出、44px 和 axe。

## 当前验证记录

| 范围                            | 结果                                                    |
| ------------------------------- | ------------------------------------------------------- |
| PostgreSQL 数据库集成           | 11/11 通过                                              |
| 服务端集成                      | 14/14 通过                                              |
| 根单元/契约测试                 | 83/83 通过；含 H5 开发代理防白屏回归                    |
| TypeScript、Lint、Build、Format | 全部通过；Build 7/7，H5 807 modules                     |
| H2 E2E/视觉                     | E2E 14/14、视觉命令 3/3；axe、44px 与三个正式视口均通过 |

本节是 2026-07-14 H2 提交前的实测结果；完整命令口径仍以 [`../../tasks/current.md`](../../tasks/current.md) 与 [`h2-manual-loop-review.md`](h2-manual-loop-review.md) 为准。

## 后续阶段

- T18–T24：积分预留/结算、Agent 状态机、提案确认、重复确认和 Provider 失败释放。
- T25–T27：ASR 权限/编码/临时清理、真实错误降级、真机矩阵、完整无障碍和视觉阈值。
- T28–T30：多副本限流、生产安全头/代理信任、备份恢复、发布回滚和 RC 全量验收。
