# Spec：微信小程序首版适配

- 编号：WX-MVP-001
- 日期：2026-10-13
- 状态：SPECIFY / 待用户审阅；未进入 PLAN、TASKS 或 IMPLEMENT
- 仓库调查基线：`531ee47`，`dev`，开始时工作区干净。
- 配套验收：[acceptance.md](./acceptance.md)

## 1. 目标与授权

把现有 AI 待办产品交付为可在微信内扫码体验、并具备提审条件的小程序，复用已实现的手动待办、项目管理、文字 Agent、计划草稿和确认执行能力。首批用户是受邀测试人员；公众发布是独立的交付阶段。

用户于 2026-10-13 明确要求暂时忽视原 Task 进度，认可当前产品具备初步上线测试基础，并授权制定小程序适配规格；用户将同步办理企业资质。旧 T24 及 T25–T30 顺序不作为本专项规格的阻挡条件，也不要求先补齐旧计划中的全部功能。历史验收记录保留，不将历史未完成项伪记为完成。

已确认：首版保留用户名密码登录；技术路线由代码评估后推荐。尚未批准：本规格推荐的 Hybrid 路线、实施计划、具体开发任务、环境变更及正式发布。本次只交付文档，不修改运行代码、调用收费 Provider 或变更服务器。

成功分为三种状态，不能混用：

1. **工程适配完成**：构建、自动化回归通过，微信开发者工具可导入。
2. **体验版验收通过**：真实企业 AppID、HTTPS 业务域名下，iOS/Android 微信完整业务与恢复用例通过。
3. **可提审 / 已发布**：资质、备案、隐私和审核资料核对完成 / 平台审核通过且用户明确批准发布。前两项不自动意味着第三项。

## 2. 推荐路线与依据

### 2.1 推荐：Taro 轻量小程序壳 + 完整业务 H5

首版新增独立的小程序壳工作区，使用与现有前端一致的 Taro、React、TypeScript，仅负责固定 H5 入口、加载失败状态和小程序配置。登录、注册、任务、项目、Agent、提案及资料页全部在同一个 H5 应用中运行。保留独立浏览器 H5 入口。

业务链路：微信小程序 WebView → HTTPS H5 → 同源 `/api/v1` → NestJS → 私有 Python Agent。数据库、Run、积分、幂等和最终业务写入继续由现有服务负责。

这一推荐服务于“尽快上线测试”的目标，不把 H5 内嵌理解为绕过服务类目；全部 AI 功能如实申报。Hybrid 的平台审核适用性仍需账号后台/平台确认，不能承诺套壳必定过审。

### 2.2 代码证据

| 现状                                                    | 文件                                                                                     | 对路线的影响                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 只有 H5 dev/build，Taro 4.2.0，未安装微信平台插件       | `apps/client/package.json`                                                               | 不能把现有产物直接上传小程序                         |
| 项目配置为 `touristappid`，`urlCheck: false`            | `apps/client/project.config.json`                                                        | 不是可发布小程序配置，不继承到新壳                   |
| API 为同源 `/api/v1`，请求带浏览器凭证                  | `apps/client/src/app-runtime.ts`、`taro-transport.ts`                                    | 全业务 H5 可沿用 Cookie Session，无需两端 Token 交换 |
| Session 使用 HttpOnly、生产 Secure、SameSite=Lax Cookie | `apps/server/src/modules/users/auth.controller.ts`                                       | 微信 WebView 必须验证真实 Cookie/Origin 行为         |
| Cookie 写请求要求可信 Origin                            | `apps/server/src/platform/http/origin.guard.ts`                                          | 不能靠放开 Origin 校验解决兼容问题                   |
| 弹层焦点、退出动画、任务动效依赖 DOM                    | `packages/ui/src/electric-ink.tsx`、`apps/client/src/components/use-task-list-motion.ts` | 全量编译小程序需重写这些平台能力                     |
| 对话键盘、消息滚动依赖 visualViewport / DOM             | `apps/client/src/components/agent-conversation-dialog.tsx`                               | 内嵌 H5 也须补微信实机兼容验收                       |
| 弹层返回使用 history/popstate                           | `apps/client/src/components/task-home-screen.tsx`                                        | 微信导航返回与网页返回需分别定义                     |
| Agent 轮询以 document.visibilityState 控制              | `apps/client/src/components/use-agent-product.tsx`、`agent-polling.ts`                   | 后台恢复不可只凭 Chrome 结果认定通过                 |
| 已有同源静态站点与 API 反代，但仅 HTTP 测试部署         | `deploy/test/nginx-container.conf`、`docs/quality/2026-10-06-http-test-deployment.md`    | 复用架构，补域名、TLS、缓存与回滚，不直接沿用测试 IP |

