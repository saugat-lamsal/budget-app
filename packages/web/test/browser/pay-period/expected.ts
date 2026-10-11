import type { BankBalances, Book, IsoDate, Pot } from '@budget-app/money';
import { outboxCounts } from '../../../../server/src/alerts/outbox.js';
import { bankRuleLogIn } from '../../../../server/src/bank-rules-db.js';
import { RECENT_DAYS } from '../../../../server/src/bank-rules.js';
import { readBankRules } from '../../../../server/src/db/store.js';
import { readLastChecked } from '../../../../server/src/history/history-db.js';
import { timeIn } from '../../../../server/src/history/today.js';
import { serverLinesIn } from '../../../../server/src/server-log.js';
import { activityView, POT_SLUGS } from '../../../../server/src/views/activity.js';
import { bucketsView } from '../../../../server/src/views/buckets.js';
import { homeView } from '../../../../server/src/views/home.js';
import { paydayView } from '../../../../server/src/views/payday.js';
import { reviewView } from '../../../../server/src/views/review.js';
import { settingsView } from '../../../../server/src/views/settings.js';
import type { RealServer } from './real-server.js';

// What every screen should show on a day, worked out from the simulator's own
// book (period.ts, simulatorBookAt) by the same code that works out the real
// server's screens from its books. The few things only the real server knows,
// and the simulator does not, are taken from the real server: when it last
// read the bank, the take-backs he has marked seen, the bank rules and their
// log lines, its own log lines (logins), and how many alerts it kept (Phase 5).
// Everything about money is the simulator's.

export const SCREENS: readonly string[] = ['/home', '/buckets', ...Object.keys(POT_SLUGS).map((slug) => `/buckets/${slug}`), '/review', '/payday', '/settings'];
export type ScreenPath = string;

// The address each screen reads its numbers from.
export function apiOf(path: ScreenPath): string {
  if (path === '/home') return '/api/home';
  if (path.startsWith('/buckets/')) return `/api/activity/${path.slice('/buckets/'.length)}`;
  return `/api${path}`;
}

export type Views = Readonly<Record<string, unknown>>;

// Every screen's numbers for the simulator's book, by API address.
export function expectedViews(book: Book, today: IsoDate, bank: BankBalances, real: RealServer, seenTakeBacks: ReadonlySet<string>): Views {
  const db = real.db;
  const zone = book.settings().homeTimeZone;
  const read = real.keeper.lastRead();
  const checkedAt = read === null ? null : { at: timeIn(zone, new Date(read)), timeZone: zone };
  const views: Record<string, unknown> = {
    '/api/home': homeView({ today, book, bank, needsLogin: false, statements: [], madeUpData: false, seenTakeBacks, lastChecked: readLastChecked(db), checkedAt }),
    '/api/buckets': bucketsView({ today, book, bank, madeUpData: false }),
    '/api/review': reviewView({ today, book, madeUpData: false }),
    '/api/payday': paydayView({ today, book, bank, madeUpData: false }),
    '/api/settings': settingsView({
      today,
      book,
      bank,
      madeUpData: false,
      bankRules: { rules: readBankRules(db), log: bankRuleLogIn(db), recentDays: RECENT_DAYS },
      serverLog: serverLinesIn(db),
      sync: { everyMinutes: real.keeper.syncEveryMinutes(), checkedAt, today },
      alerts: outboxCounts(db),
    }),
  };
  for (const [slug, pot] of Object.entries(POT_SLUGS) as [string, Pot][]) views[`/api/activity/${slug}`] = activityView({ today, book, pot, madeUpData: false });
  return views;
}

// The real server's views, as it sends them to the screens (Settings without
// a login card: that needs the browser's own login).
export function realViews(real: RealServer): Views {
  const k = real.keeper;
  const views: Record<string, unknown> = { '/api/home': k.home(), '/api/buckets': k.buckets(), '/api/review': k.review(), '/api/payday': k.payday(), '/api/settings': k.settings() };
  for (const [slug, pot] of Object.entries(POT_SLUGS) as [string, Pot][]) views[`/api/activity/${slug}`] = k.activity(pot);
  return JSON.parse(JSON.stringify(views)) as Views;
}

// The real server names a rule after the decision number the phone made for
// it ("rule-<number>"); the simulator after what it is ("grocer"). Each of
// the real server's rule ids becomes the simulator's id for the rule in the
// same place in the same list, so the two can be compared. Anything else
// about the rules (their text, what they pick, their order) is compared as is.
export function sameRuleIds(views: Views, real: Book, simulator: Book): Views {
  let text = JSON.stringify(views);
  for (const kind of ['purchase', 'deposit', 'person'] as const) {
    const ours = real.rules().filter((r) => r.for === kind);
    const theirs = simulator.rules().filter((r) => r.for === kind);
    ours.forEach((rule, i) => {
      const other = theirs[i];
      if (other !== undefined && rule.id !== other.id) text = text.split(JSON.stringify(rule.id)).join(JSON.stringify(other.id));
    });
  }
  return JSON.parse(text) as Views;
}

// The first differences between two plain values, each as where it is and
// both values: "payday.report.split.needs: real 51000, simulator 51001".
export function differences(real: unknown, expected: unknown, where = '', found: string[] = [], most = 8): string[] {
  if (found.length >= most) return found;
  if (Object.is(real, expected)) return found;
  const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object';
  if (Array.isArray(real) && Array.isArray(expected)) {
    if (real.length !== expected.length) found.push(`${where}: real has ${real.length} entries, the simulator ${expected.length}: real ${short(real)}, simulator ${short(expected)}`);
    else real.forEach((v, i) => differences(v, expected[i], `${where}[${i}]`, found, most));
    return found;
  }
  if (isObject(real) && isObject(expected) && !Array.isArray(real) && !Array.isArray(expected)) {
    for (const key of new Set([...Object.keys(real), ...Object.keys(expected)])) differences(real[key], expected[key], where === '' ? key : `${where}.${key}`, found, most);
    return found;
  }
  found.push(`${where}: real ${short(real)}, simulator ${short(expected)}`);
  return found;
}

function short(v: unknown): string {
  const text = JSON.stringify(v) ?? String(v);
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}
