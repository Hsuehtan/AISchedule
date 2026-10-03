# 系统架构

## 当前形态

P0 采用 Monorepo 和“业务模块化单体 + 私有 Agent 推理服务”。Taro 客户端、NestJS/Fastify 业务服务和 Python/FastAPI 推理服务独立构建；NestJS API 与 pg-boss Worker 共享业务代码和 PostgreSQL，Python 只通过内部 HTTP 提供无状态推理。

T18–T24 已在 Phase 3 分支实现积分、Agent 运行链路、对话、澄清、计划、提案确认和 Smart Inbox。H3 仍未通过；T25 语音、T26 可观测性增强、T27 质量收口及生产部署均不在当前已批准范围内。

```text
Taro H5 / WeChat Mini Program
          |
          | REST /api/v1 + HttpOnly Session
          v
NestJS Modular Monolith
  Users (Identity + Points) | Tasks | Projects | Agent
          |
          +-- Prisma / pg-boss --> PostgreSQL 16
          |
          +-- private HTTP / internal-agent v1
                    v
          Python Agent Service
            Prompt | Model Router | Output Validation
                    |
                    +-- DeepSeek
```

Python 与业务 PostgreSQL 之间没有凭证或网络路径。P0 也没有 Python 算法日志数据库、Collector、远程 Exporter、持久化 Trace/Metrics、Redis、第二套队列或 Python Run 数据库。

## 部署单元

- `apps/client`：Taro H5；后续由平台适配器扩展微信小程序。
- `apps/server`：唯一公开 API、认证、管理员 CLI、积分、业务持久化、pg-boss Worker、Agent 状态机与最终业务写入。
- `apps/agent-service`：Python 3.11/FastAPI 私有推理服务；只拥有 DeepSeek Secret，不拥有业务数据库、Session、积分或管理员凭证。
- PostgreSQL 16：业务事实源、积分账本和 pg-boss 队列存储。
- Caddy：T29 才完成生产级同域静态站点与 `/api` 反向代理。

本地 `compose.yaml` 提供 PostgreSQL 与隔离的 Agent 服务开发拓扑：PostgreSQL 只加入数据库网络，Python 只加入 Agent 私网，二者没有共同网络。它仍不是 T29 的生产部署资产。

## 模块依赖

- `Users` 拥有身份、Session 和积分子域；`AiPointsPort` 是积分补足、预留、结算、释放、退款的唯一业务入口。
- `Projects` 和 `Tasks` 只通过稳定 `userId` 与公开契约协作；数据库组合外键阻止跨用户关系。
- `Agent` 拥有公开 Agent API、会话、消息、Run、候选引用、提案、确认和 Smart Inbox 编排；它不得获得 Prisma Client 或直写积分、Tasks、Projects 表。
- Agent admission 使用平台 `UnitOfWork` 产生不透明 `TransactionScope`，在同一 PostgreSQL 事务中组合每日补足、积分预留、幂等记录、Run 和 pg-boss Job。
- Agent 确认通过 transaction-scoped Tasks/Projects Port 执行业务动作；所有 Mutation 在一个事务中全部成功或全部回滚。
- Python 按版本化 v2 私有契约读取授权上下文与临时引用，并自行选择模型上下文，只返回严格结构化推理结果；它不感知用户 ID、真实业务 ID、余额、成本、预留或业务写入。
- 平台层提供数据库事务、幂等、配置、时钟、内部 HTTP 和队列适配器；业务模块不得把 Repository 当作跨模块接口。

## 两条请求链路

手工任务和项目操作完全留在 NestJS 内，不调用 Python、不扣 Agent 积分。Agent 请求采用异步链路：

```text
Client -> NestJS admission
       -> daily top-up + reserve + Run + idempotency + pg-boss（单事务）
       <- 202 requestId

Worker -> 一次 Python execute -> DeepSeek
       -> NestJS 二次校验并持久化可用结果
       -> 积分结算
Client -> 轮询直到 SUCCEEDED 后读取结果
```

HTTP 2xx 不等于扣分。只有契约有效的结果已由 NestJS 持久化才形成结算义务；`RESULT_PERSISTED` 后只重试结算，不释放积分、不再次调用 Python。

## 客户端边界

- 正式入口由 Session 决定登录、注册或任务首页；H1 `?screen=` 仅保留在隔离 Fixture Gallery。
- 项目筛选使用真实 `projectId`，任务与提案操作使用真实 ID 和版本；浏览器返回优先关闭当前 Sheet。
- Agent Panel 使用真实 Conversation、Message、Run 轮询与 Proposal 状态；关闭浮层不取消请求，Smart Inbox 可恢复处理中或未读结果。
- 消息正文按纯文本展示，不渲染模型 HTML。客户端不能选择能力、价格、Provider 或模型。
- Smart Inbox 是服务端派生视图，不建主表、不调用模型、不扣分；折叠状态只保存在客户端本地。

## 产品与可用性边界

- 项目身份色与任务优先级色分离；优先级只有 HIGH 红、MEDIUM 黄、LOW 绿。
- `scheduledAt`、`deadlineAt`、`reminderAt` 可保存与展示；提醒触发、通知和已读状态尚未实现。
- 语音入口在 T25 前继续显示“暂不可用”，不调用腾讯 ASR、不扣语音积分。
- Python、DeepSeek 或 Agent 能力不可用时，认证及全部手工任务/项目能力仍可用；客户端显示稳定的“智能处理暂不可用”，不泄露内部错误。
- 真实 DeepSeek Smoke 只允许本地环境变量注入 Secret 和合成数据；通过前不能把 Stub 结果视为 Phase 3 完成证明。
- 当前不开放公网、不接入真实用户、不进行生产部署；H3 仍在 T27 后由人类审查。

算法日志持久化、Token/工具调用分析和仪表盘属于 MVP 后候选能力。未来启用前必须重新评审数据最小化、费用、保留和访问策略，且不得成为业务事实源。
