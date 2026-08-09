# Components Design / 组件设计说明

> Source of truth: Figma page `04 Electric Ink Components` (`31:2`)  
> Figma file: `dryFtYbit291732gktHIqZ`  
> Board: `Electric Ink Component Samples v0.1` (`31:3`)  
> Last reviewed: 2026-07-12

## 1. Document Purpose / 文档目的

本文件描述 AI 项目待办 P0 的 Electric Ink UI building blocks、复合组件、页面状态与 AI interaction patterns。目标读者包括 Product Designer、Frontend Engineer、iOS / Android Engineer、QA，以及后续负责 Figma componentization 的设计系统维护者。

This document records two different levels of truth:

- **Current Figma truth**: 当前 `04 Electric Ink Components` 页面已经画出的结构、尺寸、颜色与行为。
- **Recommended component API**: 为代码实现和后续 Figma Component Set 建议的 props / variants；这些 API 目前并不等于已经存在的 Figma properties。

### Current Asset Status

当前页面是 high-fidelity component samples，而不是已经发布的 production component library：

- Local variable collections: `0`
- Local text styles: `0`
- Local effect styles: `0`
- Local paint styles: `0`
- Component / Component Set / Instance nodes: `0`
- Most elements are editable `FRAME`, `RECTANGLE`, `TEXT`, and icon vector layers.

因此，开发应以本文和当前画面为视觉参考；后续如建立正式 Design System，需要把重复结构转换为 variables、styles、components 和 variants。

## 2. Design Direction / 设计方向

Electric Ink 是一个高对比、AI-forward、但保持任务工具克制感的视觉方案。

### Core Principles

1. **Action cyan is scarce.** `#00D8FF` 只用于主操作、输入 focus、AI accent 和 active state，不作为大面积背景。
2. **Ink means decision.** `#101420` 用于正文、强反馈 toast、重要 AI panel 或需要明确决策的区域。
3. **Project colors mean identity.** 项目色只表达归属，不表达按钮层级。
4. **Paper first.** 日常任务、表单、列表和 sheet 以白色或极浅蓝 surface 为主，避免一整屏单色。
5. **Same flow, clearer hierarchy.** 交互与低保真流程保持一致，视觉只增强信息层级、反馈和可扫描性。

## 3. Foundations / 基础视觉

### 3.1 Core Color Tokens

| Token | Value | Usage / 用途 |
|---|---:|---|
| `color.canvas` | `#DDE7F2` | Figma board、页面外层背景、分组背景 |
| `color.screen` | `#F6F9FF` | App screen、thread、输入区浅底 |
| `color.paper` | `#FFFFFF` | Card、row、sheet、dialog surface |
| `color.ink` | `#101420` | Primary text、dark panel、toast |
| `color.inkSoft` | `#263044` | 次级深色 surface，可选 |
| `color.muted` | `#566073` | Secondary text、helper copy |
| `color.faint` | `#9AA8BA` | Disabled text、placeholder、unset state |
| `color.line` | `#D7E0EC` | Default divider / border |
| `color.lineStrong` | `#B7C6D8` | Emphasized border、secondary button |
| `color.aiAction` | `#00D8FF` | Primary action、AI accent、focus、active |
| `color.brandSoft` | `#BFF5FF` | Cyan supporting surface |
| `color.brandWash` | `#E7FAFF` | Selected chip、AI tag、soft focus background |
| `color.brandInk` | `#061018` | Text on cyan primary action |

### 3.2 Project Identity Colors

| Project role | Value | Example |
|---|---:|---|
| Work / 工作 | `#FF5F8F` | 工作项目 dot、danger family |
| School / 孩子上学 | `#7B61FF` | 上学项目 identity |
| Life / 生活 | `#00BFA6` | 生活项目 identity、success |
| Interview / 面试准备 | `#FFB000` | 面试项目 identity、warning |

Project color should appear as a small dot, progress fill, or compact identity mark. 不应把整个任务卡片填成项目色。

### 3.3 Priority Colors

| Priority | Color | Meaning |
|---|---:|---|
| High / 高 | `#FF5F8F` | 今天必须优先处理 |
| Medium / 中 | `#FFB000` | 近期推进即可 |
| Low / 低 | `#00BFA6` | 有空时处理 |
| Unset / 未设置 | `#9AA8BA` | 用户后续设置 |

