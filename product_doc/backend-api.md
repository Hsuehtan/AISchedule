# 后端接口文档（Phase 3 当前分支）

- 文档版本：2.0
- 更新时间：2026-07-17
- 实现范围：T10–T24；H2 已通过，H3 尚未通过
- 接口真源：NestJS Controller、`packages/contracts` Zod Schema、服务端集成测试
- API 前缀：`/api/v1`

本文记录当前服务端已注册的公开接口与私有 Agent 契约。积分没有 C 端余额/修改 HTTP API，由服务端 admission 与管理员 CLI 使用。语音、提醒触发、昵称修改、用户侧改密、手机号验证码登录仍未实现。当前分支未获生产或真实用户授权。

## 1. 环境与基础约定

### 1.1 访问地址

| 环境             | Base URL                        |
| ---------------- | ------------------------------- |
| 本地直连后端     | `http://127.0.0.1:3000/api/v1`  |
| 本地 H5 同源代理 | `http://127.0.0.1:10086/api/v1` |

H5 应使用相对路径 `/api/v1`。Taro 开发服务器只代理 `/api/v1`，不得扩大为 `/api`，否则会拦截 `/api-client.ts` 等开发模块并导致白屏。

### 1.2 数据格式

- 请求和响应正文使用 `application/json`。
- JSON 字段使用 camelCase。
- 枚举使用 UPPER_SNAKE；项目颜色键例外，使用小写字符串。
- 所有业务 ID 都是 UUID。
- 所有时间都是带时区偏移的 ISO 8601 字符串，服务端持久化为 UTC。
- 默认最大请求体为 1 MiB。
- Zod 对象默认采用 strict 校验，未声明字段会导致校验失败。

### 1.3 认证

认证使用服务端签发的不透明 Session Cookie：

```text
Cookie 名：ai_schedule_session
HttpOnly：true
SameSite：Lax
Path：/
Secure：生产环境为 true
默认有效期：30 天绝对有效期，不滑动续期
```

数据库只保存 Session Token 的 SHA-256 Hash。客户端不能也不需要读取 Cookie 内容。

除健康检查、注册、登录、退出和 Session 查询外，业务接口都要求有效 Session。未认证统一返回：

```json
{
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "请先登录",
    "requestId": "req_xxx",
    "details": {}
  }
}
```

### 1.4 Origin 校验

所有非 GET/HEAD/OPTIONS 请求都经过 Origin 校验：

- 浏览器携带 Cookie 发起写请求时必须提供允许的 `Origin`。
- 本地默认允许 `http://127.0.0.1:10086` 和 `http://localhost:10086`。
- 不携带 Cookie 的非浏览器请求可以不提供 Origin。
- Origin 缺失或不允许分别返回 `ORIGIN_REQUIRED`、`ORIGIN_NOT_ALLOWED`。

### 1.5 幂等键

以下写接口必须携带请求头：

```http
Idempotency-Key: <1-128 个字符的调用方唯一值>
```

适用范围：

- Task 创建、编辑、完成、恢复、删除、删除撤销。
- Project 创建、改名、归档。
- Agent turn、计划生成、会话 viewed/回答、Proposal 编辑/dismiss/cancel/confirm、Smart Inbox 整理。

注册、登录和退出不要求 `Idempotency-Key`。

幂等记录默认保留 24 小时。相同 scope 和 key：

- 请求内容相同：返回第一次成功响应快照。
- 请求内容不同：返回 `409 IDEMPOTENCY_KEY_REUSED`。
- 第一次请求仍在处理：返回 `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`。
- 缺失：返回 `428 IDEMPOTENCY_KEY_REQUIRED`。
- 超过 128 个字符：返回 `400 IDEMPOTENCY_KEY_INVALID`。

### 1.6 乐观锁

Task 编辑、完成、恢复、删除，Project 改名/归档，以及 Agent Message 回答、Proposal 编辑/dismiss/cancel/confirm 都要求提交当前对象的 `version`。

成功写入后 `version` 加 1。版本过期时返回：

- Task：`409 TASK_VERSION_CONFLICT`
- Project：`409 PROJECT_VERSION_CONFLICT`
- Agent Message：`409 AGENT_MESSAGE_VERSION_CONFLICT`
- Action Proposal：`409 ACTION_PROPOSAL_VERSION_CONFLICT`

客户端收到 409 时应保留用户草稿，刷新对象后由用户决定是否重试。

## 2. 接口总览

