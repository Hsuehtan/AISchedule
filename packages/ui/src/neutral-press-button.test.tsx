import type { ComponentProps, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tarojs/components', () => ({
  Button: 'button',
  Text: 'span',
  View: 'div',
}));

import { NeutralPressButton } from './index';

type RenderedButtonProps = {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  hoverClass?: string;
  onClick?: () => void;
  tabIndex?: number;
};

type NeutralPressButtonRenderer = {
  render: (
    props: ComponentProps<typeof NeutralPressButton> & { hoverClass?: string },
    ref: unknown,
  ) => ReactElement;
};

function renderNeutralPressButton(
  props: ComponentProps<typeof NeutralPressButton> & { hoverClass?: string },
  ref: unknown = null,
): ReactElement {
  return (NeutralPressButton as unknown as NeutralPressButtonRenderer).render(props, ref);
}

function renderedProps(element: ReactElement): RenderedButtonProps {
  return (element as ReactElement<RenderedButtonProps>).props;
}

describe('NeutralPressButton', () => {
  it('owns the hover class and always disables the framework press class', () => {
    type Props = ComponentProps<typeof NeutralPressButton>;
    const hoverClassIsPublic: 'hoverClass' extends keyof Props ? true : false = false;

    const button = renderNeutralPressButton({
      children: '保存',
      className: 'sheetAction',
    });
    const unsafeButton = renderNeutralPressButton({
      children: '保存',
      hoverClass: 'button-hover',
    });

    expect(hoverClassIsPublic).toBe(false);
    expect(renderedProps(button).hoverClass).toBe('none');
    expect(renderedProps(unsafeButton).hoverClass).toBe('none');
  });

  it('adds the neutral press class while forwarding button semantics and events', () => {
    const onClick = vi.fn();
    const button = renderNeutralPressButton({
      ariaLabel: '保存待办',
      children: '保存',
      className: 'sheetAction customAction',
      disabled: true,
      onClick,
      tabIndex: -1,
    });

    const props = renderedProps(button);
    expect(props.className?.split(/\s+/)).toEqual(
      expect.arrayContaining(['ei-press-neutral', 'sheetAction', 'customAction']),
    );
    expect(props.disabled).toBe(true);
    expect(props.ariaLabel).toBe('保存待办');
    expect(props.tabIndex).toBe(-1);
    expect(props.onClick).toBe(onClick);
  });

  it('forwards the ref used by focus restoration flows', () => {
    const ref = { current: null };
    const button = renderNeutralPressButton({ children: '计划时间' }, ref);

    expect((button as unknown as { ref: unknown }).ref).toBe(ref);
  });
});
