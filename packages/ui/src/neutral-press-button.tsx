import { Button, type ButtonProps } from '@tarojs/components';
import { forwardRef, type ComponentRef } from 'react';

type AccessibilityButtonProps = {
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  ariaLabel?: string;
  tabIndex?: number;
};

export type NeutralPressButtonProps = Omit<ButtonProps, 'hoverClass'> & AccessibilityButtonProps;

export const NeutralPressButton = forwardRef<ComponentRef<typeof Button>, NeutralPressButtonProps>(
  function NeutralPressButton({ className, disabled = false, ...props }, ref) {
    const buttonProps = { ...props } as ButtonProps & AccessibilityButtonProps;
    delete buttonProps.hoverClass;

    return (
      <Button
        {...buttonProps}
        ref={ref}
        className={['ei-press-neutral', className].filter(Boolean).join(' ')}
        hoverClass="none"
        {...(disabled ? { disabled: true } : {})}
      />
    );
  },
);
