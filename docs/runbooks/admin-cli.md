# 管理员 CLI

当前提供管理员改密与积分 add/subtract/set/history。没有对应 C 端改密、积分修改或余额查询 HTTP 接口。

## 前置条件与安全

- 使用 Node.js 24、pnpm 11，`DATABASE_URL` 必须明确指向目标环境。
- 操作者先核对环境、目标用户、原因和维护窗口；修改命令必须记录 `--operator` 与 `--reason`。
- 目标只允许二选一：`--username` 或 `--user-id`。
- 不在原因、终端历史、截图或日志中记录密码、Session、Secret、手机号和完整私人待办。
- 生产管理员操作尚未获得 H4 授权；当前只允许本地或隔离测试环境演练。

## 修改密码

```bash
pnpm admin:password-set --username demo_user --operator haon --reason "本地恢复演练"
```

或按 UUID：

```bash
pnpm admin:password-set --user-id 00000000-0000-4000-8000-000000000000 --operator haon --reason "本地恢复演练"
```

命令必须在交互式 TTY 运行，随后隐藏输入并二次确认新密码。禁止添加 `--password`、通过参数/环境变量/stdin 管道传明文，或把密码写入 shell 历史。

成功操作在同一事务中：

1. 以当前 `credentialVersion` 做并发保护。
2. 写入新的 Argon2id Hash。
3. 同步递增 User 与 PasswordCredential 版本。
4. 撤销目标用户全部 Session。
5. 写入脱敏 `PASSWORD_SET` 管理员审计事件。

标准输出不包含密码、Hash 或 Session Token。旧密码和所有旧 Session 立即失效；新密码可重新登录。

## 积分调账

### 增加

```bash
pnpm admin:points-add --username demo_user --amount 5 --operator haon --reason "内测补发"
```

### 扣减

```bash
pnpm admin:points-subtract --user-id 00000000-0000-4000-8000-000000000000 --amount 2 --operator haon --reason "误发纠正"
```

### 设置目标余额

```bash
pnpm admin:points-set --username demo_user --balance 20 --operator haon --reason "账务对账"
```

`add` 与 `subtract` 的 `--amount` 必须是正整数；`set` 的 `--balance` 可以是 0。数值上限受 PostgreSQL integer 范围约束。`set` 会计算差额并写一条 `ADJUSTMENT`，不会覆盖或改写历史流水。

所有修改命令都支持先预演：

```bash
pnpm admin:points-set --username demo_user --balance 20 --operator haon --reason "账务对账" --dry-run
```

`--dry-run` 仍会读取并锁定一致状态以计算结果，但不更新 User、不写积分流水、不写审计事件；输出中的 `transactionId` 为 `null`。

真实调账在一个事务中：

1. 用 `FOR NO KEY UPDATE` 锁定目标 User。
2. 计算账面余额与所有有效 `DEBIT/PENDING` 预留。
3. 拒绝负余额，以及调整后余额不足以覆盖预留的操作。
4. 更新余额并写 `ADJUSTMENT/SUCCEEDED` 流水，记录配置版本/Hash、前后余额、操作者与原因。
5. 写 `POINTS_ADD | POINTS_SUBTRACT | POINTS_SET` 管理员审计事件。

输出包含 `balanceBefore`、`balanceAfter`、`pointsDelta`、`reservedPoints`、是否 dry-run 与流水 ID；不输出私人业务内容。

## 查询积分历史

```bash
pnpm admin:points-history --username demo_user
pnpm admin:points-history --user-id 00000000-0000-4000-8000-000000000000 --limit 100
```

默认返回最近 50 条，`--limit` 范围 1–200。history 是只读命令，不接收 operator/reason/dry-run。输出按创建时间倒序，包含类型、状态、差额、可用的前后余额、原因码、操作者、原因和时间。

## 常见失败

| 情况                   | 处理                                                         |
| ---------------------- | ------------------------------------------------------------ |
| 未找到用户             | 核对规范化用户名或 UUID；不要创建替代账号                    |
| 同时或都未提供两种定位 | 只保留 `--username` 或 `--user-id` 之一                      |
| 非法数值               | 使用无符号十进制整数；不接受负数、小数、指数、前导加号或空白 |
| 调整后不能覆盖预留     | 等待对应 Run 结算/释放，或先完成积分对账；不要手工改数据库   |
| 改密非交互式终端       | 切换可信 TTY；不得用明文参数规避                             |
| 凭证版本冲突           | 另一个改密已提交；重新核对目标状态后再执行                   |
| 数据库/事务失败        | 操作整体回滚；排查连接后以新的维护事件重试                   |

不要通过 SQL 直接改 `users.ai_points`、密码 Hash、credential version 或 Session。调账和改密都没有自动“撤销到旧值”；需要纠正时应使用新原因执行新的 CLI 操作，保留完整审计链。

## 验收证据

- 改密：验证多个旧 Session 全部失效、旧密码失败、新密码成功、审计脱敏、并发仅一个版本提交。
- 积分：先 dry-run，再执行并查询 history；验证前后余额、差额和审计一致，且 pending 预留不会被侵占。
- 自动化测试：`apps/server/src/admin/password-set.test.ts`、`apps/server/src/admin/points-admin.test.ts` 及相关 PostgreSQL 集成测试。
