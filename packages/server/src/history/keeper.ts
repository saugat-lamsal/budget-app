import type { IncomingMessage, Server } from 'node:http';
import { DEFAULT_SETTINGS, type BankBalances, type Book, type CardStatement, type IsoDate, type Pot } from '@budget-app/money';
import { Auth } from '../auth/auth.js';
import { answerAuth, loginViewOf } from '../auth/http.js';
import { BankRulesDesk } from '../bank-rules-desk.js';
import { bankLinesIn, bankRuleLogIn, saveBankRuleLine } from '../bank-rules-db.js';
import { RECENT_DAYS } from '../bank-rules.js';
import { bankView } from '../bank/balances.js';
import { cardStatement } from '../bank/statements.js';
import { canonical, refuse, ChoiceDesk } from '../choices.js';
import type { TokenBox } from '../crypto/token-box.js';
import type { Db } from '../db/database.js';
import { logChange, readAccounts, readBankRules, readConnection, readItems, readStatements, saveBankRules, saveItem } from '../db/store.js';
import { createAppServer, type Seen } from '../http/server.js';
import type { Log } from '../log.js';
import type { PlaidClient } from '../plaid/client.js';
import { saveServerLine, serverLinesIn } from '../server-log.js';
import { SetupDesk } from '../setup-desk.js';
import { NO_ANSWERS, SETUP_LOOK_BACK_DAYS, type SetupAnswers } from '../setup-view.js';
import { FEWEST_MINUTES, MOST_MINUTES, readLastRead, saveSyncEveryMinutes, syncEveryMinutes } from '../sync/bank-reads.js';
import { syncBank, type SyncResult } from '../sync/sync.js';
import { activityView, type ActivityView } from '../views/activity.js';
import type { BankRuleRequest, BankRuleResponse } from '../views/bank-rules.js';
import { bucketsView, type BucketsView } from '../views/buckets.js';
import type { ChoiceRequest, ChoiceResponse, MoveRequest, MoveResponse, RuleRequest, RuleResponse, SettingsRequest, SettingsResponse, SetupRequest, SetupResponse } from '../views/choice.js';
import { homeView, type CheckedAt, type HomeView } from '../views/home.js';
import { paydayView, type PaydayView } from '../views/payday.js';
import { reviewView, type ReviewView } from '../views/review.js';
import { settingsView, type SettingsView } from '../views/settings.js';
import type { SetupView } from '../views/setup.js';
import { recorderOf, totalsOf, type Answer, type Recorder, type SavedSetupAnswers } from './history.js';
import { appendEvent, lastSeqOf, readDecision, readHistory, readLastChecked, replayHistory, saveDecision, saveLastChecked, sealHistory, type DeskName } from './history-db.js';
import { timeIn, todayIn } from './today.js';

// The real server's books (Step 1): everything he answers is kept in the
// database, so a restart finds the books exactly as they were.
//
// - Every answer is an event in the book's history, in the order it
//   happened, next to what the bank sent (history.ts). Its decision number
//   and its first answer are saved in the same step: all of it, or none of it.
// - The state is rebuilt from the database: the book (replayed), the
//   take-backs seen, his Setup day answers, the bank rules, and the desks
//   that take his taps. The same desks as the demo; only where things are
//   kept differs.
// - When it opens, it replays the history and checks the totals saved with
//   each event. If they differ, it does not open, and says at which event.
// - Today is the date in his home time zone (a setting), never the server's
//   own clock zone. The clock is asked for nothing else but the time Home
//   last checked safe to spend.

export interface KeeperInput {
  readonly db: Db;
  readonly now: () => Date;
  // The app's own address, as the browser shows it (http://localhost:5190):
  // passkeys are made for it, and every request must be addressed to it
  // (Step 2). Known once the server listens; tests that never serve leave it out.
  readonly origin?: () => string;
  readonly log?: Log;
  // For tests: runs inside each save (an answer's, and a sync's), after
  // everything is written and before it is committed. A throw there stops the
  // save halfway.
  readonly beforeCommit?: () => void;
}

