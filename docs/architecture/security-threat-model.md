# P0 安全威胁模型

状态：H2 已实现认证、管理员改密、租户隔离、业务幂等与乐观锁基线；T28 安全收口和 H4 生产审查尚未完成。

## 资产

- 用户密码与 Session
- 私人任务、项目、对话和手机号
- Agent/ASR Secret 与积分余额
- Action 提案及执行权限
- Agent 业务审计与 Python 临时运行日志

## 主要威胁与控制

| 威胁                | 控制                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| 跨用户 IDOR         | Repository 强制 userId；组合外键；越权矩阵测试                                                         |
| 密码泄露            | Argon2id；不记录明文；管理员隐藏式输入                                                                 |
| Session 窃取        | 256-bit 随机 Token；仅存 SHA-256 Hash；30 天绝对过期；HttpOnly/Secure/SameSite；改密撤销全部 Session   |
| CSRF/CORS           | 同域优先；Cookie 写请求校验 Origin；生产缺少 ALLOWED_ORIGINS 时拒绝启动                                |
| 重放/双击           | 业务写入使用 Idempotency-Key、请求 Hash、唯一约束和乐观锁；认证写入按例外规则保护                      |
| Prompt 注入直接写库 | Python Agent 在网络与凭证层无业务数据库权限；Nest 二次结构校验；人工确认；动作白名单                   |
| 伪造对象 ID         | 服务端候选解析和 userId 归属校验                                                                       |
| 积分竞态            | 数据库事务、行锁/条件更新、唯一预留、对账任务                                                          |
| 内部 Agent 接口伪造 | 私网隔离、服务身份认证、固定目标地址、请求版本/大小/超时限制                                           |
| 跨服务数据泄露      | 最小上下文、临时 candidateRef、出站白名单、字段白名单日志；不传 Session、手机号、积分或数据库凭证      |
| 含糊超时重复调用    | 已提交 dispatch CAS、单次 execute、Node HTTP 不自动重试；截止/lease 后核对无结果才释放积分             |
| 敏感日志            | Pino 字段白名单与脱敏；禁止正文、认证 Token、音频、Secret                                              |
| Python 运行日志泄漏 | stdout 字段白名单；禁止 userId/candidateRef/正文/Prompt/模型正文/Token usage/工具载荷/Chain of Thought |
| 意外形成日志持久化  | P0 不引入文件日志、远程 Exporter、Collector、日志数据库、durable spool 或日志查询 API                  |
| 日志失败影响推理    | 日志 best-effort；格式化/输出异常不改变 execute、readiness、Provider 调用、积分或恢复                  |
| 注册/登录滥用       | IP 与规范化用户名独立限流；有界状态；只信任显式代理 IP；P0 小范围分发                                  |

## 认证写入例外

- 注册、登录和退出不要求客户端提供 `Idempotency-Key`。
- 注册以规范化用户名唯一约束和单事务保证 User、Identity、Credential、Contact、初始 grant 要么全部成功、要么全部失败；冲突不重复赠送。
- 登录每次成功都创建新 Session，不复用客户端重放响应；退出只撤销当前 Session，重复退出不扩大影响。
- 认证成功后的 Task、Project 和 Undo 写入仍必须校验 `Idempotency-Key`、请求 Hash、对象归属和版本。

## H2 已实现安全边界

- Session Token 使用 256-bit CSPRNG，数据库只存 SHA-256 Hash；默认 30 天绝对过期，不滑动续期。
- `SESSION_TTL_DAYS` 严格限制为 1–365 的完整正整数；生产 Cookie 使用 HttpOnly、Secure、SameSite=Lax。
- `TRUSTED_PROXY_ADDRESSES` 只接受显式 IPv4/IPv6，默认仅回环地址，避免伪造转发头绕过 IP 限流。
- 注册/登录同时消耗独立 IP 桶和规范化用户名桶；内存状态有过期清理和容量上限，容量耗尽时 fail closed。
- 并发等价用户名注册只允许一个完整事务成功，不会重复 User、Identity、Session 或初始积分。
- 管理员改密对 credential_version 做条件更新；并发操作只允许一个成功，且新 Hash、双版本、Session 撤销和脱敏审计原子提交。
- Task/Project/Undo 写入按 userId 查询并使用组合外键；幂等响应快照与业务变化同事务提交，版本冲突不覆盖新数据。
- 未知服务端异常只返回稳定错误和 requestId；日志不写请求正文、密码、Session、完整私人待办或原始异常内容。

