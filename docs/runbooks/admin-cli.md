# 管理员 CLI

当前仅交付管理员改密命令。积分增减、设置和历史查询属于 T18，H2 不提供对应 CLI，也不存在 C 端改密 HTTP 接口。

## 前置条件

- 使用 Node.js 24 和 pnpm 11。
- `DATABASE_URL` 指向明确的目标环境。
- 命令必须在交互式 TTY 中运行；新密码不会从参数、环境变量或 stdin 管道读取。
- 操作者必须确认目标环境、目标用户、操作原因和维护窗口。

生产环境操作尚未获得 H4 授权。H2 只能在本地或隔离测试环境演示。

## 修改密码

按用户名定位：

```bash
pnpm admin:password-set --username demo_user --operator haon --reason "H2 本地恢复演练"
```

按用户 UUID 定位：

```bash
pnpm admin:password-set --user-id 00000000-0000-4000-8000-000000000000 --operator haon --reason "H2 本地恢复演练"
```

命令随后以隐藏方式要求输入两次新密码。密码必须为 8–128 个 Unicode 字符；输入内容不会回显。禁止添加 `--password`、把密码写入 shell 历史，或在原因中记录密码、Session、手机号和完整私人任务。

## 成功语义

一次成功操作在同一事务中：

1. 使用目标用户当前 `credentialVersion` 做并发保护。
2. 写入新的 Argon2id Password Hash。
3. 同步递增 User 与 Credential 的版本。
4. 撤销该用户全部未撤销 Session。
5. 写入 `PASSWORD_SET` 管理员审计事件，只记录定位方式、操作者、原因、结果版本和撤销数量。

标准输出只包含目标用户 ID、新版本对应的结果和撤销 Session 数，不输出密码或 Hash。旧密码和旧 Session 必须立即失效；用户可用新密码重新登录并获得新 Session。

## 失败处理

| 情况            | 处理                                             |
| --------------- | ------------------------------------------------ |
| 未找到用户      | 核对用户名 NFKC/大小写或 UUID；不要创建替代账号  |
| 两次密码不一致  | 命令不写库，重新执行                             |
| 非交互式终端    | 切换到可信 TTY；禁止用明文参数规避               |
| 凭证版本冲突    | 表示另一个改密已先完成；重新确认目标状态后再执行 |
| 数据库/事务失败 | 操作整体回滚；检查连接和日志后按新维护事件重试   |

命令没有自动“回滚到旧密码”的功能。需要恢复时，应使用新的原因再次设置一个新密码；不得找回或复用旧明文。

## 审计与验收

本地演练至少验证：

1. 修改前用旧密码建立两个 Session。
2. 执行管理员改密。
3. 两个旧 Session 均返回未认证。
4. 旧密码登录失败，新密码登录成功。
5. 审计事件存在，且请求/结果中没有密码、Hash 或 Session Token。
6. 两个并发改密只允许一个版本提交成功。

自动化证据位于 `apps/server/src/admin/password-set.test.ts` 和 `apps/server/test/auth.integration.test.ts`。最终门禁结果以 [`tasks/current.md`](../../tasks/current.md) 为准。
