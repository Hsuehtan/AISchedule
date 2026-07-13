# 当前任务

- 任务：H1 交互冻结人类审查
- 状态：等待人类明确回复“通过”或提出修改（T01-T09 已完成）
- 分支：`codex/t01-foundation`
- 当前门禁：H1（T09 后暂停）
- 最后验证提交：`bdc5b6c test: 完成 H1 交互壳浏览器验收`

## 已完成

- H0 决策写入 PRD v1.3。
- 建立根 README、AGENTS、资产索引。
- 建立架构、API、数据模型、安全、ADR 和积分配置基线。
- 建立 T01-T30 任务与 H0-H4 门禁。
- 完成 T01 文档一致性检查。
- 建立 pnpm Workspace、Turbo、TypeScript、ESLint 和 Prettier 基线。
- 建立 Taro H5、NestJS Fastify 和四个共享包的可构建骨架。
- 以集成测试驱动实现 `/api/v1/health/live` 健康接口。
- 固定 Node.js 24 目标版本，并将 Vitest 固定到与 Taro Vite 4 兼容的 1.6.1。
- 建立用户名/昵称/密码/手机号、品牌 ID 和统一 API 错误结构。
- 建立 Task、Project、Agent 状态和 Action Mutation 共享契约。
- 建立严格的积分 YAML Schema、解析与 SHA-256 指纹。
- 建立 18 张业务表、17 个枚举、条件唯一索引、组合租户外键和 CHECK 约束。
- 建立 Prisma 7 `prisma-client`、PostgreSQL Driver Adapter 与初始 Migration。
- 建立 Project/Task Repository 基线和本地 Docker Compose PostgreSQL。
- 使用 Testcontainers 在空 PostgreSQL 16 上验证 Migration、活跃项目重名复用、跨用户外键和非负积分约束。
- 建立 DeepSeek V4 JSON Output Adapter，非法 JSON/Schema 输出不会进入业务层。
- 建立腾讯云一句话识别 Adapter，限制时长、Base64 请求大小并禁止原音频持久化。
- 建立 pg-boss Queue 边界并验证作业跨 Queue 实例持久化。
- 服务启动时严格加载积分、Agent 和语音 YAML；缺失或非法配置会拒绝启动。
- 固化 H5 录音必须编码 16k 单声道 PCM/WAV 的兼容策略。
- 从 Figma `230:4`、`230:7`、`230:10`、`230:13` 固化 Production V3 视觉基线。
- 建立 Electric Ink 颜色、布局、圆角、阴影和组件 Token。
- 建立 App Shell、状态栏、按钮、Smart Inbox 和待办行基础组件。
- 基础交互控件满足 44px 最小点击区域，并保留可访问名称与追踪标识。
- 建立覆盖 15 个 Production V3 画面的类型安全页面状态与可复现 URL。
- 建立循环式前后状态导航，未知 URL 安全回退到全部待办。
- 建立 Bottom Sheet、确认 Dialog 和 3 秒撤销 Toast 基础容器。
- 弹层使用固定标题、可滚动内容和安全区操作区，并声明可访问 Dialog/Status 语义。
- 用共享 Task、Project、Action Proposal Contract 构建可校验的 H1 Fixture。
- 实现登录、全部待办、工作项目、空状态、已完成展开和撤销 Toast。
- 实现文字、语音、候选消歧、Agent 澄清、计划、确认、待办编辑、项目管理和额度不足状态。
- 接通登录、项目筛选、待办完成/编辑、Smart Inbox、文字/语音和 Agent 确认主路径。
- 修复 Taro HTML 入口模板并补齐 pnpm 严格依赖下的 Babel Decorator 直接依赖，构建产物包含真实 JS/CSS。

## 验证记录

- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：通过。
- `pnpm test:integration`：通过，服务端健康接口 1 项集成测试。
- `pnpm build`：通过，H5 和服务端均成功构建。
- `mise x node@24 -- corepack pnpm test:integration`：通过，17 项契约/配置/健康测试及 2 项真实数据库测试。
- `mise x node@24 -- corepack pnpm build`：通过。
- `mise x node@24 -- node /opt/homebrew/bin/pnpm test`：通过，23 项单元/契约测试。
- `mise x node@24 -- node /opt/homebrew/bin/pnpm test:integration`：通过，4 项集成测试（数据库与队列真实 PostgreSQL）。
- 本地构建产物启动并访问 `/api/v1/health/live`：200，配置启动校验通过。
- `pnpm --filter @ai-schedule/ui test`：通过，2 项 Design Token/语义组件测试。
- `pnpm --filter @ai-schedule/ui typecheck` 与 `lint`：通过。
- `pnpm --filter @ai-schedule/client build`：通过；Taro 原生绑定需在受限沙箱外运行。
- `pnpm --filter @ai-schedule/ui test`：通过，含 3 项 Token/组件/弹层测试。
- `pnpm --filter @ai-schedule/client test`：通过，3 项页面状态路由测试。
- UI 与 Client `typecheck`：通过。
- `pnpm --filter @ai-schedule/client test`：通过，4 项路由与 Contract Fixture 测试。
- Client `typecheck` 与 `lint`：通过。
- Taro H5 完整构建：通过，738 个模块，生成 App/Page/Vendor JS 与 CSS。
- `pnpm format:check`、`pnpm typecheck`、`pnpm lint`：通过。
- `pnpm test`：通过，30 项单元、契约和组件测试。
- `pnpm test:integration`：通过，4 项真实 PostgreSQL/pg-boss/健康接口测试；受限沙箱无容器运行时，已在本机容器环境复验。
- `pnpm build`：通过，7/7 Workspace 构建任务成功，Taro H5 转换 738 个模块。
- `pnpm test:e2e`：通过，8/8 Chrome 测试；15 状态、核心路径、撤销、44px、axe、320/480px 和软键盘压缩均覆盖。
- H1 生成 15 张 390 × 844、2 张响应式和 1 张软键盘压缩截图。

## 当前风险

- 当前机器默认 Node.js 为 26.3.1；已安装 Node.js 24.18.0，质量命令使用 `mise x node@24 -- corepack pnpm ...`。
- 仓库原有设计图片仍为用户未提交文件，提交时不得误纳入。
- Figma Production V3 没有变量；Token 必须由代码侧固化。
- 腾讯 ASR 不支持 WebM；H5 录音适配器必须编码 PCM/WAV，设备兼容矩阵在 T25 完成。
- DeepSeek 与腾讯 ASR 未使用真实密钥，受控真实 Smoke 延后至 H3 前。
- Chrome 的 390 × 560 软键盘模拟不能替代 iOS/Android 真机 IME、安全区和地址栏验证，设备矩阵按计划在 T25/T27 完成。
- 图标目前使用轻量字符占位，正式 SVG/Icon 归一在 T27 完成。
- Figma 部分青色按钮为白字；实现为满足 WCAG AA 使用 Ink 深色字，等待 H1 明确确认。

## 唯一下一步

等待人类审查 [`docs/quality/h1-interaction-review.md`](../docs/quality/h1-interaction-review.md)。收到明确“通过”后开始 T10；此前不得进入 Phase 2。
