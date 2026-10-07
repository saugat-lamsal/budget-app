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
