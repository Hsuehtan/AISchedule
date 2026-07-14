# 当前任务

- 任务：Phase 2（T10–T17）真实手工闭环 H2 收口
- 状态：T10–T17 已实现，H2 待人工审查
- 分支：`codex/phase2-manual-loop`
- 当前门禁：H2（未通过）
- Phase 2 认证基础提交：`d60dce9 feat: 建立认证安全基础能力`
- T10–T17 实现提交：`f6dec8e`、`55e9e62`、`2dd3673`、`9b9f622`
- H2 文档提交：运行 `git log -1 -- tasks/current.md` 查询本快照所在提交
- H2 审查包：[`docs/quality/h2-manual-loop-review.md`](../docs/quality/h2-manual-loop-review.md)
- 接管快照：[`docs/handovers/2026-07-14-h2-manual-loop.md`](../docs/handovers/2026-07-14-h2-manual-loop.md)

## 本阶段锁定决策

- H1 视觉方向通过；H1 `?screen=` 仅保留为隔离 Fixture Gallery，正式跳转由真实 Session、`projectId`、`taskId` 和对象版本驱动。
- 优先级只有 HIGH/MEDIUM/LOW，新任务默认 MEDIUM；右侧只显示红/黄/绿，且与项目身份色分离。
- 任务左侧项目名称与项目 Chip 来自同一 Project；归档项目任务仍保留原项目名称、颜色和归档状态摘要。
- 昵称保持默认“用户”，不实现昵称修改入口或 API。
- `reminderAt` 只保存、编辑、清空和展示，不实现到期提醒、通知表、轮询或 Push。
- 只有软删除生成服务端 3 秒 UndoOperation；创建、完成和恢复不生成撤销。
- 注册、登录、退出不要求 `Idempotency-Key`；认证后的 Task、Project、Undo 写入仍要求。
- T10 随注册事务交付最小 `NEW_USER_GRANT`；每日补足、完整积分网关和管理员调账仍属于 T18。

## T10–T17 完成项

- [x] T10：用户名注册、登录、退出、刷新恢复、Session 安全与注册原子 grant。
- [x] T11：默认昵称和选填未验证手机号的只读用户资料。
- [x] T12：隐藏式管理员改密、凭证并发保护、全 Session 撤销和脱敏审计。
- [x] T13：待办创建、详情、分页列表、真实筛选计数和 Project 摘要。
- [x] T14：待办编辑、完成、已完成折叠、恢复和乐观锁冲突。
- [x] T15：软删除、服务端 3 秒单次撤销及到期/重复/版本冲突保护。
- [x] T16：项目创建、自动配色、改名、归档、名称复用和真实 ID 筛选。
- [x] T17：三个时间字段保存/清空/时区展示、当前范围分组和空状态。

## 实施摘要

- Users：Argon2id Password Hash、256-bit Session Token、数据库 SHA-256 Token Hash、30 天绝对过期、Origin 校验和独立 IP/用户名限流。
- Admin：通过用户名或 UUID 定位；密码只从交互式 TTY 隐藏双输入；并发改密只允许一个凭证版本提交。
- Tasks：确定性排序、租户隔离、版本化写入、24 小时业务幂等记录，以及业务结果与响应快照同事务提交。
- Projects：服务端最少使用配色；同用户创建配色串行化；任务归属与归档竞态由数据库锁保护。
- Undo：Migration 不伪造旧通用撤销历史；只有 `TASK_DELETE`，服务端生成 3 秒有效期。
- Client：正式 Taro 页面与 H1 Gallery 分离；logout/401 清空 Query 和账户级 UI 状态；失败/409 保留表单草稿。
- 智能入口：H2 只显示“智能处理暂不可用”，没有 DeepSeek、ASR、提醒触发或 Fixture 假成功。
- 本地开发：Turbo 开发任务透传后端运行环境变量；Taro H5 在 `h5.devServer` 中仅代理 `/api/v1`，避免拦截 `/api-client.ts` 导致白屏；根目录 `pnpm dev` 可同时启动真实前后端。
- 接口文档：`product_doc/backend-api.md` 记录 H2 当前 18 个真实端点、请求响应模型、错误码、认证、幂等和本地调用示例。

## 验证记录

| 范围                    | 结果                                                |
| ----------------------- | --------------------------------------------------- |
| PostgreSQL 数据库集成   | 11/11 通过                                          |
| 服务端集成              | 14/14 通过                                          |
| `pnpm test`             | 83/83 通过；含 H5 开发代理防白屏回归                |
| `pnpm typecheck`        | 11/11 Workspace 任务通过                            |
| `pnpm lint`             | 7/7 Workspace 包及根 E2E/Playwright Lint 通过       |
| `pnpm build`            | 7/7 Workspace 任务通过；H5 807 modules，约 5.88s    |
| `pnpm test:integration` | 11 项数据库、14 项服务端集成通过                    |
| `pnpm test:e2e`         | 14/14 通过；正式 H2、H1 Gallery、axe、44px 和响应式 |
| `pnpm test:visual`      | 3/3 通过                                            |
| `pnpm format:check`     | 通过                                                |

## 当前风险与非范围

- 当前认证限流是有容量上限的单进程内存实现；多副本生产前必须在 T28/T29 迁移到网关或共享存储。
- Taro/Rspack 在受限 macOS 沙箱内可能因 system-configuration `dynamic_store` NULL panic 挂起；同一 Node.js 24 命令在受控沙箱外成功，属于已知环境限制。
- Chrome 视口验证不能替代 iOS/Android 真机 IME、安全区、地址栏和录音权限；真机矩阵在 T25/T27 完成。
- 图标归一和少量 Figma 细节留到 T27，不阻断 H2 手工闭环审查。
- DeepSeek、腾讯 ASR 和真实 Provider Secret 均未连接。
- 未实现提醒触发、通知、Push、昵称修改、C 端改密或手机号验证码登录。
- 未部署生产、未开放公网、未使用真实用户数据。
- `Electric_Ink_UI_review_keyboard_icons.png` 与 `design/` 是用户本地设计资料，不得误纳入提交。

## 唯一下一步

把 [`H2 审查包`](../docs/quality/h2-manual-loop-review.md) 交给人类验收并停止开发。只有收到明确回复“通过”才可勾选 H2 并开始 T18；若收到修改清单，只修正清单内的 H2 问题并重新提交审查。
