# ADR-002：模块化单体

- 状态：已批准
- 日期：2026-07-13

## 决策

服务端使用 NestJS/Fastify 模块化单体，业务模块为 Users、Tasks、Projects、Agent。API 与 Worker 共享代码和部署制品。

## 结果

P0 不引入微服务、Redis、Kubernetes或通用事件总线；模块通过公开 Service/Contract 协作。
