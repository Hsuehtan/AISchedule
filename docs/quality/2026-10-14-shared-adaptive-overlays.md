# 2026-10-14 共享浮层高度适配

用户截图中的额度提示留白来自共享 BottomSheet 的旧 390px 最小高度。上一轮仅覆盖计划浮层，未修正共享默认。本轮将规则收口到共享 UI，避免业务组件逐个覆盖。

## 统一规则

- `BottomSheet` 与 `Dialog` 共用 `sizing`：默认 `content` 随内容收紧，`expanded` 适合持续对话，`prototype` 仅保留 H1 历史原型尺寸。
- 正式浮层默认最小高度为 0；最大高度取 760px、VisualViewport 可用高度减 24px、容器可用高度减 24px 中的较小值。标题不被压缩，内容区域可滚动，保留安全区。
- 共享 `useModalViewport` 监听 VisualViewport resize/scroll 和 window resize，并在卸载时释放；所有正式浮层共用软键盘避让。
- 额度/语音/服务提示、任务加载/错误/编辑、新建/修改/归档/管理项目、计划草稿、Agent 输入和恢复提示都自动采用默认尺寸。
- Agent 对话显式展开，保留消息区滚动与固定输入区；删除其私有视口监听和高度规则。计划仅保留内部列表/编辑布局，不再单独定义浮层高度。
- 首页麦克风/发送入口补齐显式 tabIndex，修复关闭提示后无法恢复键盘焦点的问题；禁用发送退出 Tab 顺序。
- 关闭时机、焦点管理、动效、请求及业务确认规则保持原实现；未修改服务端协议或计费。

## 验证

- 修改前新增短提示回归失败：底部按钮后存在约 204px 空白，复现共享固定最小高度问题。
- UI 单元测试 11/11、客户端单元测试 89/89 通过。
- UI/客户端 lint、typecheck、E2E ESLint、格式化及 diff 空白检查通过；正式 H5 构建通过。
- 完整 E2E 首轮 35/36 通过；唯一失败是新增关闭提示后的焦点断言，发现首页麦克风入口缺少 tabIndex。修复后，共享浮层、正式输入、按压/焦点定向复跑 3/3 通过。不将分批运行描述为一次完整 36/36。
- 已通过的完整回归包含任务/项目 CRUD、表单版本冲突、计划编辑/重生成/确认、Agent 轮询与幂等、撤销、H1 静态及可访问性。

自动化使用隔离本地服务和合成账号，额度错误由路由夹具模拟，不消耗真实积分。

新增回归覆盖语音提示、额度提示、四视口、底部间距、44px 按钮、焦点恢复、减少动态效果及 axe。VisualViewport 缩小由测试模拟，不等同于实体手机软键盘验收。

- [任务编辑](screenshots/adaptive-task-editor.png)
- [计划列表](screenshots/adaptive-plan.png)
- [草稿编辑](screenshots/adaptive-draft-editor.png)
- [压缩视口对话](screenshots/adaptive-conversation-390x560.png)
- [额度提示 390×844](screenshots/adaptive-quota-390x844.png)
- [额度提示 320×844](screenshots/adaptive-quota-320x844.png)
- [额度提示 480×844](screenshots/adaptive-quota-480x844.png)
- [额度提示 390×560](screenshots/adaptive-quota-390x560.png)

未部署公网，T24 待审及小程序规格状态不变。