### 2.3 比较与取舍

| 路线                         | 收益                                       | 首版代价                                   | 结论                         |
| ---------------------------- | ------------------------------------------ | ------------------------------------------ | ---------------------------- |
| 完整 H5 内嵌                 | 复用页面、登录与业务测试；无跨容器业务同步 | 首屏依赖网络；需处理 WebView 兼容与审核    | 本规格推荐                   |
| 全业务 Taro 编译为小程序页面 | 原生平台能力、后续原生交互更直接           | DOM、Session 传输、布局、动效需专项改造    | 保留为后续方案，不在本期双做 |
| 原生待办 + H5 Agent          | 可局部原生化                               | 两端登录、任务刷新、确认回执和草稿同步复杂 | 不推荐作为首版               |

若合法业务域名下的 Session、安全 Origin 或关键交互无法满足验收，停止 Hybrid 的相关实施切片，修订规格评审原生路线；不通过降低鉴权或隐藏 AI 入口继续上线。

## 3. 产品范围

### 纳入

- 用户名密码注册/登录/退出、Session 恢复、失效处理；同一用户名在两端对应同一 User。
- 手动待办新增、查看、编辑、完成、恢复、软删除及服务端 3 秒撤销；三种时间字段、优先级和项目筛选保持原有口径。
- 项目创建、改名、归档；空态、加载态、错误态和 Smart Inbox。
- 文字 Agent、多轮澄清、计划草稿编辑、通用 Action 确认、结果回执、失败与额度不足降级。
- 微信容器键盘、安全区、返回、断网、前后台切换和重进恢复。
- 企业 AppID 和环境配置、固定 WebView 域名、HTTPS 同源入口、版本/回滚记录、审核材料清单。
- 适用的隐私说明与 AI 生成提示；用户可在登录前查看隐私说明。文案按真实数据流填写。

### 本期不新增

微信登录/OpenID 绑定、手机号授权登录、支付、订阅消息、提醒调度、语音/腾讯 ASR、文件上传、分享私人任务/对话、完整离线编辑、跨设备实时同步、模型服务迁移、业务数据库迁移、算法日志持久化。

语音等尚未实现能力继续保持现有不可用口径，不将其列为本期完成前置条件。跨端数据以同一后端为准，下一次刷新或重新进入读取最新状态，不承诺浏览器与微信自动共享 Cookie 或实时同步。

## 4. 功能与平台契约

### WX-01 壳与环境配置

- 建议新增 `apps/miniprogram`，包名 `@ai-schedule/miniprogram`。与 `apps/client` 分别输出 `dist/`，不得互相覆盖。
- 使用标准微信导航栏；不复制模拟系统状态栏，不叠加原生 TabBar。壳只包含业务 WebView 页面及必要的原生配置/加载失败展示。
- 构建配置区分 development、trial、release；企业 AppID 和 HTTPS H5 Origin 由环境注入。trial/release 构建缺少合法配置时直接失败。
- trial/release 必须启用域名校验，拒绝 touristappid、HTTP、localhost、IP 地址、URL 用户信息、自定义端口及非白名单主机。校验行为有单测，不依赖只在开发者工具手动检查。
- WebView src 由可信构建配置和固定入口生成。忽略启动参数中的 `url`、`redirect`、`token` 等自定义跳转，不接受用户传入任意网页。
- 可携带非敏感的容器标识与发布版本用于展示适配和排查；它们不是身份、权限或计费证据。
- 不打包密码、AppSecret、DeepSeek Key、Session 或服务器环境文件；AppID 是公开配置，不等于登录凭证。

