import Taro, { useRouter } from '@tarojs/taro';
import { useState } from 'react';

import { PrototypeScreens } from '../../components/prototype-screens';
import { parsePrototypeScreen, toPrototypeHref, type PrototypeScreen } from '../../prototype-state';

export default function ReviewPage() {
  const router = useRouter();
  const [screen, setScreen] = useState<PrototypeScreen>(() =>
    parsePrototypeScreen(`?screen=${String(router.params.screen ?? '')}`),
  );

  const navigate = (nextScreen: PrototypeScreen) => {
    setScreen(nextScreen);
    void Taro.redirectTo({ url: toPrototypeHref(nextScreen) });
  };

  return <PrototypeScreens onNavigate={navigate} screen={screen} />;
}
