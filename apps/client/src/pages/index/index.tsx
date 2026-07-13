import { useEffect, useState } from 'react';

import { PrototypeScreens } from '../../components/prototype-screens';
import { parsePrototypeScreen, toPrototypeHref, type PrototypeScreen } from '../../prototype-state';

function getInitialScreen(): PrototypeScreen {
  return typeof window === 'undefined' ? 'all-todos' : parsePrototypeScreen(window.location.search);
}

export default function IndexPage() {
  const [screen, setScreen] = useState<PrototypeScreen>(getInitialScreen);

  useEffect(() => {
    const handlePopState = () => setScreen(parsePrototypeScreen(window.location.search));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (nextScreen: PrototypeScreen) => {
    if (typeof window !== 'undefined') {
      window.history.pushState({ screen: nextScreen }, '', toPrototypeHref(nextScreen));
    }
    setScreen(nextScreen);
  };

  return <PrototypeScreens onNavigate={navigate} screen={screen} />;
}
