import { Dialog, ElectricButton, NeutralPressButton } from '@ai-schedule/ui';
import { Text, Textarea, View } from '@tarojs/components';
import { useEffect, useRef, type ReactNode } from 'react';
import type { ActionCardView } from '../action-card-presentation';

export type AgentConversationOption = {
  label: string;
  meta?: string;
  optionId: string;
};

export type AgentConversationMessage = {
  allowFreeText?: boolean;
  answerDisabled?: boolean;
  canGeneratePlan?: boolean;
  content: string;
  id: string;
  options?: readonly AgentConversationOption[];
  proposalId?: string;
  role: 'ASSISTANT' | 'QUESTION' | 'USER';
  version?: number;
};

export type AgentConversationDialogProps = {
  actionCards?: Readonly<Record<string, ActionCardView>>;
  draft: string;
  errorMessage?: string;
  focusMessageId?: string;
  messages: readonly AgentConversationMessage[];
  onAnswer: (messageId: string, version: number, optionId: string) => void;
  onConfirmAction?: (proposalId: string) => void;
  onContinueAction?: (proposalId: string) => void;
  onClose: () => void;
  onDraftChange: (value: string) => void;
  onFreeText: (messageId: string, version: number) => void;
  onGeneratePlan: (messageId: string, version: number) => void;
  onOpenProposal: (proposalId: string) => void;
  onRemoveActionItem?: (proposalId: string, mutationId: string) => void;
  onRetry?: () => void;
  onSubmit: () => void;
  pending: boolean;
  planProposalIds?: readonly string[];
  proposalErrors?: readonly string[];
  onRetryProposal?: (proposalId: string) => void;
  scrollToLatest?: number;
  undoToast?: ReactNode;
};

