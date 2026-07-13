# Agent 工作约定

## 开始前

1. 阅读 `README.md`、`tasks/current.md` 和当前任务关联 ADR。
2. 运行 `git status --short --branch`，不得覆盖未说明的用户改动。
3. 一个任务只处理一个可验收目标；大于 M 的任务继续拆分。

## 实现纪律

- 采用 Contract -> Schema -> Service/API -> UI -> Test -> Docs 的纵向切片。
- 新行为先写失败测试，再写最小实现。
- 每个切片必须保持构建和已有测试可用。
- 模块仅允许通过公开 Service/Contract 协作，禁止跨模块直写数据表。
- 业务对象只引用 `user_id`，不得把用户名作为业务外键。
- 所有 Agent 写操作必须经过确认；模型输出不能直接执行数据写入。
- 不记录密码、Session、API Key、完整私人待办、原始音频或完整 Prompt。
- 不引入 P1/P2 或未在 PRD/ADR 中批准的功能。

## 命名

- 业务模块统一使用 `Users`、`Tasks`、`Projects`、`Agent`。
- 禁止新增 `AIAgent` 命名。
- 公开 API 使用 `/api/v1`，字段 camelCase，枚举值 UPPER_SNAKE。

## 完成定义

- 验收条件、受影响测试、lint、typecheck、build 全部通过。
- API、数据库、配置或 UI 行为变化已同步对应文档。
- 更新 `tasks/todo.md` 与 `tasks/current.md`。
- 形成原子 Conventional Commit，且不提交 Secret、构建产物或用户未授权文件。

## 人类门禁

- H1：T09 后审查交互壳。
- H2：T17 后审查真实手工闭环。
- H3：T27 后审查 Agent/积分/语音。
- H4：T30 后批准生产发布。

到达门禁必须暂停。涉及不可逆数据操作、生产部署、新付费服务、安全降级或明显偏离 Figma 时提前暂停。
