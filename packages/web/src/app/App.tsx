import { useCallback, useEffect, useState } from 'react';
import { ComingNext } from '../screens/ComingNext.js';
import { HomeScreen } from '../screens/Home.js';
import { TabBar } from '../ui/TabBar.js';
import { useHome } from './api.js';
import { TAB_LABELS, pathOf, tabOf, type Tab } from './routes.js';

// The app: the current tab's screen and the tab bar. The tab is in the
// address (/home, /buckets, /review, /settings), so a refresh or a
// notification link opens the right screen, and Back goes to the last tab.
export function App() {
  const [tab, setTab] = useState<Tab>(() => tabOf(window.location.pathname) ?? 'home');
  const [home, retryHome] = useHome();

  useEffect(() => {
    const onBack = (): void => setTab(tabOf(window.location.pathname) ?? 'home');
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);

  useEffect(() => {
    document.title = `${TAB_LABELS[tab]} · Budget`;
  }, [tab]);

  const go = useCallback(
    (next: Tab) => {
      if (next === tab) {
        window.scrollTo({ top: 0 });
        return;
      }
      window.history.pushState(null, '', pathOf(next));
      setTab(next);
      window.scrollTo({ top: 0 });
    },
    [tab],
  );

  // Links inside a screen (like "3 waiting in review") change tabs too.
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      const target = link === null ? null : tabOf(new URL((link as HTMLAnchorElement).href).pathname);
      if (target === null) return;
      event.preventDefault();
      go(target);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [go]);

  const waiting = home.status === 'ready' && home.value.state === 'tracking' ? home.value.waitingInReview : 0;
  return (
    <div className="app">
      {tab === 'home' ? <HomeScreen load={home} onRetry={retryHome} /> : <ComingNext tab={tab} />}
      <TabBar current={tab} onGo={go} waitingInReview={waiting} />
    </div>
  );
}
