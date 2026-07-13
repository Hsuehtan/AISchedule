# 系统架构

## 形态

P0 采用 pnpm Monorepo 和模块化单体：Taro 客户端与 NestJS/Fastify 服务端独立构建，服务端 API 与 pg-boss Worker 共享部署制品，PostgreSQL 是唯一持久化与任务队列依赖。

```text
Taro H5 / WeChat Mini Program
          |
          | REST /api/v1 + HttpOnly Session
          v
NestJS Modular Monolith
  Users | Tasks | Projects | Agent
          |
          +-- Prisma --> PostgreSQL 16
          +-- pg-boss -> PostgreSQL 16
          +-- AgentProvider -> DeepSeek
          +-- SpeechProvider -> Tencent ASR
```

## 部署单元

- `apps/client`：H5 静态产物，后续增加微信小程序产物。
- `apps/server`：HTTP API、后台任务处理和管理员 CLI 入口。
- Caddy：同域提供 H5，并反向代理 `/api`。
- PostgreSQL：使用云厂商托管实例；本地通过 Docker。

P0 不引入微服务、Redis、Kubernetes、消息总线或独立搜索服务。

## 模块依赖

- `Users` 不依赖业务模块。
- `Projects` 只依赖 `Users` 的稳定 `userId` 契约。
- `Tasks` 依赖 `Users` 和 `Projects` 的公开查询契约。
- `Agent` 通过公开 Service 调用前三个模块，不直接访问其 Repository。
- 平台层向所有模块提供数据库事务、幂等、日志、配置和时钟。

## 客户端边界

- 页面容器处理路由、Fixture/API Adapter 和服务端状态。
- `packages/ui` 只包含无业务请求的视觉组件和 Token。
- 浏览器/小程序差异通过 `platform` Adapter 隔离。
- URL/页面状态用于筛选；短暂 Sheet/Toast 状态保留在页面本地。

## 可用性

- DeepSeek、ASR 或积分网关不可用时，认证、手工任务和项目仍可用。
- Agent 请求异步处理，客户端按 `requestId` 轮询。
- 所有跨边界输入和 Provider 输出使用 Zod 校验。
