# API 契约

Base URL：`/api/v1`。JSON 字段使用 camelCase，枚举使用 UPPER_SNAKE。写接口要求 `Idempotency-Key`，版本化写入要求 `version`。

## 统一错误

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

错误映射：400 输入格式、401 未认证、403 越权、404 不存在、409 幂等/版本/唯一冲突、422 语义校验、429 限流或额度、5xx 服务端/Provider。

## Users

```text
POST  /auth/username/register
POST  /auth/username/login
POST  /auth/logout
GET   /auth/session
GET   /users/me
PATCH /users/me/profile
```

注册：`{ username, password, phone? }`。Profile Patch 仅接受 `{ nickname }`。P0 不提供用户侧密码接口。

## Tasks

```text
GET    /tasks?projectId&status&cursor&limit
POST   /tasks
GET    /tasks/:id
PATCH  /tasks/:id
DELETE /tasks/:id
POST   /tasks/:id/complete
POST   /tasks/:id/restore
POST   /undo-operations/:id/execute
```

DELETE 为幂等软删除，并返回 UndoOperation 与 `expiresAt`。

## Projects

```text
GET   /projects?status&cursor&limit
POST  /projects
PATCH /projects/:id
POST  /projects/:id/archive
```

## Agent 与语音

```text
POST  /agent/turns
GET   /agent/requests/:id
GET   /conversations/:id/messages?cursor&limit
PATCH /action-proposals/:id
POST  /action-proposals/:id/confirm
POST  /action-proposals/:id/dismiss
GET   /smart-inbox
POST  /voice/transcriptions
```

Agent/语音请求成功入队返回 202。结果只有在持久化并完成积分结算后才返回 `SUCCEEDED`。

## 认证 Cookie

H5 使用同域 HttpOnly、Secure、SameSite=Lax 的不透明 Session Cookie。数据库仅保存 Token Hash；客户端不访问 Token。
