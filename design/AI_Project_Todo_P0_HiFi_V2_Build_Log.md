# AI 项目待办 P0 高保真 UI V2 构建记录

## 触发原因

用户反馈：上一版“太丑，基本只是给交互上了色”。本次按全新 UI 设计重做，不在 V1 上微调。

## 已完成的前置检查

- 重新读取 Figma 技能说明。
- 读取低保真 HTML，确认 P0 交互边界。
- 搜索 Code Connect：未发现 `*.figma.ts(x/js)`。
- 检查 Figma 文件：没有可复用组件库，V2 需自建本地视觉系统。
- 检查字体：继续使用可用中文字体 `Noto Sans SC`。

## V2 输出计划

- 新增 Figma 页面：`03 Hi-Fi V2 Redesign`
- 新增本地过程文件：
  - `AI_Project_Todo_P0_HiFi_V2_Redesign_Strategy.md`
  - `AI_Project_Todo_P0_HiFi_V2_Tokens.json`
  - `AI_Project_Todo_P0_HiFi_V2_Build_Log.md`
  - `AI_Project_Todo_P0_HiFi_V2_Figma_Screenshot.png`

## 待回填

- Figma V2 wrapper node id：`7:3`
- Figma 页面：`03 Hi-Fi V2 Redesign`，node id `7:2`
- V2 画板：
  - `V2 Design System Notes`：`7:6`，`430 x 844`
  - `V2 / Login`：`7:33`，`390 x 844`
  - `V2 / Today Inbox`：`7:57`，`390 x 844`
  - `V2 / AI Plan Sheet`：`7:141`，`390 x 844`
  - `V2 / Project Console`：`7:266`，`390 x 844`
- 字体回读结果：149 个文本分段全部为 `Noto Sans SC`
- 本地截图：`AI_Project_Todo_P0_HiFi_V2_Figma_Screenshot.png`
- 本地截图尺寸：`1800 x 838`

## 校验结论

- 通过：V2 单独建页，没有覆盖 V1。
- 通过：手机画板尺寸一致。
- 通过：文本字体一致。
- 通过：AI sheet 与项目管理 sheet 底部按钮和说明未裁切。
- 通过：视觉语言与 V1 明显区分，不再是低保真线框上色。