| 模块     | 方法   | 路径                                             | 认证 | 幂等键 | 成功状态 |
| -------- | ------ | ------------------------------------------------ | ---- | ------ | -------- |
| Health   | GET    | `/health/live`                                   | 否   | 否     | 200      |
| Auth     | POST   | `/auth/username/register`                        | 否   | 否     | 201      |
| Auth     | POST   | `/auth/username/login`                           | 否   | 否     | 200      |
| Auth     | POST   | `/auth/logout`                                   | 否   | 否     | 200      |
| Auth     | GET    | `/auth/session`                                  | 否   | 否     | 200      |
| Users    | GET    | `/users/me`                                      | 是   | 否     | 200      |
| Tasks    | POST   | `/tasks`                                         | 是   | 是     | 201      |
| Tasks    | GET    | `/tasks`                                         | 是   | 否     | 200      |
| Tasks    | GET    | `/tasks/:id`                                     | 是   | 否     | 200      |
| Tasks    | PATCH  | `/tasks/:id`                                     | 是   | 是     | 200      |
| Tasks    | POST   | `/tasks/:id/complete`                            | 是   | 是     | 200      |
| Tasks    | POST   | `/tasks/:id/restore`                             | 是   | 是     | 200      |
| Tasks    | DELETE | `/tasks/:id?version=N`                           | 是   | 是     | 200      |
| Undo     | POST   | `/undo-operations/:id/execute`                   | 是   | 是     | 200      |
| Projects | POST   | `/projects`                                      | 是   | 是     | 201      |
| Projects | GET    | `/projects`                                      | 是   | 否     | 200      |
| Projects | PATCH  | `/projects/:id`                                  | 是   | 是     | 200      |
| Projects | POST   | `/projects/:id/archive`                          | 是   | 是     | 200      |
| Agent    | POST   | `/agent/turns`                                   | 是   | 是     | 202      |
| Agent    | POST   | `/agent/plan-generations`                        | 是   | 是     | 202      |
| Agent    | GET    | `/agent/requests/:id`                            | 是   | 否     | 200      |
| Agent    | GET    | `/conversations/:id/messages`                    | 是   | 否     | 200      |
| Agent    | POST   | `/conversations/:id/viewed`                      | 是   | 是     | 200      |
| Agent    | POST   | `/conversations/:id/messages/:messageId/answers` | 是   | 是     | 200/202  |
| Agent    | GET    | `/action-proposals/:id`                          | 是   | 否     | 200      |
| Agent    | PATCH  | `/action-proposals/:id`                          | 是   | 是     | 200      |
| Agent    | POST   | `/action-proposals/:id/dismiss`                  | 是   | 是     | 200      |
| Agent    | POST   | `/action-proposals/:id/cancel`                   | 是   | 是     | 200      |
| Agent    | POST   | `/action-proposals/:id/confirm`                  | 是   | 是     | 200      |
| Agent    | GET    | `/smart-inbox`                                   | 是   | 否     | 200      |
| Agent    | POST   | `/smart-inbox/organize`                          | 是   | 是     | 202      |

## 3. 公共响应模型