### WX-02 加载与失败

- 固定入口进入 H5 的启动/Session 检查流程。首次渲染不展示其他账号的缓存内容。
- WebView 加载成功事件只代表网页加载，不作为后端健康、登录完成或 AI 成功的证据。
- 收到 WebView 加载错误后卸载 WebView，显示原生错误页及“重试”；不假设普通 View 能覆盖全屏 WebView。无错误回调的挂起场景须在真机确认平台返回/重进入口可用。
- HTML 内提供最小启动状态及资源加载失败/超时后的刷新入口；建议 15 秒仍未完成应用启动时提示重试，不将超时误报为业务失败。
- 不自动连续刷新。重试只重新加载固定网页/查询状态，不自动重发写请求或新建 Agent Run。
- 显式刷新或壳重建可能丢失未发送文本；普通同页关开浮层及未销毁页面的前后台切换应保留内存草稿。已保存计划、提案和 Run 必须可从服务端恢复。

### WX-03 登录、Cookie 与用户隔离

- H5 和 API 使用同一 HTTPS Origin，例如网页与 `/api/v1` 同域反代；本期不引入跨站 Cookie 或壳到 H5 的 SSO 协议。
- 复用 `/api/v1/auth/username/register`、`/api/v1/auth/username/login`、`/api/v1/auth/session` 和 `/api/v1/auth/logout`；不新增微信身份表、不改 User 主键或积分 grant 规则。
- Session Cookie 保留 HttpOnly、Secure、SameSite=Lax，生产可信 Origin 精确匹配部署 Origin。不通过 query、hash、postMessage、localStorage 或小程序 Storage 传递 Session。
- 浏览器和微信可分别登录同一账号，但不承诺共享 Cookie。有效 Cookie 保留时，重新进入恢复 Session；微信清理 Cookie 后正常重新登录。
- 登录过期/撤销后，清除该容器的账号查询缓存和敏感页面。退出失败必须明确反馈，不把服务端撤销失败显示为成功。重新登录 B 后不得出现 A 的任务、提案或迟到响应。
- 按现有语义退出当前 Session；管理员改密撤销全部 Session。不得因为双端存在而扩大普通退出范围。
- 使用真实 WebView 验证 POST/PATCH/DELETE 的 Origin、Set-Cookie、Cookie、401 和 403；不放宽 OriginGuard、不反射任意 Origin，不将微信 Referer 当认证凭据。

### WX-04 UI、键盘与返回

- 保持 Electric Ink 和 Figma Production V3 的内容层级；实现前复核当前 `229:2` 节点。本次未重新读取 Figma，不声称已获新设计验收。
- 标准微信导航栏和胶囊由平台绘制；H5 在剩余可用区域布局，不能重复扣除顶部系统栏高度。底部安全区只计算一次。
- 登录、任务表单、对话输入和计划编辑在键盘打开/收起、长文本与滚动后均可操作；主要按钮触控区域至少 44 CSS px，无横向溢出。
- H5 的关闭按钮必须只关闭当前浮层，不能退出小程序；未保存计划保持现有确认语义。Android 系统返回、iOS 返回手势和微信导航返回单独记录实测行为，不承诺拦截平台关闭动作。
- 当平台实际销毁/退出 WebView 时，不能解释为用户取消提案、确认业务写入或取消服务端 Run；重进后恢复已持久化状态。
- 时间 Picker、项目横向滚动、任务完成分组和删除撤销在 iOS/Android 均可用；仅修改平台不兼容点，其他视觉变化另行评审。