当前限流是单进程内存基线。未来多副本部署前必须迁移到网关或共享存储，并保持两个独立维度和明确的容量/过期策略。

## H2 非范围

- 没有 Python Agent、DeepSeek 或腾讯 ASR 真实调用，因此 H2 不产生 Provider Secret、Prompt、原始音频或模型输出日志。
- `reminderAt` 只保存和展示；没有通知 Worker、Push Token 或提醒已读状态。
- 不开放公网、不接入真实用户、不执行生产管理员命令。
- Agent 的 Prompt 注入、提案确认和积分并发仍需在 T18–T28 随真实链路验证；现有 Schema 不是功能交付证明。

## Phase 3 服务信任边界

- H5/小程序只能访问 NestJS 公开 API；Python 内部端点不得经 Caddy、公网域名或客户端配置暴露。
- DeepSeek Secret 只注入 Python 服务；Python 不持有 PostgreSQL、Session、管理员或积分凭证，NestJS 不需要感知具体 Prompt 和 Provider SDK。
- NestJS 只发送当前请求所需的有界对话、最小业务快照与不可猜测 `candidateRef`；Python 返回的任何对象 ID、结果类型或额外字段都不可信。
- 内部调用校验服务身份、`requestId`、契约版本、Content-Type 和请求大小，并采用明确的连接/响应超时与并发上限。
- Python 出站网络默认只允许配置中的 Provider；禁止任意 URL、模型生成 URL 或用户输入控制请求目的地，避免 SSRF 和数据外传。
- 两端通过稳定 `requestId` 关联业务状态与即时运行日志。Python stdout 只记录 ADR-011 白名单字段；禁止任何认证 Token、Session、完整私人待办、原始 Prompt、模型/工具正文、Token usage、Chain of Thought、Provider 原始错误或 Secret。
- Python 不写日志文件、数据库或对象存储，不配置远程 Exporter、OTLP/Collector、Trace/Metrics 后端、durable spool 或算法日志查询端点。生产 Uvicorn 全量 access log 和 DEBUG 默认关闭。
- Python 日志可以完全丢失；logger 异常、进程重启或没有任何日志时，响应和 NestJS 业务状态必须不变。stdout success 不能证明结果已交付，也不能触发重派、开放结果、补扣、释放、退款或 Run 恢复。
- `AgentEvaluationEvent` 仍由 NestJS 记录业务评测事实；生产输入/输出样本默认不持久化。确需样本时必须另立脱敏、抽样、访问与删除方案并经过人工审查。
- 内部 HTTP 2xx 不是扣分授权。NestJS 二次校验并持久化允许结果后才可结算；无结果失败释放预留，结果已持久化后只重试结算。
- P0 含糊超时不自动再次调用 Python/DeepSeek。迟到结果在预留已释放后必须丢弃，不能重新开放或补扣积分。
- Worker 只有在预留仍为 pending 时才可原子写 Run 截止时间、延长 reservation lease 和提交 dispatch 标记；回收器遵守 `executeTimeoutAt < runDeadlineAt < reservationExpiresAt < recoveryEligibleAt`，数据库状态未知时不得释放。

## 发布前要求

- 依赖和 Secret 扫描通过。
- 生产 HTTPS、CSP、HSTS 和安全 Cookie 开启。
- 跨用户、重复确认、积分竞态和 Session 撤销测试通过。
- Python 服务认证、无业务数据库权限、出站限制、跨语言契约、单次 dispatch 和迟到结果竞态测试通过。
- Python stdout 字段白名单、无持久化依赖和 logger 故障隔离测试通过；没有任何 Python 日志时 Run 与积分终态不变。
- 生产数据和付费 Provider 的首次使用必须经过 H4 批准。
- 单进程限流迁移、多副本代理信任、备份恢复和事故 Runbook 必须在 T28/T29 完成。
