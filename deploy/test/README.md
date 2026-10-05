# 临时 HTTP 测试环境

该目录用于把本地构建的 `linux/amd64` 镜像部署到 `1.14.150.18`。它是内部测试环境，不代表 H3、H4 或生产发布通过。

## 结构

- 宿主机 Nginx 接收 `http://1.14.150.18`，转发到 `127.0.0.1:18080`。
- Web 容器提供 H5，并仅把 `/api/v1` 转发到 NestJS。
- Server、Agent 与 PostgreSQL 16 使用隔离容器网络；Agent 不加入数据库网络。
- PostgreSQL 数据保存在 Compose 命名卷中，应用容器重建不会删除数据。

## 本地构建

在仓库根目录执行：

```bash
deploy/test/build-bundle.sh <git-short-sha> <output-directory>
```

脚本构建 Server、Web、Agent 三个 `linux/amd64` 镜像，并将它们与 PostgreSQL 16 一起导出为带 SHA-256 校验文件的压缩归档。

## 服务器运行配置

服务器 `/opt/ai-schedule-test/runtime.env` 必须只在服务器保存，并至少包含：

```dotenv
RELEASE_TAG=<git-short-sha>
POSTGRES_PASSWORD=<random-password>
AGENT_SERVICE_TOKEN=<canonical-base64url-256-bit-token>
AGENT_CONTEXT_SERVICE_TOKEN=<different-canonical-base64url-256-bit-token>
DEEPSEEK_API_KEY=<provider-key>
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

每个发布版本的 Compose 放在 `/opt/ai-schedule-test/releases/<git-short-sha>/compose.yaml`。在对应目录执行：

```bash
docker compose --env-file /opt/ai-schedule-test/runtime.env up -d postgres
docker compose --env-file /opt/ai-schedule-test/runtime.env run --rm migrate
docker compose --env-file /opt/ai-schedule-test/runtime.env up -d agent server web
docker compose --env-file /opt/ai-schedule-test/runtime.env ps
```

迁移失败时停止，不启动其余服务。

## 日常操作

在当前 release 目录执行：

```bash
docker compose --env-file /opt/ai-schedule-test/runtime.env ps
docker compose --env-file /opt/ai-schedule-test/runtime.env restart agent server web
docker compose --env-file /opt/ai-schedule-test/runtime.env stop
docker compose --env-file /opt/ai-schedule-test/runtime.env logs --tail=200 server web postgres
```

Agent 按 ADR-011 禁用持久化容器日志，因此不提供历史 Agent 日志。

更新时先导入新镜像、创建新的 release 目录、更新 `RELEASE_TAG`，运行迁移后再启动新版本。应用回退只把 `RELEASE_TAG` 和 release 目录切回上一版本；数据库不自动回退。不要执行 `docker compose down -v`，否则会删除测试数据。
