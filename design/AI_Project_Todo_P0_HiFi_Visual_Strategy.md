# AI 项目待办 P0 高保真 UI 视觉方案

## 1. 输入来源

- 低保真原型：`design/AI_Project_Todo_P0_LowFi_Clickable_Prototype.html`
- Figma 文件：<https://www.figma.com/design/dryFtYbit291732gktHIqZ>
- 目标设备：移动端，主画板按 iPhone 14/15 逻辑尺寸 `390 x 844` 设计
- 产品字体来源：原型 CSS 使用系统中文字体栈 `-apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, Arial, sans-serif`
- Figma 字体决策：Figma 环境可用 `Noto Sans SC`，高保真稿使用 `Noto Sans SC` 作为中文界面字体

## 2. 设计定位

这是一个“AI 辅助的项目待办”工具，不做营销感，也不做过度拟物。视觉目标是：

- **可信赖**：待办管理需要稳定、低干扰，基础面以冷白、墨色、低饱和边框为主。
- **AI 感但不炫技**：AI 入口使用青蓝到蓝紫的轻渐变，强调“帮你处理”而不是抢主流程。
- **单手高频操作**：底部输入条是主操作入口，bottom sheet 是主要决策层。
- **清晰状态**：高优先级、完成、无项目、候选选择、额度提示都有可扫描的视觉状态。

## 3. 信息架构保留

低保真原型中的 P0 结构保持不变：

- 登录页
- 全部 / 项目横向 tabs
- 待完成任务列表
- 已完成折叠区
- 文字输入 sheet
- 语音输入 sheet
- AI 建议确认 sheet
- 候选选择 sheet
- 待办编辑 sheet
- 项目管理 sheet
- 额度提示 sheet
- toast 撤销

高保真 Figma 稿优先覆盖 4 个关键状态：

1. 登录页
2. 主待办页
3. AI 建议确认 bottom sheet
4. 项目管理 bottom sheet

## 4. 视觉系统

### 色彩

- `Surface / App`: `#F6F8FB`
- `Surface / Card`: `#FFFFFF`
- `Text / Primary`: `#111827`
- `Text / Secondary`: `#6B7280`
- `Line / Soft`: `#E5E7EB`
- `Brand / Primary`: `#2563EB`
- `Brand / Accent`: `#06B6D4`
- `Brand / Purple`: `#7C3AED`
- `Semantic / Warning`: `#F59E0B`
- `Semantic / Danger`: `#EF4444`
- `Semantic / Success`: `#16A34A`

### 字体

- 字体族：`Noto Sans SC`
- 页面标题：24 / 32, Bold
- 导航标题：20 / 28, Bold
- 卡片标题：15 / 22, Medium
- 正文：13 / 20, Regular
- 辅助信息：11 / 16, Regular

### 圆角和阴影

- 手机画板圆角：36
- App 容器圆角：28
- 卡片圆角：16
- 输入条圆角：18
- Bottom sheet 顶部圆角：24
- 阴影：柔和扩散，避免卡片堆叠过重

## 5. 组件原则

- **Tab**：胶囊形，当前项目用品牌深色填充，其余为浅底描边。
- **Task card**：左侧完成圆点，中间标题和 meta，右侧优先级 chip。
- **Input bar**：底部固定，文字入口占主宽，键盘与麦克风使用圆形图标按钮。
- **Bottom sheet**：上方增加 drag handle，内容区保留解释文案和可编辑列表。
- **Toast**：深色浮层，操作文字保持白色并强调撤销。

## 6. 交付说明

本方案已写入 Figma 文件，并在 `design` 文件夹保留过程文件：

- `AI_Project_Todo_P0_HiFi_Visual_Strategy.md`
- `AI_Project_Todo_P0_HiFi_Tokens.json`
- `AI_Project_Todo_P0_HiFi_Figma_Build_Log.md`

