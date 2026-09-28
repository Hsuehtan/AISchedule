import { useLayoutEffect, useRef } from 'react';

type RowSnapshot = { copy: HTMLElement; rect: DOMRect };
type ListSnapshot = { filterKey: string; ids: string[]; rows: Map<string, RowSnapshot> };

const easing = 'cubic-bezier(0.2, 0, 0, 1)';

export function useTaskListMotion(
  selector: string,
  ids: readonly string[],
  ready: boolean,
  filterKey: string,
): void {
  const previous = useRef<ListSnapshot | null>(null);

  useLayoutEffect(() => {
    if (typeof document === 'undefined' || !ready) return;
    const container =
      document.querySelector<HTMLElement>(`.productionTodoScreen ${selector}`) ??
      (selector === '.taskList'
        ? document.querySelector<HTMLElement>('.productionTodoScreen .productionTimeline')
        : null);
    if (!container) return;
    const rows = new Map<string, RowSnapshot>();
    const visibleRows = container.matches('.productionTimeline')
      ? []
      : Array.from(container.querySelectorAll<HTMLElement>('[data-task-id]'));
    for (const row of visibleRows) {
      const id = row.getAttribute('data-task-id');
      if (id)
        rows.set(id, {
          copy: row.cloneNode(true) as HTMLElement,
          rect: row.getBoundingClientRect(),
        });
    }

    const old = previous.current;
    previous.current = { filterKey, ids: [...ids], rows };
    if (
      !old ||
      !('animate' in container) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    if (old.filterKey !== filterKey) {
      container.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing });
      return;
    }
    if (old.ids.length === ids.length && old.ids.every((id, index) => id === ids[index])) return;

    const oldIds = new Set(old.ids);
    for (const [id, current] of rows) {
      const element = container.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`);
      if (!element) continue;
      if (!oldIds.has(id)) {
        element.animate(
          [
            { opacity: 0, transform: 'translateY(6px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 180, easing },
        );
        continue;
      }
      const former = old.rows.get(id);
      if (!former) continue;
      const offset = former.rect.top - current.rect.top;
      if (Math.abs(offset) > 1 && Math.abs(offset) < 400) {
        element.animate(
          [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }],
          {
            duration: 180,
            easing,
          },
        );
      }
    }

    const shell = container.closest<HTMLElement>('.ei-app-shell');
    if (!shell) return;
    const shellRect = shell.getBoundingClientRect();
    for (const [id, former] of old.rows) {
      if (rows.has(id)) continue;
      const ghost = former.copy;
      ghost.setAttribute('aria-hidden', 'true');
      ghost.inert = true;
      Object.assign(ghost.style, {
        position: 'absolute',
        left: `${former.rect.left - shellRect.left}px`,
        top: `${former.rect.top - shellRect.top}px`,
        width: `${former.rect.width}px`,
        height: `${former.rect.height}px`,
        margin: '0',
        pointerEvents: 'none',
        zIndex: '6',
      });
      shell.appendChild(ghost);
      const exit = ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 120,
        easing: 'ease-in',
      });
      exit.onfinish = () => ghost.remove();
      exit.oncancel = () => ghost.remove();
    }
  });
}
