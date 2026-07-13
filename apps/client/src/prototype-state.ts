export const prototypeScreens = [
  { id: 'login', label: '登录', figmaNode: '230:7' },
  { id: 'all-todos', label: '全部待办', figmaNode: '230:10' },
  { id: 'agent-plan', label: 'Agent 计划', figmaNode: '230:13' },
  { id: 'work-project', label: '工作项目', figmaNode: '231:4' },
  { id: 'empty-state', label: '空状态', figmaNode: '231:7' },
  { id: 'done-expanded', label: '已完成展开', figmaNode: '231:10' },
  { id: 'toast-undo', label: '完成与撤销', figmaNode: '231:13' },
  { id: 'text-input', label: '文字输入', figmaNode: '232:4' },
  { id: 'voice-input', label: '语音输入', figmaNode: '232:7' },
  { id: 'candidates', label: '候选消歧', figmaNode: '232:10' },
  { id: 'agent-clarify', label: 'Agent 澄清', figmaNode: '232:13' },
  { id: 'agent-confirm', label: 'Agent 确认', figmaNode: '232:16' },
  { id: 'task-edit', label: '编辑待办', figmaNode: '232:19' },
  { id: 'project-management', label: '项目管理', figmaNode: '232:22' },
  { id: 'quota-limit', label: '额度不足', figmaNode: '232:25' },
] as const;

export type PrototypeScreen = (typeof prototypeScreens)[number]['id'];

const screenIds = new Set<string>(prototypeScreens.map(({ id }) => id));

export function isPrototypeScreen(value: string): value is PrototypeScreen {
  return screenIds.has(value);
}

export function parsePrototypeScreen(search: string): PrototypeScreen {
  const value = new URLSearchParams(search).get('screen');
  return value && isPrototypeScreen(value) ? value : 'all-todos';
}

function movePrototypeScreen(screen: PrototypeScreen, offset: number): PrototypeScreen {
  const index = prototypeScreens.findIndex(({ id }) => id === screen);
  const nextIndex = (index + offset + prototypeScreens.length) % prototypeScreens.length;
  return prototypeScreens[nextIndex]?.id ?? 'all-todos';
}

export function getNextPrototypeScreen(screen: PrototypeScreen): PrototypeScreen {
  return movePrototypeScreen(screen, 1);
}

export function getPreviousPrototypeScreen(screen: PrototypeScreen): PrototypeScreen {
  return movePrototypeScreen(screen, -1);
}

export function toPrototypeHref(screen: PrototypeScreen): string {
  return `/?screen=${screen}`;
}