interface State {
  // The book as the desks use it: every change through it is written down.
  readonly recorder: Recorder | null;
  readonly seen: Set<string>;
  readonly bankRules: BankRulesDesk;
  readonly choices: ChoiceDesk | null;
  // Before tracking starts.
  readonly setup: SetupDesk | null;
}

// What a sync needs to reach the bank.
export interface SyncBank {
  readonly plaid: PlaidClient;
  readonly box: TokenBox;
  readonly log: Log;
  readonly pageSize?: number;
}

const NOUNS: Readonly<Record<DeskName, string>> = { choice: 'choice', move: 'move', settings: 'change', rule: 'change', setup: 'answer', 'bank-rule': 'change' };

export class Keeper {
  readonly #db: Db;
  readonly #now: () => Date;
  readonly #beforeCommit: (() => void) | undefined;
  // Step 2: his passkeys and logins.
  readonly #auth: Auth;
  #origin: () => string;
  #state!: State;
  // Step 3: the sync on its way, if any, and when the last one started (an
  // instant, in milliseconds); when the server starts, the last read.
  #syncing: Promise<SyncResult> | null = null;
  #lastTry: number | null;
  // The last event of the history the books in memory have.
  #lastSeq = 0;

  private constructor(input: KeeperInput) {
    this.#db = input.db;
    this.#now = input.now;
    this.#beforeCommit = input.beforeCommit;
    this.#origin = input.origin ?? (() => 'http://localhost:5190');
    this.#auth = new Auth({ db: input.db, now: input.now, origin: () => this.#origin(), today: () => this.today(), bookLines: () => this.book()?.changeLog().length ?? 0 });
    const lastRead = readLastRead(input.db);
    this.#lastTry = lastRead === null ? null : Date.parse(lastRead);
  }

  // Opens the books kept in the database, after checking that the history
  // replays to the totals saved with it (HistoryDoesNotReplay if not).
  static open(input: KeeperInput): Keeper {
    const keeper = new Keeper(input);
    keeper.reload();
    return keeper;
  }