Priority 在 AI Confirm Sheet 中使用 `pill + dot + label`；在紧凑 Task Row 中使用 trailing dot，并通过项目文字和 accessible label 避免只依赖颜色。

### 3.4 Typography

Primary font family is `Noto Sans SC`. 页面中少量较早的说明组件使用 `Inter`，新组件应优先归一到 Noto Sans SC，除非需要拉丁字符或 code label 的稳定字宽。

| Role | Size / Line height | Weight | Typical usage |
|---|---|---|---|
| Display | `34 / 44` | Bold | Board title |
| Page title | `24 / 32-34` | Bold | Large component section title |
| Section title | `20-22 / 28-30` | Bold | Component family heading |
| Sheet title | `18-22 / 24-30` | Bold | Sheet / dialog heading |
| Component title | `14-16 / 20-23` | Bold | Card title、task title |
| Body | `13-15 / 19-22` | Regular | Main content、descriptions |
| Label | `11-13 / 16-18` | Medium / Bold | Field label、chip、button |
| Caption | `9-11 / 12-16` | Regular / Medium | Meta、helper、code tag |

Guidelines:

- Do not scale text with viewport width.
- 中文正文建议最小 `12px`；`9-11px` 只用于 component annotation、meta 或 compact tag。
- Button label default is `14px Bold`; compact dialog actions use `11px Bold`.
- Letter spacing remains `0` unless a future brand rule explicitly changes it.

### 3.5 Spacing

Recommended spacing scale:

| Token | Value |
|---|---:|
| `space.xs` | `4px` |
| `space.sm` | `8px` |
| `space.md` | `12px` |
| `space.lg` | `16px` |
| `space.xl` | `24px` |
| `space.xxl` | `32px` |

Common composition rules:

- Compact icon-to-label gap: `8px`
- Row internal gap: `10-12px`
- Card internal padding: `16px`
- Sheet horizontal padding: `20-24px`
- Repeated list item gap: `8-12px`
- Major section gap: `24-40px`

### 3.6 Radius and Effects

| Spec | Value | Usage |
|---|---:|---|
| `radius.sm` | `8px` | Buttons、small input |
| `radius.md` | `12px` | Project row、toast、standard card |
| `radius.lg` | `16px` | AI panel、section、message card |
| `radius.sheet` | `22px` | Bottom sheet / dialog shell |
| `radius.full` | `999px` | Pill、chip、status tag |

Current mismatch to normalize later: Task Row samples currently render at `18px` radius, while the board guideline says rows should use `12px`. 在正式组件化时应选定一个值，不要继续双轨。

Effect guidance:

- Standard card: Ink shadow around `7%` opacity.
- AI emphasis: cyan glow / shadow around `18%` opacity.
- Sheets use a broader, softer Ink shadow; avoid dark floating-card stacks.
- Borders are usually `1px`; action confirm card may use `1.5px` Ink stroke.

## 4. Component Naming / 命名规则

Current Figma layers generally use slash-based names:

```text
section/Buttons
button/primary/default
button/label/一键整理
input/bg/密码
chip/dot/工作
Task / 写周报
message/type-3-ai-action-confirm-card
sheet/project-management
```

Recommended production naming:

- Component family: PascalCase, e.g. `TaskRow`, `PriorityLabel`, `AiDialog`.
- Figma variants: `Property=Value`, e.g. `Style=Primary, State=Default, Size=Medium`.
- Internal layers: semantic kebab-case, e.g. `task-title`, `project-meta`, `check-control`.
- Avoid user-facing copy in structural layer names when the same component is reusable.

## 5. Component Catalog / 组件目录

