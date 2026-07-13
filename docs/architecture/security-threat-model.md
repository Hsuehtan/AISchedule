# P0 安全威胁模型

## 资产

- 用户密码与 Session
- 私人任务、项目、对话和手机号
- Agent/ASR Secret 与积分余额
- Action 提案及执行权限

## 主要威胁与控制

| 威胁 | 控制 |
|---|---|
| 跨用户 IDOR | Repository 强制 userId；组合外键；越权矩阵测试 |
| 密码泄露 | Argon2id；不记录明文；管理员隐藏式输入 |
| Session 窃取 | HttpOnly/Secure/SameSite；Token Hash；改密撤销全部 Session |
| CSRF/CORS | 同域优先；Origin 校验；CORS 白名单；写接口 CSRF 防护 |
| 重放/双击 | Idempotency-Key、请求 Hash、唯一约束、乐观锁 |
| Prompt 注入直接写库 | Provider 无 Repository 权限；结构校验；人工确认；动作白名单 |
| 伪造对象 ID | 服务端候选解析和 userId 归属校验 |
| 积分竞态 | 数据库事务、行锁/条件更新、唯一预留、对账任务 |
| 敏感日志 | Pino 字段白名单与脱敏；禁止正文、Token、音频、Secret |
| 注册/登录滥用 | IP/身份限流；P0 小范围分发；必要时关闭公开注册开关 |

## 发布前要求

- 依赖和 Secret 扫描通过。
- 生产 HTTPS、CSP、HSTS 和安全 Cookie 开启。
- 跨用户、重复确认、积分竞态和 Session 撤销测试通过。
- 生产数据和付费 Provider 的首次使用必须经过 H4 批准。