export function AgentConversationDialog({
  actionCards = {},
  draft,
  errorMessage,
  focusMessageId,
  messages,
  onAnswer,
  onConfirmAction,
  onContinueAction,
  onClose,
  onDraftChange,
  onFreeText,
  onGeneratePlan,
  onOpenProposal,
  onRemoveActionItem,
  onRetry,
  onSubmit,
  pending,
  planProposalIds = [],
  proposalErrors = [],
  onRetryProposal,
  scrollToLatest,
  undoToast,
}: AgentConversationDialogProps) {
  const focusedMessageAvailable = messages.some((message) => message.id === focusMessageId);
  const previousMessageIds = useRef<Set<string> | null>(null);
  const followLatest = useRef(true);
  const previousScrollRequest = useRef(scrollToLatest);
  useEffect(() => {
    const thread = document.querySelector<HTMLElement>('.agentConversation');
    if (!thread) return undefined;
    const updateFollow = () => {
      followLatest.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40;
    };
    thread.addEventListener('scroll', updateFollow, { passive: true });
    return () => thread.removeEventListener('scroll', updateFollow);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const dialog = document.querySelector<HTMLElement>('.agentConversationDialog');
    if (!dialog) return undefined;
    const updateViewport = () => {
      const viewport = window.visualViewport;
      dialog.style.setProperty(
        '--agent-available-height',
        `${viewport?.height ?? window.innerHeight}px`,
      );
      dialog.style.setProperty(
        '--agent-keyboard-offset',
        `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`,
      );
    };
    updateViewport();
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, []);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (previousScrollRequest.current !== scrollToLatest) {
      followLatest.current = true;
      previousScrollRequest.current = scrollToLatest;
    }
    if (!followLatest.current) return;
    const thread = document.querySelector<HTMLElement>('.agentConversation');
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, pending, scrollToLatest]);
  useEffect(() => {
    const current = new Set(messages.map((message) => message.id));
    const old = previousMessageIds.current;
    previousMessageIds.current = current;
    if (
      !old ||
      typeof document === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    for (const message of messages) {
      if (old.has(message.id)) continue;
      const element = Array.from(
        document.querySelectorAll<HTMLElement>('.agentConversation [data-message-id]'),
      ).find((node) => node.getAttribute('data-message-id') === message.id);
      element?.animate(
        [
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
    }
  }, [messages]);
  useEffect(() => {
    if (!focusMessageId || !focusedMessageAvailable || typeof document === 'undefined') {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('.agentConversation .agentMessageFocused')
        ?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusMessageId, focusedMessageAvailable]);

  return (
    <Dialog
      className="agentConversationDialog"
      description="确认前不会修改你的待办和项目。"
      onClose={onClose}
      title="Agent 对话"
    >
      <View className="agentConversation">
        {messages.map((message) => (
          <View
            data-message-id={message.id}
            className={[
              message.role === 'USER' ? 'agentUserBubble' : 'agentAssistantBubble',
              message.id === focusMessageId ? 'agentMessageFocused' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            key={message.id}
          >
            {message.role !== 'USER' ? <Text className="agentMessageTag">Agent</Text> : null}
            <Text className="agentMessageContent">{message.content}</Text>
            {message.options && message.version ? (
              <View className="agentCandidateList">
                {message.options.map((option) => (
                  <NeutralPressButton
                    role="button"
                    aria-label={`选择${option.label}`}
                    className="agentCandidateRow"
                    disabled={pending || message.answerDisabled === true}
                    key={option.optionId}
                    onClick={() => onAnswer(message.id, message.version ?? 0, option.optionId)}
                    tabIndex={pending || message.answerDisabled === true ? -1 : 0}
                  >
                    <View>
                      <Text className="agentCandidateTitle">{option.label}</Text>
                      {option.meta ? (
                        <Text className="agentCandidateMeta">{option.meta}</Text>
                      ) : null}
                    </View>
                  </NeutralPressButton>
                ))}
                {message.allowFreeText ? (
                  <NeutralPressButton
                    role="button"
                    aria-label="都不是，补充说明"
                    className="agentCandidateRow agentFreeTextAnswer"
                    disabled={pending || message.answerDisabled === true}
                    onClick={() => onFreeText(message.id, message.version ?? 0)}
                    tabIndex={pending || message.answerDisabled === true ? -1 : 0}
                  >
                    <Text className="agentCandidateTitle">都不是，补充说明</Text>
                  </NeutralPressButton>
                ) : null}
              </View>
            ) : null}
            {message.proposalId && actionCards[message.proposalId] ? (
              <View className="agentActionCard" aria-label="Agent 操作确认卡">
                <Text className="agentActionCardTitle">
                  {actionCards[message.proposalId]?.title}
                </Text>
                {actionCards[message.proposalId]?.rows.map((row, index) => (
                  <View className="agentActionCardRow" key={`${index}-${row.label}`}>
                    <Text className="agentActionCardLabel">{row.label}</Text>
                    <Text className="agentActionCardValue">{row.value}</Text>
                  </View>
                ))}
                {actionCards[message.proposalId]?.removableItems?.map((item) => (
                  <View className="agentActionCardRemoveRow" key={item.id}>
                    <Text>{item.title}</Text>
                    <NeutralPressButton
                      role="button"
                      aria-label={`移除建议${item.title}`}
                      disabled={
                        pending ||
                        actionCards[message.proposalId ?? '']?.status !== 'AWAITING_CONFIRMATION'
                      }
                      onClick={() => onRemoveActionItem?.(message.proposalId ?? '', item.id)}
                      tabIndex={
                        pending ||
                        actionCards[message.proposalId ?? '']?.status !== 'AWAITING_CONFIRMATION'
                          ? -1
                          : 0
                      }
                    >
                      移除
                    </NeutralPressButton>
                  </View>
                ))}
                {actionCards[message.proposalId]?.status === 'AWAITING_CONFIRMATION' ? (
                  <View className="agentActionCardActions">
                    <ElectricButton
                      ariaLabel="继续对话"
                      disabled={pending}
                      onClick={() => onContinueAction?.(message.proposalId ?? '')}
                      variant="secondary"
                    >
                      继续对话
                    </ElectricButton>
                    <ElectricButton
                      ariaLabel="确认执行"
                      disabled={pending}
                      onClick={() => onConfirmAction?.(message.proposalId ?? '')}
                    >
                      确认执行
                    </ElectricButton>
                  </View>
                ) : (
                  <Text className="agentActionCardStatus">
                    {
                      (
                        {
                          EXECUTED: '已执行',
                          CANCELLED: '已取消',
                          SUPERSEDED: '已替换',
                          EXPIRED: '已过期',
                          FAILED: '执行失败',
                          EXECUTING: '执行中',
                          DRAFT: '待确认',
                          AWAITING_CONFIRMATION: '待确认',
                        } as const
                      )[actionCards[message.proposalId ?? '']?.status ?? 'DRAFT']
                    }
                  </Text>
                )}
              </View>
            ) : message.proposalId && planProposalIds.includes(message.proposalId) ? (
              <ElectricButton
                ariaLabel="打开计划草稿"
                onClick={() => onOpenProposal(message.proposalId ?? '')}
              >
                查看计划草稿
              </ElectricButton>
            ) : message.proposalId && proposalErrors.includes(message.proposalId) ? (
              <View className="agentConversationError">
                <Text>暂时无法读取操作卡</Text>
                <ElectricButton
                  ariaLabel="重试读取操作卡"
                  onClick={() => onRetryProposal?.(message.proposalId ?? '')}
                  variant="secondary"
                >
                  重试
                </ElectricButton>
              </View>
            ) : message.proposalId ? (
              <Text className="agentActionCardStatus">正在读取提案…</Text>
            ) : null}
            {message.role === 'ASSISTANT' && message.canGeneratePlan && !message.proposalId ? (
              <ElectricButton
                ariaLabel="根据这条回复生成计划"
                disabled={pending}
                onClick={() => onGeneratePlan(message.id, message.version ?? 0)}
                variant="secondary"
              >
                生成计划
              </ElectricButton>
            ) : null}
          </View>
        ))}
        {pending ? (
          <Text aria-live="polite" className="agentConversationStatus">
            Agent 正在处理…
          </Text>
        ) : null}
        {errorMessage ? (
          <View className="agentConversationError">
            <Text aria-live="polite">{errorMessage}</Text>
            {onRetry ? (
              <ElectricButton ariaLabel="重试读取 Agent 对话" onClick={onRetry} variant="secondary">
                重试
              </ElectricButton>
            ) : null}
          </View>
        ) : null}
      </View>
      <View className="agentConversationComposer">
        <Textarea
          aria-label="继续告诉 Agent 的内容"
          className="agentConversationInput"
          maxlength={500}
          onInput={(event) => onDraftChange(event.detail.value)}
          placeholder="继续补充或提问..."
          value={draft}
        />
        <ElectricButton
          ariaLabel="发送给 Agent"
          className="agentConversationSend"
          disabled={pending || !draft.trim()}
          onClick={onSubmit}
        >
          发送
        </ElectricButton>
      </View>
      {undoToast}
    </Dialog>
  );
}