| Family | Figma section | Main purpose |
|---|---|---|
| Color Tokens | `31:7` | Palette and semantic color reference |
| Buttons | `31:38` | Primary、secondary、dark、ghost、danger、disabled、focus |
| Inputs & Chips | `31:67` | Login fields、command composer、project filters |
| Task Rows | `51:2` | Time + project + task copy + priority + completion |
| AI Surfaces | `31:127` | Smart Inbox、sheet shell、toast |
| Project Rows | `31:152` | Project identity、count、progress、archive |
| AI Confirm Sheet | `51:51` | AI plan review、priority suggestion、batch create、task edit |
| App Shell & List States | `149:2` | Main task screen and list feedback states |
| Input Sheets | `149:108` | Text input、voice input、prompt shortcuts |
| AI Action Confirm Sheet | `149:179` | AI dialog message system and write confirmation |
| Project Management & Limit States | `149:273` | Project management、quota、auth、delete/archive rules |
| Spacing / Radius / Effects | `31:187` | Reusable visual specifications |

## 6. Buttons

### 6.1 Default Button Family

Current sample dimensions:

| Style | Visual size | Fill / Border | Label |
|---|---:|---|---|
| Primary | `144 x 42` | `#00D8FF` | `#061018`, Bold |
| Secondary | `132 x 42` | White + `#B7C6D8` border | Ink |
| Dark | `132 x 42` | Ink | White |
| Ghost | `132 x 42` | White + subtle border | Ink |
| Danger | `132 x 42` | `#FF5F8F` | White |
| Disabled | `144 x 42` | `#D7E0EC` at about `65%` | `#9AA8BA` |
| Focus ring | visual button + `3px` outer area | Cyan stroke + brand wash | unchanged |

Anatomy:

```text
Button
├── optional leading icon, 18 x 18
└── label, 14px Bold
```

Rules:

- One dominant primary action per local decision area.
- Primary cyan uses dark text, not white text.
- Dark button is reserved for special entry points such as voice or high-emphasis Ink surfaces.
- Danger is for destructive actions only; soft-delete still provides Undo.
- Visual height may be `38-42px`, but interactive hit target should be at least `44px`.

### 6.2 Compact Dialog Actions

AI dialog currently uses smaller controls:

- Send button: `52 x 38`, cyan fill, Ink label.
- Confirm action: `146 x 42`, cyan fill, Ink label.
- Continue dialog: `132 x 42`, white surface, Ink border and label.

These controls are visually compact; implementation should add invisible hit slop where required.

## 7. Inputs and Composer

### 7.1 InputField

Current sample: `236 x 46`, `10px` radius.

Anatomy:

```text
InputField
├── label
├── field surface
├── value / placeholder
└── optional focus accent, 4px on leading edge
```

States:

- Default: Screen fill + lineStrong border + faint placeholder.
- Filled: Screen fill + Ink text.
- Focused: cyan border + `4px` cyan leading accent.
- Disabled: muted text and lower-emphasis border.
- Error is not yet drawn on this page and must be specified before implementation.

### 7.2 CommandComposer

Current sample: `496 x 58`, `12px` radius.

Anatomy:

```text
CommandComposer
├── AI spark icon
├── title: 告诉我下一件事
├── hint: 输入文字，或长按说话
├── keyboard entry
└── microphone action
```

The composer is the persistent creation entry. Text and voice are input modes that converge into the same Agent processing pipeline.

### 7.3 ProjectFilterChip / ProjectTab

Current compact chip: `64 x 30`, pill radius `15px`.

States:

- Active All: brand wash fill + cyan border + cyan dot.
- Inactive project: white fill + line border + project identity dot.
- Manage: uses the same compact structure but triggers project management.

Do not use project color as the chip background. Keep it as an `8px` identity dot.

## 8. TaskRow

Canonical reference: `Task / 写周报` (`153:2`).

Current sample size: `354 x 76`.

Anatomy:

```text
TaskRow
├── Time, 43 x 40
│   ├── Time Text
│   └── project
├── Copy, 210 x 42
│   ├── Task Title
│   └── Meta: deadline + reminder
├── priority-dot, 10 x 10
└── Check Control, 24 x 24
```

Behavior:

- Click row body: open Task Edit Sheet.
- Click Check Control: mark complete / restore.
- Completion moves the task to the bottom Completed Fold.
- Project must remain readable as text; priority is a separate status.
- High / medium / low / unset priority should not replace project identity.

States:

- Pending / default
- Pending / priority high, medium, low, unset
- Done: lower emphasis, optional strikethrough, project and priority remain visible
- Pressed / focused: not yet documented as dedicated variants

## 9. ProjectRow

Current sample size: `360 x 66`, radius `12px`.

