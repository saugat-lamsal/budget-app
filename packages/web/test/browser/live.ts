import type { BankBalances, Book, IsoDate } from '@budget-app/money';
import type { Server } from 'node:http';
import type { BrowserContext, Page } from 'playwright';
import { ChoiceDesk } from '../../../server/src/choices.js';
import { createAppServer } from '../../../server/src/http/server.js';
import { activityView } from '../../../server/src/views/activity.js';
import { bucketsView } from '../../../server/src/views/buckets.js';
import { homeView } from '../../../server/src/views/home.js';
import { paydayView } from '../../../server/src/views/payday.js';
import { reviewView } from '../../../server/src/views/review.js';
import { settingsView } from '../../../server/src/views/settings.js';
import { WEB_ROOT, listen, untilAnswered, waitOrReport, watchPage } from './harness.js';

// One book, served live: every screen's numbers are worked out from it, and
// his choices go to a real desk on it, so a tap changes the book the way it
// would for real. Tests then compare what the screens show with the money
// math, on a twin of the same book that gets the same answers directly.

export interface LiveLife {
  readonly book: Book;
  readonly bank: BankBalances | null;
  readonly today: IsoDate;
}

export function liveServer(life: LiveLife): Server {
  const desk = new ChoiceDesk(life.book, () => life.today);
  return createAppServer({
    webRoot: WEB_ROOT,
    home: () => homeView({ today: life.today, book: life.book, bank: life.bank, needsLogin: false, statements: [], madeUpData: true, seenTakeBacks: new Set(), lastChecked: null }),
    buckets: () => bucketsView({ today: life.today, book: life.book, bank: life.bank, madeUpData: true }),
    review: () => reviewView({ today: life.today, book: life.book, madeUpData: true }),
    choice: (_request, choice) => desk.decide(choice),
    move: (_request, move) => desk.move(move),
    activity: (_request, pot) => activityView({ today: life.today, book: life.book, pot, madeUpData: true }),
    payday: () => paydayView({ today: life.today, book: life.book, bank: life.bank, madeUpData: true }),
    settings: () => settingsView({ today: life.today, book: life.book, bank: life.bank, madeUpData: true }),
    settingsChange: (_request, change) => desk.settings(change),
    ruleChange: (_request, change) => desk.rule(change),
  });
}

export async function startLive(life: LiveLife): Promise<{ readonly server: Server; readonly base: string }> {
  const server = liveServer(life);
  return { server, base: await listen(server) };
}

// Opens a screen of a live book and waits for its numbers.
export async function openLive(context: BrowserContext, base: string, path: string): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  watchPage(page);
  await page.goto(`${base}${path}`);
  await waitOrReport(page, base, 'main[aria-busy="false"]');
  // Home's numbers are asked for on every screen: the page is handed over only
  // once that is answered too, so a test that closes it cancels nothing.
  await untilAnswered(page);
  return page;
}
