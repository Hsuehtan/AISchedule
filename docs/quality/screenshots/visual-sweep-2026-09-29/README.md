# 2026-09-29 正式产品视觉走查截图

移动端可视化审查见[截图与优化方案 HTML](../../show-me-mobile-ui-review.html)，详细结论见[390px / 320px UI 视觉审查](../../2026-09-29-mobile-ui-review.md)。本轮已为截图增加动画稳定等待，修正部分浮层画面与文件名不一致的问题，并重新采集。

## 采集范围

- 从当前代码构建正式 H5 页面，以 390 x 844 为基线，并对关键页面补拍 320 x 844、480 x 844。
- 使用隔离的 E2E 服务、数据库和合成账号采集；没有修改 `http://127.0.0.1:10087` 上正在运行的服务或用户数据。
- Agent 分支由确定性测试替身提供；额度不足页通过拦截 API 响应模拟，不能视为真实额度耗尽的端到端验证。
- 共 43 张截图。采集脚本为 [`tests/e2e/visual-sweep.spec.ts`](../../../../tests/e2e/visual-sweep.spec.ts)，完整复跑结果为 6/6 通过。
- 本轮只采集和记录，不修改产品代码。Figma 原型展示页不属于正式产品动线，未纳入。

## 截图索引

| 场景 | 截图 |
| --- | --- |
| 登录默认、校验 | [01](01-login-default-390x844.png) · [02](02-login-validation-390x844.png) |
| 注册默认、校验 | [03](03-register-default-390x844.png) · [04](04-register-validation-390x844.png) |
| 空待办首页 | [05](05-tasks-empty-390x844.png) |
| 项目管理空态、新建、校验、有数据、改名、归档确认 | [06](06-project-manager-empty-390x844.png) · [07](07-project-create-empty-390x844.png) · [08](08-project-create-validation-390x844.png) · [09](09-project-manager-populated-390x844.png) · [10](10-project-rename-390x844.png) · [11](11-project-archive-confirm-390x844.png) |
| 待办列表混合优先级，390/320/480 宽 | [12](12-all-todos-mixed-390x844.png) · [13](13-all-todos-mixed-320x844.png) · [14](14-all-todos-mixed-480x844.png) |
| 项目筛选 | [15](15-project-filter-390x844.png) |
| 新建待办空表单、已填表单、窄屏、时间选择 | [16](16-task-create-empty-390x844.png) · [17](17-task-create-filled-390x844.png) · [18](18-task-create-filled-320x844.png) · [19](19-task-datetime-picker-390x844.png) |
| 编辑待办 | [20](20-task-edit-390x844.png) |
| 完成项收起/展开、删除后撤销提示 | [21](21-done-collapsed-390x844.png) · [22](22-done-expanded-390x844.png) · [23](23-delete-undo-toast-390x844.png) |
| Agent 文字输入空态，390/320/480 宽及示例填入 | [24](24-agent-text-empty-390x844.png) · [25](25-agent-text-empty-320x844.png) · [26](26-agent-text-empty-480x844.png) · [27](27-agent-text-example-filled-390x844.png) |
| Agent 文字回复，390/320 宽 | [28](28-agent-reply-390x844.png) · [29](29-agent-reply-320x844.png) |
| 计划草稿、单项编辑、编辑后、待确认入口 | [30](30-agent-plan-draft-390x844.png) · [31](31-agent-plan-item-edit-390x844.png) · [32](32-agent-plan-edited-390x844.png) · [33](33-smart-inbox-pending-plan-390x844.png) |
| 澄清问题，390/320 宽及回答后 | [34](34-agent-clarify-390x844.png) · [35](35-agent-clarify-320x844.png) · [36](36-agent-clarify-answered-390x844.png) |
| 候选选择、Action 确认、待确认入口 | [37](37-agent-candidates-390x844.png) · [38](38-agent-action-confirm-390x844.png) · [39](39-smart-inbox-pending-action-390x844.png) |
| Smart Inbox 整理建议、折叠 | [40](40-smart-inbox-organize-390x844.png) · [41](41-smart-inbox-collapsed-390x844.png) |
| 语音暂不可用、模拟 AI 额度不足 | [42](42-voice-deferred-390x844.png) · [43](43-agent-quota-simulated-390x844.png) |

## 走查时发现

- [计划草稿](30-agent-plan-draft-390x844.png)和[操作确认](38-agent-action-confirm-390x844.png)中的主标题与任务文字明显偏大，窄卡片中换行密集；后续应对照 Production V3 核查字号与布局。
- [Smart Inbox 折叠态](41-smart-inbox-collapsed-390x844.png)的“展开 Smart Inbox”在本次浏览器走查中无法通过普通点击或 Enter 恢复。普通点击被页面中的“一键整理”按钮遮挡；强制点击和 Enter 也未切换状态。此处仅记录现象，未修改实现。

## 未覆盖

- 真实用户现有数据、真实 DeepSeek/ASR 调用、真实额度耗尽与外部服务故障未在截图采集中触发。
- 语音录入/转写目前为延期状态，因此只记录正式页的“暂不可用”浮层。
- 本轮为广覆盖视觉采集，不代替按 Figma 逐像素验收或完整业务回归。