Anatomy:

```text
ProjectRow
├── project dot, 10 x 10
├── project name
├── task count / status copy
├── progress track, 92 x 5
├── progress fill
└── archive action, 20 x 20
```

Rules:

- Project dot and progress fill use the project identity color.
- Count copy may include AI suggestion text, e.g. `2 个无项目建议归入`.
- Archive removes the project from horizontal tabs and management entry, but tasks remain visible in `全部`.
- An empty project still renders a row with `0 个待办`.

## 10. PriorityLabel

Reusable priority label uses `pill + dot + text`.

Recommended API values:

```text
high | medium | low | unset
```

Usage:

- AI recommendation in Plan Confirm Sheet
- Task editing state
- Sorting / scanning feedback
- Compact task list may use dot-only visual, but code must still provide an accessible text label

Priority is editable. AI suggestion is not a locked system decision.

## 11. AI Surfaces and Feedback

### 11.1 SmartInboxPanel

Current sample: `512 x 112`, Ink fill, `16px` radius.

Purpose: summarize AI-discovered cleanup opportunities, such as unassigned tasks, and expose one focused action.

Rules:

- Use Ink background for a high-value AI suggestion, not for every card.
- Keep recommendation copy concrete and reversible.
- Primary action remains cyan.

### 11.2 Toast

Base sample: `320 x 52`, Ink fill, `12px` radius.

Supported messages include:

- 已创建 5 个任务，可撤销
- 已将“写周报”标记完成
- 待办已保存
- 已软删除待办

Behavior:

- Toast appears after a completed action.
- Use `撤销` for reversible creation, completion and deletion.
- Use `知道了` only for informational feedback.
- Toast does not block the main workflow.

### 11.3 BottomSheetShell

Shared sheet anatomy:

```text
BottomSheet
├── drag handle
├── title
├── supporting description
├── scrollable or fixed content
└── fixed footer actions
```

Current sheet radius is `22px`. Footer actions must remain visible when content scrolls.

## 12. AI Plan Confirm Sheet

Purpose: review an AI-generated project plan before batch creation.

Anatomy:

```text
AIPlanConfirmSheet
├── title: 计划草稿
├── subtitle
├── project summary
│   ├── project title
│   └── count + AI priority summary
├── editable plan items x 5
│   ├── index
│   ├── task title
│   ├── priority label
│   └── edit action
└── fixed footer
    ├── 再改一下
    └── 创建 5 项
```

Interaction rules:

- No project or task is created before confirmation.
- Each plan item can be edited independently.
- AI may recommend priority; user remains in control.
- Confirm creates the project and all five tasks as one batch.
- Success feedback uses a reversible toast.
- Do not duplicate priority information with an extra leading color dot when the pill already communicates it.

## 13. Task Edit Sheet

Fields are aligned with the low-fidelity interaction model:

| Field | Required | Notes |
|---|---|---|
| Title / 标题 | Yes | Main task name |
| Project / 所属项目 | No | Supports no-project task |
| Priority / 优先级 | No | high / medium / low / unset |
| Description / 描述 | No | Can be empty |
| Deadline | No | Date or relative date |
| Reminder / 提醒时间 | No | Separate from deadline |

Footer actions:

- Delete: danger action, implemented as soft delete.
- Save: primary cyan action.

## 14. Input Sheets

### 14.1 TextInputSheet

Contents:

- Title and Agent explanation
- Clickable prompt examples
- Text input field
- Cancel and Send actions

Prompt examples are lightweight shortcuts, not marketing content. Each prompt must be clickable, replaceable and mapped to a real Agent branch.

Current examples:

- 拆分新项目
- 普通写操作
- 候选消歧
- 设置优先级
- 标记完成

### 14.2 VoiceInputSheet

Contents:

- Listening state
- Voice waveform
- Recognized text result
- Retry and Continue actions

Voice is an input adapter only. Recognition output enters the same text-based Agent logic as typed input.

## 15. App Shell and List States

The main task screen includes:

```text
AppShell
├── top bar + add action
├── horizontally scrollable project tabs
├── main list summary
├── pending TaskRows
├── Completed Fold
├── optional Empty State
└── persistent CommandComposer
```

### Main List Summary

Displays current scope information:

