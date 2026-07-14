import { Button, Text, View } from '@tarojs/components';
import { useEffect, useId, type PropsWithChildren, type ReactNode } from 'react';

type ClassNameProps = {
  className?: string;
};

type FocusReturnSnapshot = {
  ariaLabel: string | null;
  ariaLabelIndex: number;
  element: HTMLElement;
};

let lastInteractionTarget: FocusReturnSnapshot | null = null;

function elementsWithAriaLabel(ariaLabel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-label]')).filter(
    (element) => element.getAttribute('aria-label') === ariaLabel,
  );
}

function snapshotFocusTarget(element: HTMLElement): FocusReturnSnapshot {
  const ariaLabel = element.getAttribute('aria-label');
  return {
    ariaLabel,
    ariaLabelIndex: ariaLabel ? elementsWithAriaLabel(ariaLabel).indexOf(element) : -1,
    element,
  };
}

function resolveFocusTarget(snapshot: FocusReturnSnapshot | null): HTMLElement | null {
  if (!snapshot) return null;
  if (snapshot.element.isConnected) return snapshot.element;
  if (!snapshot.ariaLabel) return null;

  const matches = elementsWithAriaLabel(snapshot.ariaLabel);
  return matches[snapshot.ariaLabelIndex] ?? matches[0] ?? null;
}

function findInteractionTarget(event: Event): HTMLElement | null {
  const path = event.composedPath();
  const explicitControl = path.find(
    (target): target is HTMLElement =>
      target instanceof HTMLElement &&
      (target.getAttribute('role') === 'button' || target.hasAttribute('tabindex')),
  );
  if (explicitControl) return explicitControl;

  return (
    path.find(
      (target): target is HTMLElement =>
        target instanceof HTMLElement && target.matches('a[href],button,input,select,textarea'),
    ) ?? null
  );
}

export type ModalFocusTarget = { focus: () => void };

export function cycleModalFocus(
  focusable: readonly ModalFocusTarget[],
  activeElement: unknown,
  backwards: boolean,
): boolean {
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return false;

  const activeIndex = focusable.indexOf(activeElement as ModalFocusTarget);
  if (backwards && activeIndex > 0) return false;
  if (!backwards && activeIndex >= 0 && activeIndex < focusable.length - 1) return false;

  (backwards ? last : first).focus();
  return true;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[role="button"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      element.getAttribute('aria-disabled') !== 'true' &&
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true',
  );
}

function useManagedModalFocus(focusKey: string) {
  const focusId = useId();

  useEffect(() => {
    if (typeof document === 'undefined' || typeof HTMLElement === 'undefined') return undefined;
    // Taro's H5 View does not consistently forward React refs to its custom element.
    // Query the committed, React-owned data marker so focus management uses the real DOM node.
    const dialog = document.querySelector<HTMLElement>(`[data-modal-focus-id="${focusId}"]`);
    if (!(dialog instanceof HTMLElement)) return undefined;

    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnFocus =
      activeElement && activeElement !== document.body
        ? snapshotFocusTarget(activeElement)
        : lastInteractionTarget
          ? lastInteractionTarget
          : activeElement
            ? snapshotFocusTarget(activeElement)
            : null;
    dialog.setAttribute('tabindex', '-1');
    const overlay = dialog.closest<HTMLElement>('.ei-overlay-layer');
    const background = overlay?.parentElement
      ? Array.from(overlay.parentElement.children).filter(
          (element): element is HTMLElement =>
            element instanceof HTMLElement && element !== overlay,
        )
      : [];
    const backgroundState = background.map((element) => ({
      ariaHidden: element.getAttribute('aria-hidden'),
      element,
      inert: element.inert,
    }));
    for (const element of background) {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    }

    // Taro custom elements finish their own mount work after the parent effect. Focus on
    // the next frame so their lifecycle cannot immediately return focus to <body>.
    const focusFrame = window.requestAnimationFrame(() => {
      const initialFocus =
        dialog.querySelector<HTMLElement>('[data-modal-initial-focus="true"]') ??
        focusableElements(dialog)[0] ??
        dialog;
      initialFocus.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      if (cycleModalFocus(focusableElements(dialog), document.activeElement, event.shiftKey)) {
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown, true);
      for (const { ariaHidden, element, inert } of backgroundState) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      }
      if (returnFocus) {
        // History-driven sheet closing can move focus to <body> after React unmounts the
        // overlay. Taro may also replace the opener custom element while reconciling, so
        // resolve its accessible-label snapshot against the committed page for a few
        // frames until the custom-element reconciliation has settled.
        let remainingAttempts = 3;
        const restoreFocus = () => {
          const target = resolveFocusTarget(returnFocus);
          if (document.querySelector('[aria-modal="true"]')) return;
          if (target && document.activeElement === target) return;
          if (document.activeElement && document.activeElement !== document.body) return;
          if (target) {
            target.focus({ preventScroll: true });
          }
          remainingAttempts -= 1;
          if (remainingAttempts > 0) window.requestAnimationFrame(restoreFocus);
        };
        window.requestAnimationFrame(restoreFocus);
      }
    };
  }, [focusId, focusKey]);

  return focusId;
}

