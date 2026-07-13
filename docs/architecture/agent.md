# Agent 架构

## 能力

- `agent.standardTurn`：普通回复、澄清和动作提案，默认 1 点。
- `agent.planGeneration`：计划拆解，默认 2 点。
- `speech.transcription`：语音转写，默认 1 点。

实际成本由 `config/product/points.yaml` 决定。内部重试不重复扣分。

## 请求状态机

```text
QUEUED -> RUNNING -> RESULT_PERSISTED -> SETTLING -> SUCCEEDED
             |               |               |
             +------------> FAILED --------> RELEASED
```

入队事务同时创建请求、积分预留和 pg-boss Job。可用结果先持久化，再结算积分；结算重试不能再次调用模型。

## Provider

`AgentProvider` 接受版本化请求并返回未经信任的结构化结果。P0 实现 DeepSeek Provider：普通能力默认 `deepseek-v4-flash`，计划默认 `deepseek-v4-pro`。模型名、Base URL、超时、Prompt 和 Schema 版本不写死在业务 Service。

`SpeechProvider` 接受短音频并返回转写文本。P0 使用腾讯云一句话识别；原始音频不持久化。

## 写入边界

1. Provider 输出通过 Zod Schema。
2. 服务端根据当前用户数据解析目标候选，模型不能生成可信 ID。
3. 写操作生成 ActionProposal，不修改业务数据。
4. 用户确认时校验归属、版本和幂等键。
5. ActionMutation 在事务中原子执行。
6. ActionExecution 和评估事件记录实际结果。

手工 CRUD 不经过 Agent 确认。
