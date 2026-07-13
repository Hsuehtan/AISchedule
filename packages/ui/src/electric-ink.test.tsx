import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tarojs/components', () => ({
  Button: 'button',
  Text: 'span',
  View: 'div',
}));

import { ElectricButton, SmartInboxCard, TaskRow, electricInkTokens } from './index';

describe('Electric Ink design system', () => {
  it('locks the Production V3 visual constants', () => {
    expect(electricInkTokens.color).toEqual(
      expect.objectContaining({
        ink: '#101420',
        action: '#00D8FF',
        tint: '#E1F9FF',
        screen: '#F6F9FF',
        paper: '#FFFFFF',
        canvas: '#DDE7F2',
      }),
    );
    expect(electricInkTokens.layout.referenceWidth).toBe(390);
    expect(electricInkTokens.layout.referenceHeight).toBe(844);
    expect(electricInkTokens.layout.contentWidth).toBe(354);
    expect(electricInkTokens.layout.minimumHitArea).toBeGreaterThanOrEqual(44);
    expect(electricInkTokens.component.taskRowHeight).toBe(76);
  });

  it('renders semantic, traceable controls for the fixture shell', () => {
    const button = renderToStaticMarkup(<ElectricButton ariaLabel="登录">登录</ElectricButton>);
    const inbox = renderToStaticMarkup(<SmartInboxCard onOrganize={() => undefined} />);
    const task = renderToStaticMarkup(
      <TaskRow
        id="task_weekly_report"
        meta="明天截止 · 20:00 提醒"
        project="工作"
        projectColor="pink"
        time="09:30"
        title="写周报"
      />,
    );

    expect(button).toContain('aria-label="登录"');
    expect(inbox).toContain('Smart Inbox');
    expect(inbox).toContain('一键整理');
    expect(task).toContain('data-task-id="task_weekly_report"');
    expect(task).toContain('aria-label="完成待办：写周报"');
  });
});
