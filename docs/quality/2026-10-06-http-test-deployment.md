# 2026-10-06 临时 HTTP 测试环境部署验收

## 结论

当前版本已作为经用户明确授权的临时测试环境部署到：

- 访问地址：`http://1.14.150.18`
- 应用镜像版本：`c5cce9f`
- 服务器目录：`/opt/ai-schedule-test`
- 发布目录：`/opt/ai-schedule-test/releases/c5cce9f`
- 数据库：独立 PostgreSQL 16 容器与 `ai-schedule-test_postgres_data` 命名卷
- Provider：真实 DeepSeek，Secret 仅位于服务器 `runtime.env`

此次发布只用于内部测试，不代表 T24 人工审查、H3、H4、T29 或正式生产发布通过。正式生产门禁继续保留。

## 镜像与入口

本地使用 Node.js 24、pnpm 11.8.0、Python 3.11.15 与锁定依赖构建以下 `linux/amd64` 镜像：

| 镜像                                  | 本地解压后大小 |
| ------------------------------------- | -------------: |
| `ai-schedule-test-server:c5cce9f`     |  384,682,177 B |
| `ai-schedule-test-web:c5cce9f`        |   21,176,909 B |
| `ai-schedule-test-agent:c5cce9f`      |   54,360,707 B |
| `ai-schedule-test-postgres:16-alpine` |  116,073,911 B |

离线归档大小为 573,756,783 B，SHA-256 为 `1d9458c8804f1d272e1b63301b2f2f81127dfcd5b670511858ebbc7bd6785dc9`。服务器加载前复算结果与本地一致。

宿主机 Nginx 监听 80 并转发至 `127.0.0.1:18080`。Web 容器提供 H5 和 `/api/v1` 反向代理，`/internal/*` 不经公开入口转发。PostgreSQL 16 未映射宿主端口，原宿主 PostgreSQL 15 继续监听 `127.0.0.1:5432`。

## 验证结果

### 本地工程与镜像

- `pnpm lint`：8/8 任务通过。
- `pnpm typecheck`：12/12 任务通过。
- `pnpm test`：12 个工作区任务通过；Server 127、Client 89、Contracts 54、DB 10、UI 10、Config 5、Python 101。
- `pnpm build`：8/8 任务通过，正式 H5 构建 825 modules。
- Compose 配置、Shell 语法、Git diff 检查通过。
- 四个镜像均确认是 `linux/amd64`，离线归档 SHA-256 校验通过。
- 本地独立空库应用 8 个正式 migration 成功，PostgreSQL、Agent、Server、Web 全部健康。
- 本地合成验收覆盖注册、Session、项目、待办新增/编辑/完成/恢复/删除/撤销、真实 Agent 回复、计划生成及确认写入；应用容器重建后数据仍存在。

### 服务器

- PostgreSQL 16 空库 8 个 migration 全部成功后才启动应用服务。
- PostgreSQL、Agent、Server、Web 健康检查全部通过，重启策略均为 `unless-stopped`。
- Agent 仅加入 inference 网络，不加入 database 网络；PostgreSQL 仅加入内部 database 网络。
- `GET /api/v1/health/live` 通过公网 IP 返回正常。
- 390 × 844 的真实 Chrome 渲染返回 HTTP 200，标题为“AI 待办”，登录页无 page error，页面无横向异常。
- 合成业务验收覆盖注册、退出、重新登录、Session、项目创建、待办新增/编辑/完成/恢复/删除/三秒撤销。
- 真实 DeepSeek 普通回复、v2 上下文读取、计划生成、确认后创建项目和任务、积分结算链路通过。
- 第一次远端计划生成在约 26 秒后以 `AGENT_SERVICE_UNAVAILABLE` 正常释放；服务未自动重派，容器保持健康。使用新的合成请求复验完整链路通过，记录为一次瞬时 Provider/网络超时，不掩盖该运行事实。
- 重建 Agent、Server、Web 容器后，测试账号和 3 条待办仍可重新登录读取。
- 关闭全部 SSH 会话后再次从公网检查健康接口并登录读取待办，结果通过；运行不依赖本地电脑、开发服务或 SSH。
- 最终服务器磁盘剩余约 32 GiB，内存 available 约 2.4 GiB。

验收只使用合成数据。自动化生成的测试账号不作为日常账号交付；测试人员从注册页自行创建账号。

## 运维命令

以下命令均在服务器执行：

```bash
cd /opt/ai-schedule-test/releases/c5cce9f

# 状态
docker compose --env-file /opt/ai-schedule-test/runtime.env ps

# 查看非 Agent 服务日志
docker compose --env-file /opt/ai-schedule-test/runtime.env logs --tail=200 server web postgres

# 重启应用，保留数据库与数据卷
docker compose --env-file /opt/ai-schedule-test/runtime.env restart agent server web

# 停止整套测试环境，保留数据卷
docker compose --env-file /opt/ai-schedule-test/runtime.env stop

# 再次启动
docker compose --env-file /opt/ai-schedule-test/runtime.env up -d postgres agent server web
```

更新版本时，先上传并校验新归档、`docker load`，把新 Compose 放入新的 release 目录，更新 `runtime.env` 的 `RELEASE_TAG`，再按 PostgreSQL 健康、`migrate`、Agent/Server/Web 的顺序启动。迁移失败必须停止发布。

回退应用时，把 `runtime.env` 的 `RELEASE_TAG` 改回前一镜像标签，并在前一 release 目录运行 `up -d agent server web`。数据库和命名卷不自动回退；首次发布当前没有更早的服务器版本可切回。禁止执行 `docker compose down -v`。

## 范围说明

- 本轮没有迁移本地账号或待办，也没有使用真实用户数据。
- 本轮没有配置域名、HTTPS、Secret Manager、备份、安全加固或生产容量验证。
- Python Agent 仍不持有业务数据库权限；容器日志继续按 ADR-011 不持久化。
- T24 人工审查、T25–T27、H3、T28–T30 与 H4 状态均未改变。
