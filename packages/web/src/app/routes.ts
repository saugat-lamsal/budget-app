import { MOVABLE_POTS, type Pot } from '@budget-app/money';
import { POT_NAMES } from '../ui/names.js';

// The tabs, each at its own address, so a refresh or a notification link
// opens the right screen. The server answers each of these addresses with
// the app (packages/server/src/http/server.ts, APP_PATHS; a test checks).
export const TABS = ['home', 'buckets', 'review', 'settings'] as const;
export type Tab = (typeof TABS)[number];

export const TAB_LABELS: Readonly<Record<Tab, string>> = { home: 'Home', buckets: 'Buckets', review: 'Review', settings: 'Settings' };

export function pathOf(tab: Tab): string {
  return `/${tab}`;
}

// The tab at an address, or null when the address is not a tab's.
export function tabOf(pathname: string): Tab | null {
  const name = pathname.replace(/\/$/, '').slice(1);
  return (TABS as readonly string[]).includes(name) ? (name as Tab) : null;
}

// ----- The screens that are not tabs (QUESTIONS.md B97, B104) -----

// Each bucket's name in an address: /buckets/needs. Must match
// packages/server/src/views/activity.ts (a test checks).
export const POT_SLUGS: Readonly<Record<string, Pot>> = Object.freeze({
  savings: 'savings',
  needs: 'needs',
  wants: 'wants',
  'mom-reserve': 'momReserve',
  'held-for-others': 'heldForOthers',
});

export type Route =
  | { readonly screen: 'tab'; readonly tab: Tab }
  // What went in and out of one bucket this pay period.
  | { readonly screen: 'activity'; readonly pot: Pot }
  // What the last paycheck did, and the pay period that just ended.
  | { readonly screen: 'payday' };

// The screens that are not tabs. The server answers each address with the
// app (packages/server/src/http/server.ts, SCREEN_PATHS; a test checks).
export const SCREEN_ROUTES: readonly Route[] = Object.freeze([{ screen: 'payday' }, ...MOVABLE_POTS.map((pot): Route => ({ screen: 'activity', pot }))]);

export function activityPath(pot: Pot): string {
  const found = Object.entries(POT_SLUGS).find(([, p]) => p === pot);
  if (found === undefined) throw new Error(`no address for ${pot}`);
  return `/buckets/${found[0]}`;
}

export function pathOfRoute(route: Route): string {
  switch (route.screen) {
    case 'tab':
      return pathOf(route.tab);
    case 'activity':
      return activityPath(route.pot);
    case 'payday':
      return '/payday';
  }
}

// The screen at an address, or null when the address is not one of the app's.
export function routeOf(pathname: string): Route | null {
  const tab = tabOf(pathname);
  if (tab !== null) return { screen: 'tab', tab };
  const path = pathname.replace(/\/$/, '');
  if (path === '/payday') return { screen: 'payday' };
  const slug = /^\/buckets\/([^/]+)$/.exec(path)?.[1];
  if (slug !== undefined && Object.hasOwn(POT_SLUGS, slug)) {
    const pot = POT_SLUGS[slug];
    if (pot !== undefined) return { screen: 'activity', pot };
  }
  return null;
}

// Which tab is lit while a screen is showing: a bucket's screen and Payday
// are about the buckets.
export function tabOfRoute(route: Route): Tab {
  return route.screen === 'tab' ? route.tab : 'buckets';
}

export function routeTitle(route: Route): string {
  switch (route.screen) {
    case 'tab':
      return `${TAB_LABELS[route.tab]} · Budget`;
    case 'activity':
      return `${POT_NAMES[route.pot]} · Budget`;
    case 'payday':
      return 'Payday · Budget';
  }
}

// What a screen is called on the link that goes back to it.
export function routeLabel(route: Route): string {
  switch (route.screen) {
    case 'tab':
      return TAB_LABELS[route.tab];
    case 'activity':
      return POT_NAMES[route.pot];
    case 'payday':
      return 'Payday';
  }
}

// Where "back" goes from a screen: the screen he came from, if the app knows
// it (the address it left, kept in the history entry), otherwise Buckets.
export function backTarget(route: Route, cameFrom: unknown): Route {
  const home: Route = { screen: 'tab', tab: 'buckets' };
  if (typeof cameFrom !== 'string') return home;
  const from = routeOf(cameFrom);
  if (from === null || pathOfRoute(from) === pathOfRoute(route)) return home;
  return from;
}
