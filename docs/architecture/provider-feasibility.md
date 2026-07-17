# Provider 与队列可行性验证

- 验证日期：2026-07-13
- 范围：T05 风险验证，不使用真实密钥、不产生 Provider 费用

## 结论

Taro H5、DeepSeek V4 JSON Output、pg-boss 12 和腾讯云一句话识别可满足 P0；Provider 与队列均通过应用侧接口隔离。真实账号连通、配额和计费只在 H3 前的受控环境补充验证。

> 2026-07-16 架构修订：本验证证明的是 DeepSeek HTTP/JSON 风险与 pg-boss 持久化边界，不证明新的 Python 内部服务已经可行或已实现。Node 进程内 DeepSeek Adapter 方案已被 [`ADR-009`](../decisions/ADR-009-python-agent-service-boundary.md) 取代；原 Stub 证据继续保留为历史风险验证。

## Taro H5

- Node.js 24 下 `taro build --type h5` 已通过。
- H5 输出由 Vite 4 构建；客户端业务不直接依赖 Provider SDK。

## DeepSeek

- 官方当前模型为 `deepseek-v4-flash` 和 `deepseek-v4-pro`，均支持 JSON Output。
- 当时的 Node Adapter 使用 OpenAI-compatible `/chat/completions`、`response_format: json_object`，并在 Prompt 中显式要求 JSON；Phase 3 目标实现移至 Python Agent 服务。
- HTTP Envelope、JSON 解析和业务 Schema 分层校验；非法内容统一转为 ProviderOutputError，不进入 Repository。
- 验证方式：本地 Fetch Stub 覆盖成功与恶意/非法结构。未调用真实 API。

官方依据：[模型列表](https://api-docs.deepseek.com/api/list-models)、[Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)。

## pg-boss

- pg-boss 12.26.0 支持 PostgreSQL 13+、Node 22.12+，与本项目 Node 24/PostgreSQL 16 匹配。
- 使用独立 `pgboss` Schema；内部表由 pg-boss 自身迁移管理，不混入 Prisma 业务迁移。
- Testcontainers 已验证：生产者停止后，新 Queue 实例仍能取得并完成原作业。
- T19 使用 pg-boss 的 Prisma 7 Transaction Adapter，把业务请求和作业入队纳入同一事务。

官方依据：[pg-boss 仓库与 Prisma Adapter 示例](https://github.com/timgit/pg-boss)。

## 腾讯云一句话识别

- 官方限制为 60 秒、上传数据不超过 3MB，支持 wav、pcm、ogg-opus、mp3、m4a、aac 等格式。
- 当前 Adapter 使用官方产品级 Node.js SDK、TC3-HMAC-SHA256、`SentenceRecognition` 与 `16k_zh`。
- `maxBytes` 按 Base64 后的 Data 长度校验；原音频只存在于请求内存，配置禁止持久化。
- 浏览器常见的 `audio/webm` 不在腾讯支持列表。H5 录音适配器必须输出/编码 16k 单声道 PCM/WAV；微信小程序优先使用平台支持的 mp3/aac/m4a。禁止把腾讯密钥放入 H5 或小程序。

官方依据：[一句话识别接口](https://cloud.tencent.com/document/product/1093/35646)、[Node.js SDK](https://cloud.tencent.com/document/product/494/7247)。

## 剩余验证

- 以 `packages/contracts/internal-agent/v1/openapi.yaml` 为唯一工件，验证 FastAPI/Pydantic/Zod Schema 完整等价，并用 Golden Fixtures 补充错误行为：T19.1。
- 私有 HTTP 服务认证、请求限制、超时、重启、单次 dispatch、迟到响应和 Python 无业务数据库权限：T19.2/T19.4。
- Python 最小结构化 stdout 日志、字段白名单、logger 故障隔离和无任何日志持久化依赖：T19.2/T19.3。OTLP/Collector、Token/工具调用明细、Trace/Metrics 后端和仪表盘不属于 MVP，未来另行评审。
- Python DeepSeek Adapter 的空内容、非法结构、同 execute 结构修复和确定性 Stub：T19.3；替代链路通过集成测试并确认旧路径零活动引用后，再于 T19.4d 移除 Node Provider、旧测试和配置，禁止长期双轨。
- DeepSeek 真实密钥、并发、超时与 Provider 计费：另行批准的受控 Smoke；不得把 HTTP 2xx 直接作为用户积分扣分依据。
- 腾讯云服务开通、真实普通话样本识别与地域延迟：T25/H3 前受控 Smoke。
- H5 PCM/WAV 录音的设备兼容矩阵：T25；H1 只验证录音交互壳。