### WX-05 Agent、网络与生命周期

- 保留现有 `202 + requestId` 与轮询流程；只有显式发送/确认触发相应写入，返回前台、页面刷新、读取 Inbox 不调用模型。
- H5 聚焦、pageshow、可见性或联网恢复触发合并后的状态查询。重复事件必须去重，不新建轮询器或重置写意图。
- 前台恢复后正常网络下 5 秒内开始查询已有 Run/Proposal；后台隐藏时停止主动轮询，回到前台恢复。具体 WebView 生命周期信号以实测为准。
- 不把壳 onShow 等同于 H5 visibilitychange；不把 postMessage 用作实时可靠 RPC。若平台恢复信号不足，必须评审补充机制并通过验收，不能留下永久“处理中”。
- 发送/确认中断网、页面重建或请求超时，先查询服务端已有状态。未查明结果前不自动生成新 Idempotency-Key 重做写入，也不自动重派 Python。
- 服务端 3 秒撤销按 expiresAt 计算；后台停留不会延长有效期。过期撤销不得显示成功。
- 维持模型输出纯文本/既有安全渲染，禁止将输出变成任意 HTML、外链跳转或可执行脚本。
- AI 不可用、额度不足或恢复失败均提供明确状态，手动待办保持可用。

### WX-06 通信与网络边界

- 壳不调用业务 API、不读取 User/积分、不维护第二套 Session；本期无业务 JS Bridge、微信登录或 JS-SDK 签名服务。
- H5 与 API 同源；小程序后台配置的是承载 H5 的**业务域名**。原生 request 合法域名与业务域名不是同一设置；本期壳无原生业务请求，不因习惯把所有域名都加入。
- 根路径验证文件应按微信提供的文件名与原文返回，不能被 SPA fallback 返回 index.html；不得打印或替换为伪造文件。
- HTTPS 全链路无混合内容；公开反代只提供网页、必要静态文件和公开 API，`/internal/*`、Python 和 PostgreSQL 不开放。
- 不把后端 HTTP 服务直接视为浏览器公开入口；可信代理的 scheme/host 配置应保留外部 HTTPS 事实，防止反代覆盖为 HTTP。
- 本期不允许任意外部导航或下载；隐私说明为同域固定页面。模型正文中的 URL 不自动变成可导航业务入口。

### WX-07 发布、审核与运行条件

- 企业主体认证由用户办理；另行核查实际 AppID 的 web-view 权限、适用 AI 服务类目、备案和业务域名。认证完成不等于 AI 类目审核完成。
- DeepSeek 直连的资质材料按实际供应关系准备，不把 CloudBase 提供的材料套用到本项目，也不为获取证明自动更换 Provider。
- 提供用户可读的隐私说明、实际第三方模型数据处理说明、适用的 AI 内容标识、联系/反馈方式；具体账号注销/删除渠道等要求由提审材料核查确认，缺失必需项时补充规格，不凭技术完成声称可提审。
- 审核账号使用合成数据，真实走通登录—任务—AI—确认；不按审核身份隐藏 AI、不在审核后远程开启未申报服务。
- 壳版本、H5 版本、API 版本和环境形成发布清单。旧壳与当前及上一已验收 H5 发布版本均可进入；固定入口协议保持兼容。
- index.html 应重新校验缓存；带 Hash 静态资源允许长期缓存并在部署切换后保留旧资源，避免打开中的页面因资源删除白屏。认证/API 响应不被共享缓存。
- H5 发布走同一代码审查、回归和版本记录，不借网页热更新改变已审核服务范围。
- 体验环境与生产配置隔离；已有 HTTP 临时环境不自动升级或覆盖。对真实用户开放前须有 HTTPS、安全 Cookie、权限/限流复验、备份恢复证据、回滚 Runbook 和明确发布批准；不要求按旧 Task 编号逐项推进。
- 企业资质、域名未就绪不阻挡规格和本地工程工作，但不能用开发工具“跳过校验”的结果替代体验版验收。