  // Reads everything from the database again: after a sync, or a save that
  // did not go through.
  reload(): void {
    const history = readHistory(this.#db);
    const replayed = replayHistory(history, true);
    sealHistory(this.#db, replayed.unsealed);
    const recorder = replayed.book === null ? null : recorderOf(replayed.book);
    const book = recorder?.book ?? null;
    const today = (): IsoDate => this.today();
    const bankRules = new BankRulesDesk({
      rules: readBankRules(this.#db),
      log: bankRuleLogIn(this.#db),
      lines: () => bankLinesIn(this.#db),
      today,
      bookLines: () => book?.changeLog().length ?? 0,
    });
    let setup: SetupDesk | null = null;
    if (book === null) {
      const connection = readConnection(this.#db);
      setup = new SetupDesk({
        bank: { connection, setUp: false, accounts: readAccounts(this.#db), items: readItems(this.#db), rules: readBankRules(this.#db) },
        today,
        settings: DEFAULT_SETTINGS,
        halvesWithinDays: SETUP_LOOK_BACK_DAYS,
        madeUpData: false,
        bankRules,
        answers: replayed.setupAnswers === null ? NO_ANSWERS : setupAnswersOf(replayed.setupAnswers),
      });
    }
    this.#state = { recorder, seen: replayed.seen, bankRules, choices: book === null ? null : new ChoiceDesk(book, today), setup };
    this.#lastSeq = history.at(-1)?.seq ?? 0;
  }

  book(): Book | null {
    return this.#state.recorder?.book ?? null;
  }

  // His home time zone (section 2): the book's setting once tracking has
  // started, and before that the one it will start with.
  timeZone(): string {
    return (this.book()?.settings() ?? DEFAULT_SETTINGS).homeTimeZone;
  }

  today(): IsoDate {
    return todayIn(this.timeZone(), this.#now());
  }

  // ----- What the screens show -----

  // Today's balances as the bank reports them, pending charges included
  // (12.1); null when the bank cannot be read: it wants him to log in again
  // (10.5), or its balances cannot be worked out.
  #bank(): BankBalances | null {
    const connection = readConnection(this.#db);
    if (connection === null || connection.needsLogin) return null;
    const view = bankView(readAccounts(this.#db), readItems(this.#db));
    return view.ok ? view.view.withPending : null;
  }

  #statements(): CardStatement[] {
    const stored = readStatements(this.#db);
    return readAccounts(this.#db).flatMap((a) => {
      const raw = stored.get(a.plaidAccountId)?.raw;
      if ((a.role !== 'everyday-card' && a.role !== 'old-card') || raw === undefined) return [];
      const read = cardStatement(a.role, raw);
      return read.ok ? [read.statement] : [];
    });
  }

  home(): HomeView {
    const view = homeView({
      today: this.today(),
      book: this.book(),
      bank: this.#bank(),
      needsLogin: readConnection(this.#db)?.needsLogin ?? false,
      statements: this.#statements(),
      madeUpData: false,
      seenTakeBacks: this.#state.seen,
      lastChecked: readLastChecked(this.#db),
      checkedAt: this.#checkedAt(),
    });
    // 0.5, B82: the last safe to spend the bank backed up, and when.
    if (view.state === 'tracking' && view.safeToSpend.shown) saveLastChecked(this.#db, { amount: view.safeToSpend.amount, at: timeIn(this.timeZone(), this.#now()) });
    return view;
  }

  // Step 3: "Checked at": the last read of the bank, in his home time zone.
  #checkedAt(): CheckedAt | null {
    const read = this.lastRead();
    const zone = this.timeZone();
    return read === null ? null : { at: timeIn(zone, new Date(read)), timeZone: zone };
  }

  buckets(): BucketsView {
    return bucketsView({ today: this.today(), book: this.book(), bank: this.#bank(), madeUpData: false });
  }

  review(): ReviewView {
    return reviewView({ today: this.today(), book: this.book(), madeUpData: false });
  }

  activity(pot: Pot): ActivityView {
    return activityView({ today: this.today(), book: this.book(), pot, madeUpData: false });
  }

  payday(): PaydayView {
    return paydayView({ today: this.today(), book: this.book(), bank: this.#bank(), madeUpData: false });
  }

  // With the request, the login card for the device asking (Step 2).
  settings(request?: IncomingMessage): SettingsView {
    const rules = this.#state.bankRules;
    const session = request === undefined ? null : this.#auth.session(request.headers.cookie);
    return settingsView({
      today: this.today(),
      book: this.book(),
      bank: this.#bank(),
      madeUpData: false,
      bankRules: { rules: rules.rules(), log: rules.log(), recentDays: RECENT_DAYS },
      serverLog: serverLinesIn(this.#db),
      ...(session === null ? {} : { login: loginViewOf(this.#auth, session) }),
      sync: { everyMinutes: this.syncEveryMinutes(), checkedAt: this.#checkedAt(), today: this.today() },
    });
  }

  // ----- Login (Step 2) -----

  // A new one-time code for making a passkey: good once, for 15 minutes.
  loginCode(): string {
    return this.#auth.newCode();
  }

  hasPasskeys(): boolean {
    return this.#auth.hasPasskeys();
  }

  setupView(): SetupView {
    return this.#state.setup?.view() ?? { state: 'tracking', madeUpData: false };
  }

  // ----- His answers -----

  choice(request: ChoiceRequest): ChoiceResponse {
    return this.#bookAnswer('choice', request, (desk) => desk.decide(request), 'That one was already dealt with', 'not-waiting');
  }

  move(request: MoveRequest): MoveResponse {
    return this.#bookAnswer('move', request, (desk) => desk.move(request), 'There is nothing to move yet', 'refused');
  }

  settingsChange(request: SettingsRequest): SettingsResponse {
    return this.#bookAnswer('settings', request, (desk) => desk.settings(request), 'There is nothing to change before setup day', 'refused');
  }

  ruleChange(request: RuleRequest): RuleResponse {
    return this.#bookAnswer('rule', request, (desk) => desk.rule(request), 'There is nothing to change before setup day', 'refused');
  }

  setup(request: SetupRequest): SetupResponse {
    const earlier = this.#earlier('setup', request);
    if (earlier !== null) return earlier as SetupResponse;
    const { setup, bankRules } = this.#state;
    if (setup === null) return refuse('refused', 'Setup day is done already');
    const logged = bankRules.log().length;
    const response = this.#guarded(() => setup.decide(request));
    if (!response.ok || response.replayed) return response;
    const started = setup.started();
    const decision = { id: request.id, desk: 'setup' as const, fingerprint: canonical(request), answer: response };
    if (started === null) {
      this.#save({ answer: { setup: savedSetupAnswers(setup.answers()), ...this.#bankRuleLines(logged) }, decision, bankRulesChanged: bankRules.log().length > logged });
      return response;
    }
    // 14.3: tracking starts. Setup day is the first event of the book.
    const today = this.today();
    this.#write(() => {
      const seq = appendEvent(this.#db, { event: { kind: 'setup', input: started.input }, date: today, sync: null, totals: totalsOf(started.book) });
      for (const item of started.items) saveItem(this.#db, item);
      logChange(this.#db, today, 'setup day', { startingMoney: started.startingMoney, assignment: started.input.assignment, inTransit: (started.input.transfersInTransit ?? []).map((h) => h.id) });
      saveDecision(this.#db, { ...decision, seq });
    });
    this.reload();
    return response;
  }

  bankRule(request: BankRuleRequest): BankRuleResponse {
    const earlier = this.#earlier('bank-rule', request);
    if (earlier !== null) return earlier as BankRuleResponse;
    const { setup, bankRules } = this.#state;
    if (setup === null && this.book() === null) return refuse('refused', 'There is no bank connection yet');
    const logged = bankRules.log().length;
    // On Setup day, its desk takes it, so the steps follow the rules (24c).
    const response = this.#guarded(() => (setup !== null ? setup.bankRule(request) : bankRules.decide(request)));
    if (!response.ok || response.replayed) return response;
    this.#save({
      answer: { ...this.#bankRuleLines(logged), ...(setup === null ? {} : { setup: savedSetupAnswers(setup.answers()) }) },
      decision: { id: request.id, desk: 'bank-rule', fingerprint: canonical(request), answer: response },
      bankRulesChanged: true,
    });
    return response;
  }

  // 10.6: a take-back he has seen (B84). False when there is no such take-back.
  seen(what: Seen): boolean {
    const book = this.book();
    const known = book?.changeLog().some((entry) => entry.kind === 'bank-took-back' && entry.id === what.id) ?? false;
    if (!known || this.#state.seen.has(what.id)) return known;
    this.#save({ answer: { seen: what.id } });
    this.#state.seen.add(what.id);
    return true;
  }

  // ----- Syncing with the bank (Step 3) -----

  // One sync with the bank. Never two at once: asked again while one is on
  // its way (by the timer, or by --sync), it is that one, and gets its result.
  // What it brings is saved in one transaction (sync.ts) together with the
  // moment the bank was read, and the books in memory are read again right
  // after, in the same step: an answer that comes in meanwhile is saved
  // before the sync's save (which then works from it), or after it, against
  // the book with the sync in it, never in between. A sync that fails saves
  // nothing.
  sync(bank: SyncBank): Promise<SyncResult> {
    if (this.#syncing !== null) return this.#syncing;
    this.#lastTry = this.#now().getTime();
    const running = syncBank({
      db: this.#db,
      plaid: bank.plaid,
      box: bank.box,
      log: bank.log,
      today: this.today(),
      ...(bank.pageSize === undefined ? {} : { pageSize: bank.pageSize }),
      readAt: () => this.#now().toISOString(),
      ...(this.#beforeCommit === undefined ? {} : { beforeCommit: this.#beforeCommit }),
      // Read again when it saved anything, or when the history has more than
      // the books in memory (another copy of the server saved a sync).
      afterSave: (result) => {
        if (result.changed || lastSeqOf(this.#db) !== this.#lastSeq) this.reload();
      },
    }).finally(() => {
      this.#syncing = null;
    });
    this.#syncing = running;
    return running;
  }

  // How long until the next sync is due, in milliseconds of real time: one
  // interval (section 2) after the last one started, or after the last read
  // when the server has just started. 0 or less: due now. Null while there is
  // no bank connection to read.
  syncDueIn(): number | null {
    if (readConnection(this.#db) === null) return null;
    if (this.#lastTry === null) return 0;
    return this.#lastTry + this.syncEveryMinutes() * 60_000 - this.#now().getTime();
  }

  // When the bank was last read, as an instant; null before the first read.
  lastRead(): string | null {
    return readLastRead(this.#db);
  }

  syncEveryMinutes(): number {
    return syncEveryMinutes(this.#db);
  }

  // Section 2: how often to sync, a whole number of minutes from 15 to 1,440.
  // It applies right away (13.1) and is logged (13.5).
  changeSyncEvery(minutes: unknown): { readonly ok: true } | { readonly ok: false; readonly why: string } {
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < FEWEST_MINUTES || minutes > MOST_MINUTES) {
      return { ok: false, why: `Syncing with the bank takes a whole number of minutes, ${FEWEST_MINUTES} to ${MOST_MINUTES.toLocaleString('en-US')}. Nothing was changed.` };
    }
    const before = this.syncEveryMinutes();
    if (minutes === before) return { ok: false, why: 'That is already the setting. Nothing was changed.' };
    this.#db.transaction(() => {
      saveSyncEveryMinutes(this.#db, minutes);
      saveServerLine(this.#db, { date: this.today(), action: 'sync-every-changed', before, after: minutes, afterBookLines: this.book()?.changeLog().length ?? 0 });
    })();
    return { ok: true };
  }

  // The web server for the screens, with these books behind it. Every
  // screen and every /api address needs a login (Step 2), checked against
  // the app's own address, `origin`.
  server(webRoot: string, origin: () => string, onError?: (error: unknown) => void): Server {
    this.#origin = origin;
    const auth = this.#auth;
    return createAppServer({
      webRoot,
      ...(onError === undefined ? {} : { onError }),
      gate: {
        origin,
        loggedIn: (request) => auth.session(request.headers.cookie) !== null,
        auth: (path, request, body) => answerAuth(auth, path, request, body, auth.session(request.headers.cookie)),
      },
      home: () => this.home(),
      buckets: () => this.buckets(),
      review: () => this.review(),
      activity: (_request, pot) => this.activity(pot),
      payday: () => this.payday(),
      settings: (request) => this.settings(request),
      setupView: () => this.setupView(),
      choice: (_request, choice) => this.choice(choice),
      move: (_request, move) => this.move(move),
      settingsChange: (_request, change) => this.settingsChange(change),
      ruleChange: (_request, change) => this.ruleChange(change),
      setup: (_request, answer) => this.setup(answer),
      bankRule: (_request, change) => this.bankRule(change),
      seen: (_request, what) => this.seen(what),
      syncEvery: (_request, minutes) => this.changeSyncEvery(minutes),
    });
  }

  // ----- Keeping it -----

  // A decision number already used: the same request gets its first answer
  // back, and changes nothing; a different one is refused.
  #earlier(desk: DeskName, request: { readonly id: string }): unknown {
    const saved = readDecision(this.#db, request.id);
    if (saved === null) return null;
    if (saved.fingerprint === canonical(request)) return { ...(saved.answer as object), replayed: true };
    return refuse('id-reused', `That decision number was already used for a different ${NOUNS[desk]}.`);
  }

  // An answer the book takes, through its desk. What the desk did to the
  // book is written down, and saved with the decision number and the answer.
  #bookAnswer<R extends { readonly ok: boolean; readonly replayed?: boolean }>(desk: DeskName, request: { readonly id: string }, run: (desk: ChoiceDesk) => R, beforeSetup: string, code: 'not-waiting' | 'refused'): R {
    const earlier = this.#earlier(desk, request);
    if (earlier !== null) return earlier as R;
    const { choices, recorder } = this.#state;
    if (choices === null || recorder === null) return refuse(code, beforeSetup) as unknown as R;
    recorder.start();
    let response: R;
    try {
      response = run(choices);
    } catch (error) {
      recorder.take();
      this.reload();
      throw error;
    }
    const calls = recorder.take();
    if (!response.ok || response.replayed === true) {
      if (calls.length > 0) {
        this.reload();
        throw new Error('an answer that was refused changed the book');
      }
      return response;
    }
    this.#save({ answer: { book: calls }, decision: { id: request.id, desk, fingerprint: canonical(request), answer: response } });
    return response;
  }

  // Runs a desk; anything unexpected reads everything again, so nothing half
  // done stays in memory.
  #guarded<R>(run: () => R): R {
    try {
      return run();
    } catch (error) {
      this.reload();
      throw error;
    }
  }

  // The change log lines a bank rule change added, for its event.
  #bankRuleLines(before: number): Pick<Answer, 'bankRules'> {
    const lines = this.#state.bankRules.log().slice(before);
    return lines.length === 0 ? {} : { bankRules: lines };
  }

  // Saves one answer: the event, with the totals after it, its decision
  // number and first answer, and for a bank rule change the rules and their
  // change log lines. All in one transaction.
  #save(what: { readonly answer: Answer; readonly decision?: Omit<Parameters<typeof saveDecision>[1], 'seq'>; readonly bankRulesChanged?: boolean }): void {
    const today = this.today();
    const book = this.book();
    const rules = this.#state.bankRules;
    this.#write(() => {
      const seq = appendEvent(this.#db, { event: { kind: 'answer', answer: what.answer }, date: today, sync: null, totals: totalsOf(book) });
      if (what.bankRulesChanged === true) {
        saveBankRules(this.#db, rules.rules());
        for (const line of what.answer.bankRules ?? []) saveBankRuleLine(this.#db, line);
      }
      if (what.decision !== undefined) saveDecision(this.#db, { ...what.decision, seq });
    });
  }

  // One transaction. If it does not go through, nothing of it is saved, and
  // what is in memory is read again from the database, which never had it.
  #write(writes: () => void): void {
    try {
      this.#db.transaction(() => {
        writes();
        this.#beforeCommit?.();
      })();
      this.#lastSeq = lastSeqOf(this.#db);
    } catch (error) {
      this.reload();
      throw error;
    }
  }
}

// ----- Setup day answers, kept as lists -----

function savedSetupAnswers(a: SetupAnswers): SavedSetupAnswers {
  return { onItsWay: [...a.onItsWay], halvesWithinDays: a.halvesWithinDays, lastPaycheckDate: a.lastPaycheckDate, assignment: { ...a.assignment }, suggestions: [...a.suggestions] };
}

function setupAnswersOf(s: SavedSetupAnswers): SetupAnswers {
  return {
    onItsWay: new Map(s.onItsWay),
    halvesWithinDays: s.halvesWithinDays,
    lastPaycheckDate: s.lastPaycheckDate,
    assignment: s.assignment as unknown as SetupAnswers['assignment'],
    suggestions: new Map(s.suggestions) as SetupAnswers['suggestions'],
  };
}