```text
待完成 4 · 高优先级 1 · 当前栏目：全部
```

### Completed Fold

- Completed items move below pending items.
- Fold label includes item count.
- Expanded rows use done state.

### Empty State

- Appears only for the active filter with no matching tasks.
- Creation entry remains the persistent text / voice composer.

### Done Task Row

- Lower visual emphasis.
- May use strikethrough.
- Keep project and priority for review context.

## 16. AI Action Dialog / AI 对话浮层

This pattern is an AI conversation overlay, not a standalone form. It contains a fixed header, scrollable thread and fixed composer.

### 16.1 Message Types

| Type | Name | Alignment | Visual treatment | Responsibility |
|---|---|---|---|---|
| 1 | User Input Bubble | Right | White + light gray border + cyan accent on right | Record typed input or clicked option |
| 2 | AI Text Reply Bubble | Left | White + light gray border + cyan accent on left | Explain intent and next step |
| 3 | AI Action Confirm Card | Left / full width | Paper + Ink border + action code | Show target and data changes; confirm write |
| 4 | AI Question Card | Left / full width | Paper + selectable options | Clarify ambiguous intent |

Type 1 and Type 2 are horizontal mirrors:

- Same white fill.
- Same `#C2CFDE`-family border.
- Same cyan `ai-accent`.
- Type 1 accent is on the right; Type 2 accent is on the left.
- Type 1 remains right aligned; Type 2 remains left aligned.

### 16.2 Dialog States

**State A: 意图澄清**

- Type 1 user message
- Type 2 AI explanation
- Type 4 question card with candidate choices
- Clicking an option creates a new Type 1 reply

**State B: 等待确认**

- Type 1 user reply
- Type 2 AI explanation
- Type 3 Action Confirm Card
- Continue Dialog or Confirm Action

### 16.3 Action Confirm Card

Required content:

- Human-readable action title
- Machine-readable action code, e.g. `create_task`
- Target object
- Field change
- Expected display change
- Continue dialog action
- Confirm action

Fixed rules:

1. Conversation thread scrolls; header and composer remain fixed.
2. Type 3 confirmation is the only write gateway; no persistence before confirmation.
3. Closing the dialog does not change data.
4. After execution, return to the task list and show Undo-capable toast.

State flow:

```text
意图澄清 -> 点击选项 -> 等待确认 -> 执行并回执
```

## 17. Project Management and Edge States

### 17.1 ProjectManagementSheet

Supports:

- Create project
- Rename project
- Archive project
- Display project task counts

Archived project behavior: hide from project tabs and management entry, but keep its tasks in `全部`.

### 17.2 QuotaLimitSheet

User-facing copy explains temporary unavailability without exposing internal billing mechanics.

Do not show:

- Token usage
- Model cost
- Point balance
- Recharge entry

Current message pattern:

```text
智能处理暂不可用
今日智能处理次数已达体验上限
明天可以继续使用。
```

### 17.3 Login Sample

Minimal P0 authentication surface:

- Account / email
- Password
- Login action
- Registration link

### 17.4 Soft Delete State

Delete is reversible during a short feedback window. Use toast with `撤销`.

### 17.5 Archived Project State

Archive changes navigation visibility, not task ownership or task visibility in All Tasks.

## 18. Interaction and Feedback Matrix

| User action | Immediate UI result | Persistence rule | Feedback |
|---|---|---|---|
| Complete task | Row enters done state and moves to fold | Immediate, reversible | Toast + Undo |
| Restore task | Row returns to pending list | Immediate, reversible | Toast + Undo |
| Edit task | Open Task Edit Sheet | Save only on confirmation | Saved toast |
| Delete task | Remove from active list | Soft delete first | Toast + Undo |
| Create AI plan | Open AI Plan Confirm Sheet | No write before confirm | Batch success toast |
| Select AI answer | Append Type 1 message | No write | AI continues conversation |
| Confirm AI action | Execute Type 3 action | Write only here | Return to list + Undo toast |
| Archive project | Hide project navigation entry | Preserve tasks | Archived state |
| Reach AI limit | Open QuotaLimitSheet | No write | Informational acknowledgement |

## 19. Accessibility / 可访问性

