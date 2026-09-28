import { Dialog, ElectricButton, NeutralPressButton } from '@ai-schedule/ui';
import { Text, Textarea, View } from '@tarojs/components';
import { useEffect, useRef } from 'react';

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
  draft: string;
  errorMessage?: string;
  focusMessageId?: string;
  messages: readonly AgentConversationMessage[];
  onAnswer: (messageId: string, version: number, optionId: string) => void;
  onClose: () => void;
  onDraftChange: (value: string) => void;
  onFreeText: (messageId: string, version: number) => void;
  onGeneratePlan: (messageId: string, version: number) => void;
  onOpenProposal: (proposalId: string) => void;
  onRetry?: () => void;
  onSubmit: () => void;
  pending: boolean;
  scrollToLatest?: number;
};

export function AgentConversationDialog({
  draft,
  errorMessage,
  focusMessageId,
  messages,
  onAnswer,
  onClose,
  onDraftChange,
  onFreeText,
  onGeneratePlan,
  onOpenProposal,
  onRetry,
  onSubmit,
  pending,
  scrollToLatest,
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
            {message.proposalId ? (
              <ElectricButton
                ariaLabel="打开 Agent 操作草稿"
                onClick={() => onOpenProposal(message.proposalId ?? '')}
              >
                查看操作草稿
              </ElectricButton>
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
    </Dialog>
  );
}
