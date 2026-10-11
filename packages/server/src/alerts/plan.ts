import { addDays, bucketLevel, cardNotices, type BankBalances, type Book, type CardStatement, type IsoDate } from '@budget-app/money';
import { ReplayFailed } from '../history/history.js';
import { instantIn, todayIn } from '../history/today.js';
import { alertRecord, type AlertFacts, type AlertRecord, type LastingKind } from './alerts.js';

// Which alerts are due, worked out from the book and what is known of the
// bank at one moment, and the alerts already given (the ledger). Nothing here
// asks the clock or the database: the moment and everything else is handed in,
// so the same history always comes to the same ledger.
//
// Each time the server looks (after a sync or an answer, and on its timer) it
// makes at most these, in this order, each one an "alerts" event in the book's
// history, saved with its alerts in the outbox in one step:
// - start: the first look on a database. From then on the evenings count; the
//   take-backs already there are known, and get no alert.
// - evening: each evening (the daily review time, section 2, in his home time
//   zone) not handled yet whose moment has come, oldest first, even with
//   nothing to give, so it is never handled twice. One that came while the
//   server was down is handled when it is back, and says when it was due
//   (QUESTIONS.md A36). The daily review (10.3), card reminders (9.1 to 9.3)
//   and the overdue alert (9.4) come then (A34).
// - change: what is true now that has not been told: needs or wants low or
//   empty (10.1, 10.2, once per bucket per pay period), what the bank took
//   back (10.6, once), the totals not matching the bank (10.4) and the bank
//   wanting a new login (10.5), each once when it starts (A37). Made only when
//   it gives or clears something. An alert caused by a sync in the night goes
//   at once (A35).

export type AlertCheck =
  | { readonly kind: 'start'; readonly eveningsFrom: IsoDate; readonly known: readonly string[] }
  | { readonly kind: 'evening'; readonly date: IsoDate; readonly dueAt: string }
  | { readonly kind: 'change' };

export interface AlertsEvent {
  // The moment the server looked, as an instant (ISO, UTC).
  readonly at: string;
  readonly check: AlertCheck;
  readonly given: readonly AlertRecord[];
  // Lasting alerts that stopped being true (10.4, 10.5): told again only
  // after this.
  readonly cleared: readonly LastingKind[];
}

export interface AlertLedger {
  readonly started: boolean;
  // The next evening to handle; null before the start.
  readonly nextEvening: IsoDate | null;
  // The key of every alert given, so none is given twice.
  readonly given: ReadonlySet<string>;
  // Take-backs already there at the start: no alert for them.
  readonly known: ReadonlySet<string>;
  // For 10.4 and 10.5: whether it is told and still true, and how many times
  // it has started.
  readonly lasting: Readonly<Record<LastingKind, { readonly on: boolean; readonly times: number }>>;
}

export const NO_ALERTS: AlertLedger = {
  started: false,
  nextEvening: null,
  given: new Set(),
  known: new Set(),
  lasting: { 'totals-mismatch': { on: false, times: 0 }, 'bank-login': { on: false, times: 0 } },
};

// What is known at the moment the server looks.
export interface AlertWorld {
  readonly book: Book;
  readonly now: Date;
  // His home time zone (section 2).
  readonly zone: string;
  // The bank's balances with pending charges (12.1) as last read; null when
  // they cannot be worked out. The mismatch is then neither told nor cleared.
  readonly bank: BankBalances | null;
  readonly needsLogin: boolean;
  // The latest statement of each card (section 9).
  readonly statements: readonly CardStatement[];
}

// The ledger after one "alerts" event: the same live and in a replay. An
// event that does not fit what came before (an alert given twice, an evening
// out of turn, a second start) is a history that cannot be replayed.
export function applyAlerts(ledger: AlertLedger, event: AlertsEvent): AlertLedger {
  const given = new Set(ledger.given);
  for (const alert of event.given) {
    if (given.has(alert.key)) throw new ReplayFailed(`the alert "${alert.key}" was already given`);
    given.add(alert.key);
  }
  const lasting = { ...ledger.lasting };
  for (const alert of event.given) {
    const f = alert.facts;
    if (f.kind === 'totals-mismatch' || f.kind === 'bank-login') {
      if (lasting[f.kind].on || f.time !== lasting[f.kind].times + 1) throw new ReplayFailed(`the alert "${alert.key}" is out of turn`);
      lasting[f.kind] = { on: true, times: f.time };
    }
  }
  for (const kind of event.cleared) {
    if (!lasting[kind].on) throw new ReplayFailed(`${kind} was cleared without being on`);
    lasting[kind] = { on: false, times: lasting[kind].times };
  }
  const check = event.check;
  switch (check.kind) {
    case 'start':
      if (ledger.started) throw new ReplayFailed('alerts started twice');
      return { ...ledger, started: true, nextEvening: check.eveningsFrom, given, known: new Set(check.known), lasting };
    case 'evening':
      if (!ledger.started || check.date !== ledger.nextEvening) throw new ReplayFailed(`the evening of ${check.date} is out of turn (next is ${ledger.nextEvening ?? 'none'})`);
      return { ...ledger, nextEvening: addDays(check.date, 1), given, lasting };
    case 'change':
      if (!ledger.started) throw new ReplayFailed('alerts given before they started');
      return { ...ledger, given, lasting };
  }
}