export function AppShell({ children, className }: PropsWithChildren<ClassNameProps>) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const rememberInteraction = (event: Event) => {
      const target = findInteractionTarget(event);
      if (target) {
        lastInteractionTarget = snapshotFocusTarget(target);
      }
    };
    document.addEventListener('pointerdown', rememberInteraction, true);
    return () => {
      document.removeEventListener('pointerdown', rememberInteraction, true);
      lastInteractionTarget = null;
    };
  }, []);

  return <View className={['ei-app-shell', className].filter(Boolean).join(' ')}>{children}</View>;
}

export function StatusBar() {
  return (
    <View aria-hidden className="ei-status-bar">
      <Text>9:41</Text>
      <Text className="ei-status-bar__network">5G&nbsp;&nbsp;82%</Text>
    </View>
  );
}

type ElectricButtonProps = PropsWithChildren<
  ClassNameProps & {
    ariaLabel: string;
    disabled?: boolean;
    onClick?: () => void;
    variant?: 'primary' | 'secondary' | 'ink' | 'danger';
  }
>;

export function ElectricButton({
  ariaLabel,
  children,
  className,
  disabled = false,
  onClick,
  variant = 'primary',
}: ElectricButtonProps) {
  return (
    <Button
      role="button"
      aria-label={ariaLabel}
      className={['ei-button', `ei-button--${variant}`, className].filter(Boolean).join(' ')}
      tabIndex={disabled ? -1 : 0}
      {...(disabled ? { disabled: true } : {})}
      {...(onClick ? { onClick } : {})}
    >
      {children}
    </Button>
  );
}

type SmartInboxCardProps = {
  body?: string;
  onOrganize?: () => void;
};

export function SmartInboxCard({
  body = '发现 2 个无项目待办，建议归入「生活」并设置今天提醒。',
  onOrganize,
}: SmartInboxCardProps) {
  return (
    <View className="ei-smart-inbox">
      <View className="ei-smart-inbox__title-row">
        <Text aria-hidden className="ei-spark">
          ✦
        </Text>
        <Text className="ei-smart-inbox__title">Smart Inbox</Text>
      </View>
      <Text className="ei-smart-inbox__body">{body}</Text>
      <ElectricButton
        ariaLabel="使用 Agent 一键整理 Smart Inbox"
        className="ei-smart-inbox__action"
        {...(onOrganize ? { onClick: onOrganize } : {})}
      >
        一键整理
      </ElectricButton>
    </View>
  );
}

export type TaskProjectColor = 'pink' | 'teal' | 'purple' | 'amber' | 'cyan' | 'slate';

type TaskRowProps = {
  completed?: boolean;
  disabled?: boolean;
  id: string;
  meta: string;
  onComplete?: () => void;
  onOpen?: () => void;
  priority: 'high' | 'medium' | 'low';
  project: string;
  projectColor: TaskProjectColor;
  time: string;
  title: string;
};

