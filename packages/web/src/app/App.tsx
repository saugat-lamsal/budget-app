import type { Pot } from '@budget-app/money';
import { useCallback, useEffect, useState } from 'react';
import { ActivityScreen, type Back } from '../screens/Activity.js';
import { BucketsScreen } from '../screens/Buckets.js';
import { HomeScreen } from '../screens/Home.js';
import { PaydayScreen } from '../screens/Payday.js';
import { ReviewScreen } from '../screens/Review.js';
import { SettingsScreen } from '../screens/Settings.js';
import { TabBar } from '../ui/TabBar.js';
import { useActivity, useBuckets, useHome, usePayday, useReview, useSettings, type Reload } from './api.js';
import { backTarget, pathOfRoute, routeLabel, routeOf, routeTitle, tabOfRoute, type Route, type Tab } from './routes.js';

// Each of these loads its numbers when its screen opens, so it is always fresh.
// A change on one of them (a choice, a move) also asks Home for its numbers
// again: safe to spend and what needs him may have changed.
function BucketsTab({ onChanged }: { readonly onChanged: Reload }) {
  const [load, reload] = useBuckets();
  return <BucketsScreen load={load} onRetry={reload} onChanged={onChanged} />;
}

function ReviewTab({ onChanged }: { readonly onChanged: Reload }) {
  const [load, reload] = useReview();
  return <ReviewScreen load={load} onRetry={reload} onChanged={onChanged} />;
}

function SettingsTab({ onChanged }: { readonly onChanged: Reload }) {
  const [load, reload] = useSettings();
  return <SettingsScreen load={load} onRetry={reload} onChanged={onChanged} />;
}

function ActivityTab({ pot, onChanged, back }: { readonly pot: Pot; readonly onChanged: Reload; readonly back: Back }) {
  const [load, reload] = useActivity(pot);
  return <ActivityScreen pot={pot} load={load} onRetry={reload} onChanged={onChanged} back={back} />;
}

function PaydayTab({ onChanged, back }: { readonly onChanged: Reload; readonly back: Back }) {
  const [load, reload] = usePayday();
  return <PaydayScreen load={load} onRetry={reload} onChanged={onChanged} back={back} />;
}

const HOME: Route = { screen: 'tab', tab: 'home' };

// The address it was opened from, kept in the history entry (see go).
function cameFrom(): unknown {
  const state: unknown = window.history.state;
  return typeof state === 'object' && state !== null && 'from' in state ? (state as { from: unknown }).from : undefined;
}

// The app: the current screen and the tab bar. The screen is in the address
// (/home, /buckets, /review, /settings, and the screens opened from them,
// /buckets/needs and /payday), so a refresh or a notification link opens the
// right screen, and Back goes to the last one.
export function App() {
  const [route, setRoute] = useState<Route>(() => routeOf(window.location.pathname) ?? HOME);
  const [home, retryHome] = useHome();

  useEffect(() => {
    const onBack = (): void => setRoute(routeOf(window.location.pathname) ?? HOME);
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);

  useEffect(() => {
    document.title = routeTitle(route);
  }, [route]);

  const go = useCallback(
    (next: Route) => {
      if (pathOfRoute(next) === pathOfRoute(route)) {
        window.scrollTo({ top: 0 });
        return;
      }
      // The address he left is kept with the new one, so a screen opened from
      // two places can go back to the right one.
      window.history.pushState({ from: window.location.pathname }, '', pathOfRoute(next));
      setRoute(next);
      window.scrollTo({ top: 0 });
    },
    [route],
  );

  // Links inside a screen (like "3 waiting in review", or a bucket on Buckets) change screens too.
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      const target = link === null ? null : routeOf(new URL((link as HTMLAnchorElement).href).pathname);
      if (target === null) return;
      event.preventDefault();
      go(target);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [go]);

  // The link at the top of a screen that is not a tab. It goes back to where
  // he came from when the app knows it, otherwise to Buckets.
  const from = cameFrom();
  const target = backTarget(route, from);
  const cameFromTarget = typeof from === 'string' && routeOf(from) !== null && pathOfRoute(routeOf(from) as Route) === pathOfRoute(target);
  const back: Back = {
    href: pathOfRoute(target),
    label: routeLabel(target),
    onBack: () => (cameFromTarget ? window.history.back() : go(target)),
  };

  const waiting = home.status === 'ready' && home.value.state === 'tracking' ? home.value.waitingInReview : 0;
  return (
    <div className="app">
      {route.screen === 'activity' ? (
        <ActivityTab key={route.pot} pot={route.pot} onChanged={retryHome} back={back} />
      ) : route.screen === 'payday' ? (
        <PaydayTab onChanged={retryHome} back={back} />
      ) : route.tab === 'home' ? (
        <HomeScreen load={home} onRetry={retryHome} />
      ) : route.tab === 'buckets' ? (
        <BucketsTab onChanged={retryHome} />
      ) : route.tab === 'review' ? (
        <ReviewTab onChanged={retryHome} />
      ) : (
        <SettingsTab onChanged={retryHome} />
      )}
      <TabBar current={tabOfRoute(route)} onGo={(tab: Tab) => go({ screen: 'tab', tab })} waitingInReview={waiting} />
    </div>
  );
}
