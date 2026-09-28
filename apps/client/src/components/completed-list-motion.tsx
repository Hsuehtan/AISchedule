import { View } from '@tarojs/components';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function CompletedListMotion({
  children,
  expanded,
}: {
  children: ReactNode;
  expanded: boolean;
}) {
  const cachedChildren = useRef<ReactNode>(null);
  const [, rerender] = useState(0);
  if (expanded) cachedChildren.current = children;

  useEffect(() => {
    if (expanded || typeof window === 'undefined') return undefined;
    const timer = window.setTimeout(() => {
      cachedChildren.current = null;
      rerender((value) => value + 1);
    }, 210);
    return () => window.clearTimeout(timer);
  }, [expanded]);

  if (typeof document === 'undefined') {
    return expanded ? <View className="completedTaskList">{children}</View> : null;
  }

  return (
    <View
      aria-hidden={!expanded}
      className={`completedMotion ${expanded ? 'completedMotion_open' : ''}`}
      {...(!expanded ? { inert: true } : {})}
    >
      <View className="completedTaskList">{expanded ? children : cachedChildren.current}</View>
    </View>
  );
}
