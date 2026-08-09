# AI Project Todo P0 - Electric Ink Component Samples v0.1

## Figma

- File: `dryFtYbit291732gktHIqZ`
- Page: `04 Electric Ink Components`
- Page node: `31:2`
- Board: `Electric Ink Component Samples v0.1`
- Board node: `31:3`

## Source Palette

Based on `05 Electric Ink Recolor / Same Flow`.

- Canvas: `#DDE7F2`
- Screen: `#F6F9FF`
- Paper: `#FFFFFF`
- Ink: `#101420`
- Muted: `#566073`
- AI Action: `#00D8FF`
- Work: `#FF5F8F`
- School: `#7B61FF`
- Life: `#00BFA6`
- Interview: `#FFB000`

## v0.1 Sample Scope

- Color tokens
- Buttons: primary, secondary, dark, ghost, danger, disabled, focus
- Inputs and command composer
- Project chips
- Task rows rebuilt from the approved `Task / 写周报` row style
- AI surfaces: Smart Inbox, bottom sheet, toast
- AI Confirm Sheet: project summary, 5 editable plan items, priority labels, sticky confirm actions
- Project rows
- App Shell & List States: top bar, project tabs, list summary, completed fold, empty state, input bar, toast variants
- Input Sheets: text command sheet, voice recognition sheet, sheet anatomy, prompt examples
- AI Action Confirm Sheet: two dialog states, four message types, fixed composer, scrollable thread, action draft, and state-flow documentation
- Candidates & Task Edit: candidate selection sheet, candidate card, task create/edit sheet
- Project Management & Limit States: project management sheet, quota/limit sheet, login sample, soft-delete and archive states
- Radius / shadow guidelines

## Validation

- Structure checked via Figma metadata.
- Screenshot checked visually; fixed clipped task row and toast by increasing board/section height.
- Added missing `V2 / AI Plan Sheet / Plan Sheet` confirmation overlay and adjusted it so all 5 plan items are visible above the sticky actions.
- Added priority concept to `Task Rows` and `AI Confirm Sheet`.
  - High: red `#FF5F8F`
  - Medium: yellow `#FFB000`
  - Low: green `#00BFA6`
  - Unset: gray `#9AA8BA`
- Replaced the `Task Rows` sample elements with duplicated `Task / 写周报` rows, preserving its time column, vertical strip, task copy block, badge, and check control structure.
- Added missing component samples based on `AI_Project_Todo_P0_LowFi_Clickable_Prototype.html`.
  - `App Shell & List States`
  - `Input Sheets`
  - `AI Action Confirm Sheet`
  - `Candidates & Task Edit`
  - `Project Management & Limit States`
- Extended the board to `1860 x 5270` and moved downstream sections to preserve clear spacing after the expanded AI dialog sample.
- Ran a bounds audit on the newly added sections and fixed clipped / overflowing elements.
  - Resized the app-shell task rows and bottom input bar so they stay inside the phone screen.
  - Expanded the text input sheet, AI action confirm sheet, and project management sheet so footer actions and final rows are not cut off.
  - Enlarged the voice waveform container so tall bars do not overflow.
- Aligned the `App Shell & List States` phone sample task rows with the canonical `Task / 写周报` row structure.
  - Structure: `Time` (`Time Text` + project text), `Copy` (`Task Title` + `Meta`), `priority-dot`, `Check Control`.
  - Adapted the width to the phone sample while keeping the interaction semantics consistent.
- Rebuilt `AI Action Confirm Sheet` as an AI conversation overlay instead of a standalone confirmation form.
  - State A `意图澄清`: type 1 user input, type 2 AI text reply, and type 4 clickable question card.
  - State B `等待确认`: type 1 user reply, type 2 AI explanation, and type 3 operation confirmation card.
  - The dialog header and composer remain fixed while the message thread is scrollable.
  - Clicking a type 4 option is documented as appending a type 1 reply, followed by type 2 and type 3 messages.
  - Type 3 remains the only write-entry point; no data is persisted before confirmation.
- Final AI dialog validation: required message counts verified, with `0` overflow issues and `0` section overlaps.
- Refined the AI dialog visual hierarchy from review feedback.
  - Type 1 user-input bubbles now use a white surface, light blue border, and dark text.
  - Type 1 now mirrors the Type 2 AI reply surface: identical white fill and light gray border, with the cyan `ai-accent` moved to the right edge.
  - Primary dialog actions use Electric Ink cyan `#00D8FF` with dark labels.
  - Send and action-confirm buttons use a smaller footprint with rebalanced composer and footer spacing.
- Screenshot: `design/AI_Project_Todo_P0_ElectricInk_Component_Samples_v0_1.png`

## Suggested Next Iteration

Turn selected samples into stricter reusable components one family at a time: Button, Input, Chip, Task Row, Sheet, Toast, then AI Surface.
