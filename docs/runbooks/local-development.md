# 本地开发

## 前置条件

- Node.js 24、pnpm 11
- Python 3.11.15 与 uv
- Docker Desktop 或 OrbStack

默认 Node 版本不一致时使用 `mise exec -- corepack pnpm <command>`。Python 依赖由 `uv.lock` 锁定，不要使用系统级 pip 覆盖。

## 初始化

```bash
pnpm install
cd apps/agent-service
uv sync --locked
cd ../..
docker compose -f compose.yaml up -d postgres
cp .env.example .env
pnpm db:generate
pnpm db:migrate:deploy
```

`.env.example` 只包含本地默认值和空 Secret。不要把真实 DeepSeek Key、服务 Token、Cookie 或数据库生产凭证写入 Git、聊天、截图或日志。

`compose.yaml` 提供 PostgreSQL 与 Agent 服务的本地隔离拓扑，但不是 T29 生产资产。PostgreSQL 和 Python 没有共同网络；Python 不接收 `DATABASE_URL`。

## 只开发手工功能

没有 DeepSeek Key 时可以只启动 PostgreSQL、NestJS 和 H5；Agent 公开接口会稳定返回“智能处理暂不可用”，认证、Task 和 Project 仍可使用。

先载入 `.env`：

```bash
set -a
source ./.env
set +a
```

分别在两个终端运行：

```bash
pnpm --filter @ai-schedule/server dev
pnpm --filter @ai-schedule/client dev
```

后端默认 `http://127.0.0.1:3000`，H5 默认 `http://127.0.0.1:10086`。H5 只代理 `/api/v1`；不得扩大为 `/api`，否则会拦截 Taro 的 `/api-client.ts` 开发模块。

要禁用新的 Agent 推理请求，确保 `AGENT_SERVICE_TOKEN` 为空，或同时移除 `AGENT_SERVICE_URL` 与 Token。NestJS 只有在 URL 和 Token 同时存在时才开放新请求 admission；pg-boss Worker 与恢复扫描器仍会启动，用于安全释放或结算数据库中已有的 Run。

## 启动完整 Agent 链路

生成至少 256-bit、无 padding 的 base64url 服务 Token，并把同一个值只注入本地 NestJS 与 Python 环境：

```bash
openssl rand -base64 32 | tr '/+' '_-' | tr -d '='
```

在当前 shell 设置以下变量；不要把实际值复制进文档或提交 `.env`：

```bash
export AGENT_SERVICE_TOKEN='<LOCAL_BASE64URL_TOKEN>'
export AGENT_SERVICE_URL='http://127.0.0.1:8081'
export DEEPSEEK_API_KEY='<LOCAL_DEEPSEEK_KEY>'
export DEEPSEEK_BASE_URL='https://api.deepseek.com'
```

开发模式可用根命令同时启动 Workspace：

```bash
pnpm dev
```

也可以让 Compose 只运行 Python：

```bash
docker compose -f compose.yaml up -d --build agent-service
```

Compose 将 Python 绑定在 loopback `8081`，使用只读文件系统、无 Linux capabilities、无持久化容器日志。`GET /internal/health/live` 与 `/ready` 不调用 DeepSeek；健康并不证明付费 Provider 可用。

## 契约与验证

```bash
pnpm agent:contract:generate
pnpm agent:contract:check
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
```

生成命令会从 `packages/contracts/internal-agent/{v1,v2}/openapi.yaml` 更新 Node Zod 与 Python Pydantic 模型；生成后出现未审查差异时不得手工修改生成物规避检查。

数据库集成测试使用隔离 PostgreSQL 16 Testcontainer，自动执行正式 Migration，不读取或修改本地开发库。`pnpm test:e2e` 也启动隔离 NestJS、H5、Chrome 和 Agent Stub，默认不需要真实 DeepSeek Key。

## 真实 DeepSeek Smoke

真实 Smoke 不是默认 CI。确认本地 Docker 可用并只在当前 shell 注入 `DEEPSEEK_API_KEY` 后运行：

```bash
pnpm smoke:deepseek
```

`pnpm smoke:deepseek` 不会自动加载项目根目录的 `.env`。如果凭证已经写在 `.env`，可在仓库根目录使用以下方式仅注入 Smoke 所需的两个配置项，不输出密钥，也不将本地数据库配置传给测试：

```bash
mise exec -- node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
const local = parseEnv(readFileSync('.env', 'utf8'));
const env = { ...process.env };
for (const name of ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL']) {
  if (!env[name] && local[name]) env[name] = local[name];
}
const result = spawnSync('corepack', ['pnpm', 'smoke:deepseek'], {
  env, stdio: 'inherit',
});
process.exit(result.status ?? 1);
NODE
```

测试使用隔离数据库和合成用户，覆盖 standard reply、plan generation、结果持久化及 1 点/2 点结算。包含结构修复时 Provider 调用总数不超过 4。输出只允许通过/失败、模型和耗时；不得打印 Prompt、响应正文或 Secret。

缺少 Key 或真实 Smoke 未通过时必须如实暂停，不能以 Stub 测试替代 Phase 3 完成条件。T25 语音尚未实现，不需要腾讯 ASR Secret。

## E2E 与端口

`pnpm test:e2e` 默认使用 H5 `11086` 和 API `13000`，不复用开发服务的 `10086`/`3000`。端口冲突时可设置 `H5_PORT` 和 `API_PORT`。视觉截图输出到 `docs/quality/screenshots/`。

## 停止服务

```bash
docker compose -f compose.yaml stop agent-service postgres
```

不要在日常清理中执行 `down -v`；它会删除本地开发数据卷。确需重置未发布开发库时，先依据数据库迁移 Runbook 明确确认数据可丢弃。

## 修改 Schema

1. 修改 `packages/db/prisma/schema.prisma`。
2. 执行 `pnpm db:validate` 和 `pnpm db:generate`。
3. 生成新的、不可覆盖的 Prisma Migration；禁止修改已发布 Migration。
4. 检查 SQL 锁、数据回填、未知历史记录拒绝路径和回滚风险。
5. 运行 `pnpm test:integration`。

Phase 3 只允许 expand-first；旧积分枚举/列的物理收缩必须在独立 Migration 中完成。Prisma 无法表达的 CHECK 与 partial index 不得被后续差异迁移误删。

### v2 Agent 上下文通道

同时配置两个不同的 256 位 base64url 服务凭证：`AGENT_SERVICE_TOKEN` 用于 NestJS → Python execute，`AGENT_CONTEXT_SERVICE_TOKEN` 用于 Python → NestJS context/read。分别用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` 在本地生成，只通过环境注入。不得复用 Session 或 Provider Key。

Python 本机运行设置 `AGENT_CONTEXT_URL=http://127.0.0.1:3000`；Compose 运行而 NestJS 在宿主机时设置 `AGENT_CONTEXT_URL=http://host.docker.internal:3000`（Linux 需宿主网关解析）。不要将包含本机 loopback 的 `.env` 值直接用于容器回调。NestJS 缺少任一服务方向配置时，不接纳新智能请求。

反向代理和 H5 继续只转发 `/api/v1`，不得代理 `/internal/*`。上下文服务地址为固定配置，不接受 execute 请求指定地址。不要把内部服务端口映射至公网。Python 容器不加入数据库网络。

`pnpm agent:contract:check` 检查 v1/v2 两套生成物；Python Schema 等价测试涵盖两版 execute 与 v2 context 模型。`pnpm smoke:deepseek` 使用隔离数据库、合成数据和临时双向凭证，并启动本地 NestJS 回调监听，不保存 Prompt/响应正文。保持现有 T24 门禁。
