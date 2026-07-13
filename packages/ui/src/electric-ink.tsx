import { Button, Text, View } from '@tarojs/components';
import type { PropsWithChildren, ReactNode } from 'react';

type ClassNameProps = {
  className?: string;
};

export function AppShell({ children, className }: PropsWithChildren<ClassNameProps>) {
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
      aria-label={ariaLabel}
      className={['ei-button', `ei-button--${variant}`, className].filter(Boolean).join(' ')}
      disabled={disabled}
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

export type TaskProjectColor = 'pink' | 'green' | 'violet' | 'cyan' | 'amber';

type TaskRowProps = {
  completed?: boolean;
  id: string;
  meta: string;
  onComplete?: () => void;
  onOpen?: () => void;
  priority?: 'high' | 'medium' | 'low' | 'none';
  project: string;
  projectColor: TaskProjectColor;
  time: string;
  title: string;
};

export function TaskRow({
  completed = false,
  id,
  meta,
  onComplete,
  onOpen,
  priority = 'high',
  project,
  projectColor,
  time,
  title,
}: TaskRowProps) {
  return (
    <View
      className={['ei-task-row', completed && 'ei-task-row--completed'].filter(Boolean).join(' ')}
      data-task-id={id}
      {...(onOpen ? { onClick: onOpen } : {})}
    >
      <View className="ei-task-row__time">
        <Text className="ei-task-row__time-value">{time}</Text>
        <Text className={`ei-project-color--${projectColor}`}>{project}</Text>
      </View>
      <View className="ei-task-row__copy">
        <Text className="ei-task-row__title">{title}</Text>
        <Text className="ei-task-row__meta">{meta}</Text>
      </View>
      {priority !== 'none' ? (
        <View aria-hidden className={`ei-priority ei-priority--${projectColor}`} />
      ) : null}
      <Button
        aria-label={`${completed ? '恢复' : '完成'}待办：${title}`}
        className="ei-check-control"
        onClick={(event) => {
          event.stopPropagation();
          onComplete?.();
        }}
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
  return (
    <View className="ei-overlay-layer">
      <View aria-hidden className="ei-overlay-scrim" />
      <View
        aria-label={title}
        aria-modal="true"
        className={['ei-bottom-sheet', className].filter(Boolean).join(' ')}
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
  return (
    <View className="ei-overlay-layer">
      <View aria-hidden className="ei-overlay-scrim ei-overlay-scrim--strong" />
      <View
        aria-label={title}
        aria-modal="true"
        className={['ei-dialog', className].filter(Boolean).join(' ')}
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
  message: string;
  onUndo: () => void;
};

export function UndoToast({ message, onUndo }: UndoToastProps) {
  return (
    <View aria-live="polite" className="ei-undo-toast" role="status">
      <Text aria-hidden className="ei-undo-toast__check">
        ✓
      </Text>
      <Text className="ei-undo-toast__message">{message}</Text>
      <Button aria-label={`撤销：${message}`} className="ei-undo-toast__action" onClick={onUndo}>
        撤销
      </Button>
    </View>
  );
}