export function TaskRow({
  completed = false,
  disabled = false,
  id,
  meta,
  onComplete,
  onOpen,
  priority,
  project,
  projectColor,
  time,
  title,
}: TaskRowProps) {
  const taskDetails = (
    <>
      <View className="ei-task-row__time">
        <Text className="ei-task-row__time-value">{time}</Text>
        <Text className={`ei-task-row__project ei-project-color--${projectColor}`}>{project}</Text>
      </View>
      <View className="ei-task-row__copy">
        <Text className="ei-task-row__title">{title}</Text>
        <Text className="ei-task-row__meta">{meta}</Text>
      </View>
      <View
        aria-label={`${priority === 'high' ? '高' : priority === 'medium' ? '中' : '低'}优先级`}
        className={`ei-priority ei-priority--${priority}`}
        role="img"
      />
    </>
  );

  return (
    <View
      className={['ei-task-row', completed && 'ei-task-row--completed'].filter(Boolean).join(' ')}
      data-task-id={id}
      aria-disabled={disabled ? 'true' : 'false'}
    >
      {onOpen ? (
        <Button
          role="button"
          aria-label={`编辑待办：${title}`}
          className="ei-task-row__open"
          onClick={onOpen}
          tabIndex={disabled ? -1 : 0}
          {...(disabled ? { disabled: true } : {})}
        >
          {taskDetails}
        </Button>
      ) : (
        <View className="ei-task-row__open">{taskDetails}</View>
      )}
      <Button
        role="button"
        aria-label={`${completed ? '恢复' : '完成'}待办：${title}`}
        className="ei-check-control"
        onClick={(event) => {
          event.stopPropagation();
          if (!disabled) onComplete?.();
        }}
        tabIndex={disabled ? -1 : 0}
        {...(disabled ? { disabled: true } : {})}
      >
        {completed ? '✓' : null}
      </Button>
    </View>
  );
}

export function ScreenReaderOnly({ children }: { children: ReactNode }) {
  return <Text className="ei-sr-only">{children}</Text>;
}

type BottomSheetProps = PropsWithChildren<
  ClassNameProps & {
    description?: string;
    title: string;
  }
>;

export function BottomSheet({ children, className, description, title }: BottomSheetProps) {
  const focusId = useManagedModalFocus(title);

  return (
    <View className="ei-overlay-layer">
      <View aria-hidden className="ei-overlay-scrim" />
      <View
        aria-label={title}
        aria-modal="true"
        className={['ei-bottom-sheet', className].filter(Boolean).join(' ')}
        data-modal-focus-id={focusId}
        data-focus-managed="true"
        role="dialog"
      >
        <View aria-hidden className="ei-sheet-handle" />
        <View className="ei-sheet-heading">
          <Text className="ei-sheet-title">{title}</Text>
          {description ? <Text className="ei-sheet-description">{description}</Text> : null}
        </View>
        <View className="ei-sheet-content">{children}</View>
      </View>
    </View>
  );
}

type DialogProps = PropsWithChildren<
  ClassNameProps & {
    description?: string;
    onClose: () => void;
    title: string;
  }
>;

export function Dialog({ children, className, description, onClose, title }: DialogProps) {
  const focusId = useManagedModalFocus(title);

  return (
    <View className="ei-overlay-layer">
      <View aria-hidden className="ei-overlay-scrim ei-overlay-scrim--strong" />
      <View
        aria-label={title}
        aria-modal="true"
        className={['ei-dialog', className].filter(Boolean).join(' ')}
        data-modal-focus-id={focusId}
        data-focus-managed="true"
        role="dialog"
      >
        <View aria-hidden className="ei-sheet-handle" />
        <View className="ei-dialog__heading">
          <View>
            <Text className="ei-sheet-title">{title}</Text>
            {description ? <Text className="ei-sheet-description">{description}</Text> : null}
          </View>
          <ElectricButton
            ariaLabel={`关闭${title}`}
            className="ei-dialog__close"
            onClick={onClose}
            variant="secondary"
          >
            ×
          </ElectricButton>
        </View>
        <View className="ei-dialog__content">{children}</View>
      </View>
    </View>
  );
}

type UndoToastProps = {
  disabled?: boolean;
  message: string;
  onUndo: () => void;
};

export function UndoToast({ disabled = false, message, onUndo }: UndoToastProps) {
  return (
    <View aria-live="polite" className="ei-undo-toast" role="status">
      <Text aria-hidden className="ei-undo-toast__check">
        ✓
      </Text>
      <Text className="ei-undo-toast__message">{message}</Text>
      <Button
        role="button"
        aria-label={`撤销：${message}`}
        className="ei-undo-toast__action"
        disabled={disabled}
        onClick={onUndo}
        tabIndex={disabled ? -1 : 0}
      >
        撤销
      </Button>
    </View>
  );
}