### 3.1 PublicUser

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "username": "test_user",
  "nickname": "用户",
  "phone": null,
  "phoneVerified": false,
  "locale": "zh-CN",
  "timezone": "Asia/Shanghai"
}
```

说明：

- `username` 是 P0 过渡登录标识。
- `nickname` 当前固定使用注册默认值“用户”，没有修改接口。
- 注册时选填的手机号只作为未验证 Contact 保存，不能用于登录或找回密码。
- 用户积分、凭证版本、密码 Hash 和 Session 不出现在公共响应中。

### 3.2 Project

```json
{
  "id": "00000000-0000-4000-8000-000000000010",
  "userId": "00000000-0000-4000-8000-000000000001",
  "name": "工作",
  "colorKey": "pink",
  "status": "ACTIVE",
  "archivedAt": null,
  "taskCount": 2,
  "version": 1,
  "createdAt": "2026-07-14T09:00:00.000Z",
  "updatedAt": "2026-07-14T09:00:00.000Z"
}
```

字段约束：

- `name`：trim 后 1–40 个字符。
- `colorKey`：`pink | teal | purple | amber | cyan | slate`，由服务端分配。
- `status`：`ACTIVE | ARCHIVED`。
- `taskCount`：当前项目下未软删除、未完成任务数量，由服务端派生。
- `version`：正整数。

### 3.3 Task

```json
{
  "id": "00000000-0000-4000-8000-000000000020",
  "userId": "00000000-0000-4000-8000-000000000001",
  "projectId": "00000000-0000-4000-8000-000000000010",
  "project": {
    "id": "00000000-0000-4000-8000-000000000010",
    "name": "工作",
    "colorKey": "pink",
    "status": "ACTIVE"
  },
  "title": "写周报",
  "description": "整理本周项目进展",
  "status": "TODO",
  "priority": "MEDIUM",
  "scheduledAt": "2026-07-14T01:30:00.000Z",
  "deadlineAt": "2026-07-14T12:00:00.000Z",
  "reminderAt": null,
  "completedAt": null,
  "deletedAt": null,
  "source": "MANUAL",
  "version": 1,
  "createdAt": "2026-07-14T01:00:00.000Z",
  "updatedAt": "2026-07-14T01:00:00.000Z"
}
```

字段约束：

- `title`：trim 后 1–200 个字符。
- `description`：0–2000 个字符；创建时省略则输出空字符串。
- `status`：`TODO | COMPLETED`。
- `priority`：`LOW | MEDIUM | HIGH`，创建时默认 `MEDIUM`。
- `scheduledAt`、`deadlineAt`、`reminderAt`：ISO 8601 时间或 `null`。
- `source`：`MANUAL | AGENT`；手工接口创建的对象为 `MANUAL`，确认后的 Agent Action 新建对象记录为 `AGENT` 并关联来源 Action。
- `projectId` 为 `null` 时 `project` 必须为 `null`。
- 项目归档后，已有任务仍返回项目摘要，摘要状态为 `ARCHIVED`。

### 3.4 统一错误结构

```json
{
  "error": {
    "code": "TASK_VERSION_CONFLICT",
    "message": "待办已发生变化，请刷新后重试",
    "requestId": "req_xxx",
    "details": {}
  }
}
```

- `code`：稳定、可用于程序分支的 UPPER_SNAKE 字符串。
- `message`：面向用户的中文说明，不应作为程序判断依据。
- `requestId`：服务端生成的公开请求追踪 ID，也会出现在响应头 `x-request-id`。
- `details`：校验错误等附加信息；无附加信息时为空对象。

## 4. Health

### GET `/health/live`

用途：进程存活检查，不校验数据库或外部 Provider。

响应 `200`：

```json
{
  "status": "ok",
  "service": "ai-schedule-server"
}
```

## 5. Auth 与 Users

### 5.1 POST `/auth/username/register`

注册用户名账号，同时创建默认昵称、可选未验证手机号、新用户积分流水和 Session。

请求：

```json
{
  "username": "test_user",
  "password": "<PASSWORD>",
  "phone": "13800138000"
}
```

字段约束：

- `username`：3–32 个中文、英文字母、数字、下划线或短横线；执行 Unicode NFKC、trim 和英文字母小写规范化后做唯一比较。
- `password`：8–128 个 Unicode 字符；不会自动 trim。
- `phone`：可省略；如提供，必须是 11 位中国大陆手机号，`^1[3-9]\\d{9}$`。

响应 `201`：

```json
{
  "user": {
    "id": "00000000-0000-4000-8000-000000000001",
    "username": "test_user",
    "nickname": "用户",
    "phone": "13800138000",
    "phoneVerified": false,
    "locale": "zh-CN",
    "timezone": "Asia/Shanghai"
  }
}
```

同时通过 `Set-Cookie` 写入 Session。

主要错误：

| HTTP | code                      | 含义                                                       |
| ---- | ------------------------- | ---------------------------------------------------------- |
| 409  | `USERNAME_ALREADY_EXISTS` | 规范化后的用户名已存在                                     |
| 422  | `VALIDATION_ERROR`        | 注册输入不合法                                             |
| 429  | `AUTH_RATE_LIMITED`       | 注册频率超限；`details.retryAfterSeconds` 给出建议等待时间 |

限流：单 IP 每小时 10 次；单规范化用户名每小时 5 次。当前为单进程内存限流。

### 5.2 POST `/auth/username/login`

请求：

```json
{
  "username": "test_user",
  "password": "<PASSWORD>"
}
```

响应 `200`：

```json
{
  "user": {
    "id": "00000000-0000-4000-8000-000000000001",
    "username": "test_user",
    "nickname": "用户",
    "phone": null,
    "phoneVerified": false,
    "locale": "zh-CN",
    "timezone": "Asia/Shanghai"
  }
}
```

每次登录成功都会创建一个新 Session，并写入 Cookie。

主要错误：

| HTTP | code                  | 含义                                           |
| ---- | --------------------- | ---------------------------------------------- |
| 401  | `INVALID_CREDENTIALS` | 用户名或密码错误；不存在的用户名也返回同一错误 |
| 422  | `VALIDATION_ERROR`    | 登录输入不合法                                 |
| 429  | `AUTH_RATE_LIMITED`   | 登录频率超限                                   |

限流：单 IP 每 15 分钟 50 次；单规范化用户名每 15 分钟 10 次。

### 5.3 POST `/auth/logout`

撤销当前 Cookie 对应的 Session，并清除 Cookie。没有 Session 时也返回成功。

响应 `200`：

```json
{
  "loggedOut": true
}
```

### 5.4 GET `/auth/session`

有有效 Session 时响应 `200`：

```json
{
  "authenticated": true,
  "user": {
    "id": "00000000-0000-4000-8000-000000000001",
    "username": "test_user",
    "nickname": "用户",
    "phone": null,
    "phoneVerified": false,
    "locale": "zh-CN",
    "timezone": "Asia/Shanghai"
  },
  "expiresAt": "2026-08-13T09:00:00.000Z"
}
```

没有有效 Session 时仍响应 `200`：

```json
{
  "authenticated": false,
  "user": null,
  "expiresAt": null
}
```

### 5.5 GET `/users/me`

要求认证。返回当前用户只读资料。

响应 `200`：

```json
{
  "user": {
    "id": "00000000-0000-4000-8000-000000000001",
    "username": "test_user",
    "nickname": "用户",
    "phone": null,
    "phoneVerified": false,
    "locale": "zh-CN",
    "timezone": "Asia/Shanghai"
  }
}
```

当前没有 `PATCH /users/me/profile`、用户侧改密或找回密码接口。

## 6. Tasks

本节所有接口都要求认证。除列表和详情外，所有 Task 写接口还要求 `Idempotency-Key`。

### 6.1 POST `/tasks`

请求：

```json
{
  "projectId": null,
  "title": "写周报",
  "description": "整理本周项目进展",
  "priority": "HIGH",
  "scheduledAt": "2026-07-14T09:30:00+08:00",
  "deadlineAt": "2026-07-14T20:00:00+08:00",
  "reminderAt": null
}
```

除 `title` 外均可省略。`projectId` 可以为 `null`；非空时必须属于当前用户且项目状态为 `ACTIVE`。

响应 `201`：

```json
{
  "task": { "...": "Task 模型" }
}
```

主要错误：`PROJECT_NOT_FOUND`、`VALIDATION_ERROR` 及通用幂等错误。

### 6.2 GET `/tasks`

查询参数：

| 参数        | 类型                | 默认值 | 说明                                 |
| ----------- | ------------------- | ------ | ------------------------------------ |
| `projectId` | UUID                | 无     | 只返回该项目任务；不会包含无项目任务 |
| `status`    | `TODO \| COMPLETED` | `TODO` | 任务状态                             |
| `cursor`    | UUID                | 无     | 上一页响应的 `nextCursor`            |
| `limit`     | 1–100 整数          | 50     | 每页数量                             |

示例：

```http
GET /api/v1/tasks?status=TODO&limit=20&projectId=<PROJECT_ID>
```

响应 `200`：

```json
{
  "items": [],
  "pageInfo": {
    "nextCursor": null
  },
  "counts": {
    "todo": 0,
    "completed": 0
  }
}
```

`counts` 与当前项目筛选范围一致。`TODO` 当前按计划时间升序、优先级降序、创建时间升序排列；`COMPLETED` 当前按完成时间降序排列。调用方应使用响应顺序，不自行推断游标。

### 6.3 GET `/tasks/:id`

返回当前用户未软删除的单个 Task。

响应 `200`：

```json
{
  "task": { "...": "Task 模型" }
}
```

不存在、属于其他用户或已软删除均返回 `404 TASK_NOT_FOUND`。

### 6.4 PATCH `/tasks/:id`

请求：

```json
{
  "version": 1,
  "changes": {
    "title": "完成周报",
    "projectId": "00000000-0000-4000-8000-000000000010",
    "priority": "MEDIUM",
    "scheduledAt": null,
    "deadlineAt": "2026-07-15T12:00:00+08:00",
    "reminderAt": null
  }
}
```

`changes` 至少包含一个字段。省略字段保持原值；时间或 `projectId` 传 `null` 表示清空。

响应 `200`：

```json
{
  "task": { "...": "更新后的 Task，version 已增加" }
}
```

主要错误：`TASK_NOT_FOUND`、`PROJECT_NOT_FOUND`、`TASK_VERSION_CONFLICT`、`TASK_STATE_CONFLICT`。

### 6.5 POST `/tasks/:id/complete`

请求：

```json
{
  "version": 1
}
```

响应 `200`：`{ "task": { ... } }`。任务变为 `COMPLETED`，写入 `completedAt`，版本加 1。

已完成、已删除、版本过期或不属于当前用户时返回稳定错误。完成操作不会创建 3 秒撤销；长期恢复使用 restore 接口。

### 6.6 POST `/tasks/:id/restore`

请求：

```json
{
  "version": 2
}
```

响应 `200`：`{ "task": { ... } }`。任务恢复为 `TODO`，`completedAt` 变为 `null`，版本加 1。

### 6.7 DELETE `/tasks/:id?version=N`

软删除任务。`version` 通过查询参数传递，必须为正整数。

示例：

```http
DELETE /api/v1/tasks/<TASK_ID>?version=3
Idempotency-Key: <UNIQUE_KEY>
```

响应 `200`：

```json
{
  "task": { "...": "已软删除 Task" },
  "undoOperation": {
    "id": "00000000-0000-4000-8000-000000000030",
    "expiresAt": "2026-07-14T09:00:03.000Z"
  }
}
```

只有软删除会创建 UndoOperation，有效期以服务端 `expiresAt` 为准，固定 3 秒。

### 6.8 POST `/undo-operations/:id/execute`

不接收请求正文。要求新的 `Idempotency-Key`。

响应 `200`：

```json
{
  "task": { "...": "已恢复的 Task" },
  "undoOperation": {
    "id": "00000000-0000-4000-8000-000000000030",
    "status": "EXECUTED",
    "executedAt": "2026-07-14T09:00:02.000Z"
  }
}
```

主要错误：

| HTTP | code                 | 含义                           |
| ---- | -------------------- | ------------------------------ |
| 404  | `UNDO_NOT_FOUND`     | 撤销记录不存在或不属于当前用户 |
| 409  | `UNDO_NOT_AVAILABLE` | 已执行或目标状态不允许再次撤销 |
| 410  | `UNDO_EXPIRED`       | 超过服务端 3 秒窗口            |

## 7. Projects

本节所有接口都要求认证。除列表外，所有 Project 写接口还要求 `Idempotency-Key`。

### 7.1 POST `/projects`

请求：

```json
{
  "name": "工作"
}
```

项目颜色由服务端从 `pink、teal、purple、amber、cyan、slate` 中按当前用户最少使用原则分配，客户端不能指定。

响应 `201`：

```json
{
  "project": { "...": "Project 模型" }
}
```

同一用户的活跃项目名称按 NFKC、trim 和英文字母小写规范化后不可重复；冲突返回 `409 PROJECT_NAME_CONFLICT`。项目归档后可以复用原名称。

### 7.2 GET `/projects`

查询参数：

| 参数     | 类型                 | 默认值   | 说明                      |
| -------- | -------------------- | -------- | ------------------------- |
| `status` | `ACTIVE \| ARCHIVED` | `ACTIVE` | 项目状态                  |
| `cursor` | UUID                 | 无       | 上一页响应的 `nextCursor` |
| `limit`  | 1–100 整数           | 50       | 每页数量                  |

响应 `200`：

```json
{
  "items": [],
  "pageInfo": {
    "nextCursor": null
  }
}
```

当前按创建时间升序排列。每个项目包含派生的 `taskCount`。

### 7.3 PATCH `/projects/:id`

当前只支持改名。

请求：

```json
{
  "version": 1,
  "changes": {
    "name": "核心工作"
  }
}
```

响应 `200`：`{ "project": { ... } }`。

主要错误：`PROJECT_NOT_FOUND`、`PROJECT_NAME_CONFLICT`、`PROJECT_VERSION_CONFLICT`、`PROJECT_STATE_CONFLICT`。

### 7.4 POST `/projects/:id/archive`

请求：

```json
{
  "version": 2
}
```

响应 `200`：`{ "project": { ... } }`。项目变为 `ARCHIVED`，写入 `archivedAt`，版本加 1。

归档不会删除或解除已有任务关系；任务继续返回归档项目摘要。当前没有恢复归档项目接口。

## 8. 错误码汇总

| HTTP | code                              | 典型场景                                   |
| ---- | --------------------------------- | ------------------------------------------ |
| 400  | `VALIDATION_ERROR`                | Task、Project、路径或查询参数不合法        |
| 400  | `IDEMPOTENCY_KEY_INVALID`         | 幂等键超过 128 个字符                      |
| 401  | `UNAUTHENTICATED`                 | Session 缺失、过期、撤销或凭证版本失效     |
| 401  | `INVALID_CREDENTIALS`             | 用户名或密码错误                           |
| 403  | `ORIGIN_REQUIRED`                 | 携带 Cookie 的写请求没有 Origin            |
| 403  | `ORIGIN_NOT_ALLOWED`              | Origin 不在允许列表                        |
| 404  | `TASK_NOT_FOUND`                  | Task 不存在、已删除或不属于当前用户        |
| 404  | `PROJECT_NOT_FOUND`               | Project 不存在、不可用或不属于当前用户     |
| 404  | `UNDO_NOT_FOUND`                  | UndoOperation 不存在或不属于当前用户       |
| 409  | `USERNAME_ALREADY_EXISTS`         | 规范化用户名冲突                           |
| 409  | `TASK_VERSION_CONFLICT`           | Task 乐观锁冲突                            |
| 409  | `TASK_STATE_CONFLICT`             | Task 当前状态不允许操作                    |
| 409  | `PROJECT_NAME_CONFLICT`           | 活跃项目重名                               |
| 409  | `PROJECT_VERSION_CONFLICT`        | Project 乐观锁冲突                         |
| 409  | `PROJECT_STATE_CONFLICT`          | Project 当前状态不允许操作                 |
| 409  | `UNDO_NOT_AVAILABLE`              | Undo 已执行或不可执行                      |
| 409  | `IDEMPOTENCY_KEY_REUSED`          | 相同 key 用于不同请求                      |
| 409  | `IDEMPOTENCY_REQUEST_IN_PROGRESS` | 相同请求仍在处理中                         |
| 410  | `UNDO_EXPIRED`                    | 删除撤销超过 3 秒                          |
| 422  | `VALIDATION_ERROR`                | 注册或登录输入不合法                       |
| 428  | `IDEMPOTENCY_KEY_REQUIRED`        | 业务写接口缺少幂等键                       |
| 429  | `AUTH_RATE_LIMITED`               | 注册或登录限流                             |
| 500  | `INTERNAL_ERROR`                  | 未处理的服务端异常；不向客户端暴露内部细节 |

## 9. 本地调用示例

以下命令使用后端直连地址。占位符需要由调用方替换；不要把真实密码、Cookie 或 Secret 写入仓库和日志。

```bash
export API_BASE=http://127.0.0.1:3000/api/v1
export H5_ORIGIN=http://127.0.0.1:10086
export COOKIE_JAR=/tmp/ai-schedule-cookie.txt
```

注册并保存 Cookie：

```bash
curl -i -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -H "Origin: $H5_ORIGIN" \
  -d '{"username":"test_user","password":"<PASSWORD>"}' \
  "$API_BASE/auth/username/register"
