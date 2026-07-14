# P0 安全威胁模型

状态：H2 已实现认证、管理员改密、租户隔离、业务幂等与乐观锁基线；T28 安全收口和 H4 生产审查尚未完成。

## 资产

- 用户密码与 Session
- 私人任务、项目、对话和手机号
- Agent/ASR Secret 与积分余额
- Action 提案及执行权限

## 主要威胁与控制

| 威胁                | 控制                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| 跨用户 IDOR         | Repository 强制 userId；组合外键；越权矩阵测试                                                       |
| 密码泄露            | Argon2id；不记录明文；管理员隐藏式输入                                                               |
| Session 窃取        | 256-bit 随机 Token；仅存 SHA-256 Hash；30 天绝对过期；HttpOnly/Secure/SameSite；改密撤销全部 Session |
| CSRF/CORS           | 同域优先；Cookie 写请求校验 Origin；生产缺少 ALLOWED_ORIGINS 时拒绝启动                              |
| 重放/双击           | 业务写入使用 Idempotency-Key、请求 Hash、唯一约束和乐观锁；认证写入按例外规则保护                    |
| Prompt 注入直接写库 | Provider 无 Repository 权限；结构校验；人工确认；动作白名单                                          |
| 伪造对象 ID         | 服务端候选解析和 userId 归属校验                                                                     |
| 积分竞态            | 数据库事务、行锁/条件更新、唯一预留、对账任务                                                        |
| 敏感日志            | Pino 字段白名单与脱敏；禁止正文、Token、音频、Secret                                                 |
| 注册/登录滥用       | IP 与规范化用户名独立限流；有界状态；只信任显式代理 IP；P0 小范围分发                                |

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

- 没有 DeepSeek/Agent 或腾讯 ASR 真实调用，因此 H2 不产生 Provider Secret、Prompt、原始音频或模型输出日志。
- `reminderAt` 只保存和展示；没有通知 Worker、Push Token 或提醒已读状态。
- 不开放公网、不接入真实用户、不执行生产管理员命令。
- Agent 的 Prompt 注入、提案确认和积分并发仍需在 T18–T28 随真实链路验证；现有 Schema 不是功能交付证明。

## 发布前要求

- 依赖和 Secret 扫描通过。
- 生产 HTTPS、CSP、HSTS 和安全 Cookie 开启。
- 跨用户、重复确认、积分竞态和 Session 撤销测试通过。
- 生产数据和付费 Provider 的首次使用必须经过 H4 批准。
- 单进程限流迁移、多副本代理信任、备份恢复和事故 Runbook 必须在 T28/T29 完成。
