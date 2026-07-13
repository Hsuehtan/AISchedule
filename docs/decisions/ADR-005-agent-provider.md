# ADR-005：Agent Provider

- 状态：已批准
- 日期：2026-07-13

## 决策

定义 AgentProvider；P0 默认直连 DeepSeek OpenAI-compatible API。Provider 输出不可信，必须经过 Zod 校验，不能持有业务写权限。

请求通过 pg-boss 异步执行，先持久化结果、再结算积分、最后向客户端开放。
