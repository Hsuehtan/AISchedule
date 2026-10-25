import { NeutralPressButton } from '@ai-schedule/ui';
import { View } from '@tarojs/components';
import { useEffect, useId, useState } from 'react';
import './auth-mascot.scss';

export function AuthMascot() {
  const id = useId();
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    // Taro's H5 custom button needs explicit keyboard activation.
    const button = document.querySelector<HTMLElement>(`[data-mascot-id="${id}"]`);
    const activate = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (!event.repeat && !preference.matches) button?.click();
    };
    button?.addEventListener('keydown', activate);
    return () => {
      preference.removeEventListener('change', update);
      button?.removeEventListener('keydown', activate);
    };
  }, [id]);

  return (
    <NeutralPressButton
      aria-label={reducedMotion ? '产品吉祥物' : paused ? '播放吉祥物动画' : '暂停吉祥物动画'}
      className="authMascot"
      data-mascot-id={id}
      data-paused={paused}
      disabled={reducedMotion}
      onClick={() => {
        if (!reducedMotion) setPaused((value) => !value);
      }}
      role="button"
      tabIndex={reducedMotion ? -1 : 0}
    >
      <View aria-hidden className="authMascotShadow" />
      <View aria-hidden className="authMascotBody">
        <View className="authMascotFrame authMascotNeutral" />
        <View className="authMascotFrame authMascotSmile" />
      </View>
    </NeutralPressButton>
  );
}
