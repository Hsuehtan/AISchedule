import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tarojs/components', () => ({
  Button: 'taro-button-core',
  Input: 'taro-input-core',
  Text: 'span',
  Textarea: 'taro-textarea-core',
  View: 'div',
}));

import {
  AgentConversationDialog,
  AgentProposalSheet,
  AgentTextInputSheet,
  AgentUnavailableSheet,
} from './agent-panels';

describe('production Agent panels', () => {
  it('renders a bounded plain-text composer without pricing controls', () => {
    const markup = renderToStaticMarkup(
      <AgentTextInputSheet
        disabled={false}
        onChange={() => undefined}
        onClose={() => undefined}
        onSubmit={() => undefined}
        value="整理这周的工作"
      />,
    );

    expect(markup).toContain('maxlength="500"');
    expect(markup).toContain('整理这周的工作');
    expect(markup).toContain('发送给 Agent');
    expect(markup).not.toMatch(/积分|Token|模型|价格/);
  });

  it('renders model content as escaped plain text and candidate option ids as controls', () => {
    const markup = renderToStaticMarkup(
      <AgentConversationDialog
        messages={[
          { content: '<img src=x onerror=alert(1)>', id: 'm1', role: 'ASSISTANT' },
          {
            content: '你指的是哪一项？',
            id: 'm2',
            options: [
              { label: '写周报', meta: '工作 · 明天截止', optionId: 'ref_abc' },
              { label: '都不是', optionId: 'NONE' },
            ],
            role: 'QUESTION',
            version: 2,
          },
        ]}
        onAnswer={() => undefined}
        onClose={() => undefined}
        onGeneratePlan={() => undefined}
        onOpenProposal={() => undefined}
      />,
    );

    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(markup).not.toContain('<img src=x');
    expect(markup).toContain('aria-label="选择写周报"');
    expect(markup).not.toContain('ref_abc');
  });

  it('only offers plan generation when the persisted reply permits it', () => {
    const renderReply = (canGeneratePlan: boolean) =>
      renderToStaticMarkup(
        <AgentConversationDialog
          messages={[
            {
              canGeneratePlan,
              content: '回复',
              id: 'm1',
              role: 'ASSISTANT',
            },
          ]}
          onAnswer={() => undefined}
          onClose={() => undefined}
          onGeneratePlan={() => undefined}
          onOpenProposal={() => undefined}
        />,
      );

    expect(renderReply(false)).not.toContain('根据这条回复生成计划');
    expect(renderReply(true)).toContain('根据这条回复生成计划');
  });

  it('renders editable plan rows and a direct atomic-confirm action', () => {
    const markup = renderToStaticMarkup(
      <AgentProposalSheet
        disabled={false}
        kind="PLAN"
        onCancel={() => undefined}
        onClose={() => undefined}
        onConfirm={() => undefined}
        onEditItem={() => undefined}
        onRegenerate={() => undefined}
        proposal={{
          id: 'p1',
          items: [
            { id: 'i1', priority: 'HIGH', projectName: '面试', title: '整理项目经历' },
            { id: 'i2', priority: 'LOW', projectName: '面试', title: '模拟回答' },
          ],
          summary: '产品经理面试计划',
          version: 3,
        }}
      />,
    );

    expect(markup).toContain('创建 2 项');
    expect(markup).toContain('编辑整理项目经历');
    expect(markup).toContain('再改一下');
    expect(markup).not.toContain('二次确认');
  });

  it('distinguishes quota exhaustion from service and deferred voice states', () => {
    expect(
      renderToStaticMarkup(<AgentUnavailableSheet onClose={() => undefined} reason="QUOTA" />),
    ).toContain('明天可继续');
    expect(
      renderToStaticMarkup(<AgentUnavailableSheet onClose={() => undefined} reason="SERVICE" />),
    ).toContain('智能处理暂不可用');
    expect(
      renderToStaticMarkup(
        <AgentUnavailableSheet onClose={() => undefined} reason="VOICE_DEFERRED" />,
      ),
    ).toContain('语音输入暂不可用');
  });
});