// The instant the evening of a day comes: the daily review time (section 2)
// on that day in his home time zone.
export function eveningAt(world: Pick<AlertWorld, 'book' | 'zone'>, date: IsoDate): Date {
  return instantIn(world.zone, date, world.book.settings().dailyReviewTime);
}

// The next event to make now, or null when there is nothing to do.
export function nextAlertsEvent(world: AlertWorld, ledger: AlertLedger): AlertsEvent | null {
  const at = world.now.toISOString();
  if (!ledger.started) {
    const today = todayIn(world.zone, world.now);
    const eveningsFrom = eveningAt(world, today).getTime() > world.now.getTime() ? today : addDays(today, 1);
    const known = world.book
      .changeLog()
      .flatMap((line) => (line.kind === 'bank-took-back' ? [line.id] : []));
    return { at, check: { kind: 'start', eveningsFrom, known }, given: [], cleared: [] };
  }
  const evening = ledger.nextEvening;
  if (evening !== null) {
    const due = eveningAt(world, evening);
    if (due.getTime() <= world.now.getTime()) return eveningEvent(world, ledger, evening, due.toISOString(), at);
  }
  return changeEvent(world, ledger, at);
}

// Milliseconds until the next evening is due; 0 or less when it is; null before the start.
export function nextEveningIn(world: Pick<AlertWorld, 'book' | 'zone' | 'now'>, ledger: AlertLedger): number | null {
  if (ledger.nextEvening === null) return null;
  return eveningAt(world, ledger.nextEvening).getTime() - world.now.getTime();
}

function eveningEvent(world: AlertWorld, ledger: AlertLedger, date: IsoDate, dueAt: string, at: string): AlertsEvent {
  const { book } = world;
  const given: AlertRecord[] = [];
  const give = (facts: AlertFacts): void => {
    const record = alertRecord(facts, dueAt);
    if (!ledger.given.has(record.key) && !given.some((g) => g.key === record.key)) given.push(record);
  };
  // 10.3: only if something is waiting then.
  const waiting = book.reviewItems().length;
  if (waiting > 0) give({ kind: 'daily-review', date, waiting });
  // 9.1 to 9.4, for that day, with the payments seen by then.
  const settings = book.settings();
  for (const statement of world.statements) {
    for (const notice of cardNotices(date, statement, book.cardPayments(statement.card), settings)) {
      if (notice.kind === 'overdue') {
        give({ kind: 'card-overdue', card: notice.card, dueDate: notice.dueDate, minimumPayment: notice.minimumPayment, date });
      } else {
        give({
          kind: 'card-reminder',
          card: notice.card,
          dueDate: notice.dueDate,
          daysBefore: notice.daysBefore,
          minimumPayment: notice.minimumPayment,
          statementBalance: notice.card === 'everyday-card' ? notice.statementBalance : null,
        });
      }
    }
  }
  return { at, check: { kind: 'evening', date, dueAt }, given, cleared: [] };
}

function changeEvent(world: AlertWorld, ledger: AlertLedger, at: string): AlertsEvent | null {
  const { book } = world;
  const given: AlertRecord[] = [];
  const give = (facts: AlertFacts): void => {
    const record = alertRecord(facts, at);
    if (!ledger.given.has(record.key)) given.push(record);
  };
  // 10.1 and 10.2: the level of each bucket now, once per pay period each.
  const pots = book.pots();
  const started = book.startedPeriodWith();
  const period = book.period().number;
  const percent = book.settings().lowBucketAlertPercent;
  for (const bucket of ['needs', 'wants'] as const) {
    const level = bucketLevel(pots[bucket], started[bucket], percent);
    if (level === 'low') give({ kind: 'low-bucket', bucket, period, amount: pots[bucket], startedWith: started[bucket] });
    if (level === 'empty') give({ kind: 'empty-bucket', bucket, period, amount: pots[bucket] });
  }
  // 10.6: each take-back, once.
  for (const line of book.changeLog()) {
    if (line.kind === 'bank-took-back' && !ledger.known.has(line.id)) give({ kind: 'bank-took-back', id: line.id, date: line.date, description: line.description, amount: line.amount });
  }
  // 10.4 and 10.5: told when they start, cleared when they stop.
  const cleared: LastingKind[] = [];
  const lasting = (kind: LastingKind, now: boolean | null, facts: (time: number) => AlertFacts): void => {
    if (now === null) return;
    const state = ledger.lasting[kind];
    if (now && !state.on) give(facts(state.times + 1));
    if (!now && state.on) cleared.push(kind);
  };
  const check = world.bank === null ? null : book.selfCheck(world.bank);
  lasting('totals-mismatch', check === null ? null : !check.ok, (time) => ({ kind: 'totals-mismatch', time, difference: check?.difference ?? 0 }));
  lasting('bank-login', world.needsLogin, (time) => ({ kind: 'bank-login', time }));
  if (given.length === 0 && cleared.length === 0) return null;
  return { at, check: { kind: 'change' }, given, cleared };
}
