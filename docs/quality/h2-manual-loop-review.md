# H2 真实手工闭环审查包

## 门禁状态

- 日期：2026-07-14
- 分支：`codex/phase2-manual-loop`
- 实施范围：T10–T17 已实现
- 门禁：H2 待人工审查，尚未通过
- 下一阶段：T18；未经明确回复“通过”不得开始

本审查包只证明“没有 Agent 时，用户可以安全地完成认证、待办和项目的真实持久化闭环”。它不代表 P0 已发布，也不授权连接 DeepSeek、腾讯 ASR、真实用户数据或生产环境。

## 完成范围

| 任务 | 已实现结果                                                                | 主要自动化证据                                                          |
| ---- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| T10  | 用户名注册/登录/退出、刷新恢复、30 天绝对 Session、注册初始积分原子 grant | `apps/server/test/auth.integration.test.ts`、`tests/e2e/phase2.spec.ts` |
| T11  | `GET /users/me` 只读资料、默认昵称“用户”、选填未验证手机号                | `packages/contracts/src/contracts.test.ts`、认证集成测试                |
| T12  | 隐藏式管理员改密、双版本递增、全 Session 撤销和脱敏审计                   | `apps/server/src/admin/password-set.test.ts`、认证集成测试              |
| T13  | 待办创建、详情、分页列表、当前筛选计数和真实项目摘要                      | `apps/server/test/manual-loop.integration.test.ts`、浏览器主路径        |
| T14  | 编辑、完成、已完成折叠、恢复和乐观锁                                      | 手工闭环集成测试、409 浏览器用例                                        |
| T15  | 软删除与服务端 3 秒单次 UndoOperation                                     | 数据库/服务端边界测试、3 秒内外浏览器用例                               |
| T16  | 项目创建、服务端配色、改名、归档、名称复用和真实筛选                      | 数据库并发测试、手工闭环集成测试、浏览器主路径                          |
| T17  | 三个时间字段保存/清空/时区展示、分组和空状态                              | 客户端时间单测、服务端持久化测试、浏览器主路径                          |

正式产品使用真实 Taro 页面：Session 决定 Login/Register/Home，筛选使用 `projectId`，编辑使用 `taskId + version`，浏览器返回优先关闭当前 Sheet。H1 `?screen=` 仅保留在隔离的 Fixture Gallery。

## 明确不在 H2

- Agent 对话、澄清、计划、提案确认和真实 Smart Inbox。
- DeepSeek 调用、pg-boss Agent Worker 和积分预留/结算。
- 语音采集、腾讯 ASR 和转写确认。
- `reminderAt` 到期触发、轮询、通知、Push 或已读状态。
- 昵称修改、C 端改密、找回密码、手机号验证码登录。
- 生产部署、公网开放、真实用户接入和真实 Provider Secret。

上述入口在 H2 正式页面展示“智能处理暂不可用”，不得执行 H1 Fixture 假流程。

## 本地复现

```bash
pnpm install
docker compose -f compose.yaml up -d postgres
cp .env.example .env
pnpm db:generate
pnpm db:migrate:deploy
pnpm dev
```

管理员改密演练见 [`../runbooks/admin-cli.md`](../runbooks/admin-cli.md)。自动浏览器路径使用隔离 Testcontainer，不读取或修改本地开发库：

```bash
pnpm test:e2e
```

## 人工验收路径

1. 打开注册页，使用用户名和密码注册；可分别验证留空手机号和选填手机号。
2. 确认注册后 replace 进入待办首页；刷新页面仍保持 Session。
3. 点击顶部加号，确认打开手动新建待办而非 Agent；保存一个无项目待办。
4. 进入项目管理，新建项目；再创建高、中、低三个任务并分别归属该项目。
5. 确认任务左侧项目名称/颜色与项目 Chip 同源，右侧优先级只有红、黄、绿且不受项目色影响。
6. 在“全部”和真实项目 Chip 间切换；确认无项目任务只出现在“全部”，数量和空状态随当前范围变化。
7. 编辑任务标题、描述、项目、优先级、计划时间、截止时间和提醒时间；再次编辑并清空三个时间字段。
8. 完成任务，展开已完成区并长期恢复；确认完成/恢复没有 3 秒撤销 Toast。
9. 删除任务，在 3 秒内撤销；再次删除并等待超过 3 秒，确认服务端拒绝撤销。
10. 改名项目；验证活跃项目重名冲突保留输入；归档后 Chip 消失、任务仍显示原项目摘要，并可复用原项目名。
11. 打开任一 Sheet 后使用浏览器返回；确认只关闭 Sheet，原项目筛选仍保留。
12. 退出登录，确认个人任务和本地筛选/Sheet/Undo 状态立即清空；重新登录后数据仍持久化。
13. 按管理员 Runbook 修改密码，确认旧密码与全部旧 Session 失效，新密码可登录。
14. 点击 Smart Inbox、底部 Agent/语音入口，确认只显示“智能处理暂不可用”，没有模型、ASR 或积分调用。

