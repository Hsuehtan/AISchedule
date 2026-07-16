# ADR-002：模块化单体

- 状态：已批准；“单一服务端部署制品”部分被 ADR-009 修订
- 日期：2026-07-13

## 决策

服务端使用 NestJS/Fastify 模块化单体，业务模块为 Users、Tasks、Projects、Agent。API 与 Worker 共享代码和部署制品。

2026-07-16 补充：Users、Tasks、Projects、积分、会话、提案和 Agent 业务编排仍保留在该模块化单体中；Agent 的 Prompt、模型调用和结构化推理运行时改由 [`ADR-009`](ADR-009-python-agent-service-boundary.md) 定义的私有 Python 服务承载。Python 服务是 P0 唯一的内部服务例外，不拥有业务数据库或公开客户端 API。

## 结果

P0 不扩展为通用微服务架构，也不引入 Redis、Kubernetes、服务网格或通用事件总线；NestJS 模块通过公开 Service/Contract 协作，Python Agent 通过版本化内部 HTTP 契约协作。