## 5. 技术栈与项目结构

现有版本：Node.js 24、pnpm 11.8.0、TypeScript 5.9.3、Taro 4.2.0、React 18.3.1、React Query 5.90.12、Vitest 1.6.1、Playwright 1.61.1；NestJS/Fastify、PostgreSQL/Prisma、Python 3.11.15/FastAPI 保持锁文件版本。

新增壳建议沿用 Taro 4.2.0 + React 18.3.1 + TypeScript，并增加同版本 `@tarojs/plugin-platform-weapp`；先确认锁定编译器与 WebView 类型兼容，不顺带升级全仓。依赖与 CI 变更在 PLAN 中列明后审阅。

| 路径                                  | 职责 / 状态                                                  |
| ------------------------------------- | ------------------------------------------------------------ |
| `specs/wechat-mini-program/`          | 本期规格与验收定义；本次新增                                 |
| `apps/miniprogram/`                   | 拟新增壳工作区；config、src/pages、共置 Vitest 配置/状态测试 |
| `apps/client/src/`                    | 现有完整 H5；只补容器兼容、启动失败和恢复适配                |
| `packages/ui/src/`                    | 现有共享样式与组件；按证据修复 WebView 兼容点                |
| `packages/contracts/`                 | 现有公开与内部契约；本期不预设新增业务 API                   |
| `apps/server/`、`apps/agent-service/` | 保留业务与私有推理边界；仅发现实际兼容缺陷时修复             |
| `tests/e2e/`                          | 现有 H5 Playwright；拟补容器场景的浏览器自动化用例           |
| `deploy/wechat/`                      | 拟新增 HTTPS/域名示例与发布说明；不覆盖 `deploy/test/`       |
| `docs/quality/`                       | 后续保存带版本、设备信息的真实验收报告                       |
| `docs/runbooks/`                      | 后续微信开发者工具导入、域名校验、上传、回退手册             |

本推荐需在规格批准后补充客户端 ADR，对 ADR-001 的“未来微信端”明确首版 Hybrid 选择；本草案不悄然替换已批准 PRD/ADR。生产网关选型需与 ADR-007 和现有临时 Nginx 部署协调，在 PLAN 中明确，不同时引入两套生产网关。

## 6. 工程命令

以下均从仓库根目录执行。数据库与 Python 环境前提见 `docs/runbooks/local-development.md`；测试只能指向隔离测试数据库。

### 现有可用入口

```bash
mise exec -- corepack pnpm install --frozen-lockfile
mise exec -- corepack pnpm dev
mise exec -- corepack pnpm --filter @ai-schedule/client build
mise exec -- corepack pnpm --filter @ai-schedule/client test
mise exec -- corepack pnpm lint
mise exec -- corepack pnpm typecheck
mise exec -- corepack pnpm test
mise exec -- corepack pnpm test:integration
mise exec -- corepack pnpm build
mise exec -- corepack pnpm test:e2e
mise exec -- corepack pnpm test:visual
mise exec -- corepack pnpm agent:contract:check
```

真实 Provider 验收是单独的合成数据检查，不进入默认 CI；获准并在环境中安全注入 Key 后使用 `mise exec -- corepack pnpm smoke:deepseek`，不得打印 Prompt、正文或 Secret。

### 拟新增入口（现在尚不存在，不宣称已可运行）

```bash
mise exec -- corepack pnpm --filter @ai-schedule/miniprogram dev
mise exec -- corepack pnpm --filter @ai-schedule/miniprogram build
mise exec -- corepack pnpm --filter @ai-schedule/miniprogram test
mise exec -- corepack pnpm --filter @ai-schedule/miniprogram lint
mise exec -- corepack pnpm --filter @ai-schedule/miniprogram typecheck
```

