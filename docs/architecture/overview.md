# 系统架构

## 形态

P0 采用 Monorepo 和“业务模块化单体 + 私有 Agent 推理服务”：Taro 客户端与 NestJS/Fastify 业务服务独立构建，NestJS API 与 pg-boss Worker 共享业务代码和 PostgreSQL；Python Agent 服务通过内部 HTTP 提供业务/执行状态无状态的模型推理，并可向独立可观测性数据面发射非权威算法遥测。

当前 H2 只启用 Users、Tasks、Projects 和平台基础能力；Python Agent、Agent/pg-boss 业务 Worker、DeepSeek、腾讯 ASR 和提醒触发仍未接入。下图包含完整 P0 目标形态，不表示所有连线已经上线。

```text
Taro H5 / WeChat Mini Program
          |
          | REST /api/v1 + HttpOnly Session
          v
NestJS Modular Monolith
  Users (Identity + Points) | Tasks | Projects | Agent Orchestration
          |
          +-- Prisma --> PostgreSQL 16
          +-- pg-boss -> PostgreSQL 16
          +-- SpeechProvider -> Tencent ASR
          |
          +-- private HTTP / internal contract
                    v
          Python Agent Service
            Prompt | Model Router | Output Validation
                    |
                    +-- DeepSeek
                    |
                    +-- OTLP / structured events
                              v
                    Observability Collector / Telemetry Store
                    (logs, metrics, traces only)
```

Python 与业务 PostgreSQL 之间没有连接。可观测性后端不保存 AgentRequestRun、结果、积分、幂等或恢复状态，也不能作为业务判断依据。

## 部署单元

- `apps/client`：H5 静态产物，后续增加微信小程序产物。
- `apps/server`：NestJS HTTP API、管理员 CLI，以及后续 pg-boss Worker；拥有全部业务状态，H2 未运行 Agent Worker。
- `apps/agent-service`：Phase 3 计划新增的私有 Python/FastAPI 推理服务；无客户端入口、无业务数据库凭证或网络路径，H2 尚不存在该运行时。
- Observability Collector/Telemetry Store：T26 目标能力；独立凭证和保留策略，只接收算法 Logs/Metrics/Traces，不属于 Prisma 业务模型。
- Caddy：同域提供 H5，并反向代理 `/api`。
- PostgreSQL：使用云厂商托管实例；本地通过 Docker。

P0 不扩展为通用微服务架构，也不引入 Redis、Kubernetes、服务网格、第二套任务队列、Python 业务/Run 数据库或搜索服务。两个服务保持同一仓库、同一发布版本和 Compose 入口。独立遥测后端是旁路平台能力，不改变这一服务边界；当前根 `compose.yaml` 只启动本地 PostgreSQL 开发依赖，不是 T29 生产部署资产。

## 模块依赖

- `Users` 不依赖业务模块。
- 积分是 `Users` 内部子域；它通过公开 `AiPointsPort` 提供补足、预留、结算、释放和退款，其他模块不得直写积分表。
- `Projects` 只依赖 `Users` 的稳定 `userId` 契约。
- `Tasks` 依赖 `Users` 和 `Projects` 的公开查询契约。
- NestJS `Agent` 应用模块通过公开 Service/Port 调用前三个模块，不跨模块直接访问 Repository；它拥有公开 Agent API、积分调用编排、请求状态、会话、提案和确认流程，但积分账本与状态迁移仍归 `Users/AiPointsPort`。
- Python Agent 只通过版本化内部契约接收最小上下文并返回结构化推理结果；它不访问 Users/Tasks/Projects Repository、业务 PostgreSQL 或积分。它只向独立可观测性数据面追加白名单遥测，且不读取该数据面。
- 平台层向所有模块提供数据库事务、幂等、日志、配置和时钟。跨模块原子流程使用 `UnitOfWork` 生成不透明 `TransactionScope`；各模块的 transaction-scoped Port/Repository 在同一作用域内执行，但不得暴露或跨模块传递 Prisma Repository。

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

- DeepSeek、Python Agent、ASR 或完整积分网关尚未接入时，认证、手工任务和项目仍可用。
- T19 以后公开 Agent 请求才采用异步处理和 `requestId` 轮询；NestJS Worker 对 Python 执行一次有界同步调用。H2 没有该运行时链路。
- 公开 API 输入使用 Zod 校验；Node/Python 内部边界以版本化 OpenAPI 3.1 / JSON Schema 为真源，分别由 Zod 和 Pydantic 校验。
- DeepSeek Secret 只进入 Python Agent 服务；Session、积分预留和数据库凭证不得越过内部服务边界。
- 遥测 Sink 不可用不得阻塞 execute、改变 Python readiness、触发第二次 dispatch，或影响 NestJS 的结果持久化和积分终态。
