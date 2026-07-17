import { BottomSheet, ElectricButton, NeutralPressButton } from '@ai-schedule/ui';
import { Textarea, View } from '@tarojs/components';

const EXAMPLES = [
  '我最近要准备产品经理面试，帮我拆一下',
  '把工作里的周报标记完成',
  '把周报改成高优先级',
] as const;

export type AgentTextInputSheetProps = {
  disabled: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  value: string;
};

export function AgentTextInputSheet({
  disabled,
  onChange,
  onClose,
  onSubmit,
  value,
}: AgentTextInputSheetProps) {
  return (
    <BottomSheet
      description="输入自然语言，Agent 会先理解并在写入前请你确认。"
      title="想让我帮你做什么？"
    >
      <View className="agentExampleList">
        {EXAMPLES.map((example) => (
          <NeutralPressButton
            role="button"
            className="agentExamplePrompt"
            disabled={disabled}
            key={example}
            onClick={() => onChange(example)}
            tabIndex={disabled ? -1 : 0}
          >
            {example}
          </NeutralPressButton>
        ))}
      </View>
      <Textarea
        aria-label="告诉 Agent 的内容"
        className="agentCommandInput"
        disabled={disabled}
        maxlength={500}
        onInput={(event) => onChange(event.detail.value)}
        placeholder="输入文字..."
        value={value}
      />
      <View className="agentPanelActions">
        <ElectricButton
          ariaLabel="取消文字输入"
          disabled={disabled}
          onClick={onClose}
          variant="secondary"
        >
          取消
        </ElectricButton>
        <ElectricButton
          ariaLabel="发送给 Agent"
          disabled={disabled || value.trim().length === 0}
          onClick={onSubmit}
        >
          {disabled ? '发送中…' : '发送'}
        </ElectricButton>
      </View>
    </BottomSheet>
  );
}
