# 系统架构

## 形态

P0 采用 pnpm Monorepo 和模块化单体：Taro 客户端与 NestJS/Fastify 服务端独立构建，服务端 API 与 pg-boss Worker 共享部署制品，PostgreSQL 是唯一持久化与任务队列依赖。

当前 H2 只启用 Users、Tasks、Projects 和平台基础能力；Agent/pg-boss 业务 Worker、DeepSeek、腾讯 ASR 和提醒触发仍未接入。下图包含完整 P0 目标形态，不表示所有连线已经上线。

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
- `apps/server`：HTTP API、管理员 CLI，以及后续后台任务入口；H2 未运行 Agent Worker。
- Caddy：同域提供 H5，并反向代理 `/api`。
- PostgreSQL：使用云厂商托管实例；本地通过 Docker。

P0 不引入微服务、Redis、Kubernetes、消息总线或独立搜索服务。根 `compose.yaml` 只启动本地 PostgreSQL 开发依赖，不是 T29 生产部署资产。

## 模块依赖

- `Users` 不依赖业务模块。
- `Projects` 只依赖 `Users` 的稳定 `userId` 契约。
- `Tasks` 依赖 `Users` 和 `Projects` 的公开查询契约。
- `Agent` 通过公开 Service 调用前三个模块，不直接访问其 Repository。
- 平台层向所有模块提供数据库事务、幂等、日志、配置和时钟。

## 客户端边界

- 页面容器处理正式路由、API Adapter 和服务端状态；Fixture 只存在于隔离 Gallery。
- `packages/ui` 只包含无业务请求的视觉组件和 Token。
- 浏览器/小程序差异通过 `platform` Adapter 隔离。
- 真实页面用于 Login/Register/Task Home；账户级筛选和短暂 Sheet/Toast 状态由根 App State 持有，并在 logout/401 时整体清空。
- H1 的 `?screen=` 只保留为隔离的视觉 Fixture Gallery，不得作为正式产品导航。
- 正式入口由 Session 状态决定登录/注册/任务首页；项目筛选使用真实 `projectId`，任务编辑使用真实 `taskId`，浏览器返回优先关闭当前 Sheet。

## Phase 2 展示语义

- 任务左侧项目标签和项目筛选 Chip 来自同一 Project；归档项目任务在“全部”中仍展示原项目名称和身份色。
- 项目身份色只区分项目。任务右侧优先级只使用 HIGH 红、MEDIUM 黄、LOW 绿，新任务默认 MEDIUM。
- `scheduledAt`、`deadlineAt`、`reminderAt` 分别保存和展示；Phase 2 不启动到期调度或站内通知。
- Smart Inbox、文字 Agent 和语音入口在 H2 显示明确不可用状态，不执行 Fixture、模型或 ASR 请求。

## 可用性

- DeepSeek、ASR 或完整积分网关尚未接入时，认证、手工任务和项目仍可用。
- T19 以后 Agent 请求才采用异步处理和 `requestId` 轮询；H2 没有该运行时链路。
- 所有跨边界输入和 Provider 输出使用 Zod 校验。
