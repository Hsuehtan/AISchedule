# AI 项目待办 P0 高保真 Figma 构建记录

## 文件

- Figma：<https://www.figma.com/design/dryFtYbit291732gktHIqZ>
- Team：`1651559250734964691`
- 创建时间：2026-06-25

## 已完成步骤

- 读取低保真 HTML，识别核心状态、任务数据、项目 tabs、bottom sheet 交互。
- 检查 Figma 新文件，确认初始为空文件。
- 检查设计库：当前文件未接入已有组件；可用社区库包括 Material 3、Simple Design System、iOS UI kits。
- 搜索当前文件设计系统：未找到可直接复用的 button/card/input/tab 组件或变量。
- 检查字体：源原型为系统中文字体栈；Figma 环境可用 `Noto Sans SC`，用于高保真稿。
- 创建 Figma 页面：
  - `00 Cover / Visual Direction`
  - `01 Components`
  - `02 Hi-Fi Screens`
- 创建本地组件样式示意：button、tab、task card、input bar、bottom sheet。
- 创建 4 个关键高保真画板：
  - `Screen / Login`：`4:92`
  - `Screen / Main Todo`：`4:110`
  - `Screen / AI Confirm Sheet`：`4:180`
  - `Screen / Project Management`：`4:281`
- 调整 bottom sheet 高度，确保 AI 确认按钮和项目管理说明完整显示在手机画板内。
- 导出 Figma 预览截图：`design/AI_Project_Todo_P0_HiFi_Figma_Screenshot.png`

## Figma 输出计划

- `00 Cover / Visual Direction`：设计方向、tokens、原型链路说明。
- `01 Components`：本地组件示意，包括 button、tab、task card、bottom sheet、input bar。
- `02 Hi-Fi Screens`：4 个高保真关键状态：
  - 登录页
  - 主待办页
  - AI 建议确认
  - 项目管理

## 校验项

- 通过：所有文本节点回读为 `Noto Sans SC`。
- 通过：4 个手机画板尺寸均为 `390 x 844`。
- 通过：任务列表、tabs、底部输入条和 bottom sheet 与低保真结构一致。
- 通过：AI 确认 sheet 与项目管理 sheet 内容未被底部裁切。
- 通过：色彩、圆角、阴影、间距遵循 `AI_Project_Todo_P0_HiFi_Tokens.json`。

## 结构校验结果

- Figma 页面数：3
- 高保真手机画板数：4
- 文本节点数：147
- 字体族统计：`Noto Sans SC` x 135 个文本分段