验收中遇到 409 或网络失败时，任务/项目表单内容必须保留，不得展示虚假成功。

## 截图

以下截图来自正式 H2 路径，不是 H1 Fixture：

- [320 × 844](screenshots/h2-manual-loop-320x844.png)
- [390 × 844](screenshots/h2-manual-loop-390x844.png)
- [480 × 844](screenshots/h2-manual-loop-480x844.png)

![H2 390 × 844](screenshots/h2-manual-loop-390x844.png)

## 自动化结果

| 命令/范围                            | 当前记录                                                              |
| ------------------------------------ | --------------------------------------------------------------------- |
| PostgreSQL 数据库集成                | 11/11 通过：租户约束、配色并发、归档竞态、排序、软删除与 3 秒边界     |
| 服务端集成                           | 14/14 通过：认证/并发注册/改密/Session、Task/Project/Undo、幂等事务   |
| `pnpm test`                          | 83/83 单元与契约测试通过；含 H5 开发代理防白屏回归                    |
| `pnpm typecheck`                     | 11/11 Workspace 任务通过                                              |
| `pnpm lint`                          | 7/7 Workspace 包及根 E2E/Playwright Lint 通过                         |
| `pnpm build`                         | 7/7 Workspace 任务通过；H5 807 modules，约 5.88s                      |
| `pnpm test:integration`              | 数据库 11/11、服务端 14/14 通过                                       |
| `pnpm test:e2e` / `pnpm test:visual` | 14/14 与 3/3 通过；含 axe、44px、Sheet 焦点、320/390/480px 和 H2 截图 |
| `pnpm format:check`                  | 通过                                                                  |

## 提交与关键变更

- 分支：`codex/phase2-manual-loop`
- Phase 2 认证基础提交：`d60dce9 feat: 建立认证安全基础能力`
- T10–T17 实现提交：`f6dec8e`、`55e9e62`、`2dd3673`、`9b9f622`
- H2 文档与验收提交：运行 `git log -1 -- docs/quality/h2-manual-loop-review.md` 查询本审查包所在提交

关键变更集中在 `apps/client/src/`、`apps/server/src/modules/{users,tasks,projects}/`、`packages/contracts/`、`packages/db/`、`tests/e2e/phase2.spec.ts` 与本审查包链接的架构/追踪文档。

## 追踪与已知风险

完整 PRD/行为到测试映射见 [`acceptance-traceability.md`](acceptance-traceability.md)。

- H2 浏览器自动化使用 Chrome 和 320/390/480px 视口；iOS/Android 真机 IME、安全区和地址栏仍在 T25/T27 验证。
- 图标归一与少量 Figma 视觉细节按已批准结论延期到 T27，不阻断手工业务闭环判断。
- 当前认证限流是有容量上限的单进程内存实现；多副本生产部署前必须在 T28/T29 迁移到网关或共享存储。
- 列表项与范围计数当前使用 PostgreSQL `READ COMMITTED` 的连续查询；并发写入瞬间可能出现一次计数/列表短暂不一致，后续可收敛为同一快照或单条 CTE。
- 列表游标尚未显式验证属于当前用户和筛选范围；UUID 不可枚举且查询不会返回他人数据，但 T28 前应补齐范围校验以消除排序锚点和存在性侧信道。
- 首次向含历史数据的环境部署前，需要预检同一用户的重复 Contact；H2 没有生产迁移授权。
- Taro/Rspack 在受限 macOS 沙箱内读取 system-configuration `dynamic_store` 时会出现 NULL panic 并挂起；同一 Node.js 24 全量构建命令在受控沙箱外成功（H5 807 modules，约 5.88s），因此当前判定为环境限制，而不是代码构建失败。复验命令：`mise exec -- corepack pnpm build`。
- Agent/ASR/提醒触发尚未实现，因此不能把 H2 结果外推为完整 P0 或发布批准。

## 需要人类给出的结论

无新增产品待决策项。请按上述路径给出其一：

- `通过`：H2 标记完成，才允许开始 T18。
- 修改清单：保持 H2 未通过，仅修正清单内问题并重新提交审查。

在收到结论前，开发必须停止在 H2，不进入 Agent、语音或生产工作。
