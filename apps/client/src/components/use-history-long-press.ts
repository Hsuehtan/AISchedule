import { useEffect } from 'react';

export type HistoryDeleteTarget = { id: string; title: string };

export function useHistoryLongPress(
  enabled: boolean,
  select: (target: HistoryDeleteTarget) => void,
) {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number } | undefined;
    let suppressed: HTMLElement | undefined;
    const rowFor = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest<HTMLElement>('.agentHistoryRow[data-conversation-id]')
        : null;
    const cancel = () => {
      clearTimeout(timer);
      timer = undefined;
      start = undefined;
    };
    const open = (row: HTMLElement) => {
      suppressed = row;
      select({
        id: row.dataset.conversationId!,
        title: row.querySelector('.agentHistoryTitle')?.textContent ?? '此会话',
      });
    };
    const down = (event: PointerEvent) => {
      cancel();
      suppressed = undefined;
      const row = rowFor(event.target);
      if (!row || event.button !== 0 || !event.isPrimary) return;
      start = { x: event.clientX, y: event.clientY };
      timer = setTimeout(() => {
        cancel();
        if (row.isConnected) open(row);
      }, 550);
    };
    const move = (event: PointerEvent) => {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) cancel();
    };
    const click = (event: MouseEvent) => {
      if (suppressed && rowFor(event.target) === suppressed) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressed = undefined;
      }
    };
    const context = (event: MouseEvent) => {
      const row = rowFor(event.target);
      if (!row) return;
      event.preventDefault();
      cancel();
      open(row);
    };
    const key = (event: KeyboardEvent) => {
      const row = rowFor(event.target);
      if (!row || (event.key !== 'Delete' && !(event.shiftKey && event.key === 'F10'))) return;
      event.preventDefault();
      cancel();
      if (!event.repeat) open(row);
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', cancel);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('scroll', cancel, true);
    document.addEventListener('click', click, true);
    document.addEventListener('contextmenu', context);
    document.addEventListener('keydown', key);
    return () => {
      cancel();
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', cancel);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('scroll', cancel, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('contextmenu', context);
      document.removeEventListener('keydown', key);
    };
  }, [enabled, select]);
}
