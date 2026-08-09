# AI Project Todo P0 Hi-Fi V2 - 05 Electric Ink Full UI

## Goal

将 `05 Electric Ink` 从单张配色探索扩展为完整高保真 UI 方案。方向不是给低保真交互简单上色，而是建立一套更有产品性和 AI 感的视觉语言：浅冷画布、白色任务纸面、深墨色决策区、高亮青色命令入口，并用洋红、紫、青绿、琥珀区分项目与状态。

## Figma Target

- File: `dryFtYbit291732gktHIqZ`
- Page: `03 Hi-Fi V2 Redesign`
- Board: `05 Electric Ink Full UI System`
- Board node: `17:2`
- Status: created and visually validated

## Visual Direction

- Canvas 使用 `#DDE7F2`，让整套方案比纯白界面更像一个可工作的操作台。
- App 主屏使用 `#F6F9FF`，任务卡与表单使用 `#FFFFFF`，形成清晰层级。
- AI 决策、语音识别、确认计划等高认知负载区域使用 `#101420` 深墨色承载，配合 `#00D8FF` 做命令和焦点。
- 项目身份色保持强区分：洋红 `#FF5F8F`、紫 `#7B61FF`、青绿 `#00BFA6`、琥珀 `#FFB000`。
- 圆角控制在 6-28px：日常控件偏克制，底部 sheet 与手机外框更柔和。

## Screen Set

1. 登录：展示产品入口、账号登录、AI 命令心智。
2. 今日任务：主收件箱、项目筛选、任务列表、底部输入入口。
3. 文字指令：命令输入 sheet、意图 chips、生成计划 CTA。
4. 语音收集：波形、实时转写、识别状态、确认入口。
5. AI 计划确认：AI 解析出的任务、时间、项目与风险提示。
6. 候选任务选择：多候选拆分、勾选、合并确认。
7. 任务编辑：标题、项目、时间、优先级、备注。
8. 项目工作台：项目健康、今日焦点、任务分布。
9. 额度限制：剩余额度、升级/明日继续、降级输入方案。
10. 完成后撤销：完成反馈、撤销 toast、归档状态。

## Component Coverage

- Primary / secondary / dark / destructive buttons
- Project chips
- Task rows
- AI summary cards
- Bottom command composer
- Modal / bottom sheet styles
- Quota progress bar
- Toast feedback

## Local Assets

- Tokens: `design/AI_Project_Todo_P0_HiFi_V2_ElectricInk_Tokens.json`
- Screenshot: `design/AI_Project_Todo_P0_HiFi_V2_ElectricInk_Full_UI_Screenshot.png`

## Validation

- Figma structure check: board contains the visual system panel, component sample panel, and 12 mobile UI states.
- Screenshot check: corrected typography sample wrapping and login hero wrapping after first visual pass.
- Final font: `Noto Sans SC`.
