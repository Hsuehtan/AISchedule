# ADR-005：Agent Provider

- 状态：已被 ADR-009 取代
- 日期：2026-07-13

## 决策

定义 AgentProvider；P0 默认直连 DeepSeek OpenAI-compatible API。Provider 输出不可信，必须经过 Zod 校验，不能持有业务写权限。

请求通过 pg-boss 异步执行，先持久化结果、再结算积分、最后向客户端开放。

T05 已验证 DeepSeek V4 JSON Output Adapter 与 pg-boss 12 PostgreSQL 持久化边界；证据见 [`../architecture/provider-feasibility.md`](../architecture/provider-feasibility.md)。

2026-07-16 起不再由 NestJS 进程内 Provider 直连 DeepSeek。历史验证仍用于说明 Provider 输出校验和队列持久化风险；新的 Python 推理运行时、内部 HTTP 与积分边界见 [`ADR-009`](ADR-009-python-agent-service-boundary.md)。

实施状态：T19 已创建 `apps/agent-service` 和版本化内部契约。NestJS 只依赖 `AgentRuntimePort`，DeepSeek Secret、Prompt、模型路由与一次结构修复均位于 Python；本 ADR 的 Node 进程内 Provider 形态不得重新引入。