拟定 dev/build 分别执行 `taro build --type weapp --watch` / `taro build --type weapp`，并在编译前验证配置。环境变量建议为 `WEAPP_APP_ID`、`WEAPP_H5_ORIGIN`、`WEAPP_RELEASE_CHANNEL` 和 `WEAPP_RELEASE_VERSION`；不填虚构 AppID，不默认回落到生产。PLAN 阶段明确注入、Turbo 缓存键、独立壳配置生成方式与根级构建行为，确保不同环境不会复用错误缓存。

微信开发者工具导入 `apps/miniprogram`，其生成配置指向壳 `dist/`；工具版本、基础库、真机微信版本在验收中记录。首次上传保留人工登录与扫码流程，不默认增加 CI 上传密钥或自动发布。

## 7. 代码风格

沿用 ESLint、Prettier：单引号、分号、尾逗号、100 列；React 函数组件，纯函数与平台副作用分离，外部数据作为 unknown 验证。公开业务字段 camelCase，枚举 UPPER_SNAKE，模块仍为 Users / Tasks / Projects / Agent。

下面是仓库现有的真实代码风格示例（`apps/client/src/agent-polling.ts`），不表示本期新增实现：

```ts
export type AgentPollingState = {
  elapsedMs: number;
  pageVisible: boolean;
  terminal: boolean;
};

export function agentPollingInterval({
  elapsedMs,
  pageVisible,
  terminal,
}: AgentPollingState): number | false {
  if (!pageVisible || terminal) return false;
  if (elapsedMs < 10_000) return 1_000;
  if (elapsedMs < 30_000) return 2_000;
  return 5_000;
}
```

新增容器差异集中在小范围 Adapter/Hook；业务组件不散布 UA 判断。错误文案使用“页面加载失败，请重试”等可理解表达，不暴露服务器地址、Token、Prompt 或技术堆栈。

## 8. 测试策略与成功条件

完整编号用例见 [验收矩阵](./acceptance.md)。本次仅定义测试，不将旧 H5 测试通过数当成小程序证据。

- **单元测试 / Vitest**：URL/环境校验、壳加载错误状态、恢复事件去重、轮询和过期判断；共置 `.test.ts(x)`。新增行为先写失败测试，覆盖每个允许与拒绝分支，不制定无意义的全仓覆盖率数字。
- **服务集成 / 现有测试框架**：Cookie 属性、Origin 拒绝、退出/撤销、跨用户隔离、重复确认与积分不变量。只有涉及这些边界的变更才补测试，但核心回归在体验版前必须通过。
- **浏览器 / Playwright**：正式登录和任务路由、键盘/布局、恢复/断网、不同账号、H5 回归；浏览器模拟微信 UA 仅是辅助，不能标注为真机通过。
- **微信开发者工具**：编译、AppID、业务域名、src 白名单、错误页和包体；标准平台检查通过，不预设未经核实的包体/基础库门槛。
- **真机人工**：至少一台 iOS 和一台 Android，真实微信、合法 HTTPS 域名、不跳过校验；覆盖冷启动、Cookie、导航、键盘、前后台、断网、完整 AI 确认与幂等。记录型号/OS/微信/基础库/AppID 环境/壳与 H5/API 版本，不记录凭证。
- **体验性能目标（待随规格确认）**：每台真机在稳定 Wi-Fi 下连续 5 次冷启动，无白屏，全部在 5 秒内出现可操作的登录页或任务页；不含人工输入和模型生成时间。弱网不设伪精确 SLA，但必须有加载/失败反馈及可重试入口。
- **发布回归**：现有 lint、typecheck、build、相关单元/集成、完整 H5 E2E、微信体验矩阵通过；未通过或受外部条件阻挡的项明确记录，不能写成 PASS。

## 9. 边界

### Always