```

读取当前 Session：

```bash
curl -i -b "$COOKIE_JAR" "$API_BASE/auth/session"
```

创建项目：

```bash
curl -i -b "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -H "Origin: $H5_ORIGIN" \
  -H "Idempotency-Key: project-$(date +%s)" \
  -d '{"name":"工作"}' \
  "$API_BASE/projects"
```

创建无项目待办：

```bash
curl -i -b "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -H "Origin: $H5_ORIGIN" \
  -H "Idempotency-Key: task-$(date +%s)" \
  -d '{"title":"写周报","priority":"MEDIUM"}' \
  "$API_BASE/tasks"
```

## 10. Agent

本节接口全部要求认证。除读取请求、消息、Proposal 和 Smart Inbox 外，所有写接口都要求 `Idempotency-Key`。客户端不能选择 capability、成本、Provider、模型或 Prompt。

### 10.1 POST `/agent/turns`

创建普通文本请求。`conversationId` 省略时创建新会话；对话内继续输入时提交已有会话 ID。

```json
{
  "conversationId": "00000000-0000-4000-8000-000000000100",
  "input": {
    "mode": "TEXT",
    "text": "把下周发布前的工作拆一下",
    "replyTo": {
      "messageId": "00000000-0000-4000-8000-000000000101",
      "version": 1
    }
  }
}
```

`text` trim 后 1–500 字；`replyTo` 可省略。普通请求固定绑定 `agent.standardTurn`，当前成本 1 点。

成功返回 `202`：

```json
{
  "requestId": "00000000-0000-4000-8000-000000000110",
  "conversationId": "00000000-0000-4000-8000-000000000100",
  "status": "QUEUED",
  "pollAfterMs": 1000
}
```

Admission 在同一事务完成当日懒补足、积分预留、幂等记录、Run 和 pg-boss Job。只有调用前的有效预留，不会因 HTTP 202 立即扣分。

### 10.2 POST `/agent/plan-generations`

从已交付的 Message 或现有 Proposal 发起计划生成/重做：

```json
{
  "source": {
    "type": "MESSAGE",
    "messageId": "00000000-0000-4000-8000-000000000101",
    "version": 1
  },
  "instruction": "拆成五个可执行步骤"
}
```

`source.type` 也可以是 `PROPOSAL`，此时提交 `proposalId + version`。`instruction` 可省略，存在时为 1–500 字。请求固定绑定 `agent.planGeneration`，当前成本 2 点，返回与 turn 相同的 `202` 排队结构。

计划采用二阶段计费：此前普通理解/澄清的 1 点和本次明确计划生成的 2 点是两个独立 Run。PLAN 保存为 `CREATE_PROJECT_TASKS` Proposal，不建立独立 Plan 对象。

### 10.3 GET `/agent/requests/:id`

轮询状态：

```text
QUEUED | RUNNING | RESULT_PERSISTED | SETTLING | SUCCEEDED | FAILED | RELEASED
```

非终态只返回 `requestId`、`conversationId`、`status`、`pollAfterMs`。只有 `SUCCEEDED` 才返回可消费的 `result` 与 `completedAt`：

```text
REPLY | CLARIFICATION | CANDIDATES | PLAN | ACTION_PROPOSAL
```

`FAILED/RELEASED` 返回稳定 `failure: { code, message, canRetry }`，不包含 Python/DeepSeek 原始错误。HTTP 2xx、Provider 已计费或 Python 返回正文均不等同于产品成功；结果必须经 NestJS 二次校验、持久化并完成积分结算。

### 10.4 GET `/conversations/:id/messages`

查询参数：`cursor` 为 Message UUID，`limit` 默认 50、范围 1–100。响应：

```json
{
  "items": [],
  "pageInfo": { "nextCursor": null }
}
```

Message 类型是 `USER_INPUT | AI_REPLY | QUESTION | ACTION_CONFIRM`。QUESTION 进一步区分 `CLARIFICATION | CANDIDATES`，包含服务端生成的 optionId、是否允许自由文本与下一步类型。正文始终作为纯文本返回，不提供模型 HTML。

P0 没有完整历史会话列表，只能读取已知、属于当前用户的 Conversation。

### 10.5 POST `/conversations/:id/viewed`

```json
{
  "lastViewedMessageId": "00000000-0000-4000-8000-000000000101"
}
```

记录当前会话最后查看消息，用于 Smart Inbox 的未读回复派生。成功返回 `lastViewedMessageId + viewedAt`。

### 10.6 POST `/conversations/:id/messages/:messageId/answers`

选项回答：

```json
{
  "version": 1,
  "answer": {
    "type": "OPTION",
    "optionId": "opt_abc123"
  }
}
```

补充文本：

```json
{
  "version": 1,
  "answer": {
    "type": "TEXT",
    "text": "是工作项目里的发布任务"
  }
}
```

客户端只能提交服务端 optionId，不能提交真实 Task/Project ID。NestJS 重新校验消息版本、当前用户归属和候选目标版本。确定性推进返回 `200 { outcome: "DETERMINISTIC", message, proposal }`，不调用模型、不扣分；需要继续推理时返回 `202 { outcome: "QUEUED", request }` 并创建新的积分预留。

### 10.7 Action Proposal

读取：

```http
GET /api/v1/action-proposals/<PROPOSAL_ID>
```

状态：

```text
DRAFT | AWAITING_CONFIRMATION | SUPERSEDED | CANCELLED
EXECUTING | EXECUTED | FAILED | EXPIRED
```

Action：

```text
CREATE_TASK | CREATE_PROJECT_TASKS | ORGANIZE_TASKS | UPDATE_TASK
COMPLETE_TASK | RESTORE_TASK | DELETE_TASK
```

所有包含 Proposal 的响应均提供 `proposal.presentation: "PLAN" | "ACTION"`。它由关联 Run 的实际生成结果类型决定：专门计划生成的 `PLAN` 使用计划草稿浮层，`ACTION_PROPOSAL` 使用对话内确认卡；不能根据 `actionCode` 推断。历史 Proposal 的分类从其关联 Run 读取，不要求数据迁移。

编辑使用 `PATCH /action-proposals/:id`，请求为 `{ version, command }`。严格白名单命令：

- `SET_PROJECT`
- `UPDATE_TASK_DRAFT`
- `REMOVE_MUTATION`
- `REMOVE_FIELD_SUGGESTION`

计划草稿允许本地修改项目、标题、描述、优先级、三个时间字段和删除计划项；这些编辑不调用模型、不扣分。

关闭但保留：

```http
POST /api/v1/action-proposals/<ID>/dismiss
Content-Type: application/json
Idempotency-Key: <UNIQUE_KEY>