- Interactive hit targets should be at least `44 x 44px`, even when the visible control is smaller.
- Do not communicate project or priority through color alone; provide text or accessible labels.
- Focus state must use more than subtle color change. Use cyan border / ring plus platform focus semantics.
- Body text contrast should meet WCAG AA against Paper and Screen surfaces.
- Toast action must be keyboard and screen-reader accessible.
- Sheets must trap focus while open and restore focus to the triggering control on close.
- AI confirmation must announce that no write occurs before confirmation.
- Voice recognition result must be editable or restartable.
- Destructive controls require clear labels; icon-only controls need accessible names.

## 20. Responsive Behavior / 响应式规则

- Phone sheets use full width with fixed horizontal padding and max-height scrolling.
- Header and footer remain fixed; content area owns scrolling.
- TaskRow uses stable tracks for time, copy, priority and completion control.
- Long project or task names truncate to one line in compact rows; full content is available in edit/detail view.
- Project tabs scroll horizontally and must not compress labels below readable width.
- Dialog message bubbles use a max width; user messages align right and AI messages align left.
- Text must never overlap actions, status chips or scrollbars.

## 21. Recommended Component API

The following interfaces are implementation guidance, not existing Figma component properties.

```ts
type Priority = "high" | "medium" | "low" | "unset";

type ProjectTone = "work" | "school" | "life" | "interview" | "neutral";

interface ButtonProps {
  style: "primary" | "secondary" | "dark" | "ghost" | "danger";
  size?: "compact" | "medium";
  state?: "default" | "focused" | "pressed" | "disabled";
  label: string;
  icon?: IconName;
}

interface TaskRowProps {
  title: string;
  project?: string;
  projectTone?: ProjectTone;
  time?: string;
  deadline?: string;
  reminder?: string;
  priority: Priority;
  completed: boolean;
  onOpen(): void;
  onToggleComplete(): void;
}

interface ProjectRowProps {
  name: string;
  tone: ProjectTone;
  taskCount: number;
  progress?: number;
  archived?: boolean;
  onRename(): void;
  onArchive(): void;
}

interface ToastProps {
  message: string;
  actionLabel?: "撤销" | "知道了";
  onAction?(): void;
}

type AiDialogMessage =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "action-confirm"; draft: ActionDraft }
  | { type: "question"; prompt: string; options: QuestionOption[] };

interface ActionDraft {
  code: string;
  title: string;
  target: string;
  fieldChange: string;
  displayChange: string;
}

interface AiDialogProps {
  state: "clarifying" | "waiting-confirmation" | "executing" | "completed";
  messages: AiDialogMessage[];
  onSend(text: string): void;
  onSelectOption(optionId: string): void;
  onConfirmAction(): void;
  onClose(): void;
}
```

## 22. Known Gaps / 当前缺口

1. Figma currently has no variables, styles or Component Sets; token binding is not yet enforced.
2. Task Row samples contain duplicated frames; `153:2` should become the canonical master.
3. Typography uses both Noto Sans SC and Inter; future components should normalize font ownership.
4. Task Row actual radius (`18px`) conflicts with the global row guideline (`12px`).
5. Error, loading, hover and pressed states are not fully documented for every component.
6. Candidate selection is currently represented inside the Type 4 AI Question Card rather than a standalone component section.
7. Figma node IDs can change after manual edits; use semantic names as the long-term reference.

## 23. QA Checklist / 验收清单

- [ ] Primary actions use `#00D8FF` with dark Ink text.
- [ ] Project color is used for identity, not action hierarchy.
- [ ] Priority label and project identity remain independent.
- [ ] Task rows preserve time, project, title, meta, priority and completion control.
- [ ] Sheets keep footer actions visible while content scrolls.
- [ ] AI Type 1 and Type 2 bubbles are mirrored surfaces with opposite-side cyan accents.
- [ ] AI Type 3 is the only write confirmation gateway.
- [ ] AI Type 4 options append a user reply before creating an action draft.
- [ ] Create, complete and soft-delete flows provide reversible toast feedback.
- [ ] Archived projects do not hide their tasks from All Tasks.
- [ ] Compact controls retain at least a `44px` interactive hit target.
- [ ] No text, button, scrollbar or card overlaps at supported viewport sizes.

