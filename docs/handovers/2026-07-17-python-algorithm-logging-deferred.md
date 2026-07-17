# Python 算法日志持久化延期接管快照

- 日期：2026-07-17
- 范围：MVP 架构与计划收缩，不含代码实现
- 当前门禁：H2 未通过，禁止开始 T18
- 决策：[`ADR-011`](../decisions/ADR-011-defer-agent-log-persistence.md)

## 最新结论

1. MVP 不持久化 Python 模型调用、工具调用、Token usage、延迟、Trace、Metrics 或其他算法运行日志。
2. 不建设日志数据库、对象存储、远程 Exporter、OTLP/Collector、持久队列、保留/查询/导出能力或算法仪表盘。
3. Python 只输出不落库的最小结构化 JSON 到 stdout/stderr；MVP 不提供产品级保留或查询能力，日志不可查询或随进程退出丢失是允许行为。
4. stdout/stderr 日志缺失、异常或显示 success 都不能改变 NestJS 的响应、dispatch、Run、积分、幂等和恢复判断。
5. NestJS 继续持久化 AgentRequestRun、最终 resolved 版本、可用结果、积分和 AgentEvaluationEvent；这些是产品业务审计，不是 Python 算法日志。
6. 2026-07-17 早先快照中的 Collector、14/90 天保留和 T26 独立遥测后端计划已被本决策取代；旧快照只保留历史，不再指导 MVP 实施。

## T19/T26 新范围

- T19.1：跨语言 execute 契约和无 Run/回调/日志 API 负向契约。
- T19.2：FastAPI 安全骨架、稳定 requestId、最小结构化 stdout、字段白名单和 logger 故障隔离。
- T19.3：Provider/结构修复能力，以及 execute 成功/失败和结构修复的最小运行事件；不采集 Token/工具明细。
- T26.1：NestJS AgentEvaluationEvent 与业务审计完整性。
- T26.2：日志脱敏、生产级别、无持久化依赖的负向验收。
- T26.3：Provider、Run、结算和迟到响应故障恢复；只依据 NestJS/PostgreSQL/pg-boss。

## 明确不在 MVP

- Python 算法日志持久化和检索。
- OTLP、Collector、Trace/Metrics 后端、Dashboard、SLO/Alert。
- 模型/工具调用明细、Token 成本统计、算法 A/B 实验和离线关联。
- 任何以日志证明 dispatch、结果交付、积分或恢复的逻辑。

未来确有需要时，必须重新立 ADR、任务和人工门禁，并重新确定数据最小化、费用、抽样、访问、保留和删除策略。

## 唯一下一步

等待人类完成 H2 审查并明确回复“通过”。通过后仍从 T18.1 积分配置与能力注册开始，不因本次文档调整提前创建 Python 服务。