{ "version": 1 }
```

`dismiss` 校验请求中的当前版本，但只更新 `lastDismissedAt`，不改变待确认状态、不递增 Proposal 业务版本；`cancel` 才将 Proposal 明确取消并推进版本。待确认和执行失败草稿统一在 7 天后惰性过期；过期重生成在积分预留和模型调用前拒绝。重新生成允许以版本匹配且未过期的待确认或执行失败草稿为来源；新草稿成功持久化后才 supersede 旧草稿，保留旧执行记录。失败执行不能通过重复确认再次写入，应确认重新生成的新提案。

确认：

```http
POST /api/v1/action-proposals/<ID>/confirm
Content-Type: application/json
Idempotency-Key: <UNIQUE_KEY>

{ "version": 2 }
```

确认重新校验用户归属、Proposal/Task/Project 版本、项目状态与名称唯一性，并在一个事务执行全部 Mutation。一个 Proposal 最多一个 ActionExecution；重复确认返回同一结果。成功响应 outcome 为 `EXECUTED`；业务冲突响应 outcome 为 `FAILED` 并使用稳定 Action 错误码。确认、取消、编辑和最终业务写入都不再扣积分。

创建、完成和恢复不提供短时撤销；软删除可以在 execution result 中返回一个 3 秒批量 UndoOperation。

### 10.8 GET `/smart-inbox`

可选查询参数 `projectId`。响应只有一个当前优先项：

```json
{
  "item": {
    "kind": "AWAITING_CONFIRMATION",
    "title": "还有计划等待确认",
    "body": "查看并确认后才会创建待办",
    "action": {
      "type": "RESUME_CONVERSATION",
      "conversationId": "00000000-0000-4000-8000-000000000100",
      "messageId": null,
      "proposalId": "00000000-0000-4000-8000-000000000120",
      "requestId": null
    }
  }
}
```

`kind` 固定优先级：

```text
AWAITING_CONFIRMATION -> AWAITING_CLARIFICATION -> PROCESSING
-> EXECUTION_FAILED -> UNREAD_REPLY -> ORGANIZE_TASKS
-> CURRENT_SCOPE / EMPTY_SCOPE -> DEFAULT
```

前五类是账户全局状态，不受项目筛选隐藏。执行失败入口只由 Proposal 当前 `FAILED` 状态派生；已替代、取消、执行、过期的 Proposal 即使保留历史失败 execution 也不再置顶。Smart Inbox 只查询已持久化业务状态，不建主表、不调用 Python、不扣分；Provider 故障时仍可恢复已有结果。

### 10.9 POST `/smart-inbox/organize`

```json
{
  "scope": { "type": "ALL" }
}
```

`scope` 也可以是 `{ "type": "PROJECT", "projectId": "UUID" }`，用于保留界面上下文；整理候选始终是当前用户最多 20 个无项目、未完成、未删除 Task。没有候选时在 admission 前拒绝，不预留积分。

存在候选时按 `agent.standardTurn` 预留 1 点并返回 202。模型只生成 `ORGANIZE_TASKS` Proposal，最终写入仍需用户确认。

### 10.10 Agent 错误与积分展示

常见公开错误：

| HTTP | code                                                        | 含义                                     |
| ---- | ----------------------------------------------------------- | ---------------------------------------- |
| 404  | `AGENT_REQUEST_NOT_FOUND`                                   | Run、会话作用域或相关对象不可见          |
| 404  | `ACTION_PROPOSAL_NOT_FOUND`                                 | Proposal 不存在或不属于当前用户          |
| 409  | `AGENT_REQUEST_CONFLICT`                                    | Run/回答当前状态冲突                     |
| 409  | `AGENT_MESSAGE_VERSION_CONFLICT`                            | QUESTION 已被回答或版本过期              |
| 409  | `ACTION_PROPOSAL_VERSION_CONFLICT`                          | Proposal 版本过期                        |
| 409  | `ACTION_PROPOSAL_NOT_EXECUTABLE`                            | Proposal 当前状态不能确认                |
| 409  | `ACTION_TARGET_VERSION_CONFLICT`                            | Task/Project 已变化                      |
| 429  | `AGENT_DAILY_QUOTA_EXHAUSTED` / `AGENT_POINTS_INSUFFICIENT` | 当日可用额度不足                         |
| 503  | `AGENT_CAPABILITY_DISABLED` / `AGENT_SERVICE_UNAVAILABLE`   | 能力停用、Python/Provider/内部服务不可用 |

客户端不显示积分数字、模型、Token、成本或充值入口。额度确实耗尽显示“明天可继续”；能力停用、Provider 故障和内部异常显示“智能处理暂不可用”。

## 11. Python Agent 私有接口

以下接口不带 `/api/v1` 前缀，不通过 H5/Caddy/公网暴露：

```text
POST /internal/v2/agent/execute
POST /internal/v2/agent/context/read # NestJS 私有读接口
POST /internal/v1/agent/execute # 兼容
GET  /internal/health/live
GET  /internal/health/ready
```

新 Run 的唯一规范工件是 `packages/contracts/internal-agent/v2/openapi.yaml`，v1 保留兼容。v2 execute 请求只包含 Run UUID、契约版本、能力、截止时间、locale/timezone、允许结果类型；Python 使用独立凭证向 NestJS `/internal/v2/agent/context/read` 按需分页读取来源、历史和候选，并自行决定模型上下文。候选只导出临时 candidateRef；禁止包含用户 ID、真实业务 ID、Session、余额、成本、reservation 或 Provider 选择。

成功响应返回实际使用的 Provider、模型、Prompt、Provider Schema 版本和结构修复次数，但不返回 `billable`。NestJS 必须再次校验结果、临时引用、用户归属、目标版本和业务上限。

内部服务使用至少 256-bit Bearer Token、常量时间比较、256 KiB 请求上限和默认并发 4。健康检查不调用 DeepSeek。Node 不自动重试 execute；Python 只在收到非空但结构非法内容时，在同一 execute 内最多结构修复一次。

Python 没有数据库、Session 或积分凭证，不持久化 Run、会话、模型/工具日志、Token usage 或 Trace。DeepSeek Secret 只进入 Python。本地真实 Smoke 使用 `pnpm smoke:deepseek`，不属于默认 CI，只允许合成数据，输出不得包含 Prompt、正文或 Secret。

## 12. 当前明确未提供的接口

- 语音上传、腾讯 ASR 与 `/voice/transcriptions`（T25）。
- `reminderAt` 到期调度、站内通知、Push 和提醒已读状态。
- 完整历史会话列表。
- C 端积分余额/修改、昵称修改、修改密码和找回密码。
- 手机号验证码注册、登录和绑定。
- 项目取消归档。
- Python Run 查询/回放、Callback、算法日志上传/查询和 Token usage API。
- 生产公网入口；H3/H4 均未通过。

管理员改密与积分 add/subtract/set/history 通过本地 CLI 提供，不属于 HTTP API；见 `docs/runbooks/admin-cli.md`。
