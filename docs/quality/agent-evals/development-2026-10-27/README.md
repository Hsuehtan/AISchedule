# 开发过程评测证据

这里保留开发轮次、失败和单例诊断。最终验收使用上级目录的 Runtime v5 三轮、固定时钟基线、v5 比较报告及三个 v5 时区报告。旧 HTTP 402 工件在上级既有历史文件中保留。

- 恢复后的旧 Prompt 三轮 355/360，澄清类 26/30，未达到分类门槛。
- v2 三轮 359/360 后，补充时区场景仍发现下周五与 DST 错误，未据此收口。
- v3 早期时区夹具把 IANA 时区退化为固定偏移；这些输入有测试夹具错误。修复后 v3 的 IANA 三时区共 15/15。
- v3 三轮 355/360；预算失败暴露实际请求仍声明第三次读取工具，补测又发现不同输出类型会分别获得修复机会。v4 在实际调用边界统一限制。
- v4 三轮 357/360；失败边界补测发现框架默认重试空响应，v5 增加立即终止保护。
- 所有诊断和开发轮次只保存元数据，没有用单例重试替换完整三轮中的失败。

| 文件 | 通过/计分数 | 失败分类 |
| --- | ---: | --- |
| [pydantic-agent-recovered-3-rounds.json](pydantic-agent-recovered-3-rounds.json) | 355/360 | SEMANTIC: 5 |
| [pydantic-agent-v2-comparison.json](pydantic-agent-v2-comparison.json) | 诊断/比较元数据 | 见文件 |
| [pydantic-agent-v2-fixed-clock-3-rounds.json](pydantic-agent-v2-fixed-clock-3-rounds.json) | 359/360 | PROVIDER_OUTPUT_INVALID: 1 |
| [pydantic-agent-v3-final-3-rounds.json](pydantic-agent-v3-final-3-rounds.json) | 355/360 | EXECUTION_BUDGET_EXCEEDED: 2, SEMANTIC: 2, PROVIDER_OUTPUT_INVALID: 1 |
| [pydantic-agent-v4-final-3-rounds.json](pydantic-agent-v4-final-3-rounds.json) | 357/360 | SEMANTIC: 2, PROVIDER_OUTPUT_INVALID: 1 |
| [pydantic-v2-calendar-diagnostic.json](pydantic-v2-calendar-diagnostic.json) | 1/1 | 无 |
| [pydantic-v2-fixed-clock-focus.json](pydantic-v2-fixed-clock-focus.json) | 11/12 | SEMANTIC_TIME: 1 |
| [pydantic-v2-time-los-angeles.json](pydantic-v2-time-los-angeles.json) | 4/5 | SEMANTIC_TIME: 1 |
| [pydantic-v2-time-shanghai.json](pydantic-v2-time-shanghai.json) | 4/5 | SEMANTIC_TIME: 1 |
| [pydantic-v2-time-utc.json](pydantic-v2-time-utc.json) | 4/5 | SEMANTIC_TIME: 1 |
| [pydantic-v3-time-final-los-angeles.json](pydantic-v3-time-final-los-angeles.json) | 4/5 | SEMANTIC_TIME: 1 |
| [pydantic-v3-time-final-shanghai.json](pydantic-v3-time-final-shanghai.json) | 5/5 | 无 |
| [pydantic-v3-time-final-utc.json](pydantic-v3-time-final-utc.json) | 5/5 | 无 |
| [pydantic-v3-time-iana-los-angeles.json](pydantic-v3-time-iana-los-angeles.json) | 5/5 | 无 |
| [pydantic-v3-time-iana-shanghai.json](pydantic-v3-time-iana-shanghai.json) | 5/5 | 无 |
| [pydantic-v3-time-iana-utc.json](pydantic-v3-time-iana-utc.json) | 5/5 | 无 |
| [pydantic-v3-time-los-angeles.json](pydantic-v3-time-los-angeles.json) | 4/5 | SEMANTIC_TIME: 1 |
| [pydantic-v3-time-shanghai.json](pydantic-v3-time-shanghai.json) | 5/5 | 无 |
| [pydantic-v3-time-utc.json](pydantic-v3-time-utc.json) | 5/5 | 无 |
| [pydantic-v4-time-los-angeles.json](pydantic-v4-time-los-angeles.json) | 5/5 | 无 |
| [pydantic-v4-time-shanghai.json](pydantic-v4-time-shanghai.json) | 5/5 | 无 |
| [pydantic-v4-time-utc.json](pydantic-v4-time-utc.json) | 5/5 | 无 |
| [recovered-provider-check.json](recovered-provider-check.json) | 1/1 | 无 |

## 后续校准证据

v5 的第一套三轮结果为 357/360，但其中 `toolCalls` 统计的是底层上下文读取，未包含重复工具尝试。它与比较、时区结果以 `legacy-context-read-count` 后缀保留，不作为最终调用预算证据。修正评测计数器后，完整重跑三时区及三轮；Runtime、固定语料和业务评分规则未变。

隔离回退助手的两次校准失败也保留：第一次源码路径断言受 macOS `/tmp` 与 `/private/tmp` 别名影响，第二次进一步修正别名判断。两次均未执行有效测试（首份旧字段 `priorSourceLocationAsserted` 为硬编码，不构成证据）；最终使用 resolve 后的真实源码路径断言通过 24 项。没有回退或修改运行服务。

- [pydantic-agent-v5-comparison-legacy-context-read-count.json](pydantic-agent-v5-comparison-legacy-context-read-count.json)
- [pydantic-agent-v5-final-3-rounds-legacy-context-read-count.json](pydantic-agent-v5-final-3-rounds-legacy-context-read-count.json)
- [pydantic-v5-time-los-angeles-legacy-context-read-count.json](pydantic-v5-time-los-angeles-legacy-context-read-count.json)
- [pydantic-v5-time-shanghai-legacy-context-read-count.json](pydantic-v5-time-shanghai-legacy-context-read-count.json)
- [pydantic-v5-time-utc-legacy-context-read-count.json](pydantic-v5-time-utc-legacy-context-read-count.json)
- [rollback-initial-source-assertion-failed.json](rollback-initial-source-assertion-failed.json)
- [rollback-temp-path-alias-failed.json](rollback-temp-path-alias-failed.json)
