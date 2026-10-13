// H5-only interaction controller shared by BottomSheet and Dialog.
export function manageModalInteraction(modal: HTMLElement): () => void {
  const handle = modal.querySelector<HTMLElement>('.ei-sheet-resize-handle');
  handle?.setAttribute('tabindex', '0');
  const viewport = window.visualViewport;
  let requestedHeight: number | null = null;
  let naturalHeight = modal.getBoundingClientRect().height;
  let drag: { pointerId: number; y: number; height: number } | null = null;

  const bounds = () => {
    const available = viewport?.height ?? window.innerHeight;
    const containerHeight = modal.parentElement?.clientHeight ?? available;
    const max = Math.max(0, Math.min(760, available - 24, containerHeight - 24));
    const style = getComputedStyle(modal);
    const heading = modal.querySelector<HTMLElement>('.ei-sheet-heading, .ei-dialog__heading');
    const content = modal.querySelector<HTMLElement>('.ei-sheet-content, .ei-dialog__content');
    const contentStyle = content ? getComputedStyle(content) : null;
    // Nested scroll layouts keep summary cards and action bars outside their scroll area.
    const fixedHeight =
      content && contentStyle?.display === 'flex' && contentStyle.overflowY === 'hidden'
        ? Array.from(content.children).reduce((total, child) => {
            const childStyle = getComputedStyle(child);
            if (
              childStyle.flexShrink !== '0' ||
              ['absolute', 'fixed'].includes(childStyle.position)
            )
              return total;
            return (
              total +
              child.getBoundingClientRect().height +
              parseFloat(childStyle.marginTop) +
              parseFloat(childStyle.marginBottom)
            );
          }, 0)
        : 0;
    const chrome =
      parseFloat(style.paddingTop) +
      parseFloat(style.paddingBottom) +
      (heading?.getBoundingClientRect().height ?? 0) +
      fixedHeight +
      (contentStyle ? parseFloat(contentStyle.marginTop) : 0);
    // Keep the heading, fixed composer and a useful portion of the scroll area visible.
    const min = Math.min(max, naturalHeight, Math.max(200, chrome + 96));
    return { min, max };
  };
  const syncHandle = () => {
    if (!handle) return;
    const { min, max } = bounds();
    const height = modal.getBoundingClientRect().height;
    handle.setAttribute('aria-valuemin', String(Math.round(min)));
    handle.setAttribute('aria-valuemax', String(Math.round(max)));
    handle.setAttribute('aria-valuenow', String(Math.round(height)));
    handle.setAttribute('aria-valuetext', `浮层高度 ${Math.round(height)} 像素`);
  };
  const resize = (height: number) => {
    const { min, max } = bounds();
    requestedHeight = Math.max(min, Math.min(max, height));
    modal.style.setProperty('--ei-modal-user-height', `${requestedHeight}px`);
    modal.dataset.modalResized = 'true';
    syncHandle();
  };
  const finishDrag = () => {
    const pointerId = drag?.pointerId;
    drag = null;
    delete modal.dataset.modalResizing;
    if (pointerId !== undefined && handle?.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
  };
  const updateViewport = () => {
    finishDrag();
    const height = viewport?.height ?? window.innerHeight;
    modal.style.setProperty('--ei-modal-viewport-height', `${height}px`);
    modal.style.setProperty(
      '--ei-modal-keyboard-offset',
      `${Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0))}px`,
    );
    modal.style.setProperty('--ei-modal-limit', `${bounds().max}px`);
    if (requestedHeight === null) naturalHeight = modal.getBoundingClientRect().height;
    else resize(requestedHeight);
    syncHandle();
  };
  const down = (event: PointerEvent) => {
    if (!handle || event.button !== 0 || !event.isPrimary || drag) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    drag = {
      pointerId: event.pointerId,
      y: event.clientY,
      height: modal.getBoundingClientRect().height,
    };
    modal.dataset.modalResizing = 'true';
    // Window listeners also finish the gesture when pointer capture is unavailable.
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* No active native pointer. */
    }
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    resize(drag.height + drag.y - event.clientY);
  };
  const up = (event: PointerEvent) => {
    if (event.pointerId === drag?.pointerId) finishDrag();
  };
  const key = (event: KeyboardEvent) => {
    const current = modal.getBoundingClientRect().height;
    const { min, max } = bounds();
    const next = {
      ArrowUp: current + 40,
      ArrowDown: current - 40,
      PageUp: current + 100,
      PageDown: current - 100,
      Home: min,
      End: max,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      finishDrag();
      resize(next);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      finishDrag();
      requestedHeight = null;
      delete modal.dataset.modalResized;
      modal.style.removeProperty('--ei-modal-user-height');
      updateViewport();
    } else if (event.key === 'Escape' && drag) {
      event.preventDefault();
      finishDrag();
    }
  };

  updateViewport();
  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          if (requestedHeight === null) naturalHeight = modal.getBoundingClientRect().height;
          syncHandle();
        });
  observer?.observe(modal);
  handle?.addEventListener('pointerdown', down);
  handle?.addEventListener('lostpointercapture', finishDrag);
  handle?.addEventListener('keydown', key);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  viewport?.addEventListener('resize', updateViewport);
  viewport?.addEventListener('scroll', updateViewport);
  window.addEventListener('resize', updateViewport);
  window.addEventListener('blur', finishDrag);
  return () => {
    finishDrag();
    observer?.disconnect();
    handle?.removeEventListener('pointerdown', down);
    handle?.removeEventListener('lostpointercapture', finishDrag);
    handle?.removeEventListener('keydown', key);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    viewport?.removeEventListener('resize', updateViewport);
    viewport?.removeEventListener('scroll', updateViewport);
    window.removeEventListener('resize', updateViewport);
    window.removeEventListener('blur', finishDrag);
    delete modal.dataset.modalResized;
    modal.style.removeProperty('--ei-modal-user-height');
  };
}