- 保留 H5 可用和现有业务语义；Contract → Schema → Service/API → UI → Test → Docs，仅触及实际需要的层。
- 新行为先失败测试，修复保持切片可验收；记录真实构建、设备与版本证据。
- 继续执行用户确认后写入、原子积分、单次 dispatch、Python 私有无业务数据库和白名单非持久化日志边界。
- 本规格批准后再形成 PLAN，计划批准后拆 TASKS，任务批准后实施；各阶段使用技能规定的审阅门禁。

### Ask first

- Hybrid 改为原生、微信登录、数据库/认证契约改变、增加未列入已批准计划的依赖或 CI 能力。
- 新收费服务、迁移真实数据、改动运行中的服务器/域名配置、正式上传提审或公众发布。
- 明显偏离 Figma 或新增付费、语音、通知、分享、原生业务页等产品范围。
- 需要因 WebView 不兼容改变 Cookie/Origin 安全模型；必须先提出可审阅方案。

### Never

- 以 Hybrid 规避类目或备案，把企业认证等同于 AI 资质齐全。
- 在 URL、Bridge、截图、日志、Git、H5 或壳包中泄露凭证或私人正文。
- 开放任意 URL、移除 Cookie 写请求的 Origin 校验、直连模型或 Python、借前后台事件自动重发业务写入。
- 删除失败测试、伪造真机证据、用开发模式跳过校验代替上线验收，或将旧任务全部勾选完成。

## 10. 审阅点与外部依赖

| 事项                                      | 当前状态                        | 阻挡范围               |
| ----------------------------------------- | ------------------------------- | ---------------------- |
| 完整 H5 Hybrid 路线                       | 本文推荐，待用户审阅            | PLAN 冻结              |
| 用户名密码登录                            | 用户已确认                      | 无需再次询问           |
| 不新增语音等功能，沿用现有能力            | 本文范围建议                    | 规格审阅               |
| 企业认证后实际 AppID、web-view 权限与类目 | 用户办理中，未核实完成          | 合法体验与提审         |
| H5 HTTPS 域名及备案、验证文件             | 未提供                          | 域名绑定与真机联网验收 |
| 受邀测试范围、是否接入真实用户数据        | 默认先合成数据                  | 扩大测试范围前确认     |
| 5 秒冷启动目标、设备/微信支持范围         | 本文建议；PLAN 固定具体验证版本 | 体验验收               |
| 隐私/AI 资质材料、运营联系方式与正式名称  | 待用户/平台核查                 | 提审                   |

用户只需先审阅路线和范围；AppID、域名和资质资料可随开发准备，不需要把 AppSecret 发到聊天。

## 11. 来源与核查限制

- 仓库：PRD、ADR-001/003/007/008/009/011/012、当前源码、2026-10-06 部署报告。历史资料用于确认现状，不限制用户本次授权的专项推进顺序。
- [Taro 平台插件（4.x）](https://docs.taro.zone/docs/platform-plugin/)：微信平台插件与分端编译机制。
- [Taro WebView 组件](https://docs.taro.zone/en/docs/components/open/web-view)：整页容器、业务域名、加载事件和 postMessage 非实时交付。此次可读取的是 3.x 文档，4.2.0 的实际类型、构建和行为仍需在实施验证。
- [微信 WebView 官方入口](https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html)：此次抓取失败；实施/提审时通过后台和开发者工具复核当前规则。
- [腾讯云小程序文档预览接入](https://cloud.tencent.com/document/product/436/122402)：合法业务域名与开发时跳过校验不能替代正式发布条件。
- [CloudBase 主体与 AI 资质说明](https://docs.cloudbase.net/ai/release/algorithm-filing)：非个人主体与 AI 类目材料相互独立；其特定供给链材料不直接适用于当前 DeepSeek 直连。

外部资料核查日期为 2026-10-13；Cookie 持久性、Origin、返回、后台恢复、首屏性能及审核是否接受完整 H5 承载均未在本轮真实微信中验证，必须按验收矩阵取得证据。
