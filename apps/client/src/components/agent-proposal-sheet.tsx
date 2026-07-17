import { BottomSheet, ElectricButton, NeutralPressButton } from '@ai-schedule/ui';
import { Text, View } from '@tarojs/components';

type ProposalItem = {
  id: string;
  priority: 'HIGH' | 'LOW' | 'MEDIUM';
  projectName: string;
  title: string;
};

export type AgentProposalView = {
  id: string;
  items: readonly ProposalItem[];
  summary: string;
  version: number;
};

export type AgentProposalSheetProps = {
  disabled: boolean;
  kind: 'ACTION' | 'PLAN';
  onCancel: () => void;
  onClose: () => void;
  onConfirm: () => void;
  onEditItem: (itemId: string) => void;
  onRegenerate: () => void;
  proposal: AgentProposalView;
};

const PRIORITY_LABEL = { HIGH: '高', LOW: '低', MEDIUM: '中' } as const;

export function AgentProposalSheet({
  disabled,
  kind,
  onCancel,
  onClose,
  onConfirm,
  onEditItem,
  onRegenerate,
  proposal,
}: AgentProposalSheetProps) {
  const confirmLabel = kind === 'PLAN' ? `创建 ${proposal.items.length} 项` : '确认执行';

  return (
    <BottomSheet
      className="agentProposalSheet"
      description="草稿可以编辑；确认后才会写入。"
      title={kind === 'PLAN' ? '计划草稿' : '确认 Agent 操作'}
    >
      <NeutralPressButton
        role="button"
        aria-label="关闭 Agent 草稿"
        className="agentPanelClose"
        onClick={onClose}
        tabIndex={0}
      >
        ×
      </NeutralPressButton>
      <View className="agentProposalSummary">
        <Text className="agentProposalTitle">{proposal.summary}</Text>
        <Text className="agentProposalMeta">{proposal.items.length} 项待办</Text>
      </View>
      <View className="agentPlanList">
        {proposal.items.map((item, index) => (
          <View className="agentPlanRow" key={item.id}>
            <Text className="agentPlanIndex">{index + 1}</Text>
            <View className="agentPlanCopy">
              <Text className="agentPlanTitle">{item.title}</Text>
              <Text className="agentPlanMeta">{item.projectName}</Text>
            </View>
            <Text className={`agentPriority agentPriority_${item.priority.toLowerCase()}`}>
              {PRIORITY_LABEL[item.priority]}
            </Text>
            <NeutralPressButton
              role="button"
              aria-label={`编辑${item.title}`}
              className="agentEditPlanItem"
              disabled={disabled}
              onClick={() => onEditItem(item.id)}
              tabIndex={disabled ? -1 : 0}
            >
              编辑
            </NeutralPressButton>
          </View>
        ))}
      </View>
      <View className="agentProposalSecondaryActions">
        <ElectricButton
          ariaLabel="取消 Agent 草稿"
          disabled={disabled}
          onClick={onCancel}
          variant="secondary"
        >
          取消草稿
        </ElectricButton>
        {kind === 'PLAN' ? (
          <ElectricButton
            ariaLabel="重新生成计划"
            disabled={disabled}
            onClick={onRegenerate}
            variant="secondary"
          >
            再改一下
          </ElectricButton>
        ) : null}
      </View>
      <ElectricButton ariaLabel={confirmLabel} disabled={disabled} onClick={onConfirm}>
        {disabled ? '执行中…' : confirmLabel}
      </ElectricButton>
    </BottomSheet>
  );
}
