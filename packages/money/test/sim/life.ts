import {
  DEFAULT_SETTINGS,
  MoneyError,
  addDays,
  cardNotices,
  changeSettings,
  daysBetween,
  startTracking,
  withPendingCharges,
  type BankBalances,
  type BankTransaction,
  type Book,
  type CardNotice,
  type CardStatement,
  type Cents,
  type Deposit,
  type IsoDate,
  type LeftoverAnswer,
  type LeftoverChoice,
  type Pot,
  type Pots,
  type Purchase,
  type ReviewItem,
  type SavingsWithdrawal,
  type Settings,
  type SetupInput,
  type SortingRule,
  type TransferSent,
} from '../../src/index.js';
import { SimBank, type Card, type ChargeAccount, type OwnAccount, type Posted } from './bank.js';
import { Random } from './random.js';

// Phase 2, the simulated you: a made-up person with made-up numbers, lived
// one day at a time. Each day the bank's activity arrives in a shuffled
// order, the person does their evening review, and then every check runs.
// Besides the daily self-check, the simulator works out from the rulebook
// what each thing should do to the buckets and checks the book did exactly
// that. The first check that fails stops the life and reports its seed and
// day, so the same life can be played again exactly.

export interface LifeOptions {
  readonly seed: number;
  readonly years: number;
  // For the simulator's own tests: on this day the bank changes a balance
  // without telling the book, so the self-check must fail.
  readonly sabotageOnDay?: number;
  // For the bank connection's tests (packages/server): what the bank did on
  // setup day and on each day after, and the book's totals at the end of
  // each day, so the same days can be played through the bank connection in
  // Plaid's format. Recording changes nothing about the life.
  readonly record?: LifeRecorder;
}

// The book's totals that bank activity alone decides. The person's answers
// only move money between buckets, so these do not depend on them.
export interface BookTotals {
  readonly appSide: Cents;
  readonly inTransit: Cents;
  readonly oldCardDebt: Cents;
}

export interface RecordedBankDay {
  readonly date: IsoDate;
  // What the bank sent that day, in the order it sent it.
  readonly feed: readonly BankTransaction[];
  readonly posted: Posted;
  // 12.1: posted plus pending charges.
  readonly balances: BankBalances;
  // Transfers with only one half showing, as "from to amount left|arrived".
  readonly halvesShowing: readonly string[];
  readonly totals: BookTotals;
}

export interface LifeRecorder {
  // The bank as it started, what it sent before setup day, and setup day itself.
  setupDay(setup: { readonly start: Posted; readonly feed: readonly BankTransaction[]; readonly input: SetupInput; readonly totals: BookTotals }): void;
  day(day: RecordedBankDay): void;
}

export type LifeResult =
  | { readonly ok: true; readonly seed: number; readonly days: number; readonly stats: Stats }
  | {
      readonly ok: false;
      readonly seed: number;
      readonly day: number;
      readonly date: IsoDate;
      readonly check: string;
      readonly message: string;
      readonly recent: readonly string[];
      readonly stats: Stats;
    };

// How often each kind of thing happened, to show the life covers what it should.
export const STAT_NAMES = [
  'days',
  'paychecks',
  'threePaycheckMonths',
  'latePaychecks',
  'smallPaychecks',
  'earlyPaychecksInReview',
  'myPaycheckChoices',
  'bonuses',
  'otherIncome',
  'purchases',
  'postedFromPending',
  'postedAtNewAmount',
  'holdsDropped',
  'pendingChanged',
  'refundsLinked',
  'refundsInReview',
  'splitPurchases',
  'savingsBills',
  'momPayments',
  'momDifferences',
  'momFromSavings',
  'paidForFriends',
  'friendsPaidBack',
  'personPaymentsFromSavings',
  'paymentsForMom',
  'forMomRules',
  'forMomResorted',
  'personPaymentsSplit',
  'everydayCardPayments',
  'oldCardPayments',
  'oldCardFromSavings',
  'oldCardPurchases',
  'oldCardRefunds',
  'paymentsInTransit',
  'paymentsLandedFirst',
  'paymentsLandedOutOfOrder',
  'lateCardPayments',
  'remindersChecked',
  'overdueAlerts',
  'cardFees',
  'cardInterest',
  'savingsTransfers',
  'transfersMarked',
  'leftoverRolledOver',
  'leftoverMovedToSavings',
  'leftoverAnsweredLate',
  'leftoverLoweredLate',
  'settingsChanges',
  'handMoves',
  'confirmedMoves',
  'resorts',
  'mistakesRefused',
  'alwaysRules',
  'rulesAdded',
  'duplicatesSent',
  'takenBack',
  'pendingAtSetup',
  'inTransitAtSetup',
] as const;
export type Stats = Record<(typeof STAT_NAMES)[number], number>;

const PAYROLL = 'ACME PAYROLL';
const MOM = 'Made Up Mom';
// Someone the person sends money to for mom, which no rule knows at first (7.6).
const FOR_MOM = 'MADE UP AUNT';
const FIRST_START: IsoDate = '2026-10-01';

const START_RULES: readonly SortingRule[] = [
  { id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' },
  { id: 'gas', for: 'purchase', contains: 'MADE UP GAS', bucket: 'needs' },
  { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
  { id: 'pharmacy', for: 'purchase', contains: 'PHARMACY', bucket: 'needs' },
  { id: 'utility', for: 'purchase', contains: 'UTILITY', bucket: 'needs' },
  { id: 'phone', for: 'purchase', contains: 'PHONE', bucket: 'needs' },
  { id: 'streaming', for: 'purchase', contains: 'STREAMING', bucket: 'wants' },
  { id: 'landlord', for: 'person', contains: 'LANDLORD', choice: { to: 'needs' } },
  { id: 'roommate', for: 'deposit', contains: 'ROOMMATE', choice: { to: 'needs' } },
  { id: 'savings-interest', for: 'deposit', contains: 'INTEREST PAID', choice: { to: 'savings' } },
];

// How the person sorts something from a store when it waits in review.
type Sorting = 'needs' | 'wants' | 'split' | 'either';

interface Store {
  readonly name: string;
  readonly sorting: Sorting;
  readonly min: Cents;
  readonly max: Cents;
  // How often it comes up: on this many days in 1,000.
  readonly perThousandDays: number;
  // Paid by debit card this many times in 10, otherwise by the everyday card.
  readonly debitOutOf10: number;
  readonly how: 'pending' | 'posted' | 'gas';
  readonly tip?: boolean;
  readonly refundsOutOf100?: number;
}

const STORES: readonly Store[] = [
  { name: 'MADE UP GROCER', sorting: 'needs', min: 2_500, max: 18_000, perThousandDays: 300, debitOutOf10: 4, how: 'pending' },
  { name: 'MADE UP GAS', sorting: 'needs', min: 2_500, max: 7_500, perThousandDays: 150, debitOutOf10: 3, how: 'gas' },
  { name: 'MADE UP CAFE', sorting: 'wants', min: 300, max: 1_200, perThousandDays: 550, debitOutOf10: 2, how: 'pending' },
  { name: 'MADE UP RESTAURANT', sorting: 'wants', min: 1_800, max: 9_500, perThousandDays: 200, debitOutOf10: 1, how: 'pending', tip: true },
  { name: 'MADE UP ONLINE SHOP', sorting: 'either', min: 800, max: 16_000, perThousandDays: 140, debitOutOf10: 1, how: 'pending', refundsOutOf100: 15 },
  { name: 'MADE UP BIG BOX', sorting: 'split', min: 3_000, max: 26_000, perThousandDays: 90, debitOutOf10: 3, how: 'pending', refundsOutOf100: 6 },
  { name: 'MADE UP PHARMACY', sorting: 'needs', min: 800, max: 6_000, perThousandDays: 45, debitOutOf10: 5, how: 'posted' },
  { name: 'MADE UP CINEMA', sorting: 'wants', min: 1_200, max: 4_000, perThousandDays: 40, debitOutOf10: 0, how: 'pending' },
];

const SPLITS: readonly Settings['split'][] = [
  { savings: 50, needs: 30, wants: 20 },
  { savings: 40, needs: 35, wants: 25 },
  { savings: 55, needs: 30, wants: 15 },
  { savings: 45, needs: 35, wants: 20 },
  { savings: 60, needs: 25, wants: 15 },
];

// How the person sorts a payment to a person: one place, for mom, or split
// across needs, wants, and not mine (7.6).
type PersonSorting = 'needs' | 'wants' | 'not-mine' | 'mom' | 'split';

// What the person knows about a bank transaction: how they will sort it.
type Intent =
  | { readonly type: 'store'; readonly sorting: Sorting; readonly store: string }
  | { readonly type: 'person'; readonly sorting: PersonSorting }
  | { readonly type: 'from-savings'; readonly sorting: 'needs' | 'wants' }
  | { readonly type: 'money-in'; readonly choice: 'paycheck' | 'other-income' | 'not-mine' | 'needs' | 'wants' }
  | { readonly type: 'refund'; readonly bucket: 'needs' | 'wants' };

// Where a purchase stands, as the simulator keeps track of it: the bucket it
// is in, waiting in review, split, counted on setup day, on the old card, or
// taken back by the bank (4.10).
type Standing = 'needs' | 'wants' | 'unsorted' | 'split' | 'setup' | 'old-card' | 'gone';

type PotName = keyof Pots;
const POT_NAMES: readonly PotName[] = ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers', 'unsortedIn', 'unsortedOut'];
// How the buckets should change. Anything not named should not change.
type Change = Partial<Record<PotName, Cents>>;

interface CardPaymentSeen {
  left: IsoDate | null;
  landed: IsoDate | null;
  readonly amount: Cents;
}

interface Person {
  readonly pay: Cents;
  readonly rent: Cents;
  readonly closingDay: Record<Card, number>;
  readonly roommate: boolean;
  readonly momTimesPerMonth: number;
  // After a few payments for mom sorted by hand, "always do this" (13.6).
  readonly alwaysForMom: boolean;
}

class CheckFailed extends Error {
  readonly check: string;

  constructor(check: string, message: string) {
    super(message);
    this.check = check;
  }
}

export function liveALife(options: LifeOptions): LifeResult {
  return new Life(options).live();
}

class Life {
  readonly #seed: number;
  readonly #days: number;
  readonly #sabotageOnDay: number | undefined;
  readonly #record: LifeRecorder | undefined;
  readonly #startPosted: Posted;
  // How much of the bank's feed has been recorded.
  #recordedUpTo = 0;
  readonly #random: Random;
  readonly #person: Person;
  readonly #bank: SimBank;
  readonly #book: Book;
  readonly #setupInput: SetupInput;
  readonly #start: IsoDate;
  readonly #stats: Stats;
  #date: IsoDate;
  #day = 0;

  // The simulator's own record of what the book should know.
  #settings: Settings;
  // The split the pay period started with (13.1, B38).
  #periodSplit: Settings['split'];
  #lastPaycheckDate: IsoDate;
  #paychecksSeen = 0;
  readonly #rules: SortingRule[] = [...START_RULES];
  // By the id a purchase first had; a posting's id leads back to it.
  readonly #standing = new Map<string, Standing>();
  readonly #firstId = new Map<string, string>();
  // How the person split each split purchase, by the id it first had.
  readonly #splitParts = new Map<string, { readonly needs: Cents; readonly wants: Cents }>();
  readonly #momSent = new Map<string, Cents>();

  // Things already set to happen on a later day, such as a pending charge
  // posting or a card payment landing.
  readonly #later = new Map<IsoDate, (() => void)[]>();
  // What the person does after the day's bank activity, such as moving
  // money to savings on payday.
  readonly #tonight: (() => void)[] = [];
  readonly #intents = new Map<string, Intent>();
  // Everything sent to the book, for duplicates.
  readonly #sent: BankTransaction[] = [];
  // Recent lines for a failure report.
  readonly #recent: string[] = [];
  readonly #statements: CardStatement[] = [];
  readonly #cardPayments: Record<Card, CardPaymentSeen[]> = { 'everyday-card': [], 'old-card': [] };
  // The leftover questions: when the person will answer each one, and how.
  readonly #leftoverPlans = new Map<string, { readonly on: IsoDate | null; readonly answer: LeftoverAnswer }>();
  // What each leftover question asked at payday, and what spending made
  // before payday had taken from its bucket then (B4).
  readonly #askedAtPayday = new Map<string, { readonly asked: Cents; readonly spentBefore: Cents }>();
  // Early paychecks the person leaves in review until a later day.
  readonly #waitUntil = new Map<string, IsoDate>();
  // Purchases the person sorted by hand to one bucket, which they may re-sort.
  readonly #handSorted: { readonly id: string; to: 'needs' | 'wants' }[] = [];
  readonly #alertsGiven = new Set<string>();
  // 10.6: what the bank took back, oldest first, for the alerts still to come.
  readonly #tookBack: { readonly id: string; readonly date: IsoDate; readonly description: string; readonly amount: Cents }[] = [];
  // Payments for mom that are not the mom rule's, which the person may sort
  // again (7.6): what each took from the reserve, and the day it was made.
  readonly #forMom: { readonly id: string; readonly date: IsoDate; readonly amount: Cents; readonly fromReserve: Cents }[] = [];
  // Payments the mom rule matched, which can never be sorted another way (8.1).
  readonly #momRulePayments: string[] = [];
  // Where the person sorted each mom difference, by its review id.
  readonly #differenceTo = new Map<string, 'needs' | 'wants'>();
  #restaurantsSortedByHand = 0;
  #forMomSortedByHand = 0;
  #nextScheduledPayday: IsoDate;
  #nextSettingsChange: IsoDate;

  constructor(options: LifeOptions) {
    this.#seed = options.seed;
    this.#days = Math.round(options.years * 365);
    this.#sabotageOnDay = options.sabotageOnDay;
    this.#record = options.record;
    this.#random = new Random(options.seed);
    this.#stats = Object.fromEntries(STAT_NAMES.map((name) => [name, 0])) as Stats;
    const r = this.#random;
    this.#person = {
      pay: r.int(260_000, 480_000),
      rent: r.int(90_000, 180_000),
      closingDay: { 'everyday-card': r.int(1, 28), 'old-card': r.int(1, 28) },
      roommate: r.chance(1, 2),
      momTimesPerMonth: r.int(1, 3),
      alwaysForMom: r.chance(1, 2),
    };
    this.#start = addDays(FIRST_START, r.int(0, 364));
    this.#date = this.#start;
    const lastPaycheck = addDays(this.#start, -r.int(0, 13));
    this.#lastPaycheckDate = lastPaycheck;
    this.#nextScheduledPayday = addDays(lastPaycheck, 14);
    this.#nextSettingsChange = addDays(this.#start, r.int(60, 330));

    // Setup day (section 14): the bank as it stands, with a few charges still
    // pending and sometimes a card payment on its way.
    this.#startPosted = {
      checking: r.int(150_000, 600_000),
      savings: r.int(200_000, 2_000_000),
      everydayCard: r.int(0, 250_000),
      oldCard: r.int(250_000, 350_000),
    };
    this.#bank = new SimBank(this.#startPosted);
    for (let i = r.int(0, 3); i > 0; i--) {
      const store = r.pick(STORES.filter((s) => s.how !== 'posted'));
      const account = r.chance(store.debitOutOf10, 10) ? 'checking' : 'everyday-card';
      const charge = this.#bank.authorize(addDays(this.#start, -r.int(0, 2)), account, r.int(store.min, store.max), store.name);
      this.#standing.set(charge.id, 'setup');
      this.#intents.set(charge.id, { type: 'store', sorting: store.sorting, store: store.name });
      this.#stats.pendingAtSetup++;
      this.#laterOn(addDays(this.#start, r.int(1, 3)), () => this.#post(charge.id, charge.amount + (r.chance(1, 4) ? r.int(1, 1_500) : 0)));
    }
    if (r.chance(1, 5)) {
      const charge = this.#bank.authorize(addDays(this.#start, -1), 'old-card', r.int(1_000, 6_000), 'MADE UP CAFE');
      this.#standing.set(charge.id, 'old-card');
      this.#stats.pendingAtSetup++;
      this.#laterOn(addDays(this.#start, r.int(1, 3)), () => this.#post(charge.id, charge.amount));
    }
    if (r.chance(1, 4)) {
      const left = this.#bank.send(addDays(this.#start, -1), 'checking', 'everyday-card', r.int(5_000, 60_000));
      this.#stats.inTransitAtSetup++;
      const seen: CardPaymentSeen = { left: left.date, landed: null, amount: left.amount };
      this.#cardPayments['everyday-card'].push(seen);
      this.#laterOn(addDays(this.#start, r.int(1, 2)), () => {
        this.#ownTransfer(() => this.#bank.land(this.#date, left, r.chance(7, 10)));
        seen.landed = this.#date;
      });
    }
    // Sometimes a payment shows landing on the card before it shows leaving
    // checking, or a payment to the old card is on its way (12.5, B48).
    if (r.chance(1, 8)) {
      const landed = this.#bank.landFirst(addDays(this.#start, -1), 'checking', 'everyday-card', r.int(5_000, 60_000));
      this.#stats.inTransitAtSetup++;
      const seen: CardPaymentSeen = { left: null, landed: landed.date, amount: landed.amount };
      this.#cardPayments['everyday-card'].push(seen);
      this.#laterOn(addDays(this.#start, r.int(1, 2)), () => {
        this.#ownTransfer(() => this.#bank.sendAfter(this.#date, landed));
        seen.left = this.#date;
      });
    }
    if (r.chance(1, 8)) {
      const left = this.#bank.send(addDays(this.#start, -1), 'checking', 'old-card', r.int(5_000, 30_000));
      this.#stats.inTransitAtSetup++;
      const seen: CardPaymentSeen = { left: left.date, landed: null, amount: left.amount };
      this.#cardPayments['old-card'].push(seen);
      this.#laterOn(addDays(this.#start, r.int(1, 2)), () => {
        this.#ownTransfer(() => this.#bank.land(this.#date, left, r.chance(1, 2)));
        seen.landed = this.#date;
      });
    }
    // 14.2: the person assigns the starting money, worked out here on its own.
    const balances = this.#bank.balances();
    const startingMoney = balances.checking + balances.savings - balances.everydayCard + this.#bank.inTransit();
    const momReserve = Math.min(r.int(0, 300_000), balances.savings);
    const savings = balances.savings - momReserve;
    const rest = startingMoney - savings - momReserve;
    const needs = rest > 0 ? share(rest, 60) : rest;
    this.#settings = changeSettings(DEFAULT_SETTINGS, { paycheckRule: { contains: PAYROLL }, momRule: { contains: MOM } });
    this.#periodSplit = this.#settings.split;
    this.#setupInput = {
      date: this.#start,
      bankBalances: this.#bank.postedBalances(),
      pendingCharges: this.#bank.pendingCharges(),
      transfersInTransit: this.#bank.halvesShowing(),
      oldCardBalance: this.#bank.posted.oldCard,
      assignment: { savings, needs, wants: rest - needs, momReserve, heldForOthers: 0 },
      lastPaycheckDate: lastPaycheck,
      settings: this.#settings,
      rules: START_RULES,
    };
    const setup = startTracking(this.#setupInput);
    if (!setup.ok) throw new Error(`seed ${options.seed}: the simulator's setup day did not add up (${setup.difference})`);
    this.#book = setup.book;
  }

  live(): LifeResult {
    try {
      this.#checkSetupDay();
      if (this.#record !== undefined) {
        this.#recordedUpTo = this.#bank.feed.length;
        this.#record.setupDay({ start: { ...this.#startPosted }, feed: [...this.#bank.feed], input: this.#setupInput, totals: this.#totals() });
      }
      for (this.#day = 0; this.#day < this.#days; this.#day++) {
        this.#date = addDays(this.#start, this.#day);
        this.#bankDay();
        if (this.#day === this.#sabotageOnDay) this.#bank.changeWithoutTelling('checking', -1);
        this.#evening();
        this.#check();
        this.#recordDay();
        this.#stats.days++;
      }
      return { ok: true, seed: this.#seed, days: this.#days, stats: this.#stats };
    } catch (error) {
      const check = error instanceof CheckFailed ? error.check : 'the book refused something';
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, seed: this.#seed, day: this.#day, date: this.#date, check, message, recent: [...this.#recent], stats: this.#stats };
    }
  }

  // B4: what spending made before this day takes from a bucket now, worked
  // out from the purchases as the book lists them: what is left of each
  // (after refunds, and less any part counted on setup day), in the bucket it
  // is sorted to, or its part of a split.
  #spentBeforeFromList(bucket: 'needs' | 'wants', day: IsoDate): Cents {
    let spent = 0;
    for (const p of this.#book.purchases()) {
      if (daysBetween(p.date, day) <= 0) continue;
      const left = p.amount - p.refunded - p.countedAtSetup;
      const sorted = p.sortedTo;
      if ('split' in sorted) {
        if (left !== 0) spent += sorted.split.filter((part) => part.bucket === bucket).reduce((sum, part) => sum + part.amount, 0);
      } else if (sorted.to === bucket) {
        spent += left;
      }
    }
    return spent;
  }

  #totals(): BookTotals {
    const check = this.#book.selfCheck(this.#bank.balances());
    return { appSide: check.appSide, inTransit: check.inTransit, oldCardDebt: this.#book.oldCardDebt() };
  }

  #recordDay(): void {
    if (this.#record === undefined) return;
    const feed = this.#bank.feed.slice(this.#recordedUpTo);
    this.#recordedUpTo = this.#bank.feed.length;
    const halvesShowing = this.#bank
      .halvesShowing()
      .map((h) => `${h.from} ${h.to} ${h.amount} ${h.kind === 'transfer-sent' ? 'left' : 'arrived'}`)
      .sort();
    this.#record.day({ date: this.#date, feed, posted: { ...this.#bank.posted }, balances: this.#bank.balances(), halvesShowing, totals: this.#totals() });
  }

  // 14.3: an assignment a cent off either way is refused, saying what is left.
  #checkSetupDay(): void {
    const assignment = this.#setupInput.assignment;
    for (const off of [-1, 1]) {
      const result = startTracking({ ...this.#setupInput, assignment: { ...assignment, wants: assignment.wants + off } });
      if (result.ok || result.difference !== -off) {
        throw new CheckFailed('14.3 setup adds up exactly', `an assignment ${off} cent off was ${result.ok ? 'accepted' : `refused with ${result.difference} left`}`);
      }
    }
  }

  // ---- The bank's day -------------------------------------------------

  #bankDay(): void {
    const r = this.#random;
    const today = this.#date;
    const dayOfMonth = Number(today.slice(8, 10));
    // Plans first, since some of what they plan can happen today.
    if (today === this.#nextScheduledPayday) this.#planPaycheck();
    if (dayOfMonth === 1) this.#planMomPayments();
    const events: (() => void)[] = [...(this.#later.get(today) ?? [])];
    this.#later.delete(today);

    for (const store of STORES) if (r.chance(store.perThousandDays, 1_000)) events.push(() => this.#shop(store));
    // Now and then the rent goes from savings; the landlord's rule still sorts it (A16).
    if (dayOfMonth === 1) events.push(() => this.#payPerson(this.#person.rent, 'MADE UP LANDLORD', 'needs', r.chance(1, 12) ? 'savings' : 'checking'));
    if (dayOfMonth === 5) events.push(() => this.#bill('MADE UP STREAMING', 1_599, 'everyday-card'));
    if (dayOfMonth === 12) events.push(() => this.#bill('MADE UP UTILITY', r.int(6_000, 20_000), 'checking'));
    if (dayOfMonth === 18) events.push(() => this.#bill('MADE UP PHONE', r.int(4_500, 9_000), 'everyday-card'));
    if (dayOfMonth === 15 && this.#person.roommate) events.push(() => this.#deposit('checking', r.int(4_000, 12_000), 'ZELLE FROM MADE UP ROOMMATE', null));
    if (dayOfMonth === 28) events.push(() => this.#deposit('savings', r.int(50, 1_500), 'MADE UP BANK INTEREST PAID', null));
    for (const card of ['everyday-card', 'old-card'] as const) {
      if (dayOfMonth === this.#person.closingDay[card]) events.push(() => this.#closeStatement(card));
    }
    if (r.chance(1, 25)) events.push(() => this.#payForFriend());
    if (r.chance(1, 40)) events.push(() => this.#deposit('checking', r.int(1_500, 6_000), 'ZELLE FROM MADE UP FRIEND', 'wants'));
    if (r.chance(1, 30)) events.push(() => this.#payPerson(r.int(2_500, 8_000), 'MADE UP BARBER', 'wants'));
    if (r.chance(1, 60)) events.push(() => this.#payPerson(r.int(5_000, 40_000), FOR_MOM, 'mom'));
    if (r.chance(1, 40)) events.push(() => this.#payPerson(r.int(2_000, 16_000), 'MADE UP COWORKER', 'split'));
    if (r.chance(1, 45)) events.push(() => this.#billFromSavings());
    if (r.chance(1, 50)) events.push(() => this.#misreadTransfer());
    if (r.chance(1, 150)) events.push(() => this.#chargeTwice());
    if (r.chance(1, 120)) events.push(() => this.#deposit('checking', r.int(2_000, 30_000), 'MADE UP GIFT', r.pick(['other-income', 'wants'] as const)));
    if (r.chance(1, 600)) events.push(() => this.#oldCardPurchase());
    if (r.chance(1, 400)) events.push(() => this.#oldCardRefund());
    if (today.slice(5) === '03-15') events.push(() => this.#deposit('checking', r.int(20_000, 250_000), 'IRS TREAS 310 TAX REF', 'other-income'));
    if (r.chance(1, 50)) events.push(() => this.#sendDuplicate());

    // The bank sends the day's activity in no particular order.
    for (let i = events.length - 1; i > 0; i--) {
      const j = r.int(0, i);
      [events[i], events[j]] = [events[j] as () => void, events[i] as () => void];
    }
    for (const event of events) event();
  }

  #laterOn(date: IsoDate, event: () => void): void {
    const list = this.#later.get(date);
    if (list) list.push(event);
    else this.#later.set(date, [event]);
  }

  // Paydays every 14 days (section 2). Now and then the paycheck is a few
  // days late. One that comes 5 days late makes the next one arrive only 9
  // days after it, so that one waits in review as an early paycheck (3.7).
  // Now and then a bonus comes through payroll a few days after payday.
  #planPaycheck(): void {
    const r = this.#random;
    const scheduled = this.#nextScheduledPayday;
    this.#nextScheduledPayday = addDays(scheduled, 14);
    const delay = r.chance(1, 60) ? 5 : r.chance(1, 40) ? r.int(1, 4) : 0;
    if (delay > 0) this.#stats.latePaychecks++;
    const spread = share(this.#person.pay, 3);
    // Now and then a short paycheck, smaller than what the mom reserve takes (B1).
    const small = r.chance(1, 50);
    if (small) this.#stats.smallPaychecks++;
    const amount = small ? r.int(30_000, 140_000) : this.#person.pay + r.int(-spread, spread);
    this.#laterOn(addDays(scheduled, delay), () => this.#payroll(amount, `${PAYROLL} DIRECT DEP`, 'paycheck'));
    if (r.chance(1, 13)) {
      this.#laterOn(addDays(scheduled, delay + r.int(2, 7)), () => {
        this.#stats.bonuses++;
        this.#payroll(r.int(30_000, 200_000), `${PAYROLL} BONUS`, 'other-income');
      });
    }
  }

  // 3.1 and 3.7: a deposit matching the paycheck rule is a paycheck, unless
  // it comes less than 10 days after the last one; then it waits in review.
  #payroll(amount: Cents, description: string, meant: 'paycheck' | 'other-income'): void {
    const early = daysBetween(this.#lastPaycheckDate, this.#date) < this.#settings.earlyPaycheckDays;
    const before = this.#book.pots();
    const asked = this.#openLeftovers();
    const txn = this.#bank.deposit(this.#date, 'checking', amount, description);
    this.#intents.set(txn.id, { type: 'money-in', choice: meant });
    const outcome = this.#receive(txn);
    if (early) {
      if (outcome !== 'review') throw new CheckFailed('3.7 an early paycheck waits in review', `${txn.id}, ${daysBetween(this.#lastPaycheckDate, this.#date)} days after the last paycheck, came back as ${outcome}`);
      this.#expectChange(before, { unsortedIn: amount }, '3.7 an early paycheck waits in review', txn.id);
      this.#stats.earlyPaychecksInReview++;
    } else {
      if (outcome !== 'paycheck') throw new CheckFailed('3.1 a paycheck starts a pay period', `${txn.id}, ${daysBetween(this.#lastPaycheckDate, this.#date)} days after the last paycheck, came back as ${outcome}`);
      this.#onPaycheck(before, asked, amount, this.#date, false);
    }
  }

  #openLeftovers(): Set<'needs' | 'wants'> {
    return new Set(this.#book.reviewItems().flatMap((i) => (i.type === 'leftover' ? [i.bucket] : [])));
  }

  // 3.2 and 3.3, worked out here from the rulebook: the mom reserve comes off
  // first, as much as fits under the cap (a smaller paycheck gives all it
  // has); what does not fit goes to savings; the rest is split by the
  // percentages, each rounded down, with the leftover cents to savings.
  #expectedSplit(amount: Cents, reserveBefore: Cents): { momReserve: Cents; savings: Cents; needs: Cents; wants: Cents } {
    const { momReservePerPaycheck, momReserveCap, split } = this.#settings;
    const forReserve = Math.min(momReservePerPaycheck, amount);
    const fits = Math.max(0, Math.min(forReserve, momReserveCap - reserveBefore));
    const rest = amount - forReserve;
    const needs = share(rest, split.needs);
    const wants = share(rest, split.wants);
    return { momReserve: fits, savings: forReserve - fits + rest - needs - wants, needs, wants };
  }

  // `asked` is which buckets had a leftover question open before payday;
  // `fromReview` is a deposit you called your paycheck (6.1).
  #onPaycheck(before: Pots, asked: Set<'needs' | 'wants'>, amount: Cents, date: IsoDate, fromReview: boolean): void {
    const record = this.#book.paychecks().at(-1);
    const expected = this.#expectedSplit(amount, before.momReserve);
    const got = record && { momReserve: record.split.momReserve, savings: record.split.savings, needs: record.split.needs, wants: record.split.wants };
    if (!record || record.amount !== amount || record.date !== date || !same(got, expected)) {
      throw new CheckFailed('3.2 and 3.3 the paycheck split', `a paycheck of ${amount} with the reserve at ${before.momReserve}: expected ${JSON.stringify(expected)}, the book has ${JSON.stringify(got)} on ${record?.date}`);
    }
    // The buckets at payday: the paycheck's parts, plus whatever was left in
    // a bucket set to always move it to savings (3.4). When a question from
    // the last payday is still open and the setting has changed since, only
    // the reserve is checked; the rulebook does not cover that case.
    const change: Change = { ...expected, ...(fromReview ? { unsortedIn: -amount } : {}) };
    for (const bucket of ['needs', 'wants'] as const) {
      if (this.#settings.leftoverAtPayday[bucket] === 'move-to-savings' && before[bucket] > 0) {
        change[bucket] = expected[bucket] - before[bucket];
        change.savings = (change.savings ?? 0) + before[bucket];
      }
    }
    if ([...asked].some((bucket) => this.#settings.leftoverAtPayday[bucket] !== 'ask')) {
      this.#expectChange(before, { momReserve: expected.momReserve, ...(fromReview ? { unsortedIn: -amount } : {}) }, '3.2 the mom reserve at payday', `paycheck of ${amount}`, ['savings', 'needs', 'wants']);
    } else {
      this.#expectChange(before, change, '3.2 to 3.4 the buckets at payday', `paycheck of ${amount}`);
    }
    // 3.4 and B2: a leftover question for each bucket set to ask, about what
    // was left when the paycheck came, replacing any earlier one (B3).
    for (const bucket of ['needs', 'wants'] as const) {
      const left = before[bucket];
      const setting = this.#settings.leftoverAtPayday[bucket];
      const questions = this.#book.reviewItems().filter((i) => i.type === 'leftover' && i.bucket === bucket);
      const asks = setting === 'ask' && left > 0;
      const question = questions[0];
      if (asks ? questions.length !== 1 || question?.type !== 'leftover' || question.amount !== left : questions.length !== 0) {
        throw new CheckFailed('3.4 the leftover question at payday', `${bucket} had ${left} left and is set to ${setting}; the questions are ${JSON.stringify(questions)}`);
      }
      if (asks && question !== undefined) this.#askedAtPayday.set(question.id, { asked: left, spentBefore: this.#spentBeforeFromList(bucket, date) });
    }
    this.#lastPaycheckDate = date;
    this.#paychecksSeen++;
    this.#periodSplit = this.#settings.split;
    this.#stats.paychecks++;
    const month = date.slice(0, 7);
    if (this.#book.paychecks().filter((p) => p.date.slice(0, 7) === month).length === 3) this.#stats.threePaycheckMonths++;
    // 3.8: the person moves what should be in savings, that evening or the
    // next day, keeping some money in checking. Money on its way counts as
    // moved (B46). When the account holds more than it should, there is
    // nothing to move and the extra is shown on its own; if checking is
    // low, the person brings some of it back.
    const move = (): void => {
      const pots = this.#book.pots();
      const onItsWay = this.#bank.halvesShowing().reduce((sum, h) => sum + (h.kind === 'transfer-sent' && h.to === 'savings' ? h.amount : 0), 0);
      const shouldBeInSavings = pots.savings + pots.momReserve;
      const savingsAccountBalance = this.#bank.posted.savings;
      const gap = shouldBeInSavings - (savingsAccountBalance + onItsWay);
      const expected = gap >= 0 ? { shouldBeInSavings, savingsAccountBalance, stillToMove: gap } : { shouldBeInSavings, savingsAccountBalance, stillToMove: 0, extraInSavings: -gap };
      const transfer = this.#book.savingsTransfer(savingsAccountBalance);
      if (!same(transfer, expected)) throw new CheckFailed('3.8 what still needs to move', `the app says ${JSON.stringify(transfer)}, expected ${JSON.stringify(expected)}`);
      const spare = this.#bank.posted.checking - 50_000;
      const extra = transfer.extraInSavings ?? 0;
      if (transfer.stillToMove > 0 && spare > 0) this.#moveBetweenOwn('checking', 'savings', Math.min(transfer.stillToMove, spare));
      else if (extra > 0 && this.#bank.posted.checking < 100_000 && savingsAccountBalance > 0) {
        this.#moveBetweenOwn('savings', 'checking', Math.min(extra, savingsAccountBalance));
      }
    };
    if (this.#random.chance(1, 3)) this.#laterOn(addDays(this.#date, 1), move);
    else this.#tonight.push(move);
  }

  #moveBetweenOwn(from: OwnAccount, to: OwnAccount, amount: Cents): void {
    this.#stats.savingsTransfers++;
    if (this.#random.chance(1, 2)) {
      this.#ownTransfer(() => this.#bank.transfer(this.#date, from, to, amount));
    } else {
      const left = this.#ownTransfer(() => this.#bank.send(this.#date, from, to, amount));
      this.#laterOn(addDays(this.#date, 1), () => this.#ownTransfer(() => this.#bank.land(this.#date, left, this.#random.chance(1, 2))));
    }
  }

  // 5.1 to 5.3: a transfer between your own accounts never changes a bucket,
  // except money leaving for the old card, which is spending from needs (5.2;
  // from savings it waits in review, QUESTIONS.md A4).
  #ownTransfer<T extends BankTransaction>(make: () => T): T {
    const before = this.#book.pots();
    const txn = make();
    this.#receive(txn);
    let change: Change = {};
    if ((txn.kind === 'transfer' || txn.kind === 'transfer-sent') && txn.to === 'old-card') {
      change = txn.from === 'checking' ? { needs: -txn.amount } : { unsortedOut: txn.amount };
    }
    this.#expectChange(before, change, '5.1 to 5.3 transfers between your own accounts', `${txn.kind} ${txn.id}`);
    return txn;
  }

  #shop(store: Store): void {
    const r = this.#random;
    const account: ChargeAccount = r.chance(store.debitOutOf10, 10) ? 'checking' : 'everyday-card';
    const amount = r.int(store.min, store.max);
    this.#stats.purchases++;
    if (store.how === 'posted' || r.chance(1, 20)) {
      const id = this.#purchase(() => this.#bank.purchase(this.#date, account, amount, store.name), store);
      this.#maybeRefund(store, id, amount, account);
      return;
    }
    // Gas pumps often hold $100 and post the real amount later (4.6).
    const hold = store.how === 'gas' && r.chance(1, 2) ? 10_000 : amount;
    const finalAmount = amount + (store.tip ? share(amount, r.int(0, 22)) : 0);
    const id = this.#purchase(() => this.#bank.authorize(this.#date, account, hold, store.name), store);
    // A restaurant often adds the tip the next day, while the charge is still pending (A13).
    const changesFirst = finalAmount !== hold && store.tip === true && r.chance(1, 3);
    if (changesFirst) this.#laterOn(addDays(this.#date, 1), () => this.#changePending(id, finalAmount));
    this.#laterOn(addDays(this.#date, r.int(1, 4) + (changesFirst ? 1 : 0)), () => {
      // Some pumps drop the hold and post the real charge on its own (A2).
      if (hold !== finalAmount && store.how === 'gas' && r.chance(1, 5)) {
        this.#dropHold(id);
        this.#purchase(() => this.#bank.purchase(this.#date, account, finalAmount, store.name), store);
        return;
      }
      const posted = this.#post(id, finalAmount);
      this.#maybeRefund(store, posted, finalAmount, account);
    });
  }

  // QUESTIONS.md A2: the bank drops a pending charge without posting it, and
  // its money goes back where it came from.
  #dropHold(pendingId: string): void {
    const first = this.#firstId.get(pendingId) ?? pendingId;
    const standing = this.#standing.get(first);
    const hold = this.#bank.pendingCharges().find((c) => c.id === pendingId);
    if (hold === undefined) return;
    const before = this.#book.pots();
    const txn = this.#bank.drop(pendingId, this.#date);
    const outcome = this.#receive(txn);
    if (outcome !== 'dropped') throw new CheckFailed('4.6 a dropped pending charge (A2)', `${txn.id} came back as ${outcome}`);
    let change: Change = {};
    if (standing === 'needs' || standing === 'wants') change = { [standing]: hold.amount };
    else if (standing === 'unsorted') change = { unsortedOut: -hold.amount };
    else if (standing === 'split') change = { ...this.#splitParts.get(first) };
    this.#expectChange(before, change, '4.6 a dropped pending charge gives its money back (A2)', txn.id);
    this.#standing.set(first, 'unsorted');
    this.#stats.holdsDropped++;
  }

  // 4.1 to 4.3: a purchase comes out of the bucket its first matching rule
  // picks, on the day of the purchase; with no rule it waits in review.
  #purchase(make: () => Purchase, store: Store | null): string {
    const before = this.#book.pots();
    const txn = make();
    if (store) this.#intents.set(txn.id, { type: 'store', sorting: store.sorting, store: store.name });
    this.#receive(txn);
    const rule = this.#ruleFor('purchase', txn.description);
    const bucket = rule?.for === 'purchase' ? rule.bucket : null;
    this.#expectChange(before, bucket ? { [bucket]: -txn.amount } : { unsortedOut: txn.amount }, '4.1 to 4.3 a purchase is counted', txn.id);
    this.#standing.set(txn.id, bucket ?? 'unsorted');
    return txn.id;
  }

  // 4.6: the posted charge replaces the pending one, at whatever amount.
  #post(pendingId: string, amount: Cents): string {
    const first = this.#firstId.get(pendingId) ?? pendingId;
    const hold = this.#bank.pendingCharges().find((c) => c.id === pendingId);
    const before = this.#book.pots();
    const txn = this.#bank.post(pendingId, this.#date, amount);
    const intent = this.#intents.get(pendingId);
    if (intent) this.#intents.set(txn.id, intent);
    this.#firstId.set(txn.id, first);
    this.#receive(txn);
    this.#stats.postedFromPending++;
    const oldAmount = hold?.amount ?? amount;
    if (amount !== oldAmount) this.#stats.postedAtNewAmount++;
    this.#expectNewAmount(before, first, oldAmount, amount, '4.6 a posting replaces its pending charge', txn.id);
    return txn.id;
  }

  // QUESTIONS.md A13: the bank changes a pending charge's amount before it
  // posts, such as a tip added the next day.
  #changePending(pendingId: string, amount: Cents): void {
    const first = this.#firstId.get(pendingId) ?? pendingId;
    const hold = this.#bank.pendingCharges().find((c) => c.id === pendingId);
    if (hold === undefined) throw new Error(`the simulator's bank has no pending charge ${pendingId}`);
    const before = this.#book.pots();
    const txn = this.#bank.changePending(pendingId, this.#date, amount);
    const outcome = this.#receive(txn);
    if (outcome !== 'changed') throw new CheckFailed('4.6 a pending charge changes amount (A13)', `${txn.id} came back as ${outcome}`);
    this.#expectNewAmount(before, first, hold.amount, amount, '4.6 a pending charge changes amount (A13)', txn.id);
    this.#stats.pendingChanged++;
  }

  // 4.6 and A13: a pending charge's new amount, as it posts or while it is
  // still pending, replaces the old one and keeps its bucket. A split that
  // no longer adds up goes back to review, all of it (A1); a charge counted
  // on setup day leaves only the difference waiting (A10); on the old card
  // only the debt changes (B15).
  #expectNewAmount(before: Pots, first: string, oldAmount: Cents, newAmount: Cents, check: string, what: string): void {
    const difference = newAmount - oldAmount;
    const standing = this.#standing.get(first);
    if (standing === 'needs' || standing === 'wants') this.#expectChange(before, { [standing]: -difference }, check, what);
    else if (standing === 'unsorted') this.#expectChange(before, { unsortedOut: difference }, check, what);
    else if (standing === 'setup') this.#expectChange(before, { unsortedOut: difference }, '14.2 a charge pending on setup day leaves only the difference (A10)', what);
    else if (standing === 'old-card') this.#expectChange(before, {}, '5.4 old card purchases touch no bucket', what);
    else if (standing === 'split' && difference === 0) this.#expectChange(before, {}, check, what);
    else if (standing === 'split') {
      const parts = this.#splitParts.get(first);
      if (parts === undefined) throw new CheckFailed(check, `the simulator has no split for ${first}`);
      this.#expectChange(before, { needs: parts.needs, wants: parts.wants, unsortedOut: newAmount }, '4.5 a split that no longer adds up goes back to review (A1)', what);
      this.#standing.set(first, 'unsorted');
    } else {
      throw new CheckFailed(check, `the simulator lost track of ${first} (${String(standing)})`);
    }
  }

  // Some things bought online come back, in full or in part, a week or two
  // later. Most refunds name their purchase; the rest wait in review (4.5).
  #maybeRefund(store: Store, purchaseId: string, amount: Cents, account: ChargeAccount): void {
    const r = this.#random;
    if (!store.refundsOutOf100 || !r.chance(store.refundsOutOf100, 100)) return;
    const back = r.chance(3, 5) ? amount : Math.max(1, share(amount, r.int(20, 80)));
    const linked = r.chance(17, 20);
    const bucket = store.sorting === 'wants' ? 'wants' : 'needs';
    this.#laterOn(addDays(this.#date, r.int(5, 20)), () => {
      const first = this.#firstId.get(purchaseId) ?? purchaseId;
      const standing = this.#standing.get(first);
      const before = this.#book.pots();
      const txn = this.#bank.refund(this.#date, account, back, `${store.name} REFUND`, linked ? purchaseId : undefined);
      this.#intents.set(txn.id, { type: 'refund', bucket });
      const outcome = this.#receive(txn);
      if (!linked) {
        if (outcome !== 'review') throw new CheckFailed('4.5 a refund it cannot match waits in review', `${txn.id} came back as ${outcome}`);
        this.#expectChange(before, { unsortedIn: back }, '4.5 a refund it cannot match waits in review', txn.id);
        this.#stats.refundsInReview++;
        return;
      }
      this.#stats.refundsLinked++;
      // Back into the bucket the purchase came from; for one not sorted yet,
      // off the unsorted spending (B7). A full refund of a split purchase
      // gives each bucket its part back; a partial one sends the purchase
      // back to review to be split again (4.5, A1).
      if (standing === 'needs' || standing === 'wants') this.#expectChange(before, { [standing]: back }, '4.5 a refund goes back to its bucket', txn.id);
      else if (standing === 'unsorted') this.#expectChange(before, { unsortedOut: -back }, '4.5 a refund of a purchase not sorted yet', txn.id);
      else if (standing === 'split') {
        const parts = this.#splitParts.get(first);
        if (back === amount && parts) this.#expectChange(before, { needs: parts.needs, wants: parts.wants }, '4.5 a full refund of a split purchase', txn.id);
        else this.#standing.set(first, 'unsorted');
      }
    });
  }

  #bill(name: string, amount: Cents, account: ChargeAccount): void {
    this.#stats.purchases++;
    this.#purchase(() => this.#bank.purchase(this.#date, account, amount, name), null);
  }

  // 7.4: a payment to a person goes to review unless a rule covers them,
  // whichever of your accounts it leaves (A16). A rule can say it is for mom
  // (7.6); then it comes out of the reserve as far as it goes, like one the
  // mom rule matches (8.1, 8.3).
  #payPerson(amount: Cents, payee: string, sorting: PersonSorting, from: OwnAccount = 'checking'): void {
    if (from === 'savings') this.#stats.personPaymentsFromSavings++;
    const before = this.#book.pots();
    const txn = this.#bank.payPerson(this.#date, amount, payee, from);
    this.#intents.set(txn.id, { type: 'person', sorting });
    this.#receive(txn);
    const rule = this.#ruleFor('person', txn.description);
    const to = rule?.for === 'person' ? rule.choice.to : null;
    let change: Change;
    if (to === null) change = { unsortedOut: amount };
    else if (to === 'not-mine') change = { heldForOthers: -amount };
    else if (to === 'mom') {
      const fromReserve = this.#forMomPayment(txn.id, txn.date, amount, before.momReserve);
      change = { momReserve: -fromReserve, unsortedOut: amount - fromReserve };
      this.#stats.paymentsForMom++;
    } else change = { [to]: -amount };
    this.#expectChange(before, change, '7.4 a payment to a person', txn.id);
    if (to === 'mom') this.#checkMomMonth(txn.date);
  }

  // 7.6: a payment for mom that the mom rule did not match. It takes what
  // the reserve has, up to its amount (8.3), counts toward its month (8.2),
  // and can be sorted another way later. Returns what the reserve gave.
  #forMomPayment(id: string, date: IsoDate, amount: Cents, reserve: Cents): Cents {
    const fromReserve = Math.min(amount, Math.max(0, reserve));
    this.#forMom.push({ id, date, amount, fromReserve });
    if (this.#forMom.length > 30) this.#forMom.shift();
    this.#addMomSent(date, amount);
    return fromReserve;
  }

  #addMomSent(date: IsoDate, amount: Cents): void {
    const month = date.slice(0, 7);
    this.#momSent.set(month, (this.#momSent.get(month) ?? 0) + amount);
  }

  // 8.2: everything sent to mom in a month, worked out here on its own.
  #checkMomMonth(date: IsoDate): void {
    const month = date.slice(0, 7);
    const sent = this.#momSent.get(month) ?? 0;
    const shown = this.#book.momSentInMonth(month).sent;
    if (shown !== sent) throw new CheckFailed('8.2 sent to mom this month', `${sent} sent in ${month}, the app shows ${shown}`);
  }

  // 8.1 to 8.3: one to three payments to mom a month, on random days, now
  // and then from savings (A16). Each comes out of the reserve as far as it
  // goes, and the rest waits in review.
  #planMomPayments(): void {
    const r = this.#random;
    for (let i = 0; i < this.#person.momTimesPerMonth; i++) {
      const amount = r.int(20_000, 150_000);
      const from: OwnAccount = r.chance(1, 6) ? 'savings' : 'checking';
      this.#laterOn(addDays(this.#date, r.int(0, 27)), () => {
        this.#stats.momPayments++;
        if (from === 'savings') this.#stats.momFromSavings++;
        const before = this.#book.pots();
        const txn = this.#bank.payPerson(this.#date, amount, MOM, from);
        this.#receive(txn);
        const fromReserve = Math.min(amount, Math.max(0, before.momReserve));
        if (fromReserve < amount) this.#stats.momDifferences++;
        this.#expectChange(before, { momReserve: -fromReserve, unsortedOut: amount - fromReserve }, '8.1 and 8.3 a payment to mom', txn.id);
        this.#addMomSent(txn.date, amount);
        this.#checkMomMonth(txn.date);
        this.#momRulePayments.push(txn.id);
        if (this.#momRulePayments.length > 20) this.#momRulePayments.shift();
      });
    }
  }

  // 4.9 (A16): a bill paid straight from savings waits in review, even one
  // a rule would sort if it came from checking.
  #billFromSavings(): void {
    const r = this.#random;
    this.#stats.savingsBills++;
    const before = this.#book.pots();
    const txn = this.#bank.payFromSavings(this.#date, r.int(5_000, 60_000), r.pick(['MADE UP INSURANCE', 'MADE UP UTILITY'] as const));
    this.#intents.set(txn.id, { type: 'from-savings', sorting: r.chance(4, 5) ? 'needs' : 'wants' });
    const outcome = this.#receive(txn);
    const item = this.#book.reviewItems().find((i) => i.id === txn.id);
    if (outcome !== 'review' || item?.type !== 'spending' || item.reason !== 'from-savings') {
      throw new CheckFailed('4.9 money leaving savings waits in review', `${txn.id} came back as ${outcome}: ${JSON.stringify(item)}`);
    }
    this.#expectChange(before, { unsortedOut: txn.amount }, '4.9 money leaving savings waits in review', txn.id);
  }

  // 5.6 (A12): now and then the bank shows a move between checking and
  // savings as spending on one account and a deposit on the other. Each
  // waits in review until the person marks it as a transfer between their
  // accounts, which they do as soon as it shows, the way a bank rule would
  // read it (so the bank connection's tests can read it with one). Then no
  // bucket changes (5.3), and it is in transit until its other half shows
  // (12.5).
  #misreadTransfer(): void {
    const r = this.#random;
    const from: OwnAccount = r.chance(2, 3) ? 'checking' : 'savings';
    const to: OwnAccount = from === 'checking' ? 'savings' : 'checking';
    const left = this.#bank.misreadSend(this.#date, from, to, r.int(5_000, 80_000));
    this.#markAsTransfer(left, to);
    const land = (): void => this.#markAsTransfer(this.#bank.misreadLand(this.#date, left), from);
    if (r.chance(1, 2)) land();
    else this.#laterOn(addDays(this.#date, r.int(1, 2)), land);
  }

  #markAsTransfer(txn: Purchase | SavingsWithdrawal | Deposit, other: OwnAccount): void {
    const r = this.#random;
    const before = this.#book.pots();
    const outcome = this.#receive(txn);
    const item = this.#book.reviewItems().find((i) => i.id === txn.id);
    const reason = txn.kind === 'deposit' ? 'deposit' : txn.kind === 'savings-withdrawal' ? 'from-savings' : 'no-rule';
    if (outcome !== 'review' || item === undefined || !('reason' in item) || item.reason !== reason) {
      throw new CheckFailed('5.6 a transfer shown as something else waits in review', `${txn.id} came back as ${outcome}: ${JSON.stringify(item)}`);
    }
    this.#expectChange(before, txn.kind === 'deposit' ? { unsortedIn: txn.amount } : { unsortedOut: txn.amount }, '5.6 a transfer shown as something else waits in review', txn.id);
    // Now and then a slip first: the account it is already in, or a card
    // for money that arrived.
    if (r.chance(1, 10)) {
      const wrong = txn.kind === 'deposit' && r.chance(1, 2) ? 'everyday-card' : txn.account;
      this.#expectRefused(() => this.#book.sort(txn.id, { transfer: wrong }, this.#date), this.#book.pots(), txn.id, `marking ${txn.id} as a transfer with ${wrong} (5.6)`);
    }
    this.#book.sort(txn.id, { transfer: other }, this.#date);
    this.#note(`mark ${txn.id} as a transfer with ${other}`);
    this.#expectChange(before, {}, '5.6 a transfer between your accounts changes no bucket', txn.id);
    if (this.#book.reviewItems().some((i) => i.id === txn.id)) throw new CheckFailed('5.6 a marked transfer leaves review', txn.id);
    this.#stats.transfersMarked++;
  }

  // 4.10 (A14): now and then the bank charges a recent purchase twice, and a
  // few days later takes the copy back. The copy counts like any purchase.
  #chargeTwice(): void {
    const r = this.#random;
    const recent = this.#sent
      .slice(-60)
      .filter((t): t is Purchase => t.kind === 'purchase' && !t.pending && (t.account === 'checking' || t.account === 'everyday-card') && STORES.some((s) => s.name === t.description));
    if (recent.length === 0) return;
    const first = r.pick(recent);
    const copy = this.#bank.chargeTwice(this.#date, first);
    this.#purchase(() => copy, STORES.find((s) => s.name === first.description) ?? null);
    this.#laterOn(addDays(this.#date, r.int(1, 6)), () => this.#takeBackCopy(copy));
  }

  // 4.10: taken back, the copy's money goes back where it came from, the
  // change is logged (13.5), and an alert says so, once (10.6).
  #takeBackCopy(copy: Purchase): void {
    const standing = this.#standing.get(copy.id);
    const before = this.#book.pots();
    const logBefore = this.#book.changeLog().length;
    const txn = this.#bank.takeBack(this.#date, copy);
    const outcome = this.#receive(txn);
    if (outcome !== 'taken-back') throw new CheckFailed('4.10 the bank takes back a charge (A14)', `${txn.id} came back as ${outcome}`);
    let change: Change;
    if (standing === 'needs' || standing === 'wants') change = { [standing]: copy.amount };
    else if (standing === 'unsorted') change = { unsortedOut: -copy.amount };
    else if (standing === 'split') change = { ...this.#splitParts.get(copy.id) };
    else throw new CheckFailed('4.10 the bank takes back a charge (A14)', `the simulator did not expect the copy ${copy.id} to be ${String(standing)}`);
    this.#expectChange(before, change, '4.10 a charge taken back gives its money back (A14)', txn.id);
    const log = this.#book.changeLog();
    const logged = { date: this.#date, kind: 'bank-took-back', id: copy.id, description: copy.description, amount: copy.amount };
    if (log.length !== logBefore + 1 || !same(log.at(-1), logged)) throw new CheckFailed('13.5 a take-back is logged (A14)', `expected ${JSON.stringify(logged)}, the log ends with ${JSON.stringify(log.at(-1))}`);
    if (this.#book.reviewItems().some((i) => i.id === copy.id)) throw new CheckFailed('4.10 nothing taken back waits in review', copy.id);
    this.#tookBack.push({ id: copy.id, date: this.#date, description: copy.description, amount: copy.amount });
    this.#standing.set(copy.id, 'gone');
    this.#stats.takenBack++;
    // Sorting it now is refused, which the person now and then tries.
    if (this.#random.chance(1, 5)) this.#expectRefused(() => this.#book.sort(copy.id, { to: 'needs' }, this.#date), this.#book.pots(), null, `sorting ${copy.id}, which the bank took back (4.10)`);
  }

  // Paying for a friend is not your spending (7.2); they pay you back later (7.1).
  #payForFriend(): void {
    const r = this.#random;
    const amount = r.int(2_000, 20_000);
    this.#stats.paidForFriends++;
    this.#payPerson(amount, 'MADE UP FRIEND', 'not-mine');
    this.#laterOn(addDays(this.#date, r.int(3, 20)), () => {
      this.#stats.friendsPaidBack++;
      this.#deposit('checking', amount, 'ZELLE FROM MADE UP FRIEND', 'not-mine');
    });
  }

  // 6.1 and 6.2: a deposit goes where a rule for its source says, or waits in review.
  #deposit(account: OwnAccount, amount: Cents, description: string, choice: 'other-income' | 'not-mine' | 'needs' | 'wants' | null): void {
    const before = this.#book.pots();
    const txn = this.#bank.deposit(this.#date, account, amount, description);
    if (choice) this.#intents.set(txn.id, { type: 'money-in', choice });
    this.#receive(txn);
    const rule = this.#ruleFor('deposit', description);
    const to = rule?.for === 'deposit' ? rule.choice.to : null;
    const change: Change = to === null ? { unsortedIn: amount } : to === 'other-income' ? this.#otherIncome(amount) : to === 'not-mine' ? { heldForOthers: amount } : { [to]: amount };
    this.#expectChange(before, change, '6.1 and 6.2 a deposit', txn.id);
  }

  // 6.1: other income is split by this pay period's percentages (B38), with
  // no mom reserve.
  #otherIncome(amount: Cents): Change {
    const needs = share(amount, this.#periodSplit.needs);
    const wants = share(amount, this.#periodSplit.wants);
    return { needs, wants, savings: amount - needs - wants };
  }

  // 5.4: a new purchase on the old card raises the debt and is only a flag to see.
  #oldCardPurchase(): void {
    const r = this.#random;
    this.#stats.oldCardPurchases++;
    const before = this.#book.pots();
    const txn = this.#bank.authorize(this.#date, 'old-card', r.int(1_000, 6_000), 'MADE UP CAFE');
    this.#receive(txn);
    this.#expectChange(before, {}, '5.4 old card purchases touch no bucket', txn.id);
    if (!this.#book.reviewItems().some((i) => i.type === 'old-card-purchase' && i.id === txn.id)) {
      throw new CheckFailed('5.4 a new old card purchase is flagged', `${txn.id} is not flagged`);
    }
    this.#standing.set(txn.id, 'old-card');
    // It may post at a new amount; only the debt changes (B15).
    this.#laterOn(addDays(this.#date, r.int(1, 3)), () => this.#post(txn.id, txn.amount + (r.chance(1, 3) ? r.int(1, 500) : 0)));
  }

  // B13: a refund on the old card lowers the debt and touches no bucket.
  #oldCardRefund(): void {
    this.#stats.oldCardRefunds++;
    const before = this.#book.pots();
    const txn = this.#bank.refund(this.#date, 'old-card', this.#random.int(500, 5_000), 'MADE UP STORE REFUND');
    this.#receive(txn);
    this.#expectChange(before, {}, 'B13 an old card refund touches no bucket', txn.id);
  }

  // The bank sometimes sends something it already sent. Nothing changes.
  #sendDuplicate(): void {
    const recent = this.#sent.slice(-40);
    if (recent.length === 0) return;
    const txn = this.#random.pick(recent);
    const before = this.#book.pots();
    const { outcome } = this.#book.receive(txn);
    this.#stats.duplicatesSent++;
    if (outcome !== 'duplicate') throw new CheckFailed('nothing is counted twice', `${txn.id} sent again came back as ${outcome}`);
    this.#expectChange(before, {}, 'nothing is counted twice', `${txn.id} sent again`);
  }

  // A card's closing day: interest if the last statement was not paid in
  // full, the new statement, the person's plan for paying it, and checks on
  // the reminder days, the due date, and the day after it.
  #closeStatement(card: Card): void {
    const r = this.#random;
    const last = this.#statements.filter((s) => s.card === card).at(-1);
    if (last && card === 'everyday-card') {
      const unpaid = last.statementBalance - this.#paidToward(last, last.dueDate);
      if (unpaid > 0) this.#cardCharge(card, 'interest', Math.max(1, share(unpaid, 2)));
    }
    if (card === 'old-card' && r.chance(1, 4)) this.#cardCharge(card, 'interest', r.int(500, 4_000));
    const statement = this.#bank.closeStatement(card, this.#date);
    this.#statements.push(statement);
    const { closingDate, dueDate, statementBalance: balance, minimumPayment: minimum } = statement;
    for (const days of this.#settings.cardReminderDaysBefore) this.#laterOn(addDays(dueDate, -days), () => this.#noticesDue(statement));
    this.#laterOn(dueDate, () => this.#noticesDue(statement));
    this.#laterOn(addDays(dueDate, 1), () => this.#dueDatePassed(statement));
    if (balance <= 0) return;
    const before = (days: number): IsoDate => addDays(dueDate, -days);
    const after = (days: number): IsoDate => addDays(dueDate, days);
    const plan = r.int(1, 100);
    if (card === 'everyday-card') {
      if (plan <= 70) {
        this.#planCardPayment(card, 'checking', balance, before(r.int(1, 8)));
      } else if (plan <= 78) {
        this.#planCardPayment(card, 'checking', minimum, before(r.int(1, 8)));
      } else if (plan <= 90) {
        const first = Math.max(1, share(balance, r.int(30, 70)));
        if (balance > first && first * 2 !== balance && r.chance(1, 3)) {
          this.#laterOn(this.#notBeforeTomorrow(before(r.int(3, 8))), () => this.#payTwoAtOnce(card, first, balance - first));
        } else {
          this.#planCardPayment(card, 'checking', first, addDays(closingDate, r.int(3, 10)));
          if (balance > first) this.#planCardPayment(card, 'checking', balance - first, before(r.int(1, 5)));
        }
      } else if (plan <= 95 || minimum <= 1) {
        this.#stats.lateCardPayments++;
        this.#planCardPayment(card, 'checking', balance, after(r.int(1, 5)));
      } else {
        // Less than the minimum before the due date, the rest after it (A6).
        const short = r.int(1, minimum - 1);
        this.#stats.lateCardPayments++;
        this.#planCardPayment(card, 'checking', short, before(r.int(1, 5)));
        this.#planCardPayment(card, 'checking', balance - short, after(r.int(1, 5)));
      }
    } else {
      const amount = Math.min(balance, minimum + r.int(0, 40_000));
      if (plan <= 85) {
        this.#planCardPayment(card, 'checking', amount, before(r.int(2, 10)));
      } else if (plan <= 90) {
        this.#stats.oldCardFromSavings++;
        this.#planCardPayment(card, 'savings', amount, before(r.int(2, 10)));
      } else if (plan <= 95 && minimum > 1) {
        const short = r.int(1, minimum - 1);
        this.#stats.lateCardPayments++;
        this.#planCardPayment(card, 'checking', short, before(r.int(2, 10)));
        this.#planCardPayment(card, 'checking', amount - short, after(r.int(1, 6)));
      } else {
        this.#stats.lateCardPayments++;
        this.#planCardPayment(card, 'checking', amount, after(r.int(1, 6)));
      }
    }
  }

  #notBeforeTomorrow(on: IsoDate): IsoDate {
    return daysBetween(this.#date, on) < 1 ? addDays(this.#date, 1) : on;
  }

  #planCardPayment(card: Card, from: OwnAccount, amount: Cents, on: IsoDate): void {
    if (amount <= 0) return;
    this.#laterOn(this.#notBeforeTomorrow(on), () => this.#payCard(card, from, amount));
  }

  // A card payment: usually it leaves checking and lands on the card one to
  // three days later (12.5); sometimes the same day; sometimes the card shows
  // it before checking does.
  #payCard(card: Card, from: OwnAccount, amount: Cents): void {
    const r = this.#random;
    if (card === 'everyday-card') this.#stats.everydayCardPayments++;
    else this.#stats.oldCardPayments++;
    const seen: CardPaymentSeen = { left: null, landed: null, amount };
    this.#cardPayments[card].push(seen);
    const how = r.int(1, 100);
    if (how <= 20) {
      this.#ownTransfer(() => this.#bank.transfer(this.#date, from, card, amount));
      seen.left = this.#date;
      seen.landed = this.#date;
    } else if (how <= 92) {
      this.#stats.paymentsInTransit++;
      const left = this.#ownTransfer(() => this.#bank.send(this.#date, from, card, amount));
      seen.left = this.#date;
      this.#laterOn(addDays(this.#date, r.int(1, 3)), () => {
        this.#ownTransfer(() => this.#bank.land(this.#date, left, r.chance(7, 10)));
        seen.landed = this.#date;
      });
    } else {
      this.#stats.paymentsLandedFirst++;
      const landed = this.#ownTransfer(() => this.#bank.landFirst(this.#date, from, card, amount));
      seen.landed = this.#date;
      this.#laterOn(addDays(this.#date, r.int(1, 2)), () => {
        this.#ownTransfer(() => this.#bank.sendAfter(this.#date, landed));
        seen.left = this.#date;
      });
    }
  }

  // Two payments of different amounts leave the same day and land out of
  // order, neither naming the other half, so the book has to pair each
  // landing by its amount (12.5, B45).
  #payTwoAtOnce(card: Card, first: Cents, second: Cents): void {
    this.#stats.everydayCardPayments += 2;
    this.#stats.paymentsInTransit += 2;
    this.#stats.paymentsLandedOutOfOrder++;
    const halves: { left: TransferSent; seen: CardPaymentSeen }[] = [first, second].map((amount) => {
      const seen: CardPaymentSeen = { left: this.#date, landed: null, amount };
      this.#cardPayments[card].push(seen);
      return { left: this.#ownTransfer(() => this.#bank.send(this.#date, 'checking', card, amount)), seen };
    });
    halves.reverse().forEach(({ left, seen }, i) => {
      this.#laterOn(addDays(this.#date, i + 1), () => {
        this.#ownTransfer(() => this.#bank.land(this.#date, left, false));
        seen.landed = this.#date;
      });
    });
  }

  // What the person has paid toward a statement, as of a day: payments that
  // reached the card after the closing date (or are still on their way), and
  // that have shown leaving by that day (B47), or shown landing when the card
  // saw them first.
  #paidToward(statement: CardStatement, asOf: IsoDate): Cents {
    let paid = 0;
    for (const p of this.#cardPayments[statement.card]) {
      const shown = p.left ?? p.landed;
      if (shown === null || daysBetween(shown, asOf) < 0) continue;
      if (p.landed !== null && daysBetween(statement.closingDate, p.landed) <= 0) continue;
      paid += p.amount;
    }
    return paid;
  }

  // 9.1 to 9.3: a reminder on the reminder days while not enough is paid:
  // the full statement balance on the everyday card, the minimum on the old
  // card. Never one with nothing owed (B29), and no overdue alert on the due
  // date itself (9.4).
  #noticesDue(statement: CardStatement): void {
    const { card, dueDate, statementBalance, minimumPayment } = statement;
    const daysLeft = daysBetween(this.#date, dueDate);
    const owed = card === 'everyday-card' ? statementBalance : minimumPayment;
    const remind = this.#settings.cardReminderDaysBefore.includes(daysLeft) && owed > 0 && this.#paidToward(statement, this.#date) < owed;
    let expected: CardNotice[] = [];
    if (remind && card === 'everyday-card') expected = [{ kind: 'reminder', card, daysBefore: daysLeft, dueDate, statementBalance, minimumPayment }];
    if (remind && card === 'old-card') expected = [{ kind: 'reminder', card, daysBefore: daysLeft, dueDate, minimumPayment }];
    this.#expectNotices(statement, expected, '9.1 to 9.3 card reminders');
  }

  // 9.4: the day after the due date, an overdue alert if the payments since
  // the statement add up to less than the minimum, and then a late fee.
  #dueDatePassed(statement: CardStatement): void {
    const overdue = this.#paidToward(statement, this.#date) < statement.minimumPayment;
    const { card, dueDate, minimumPayment } = statement;
    this.#expectNotices(statement, overdue ? [{ kind: 'overdue', card, dueDate, minimumPayment }] : [], '9.4 the overdue alert');
    if (overdue) {
      this.#stats.overdueAlerts++;
      this.#cardCharge(card, 'fee', 2_900);
    }
  }

  #expectNotices(statement: CardStatement, expected: CardNotice[], check: string): void {
    this.#stats.remindersChecked++;
    const notices = cardNotices(this.#date, statement, this.#book.cardPayments(statement.card), this.#book.settings());
    if (!same(notices, expected)) {
      const paid = this.#paidToward(statement, this.#date);
      throw new CheckFailed(check, `${statement.card} closed ${statement.closingDate}, due ${statement.dueDate}, paid ${paid}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(notices)}`);
    }
  }

  // 4.8 and 5.5: fees and interest on the everyday card wait in review with
  // needs suggested; on the old card they only raise the debt.
  #cardCharge(card: Card, charge: 'fee' | 'interest', amount: Cents): void {
    if (charge === 'fee') this.#stats.cardFees++;
    else this.#stats.cardInterest++;
    const before = this.#book.pots();
    const txn = this.#bank.cardCharge(this.#date, card, charge, amount);
    this.#receive(txn);
    if (card === 'old-card') {
      this.#expectChange(before, {}, '5.5 old card fees and interest', txn.id);
      return;
    }
    this.#expectChange(before, { unsortedOut: amount }, '4.8 card fees and interest wait in review', txn.id);
    const item = this.#book.reviewItems().find((i) => i.id === txn.id);
    if (item?.type !== 'spending' || item.suggestion !== 'needs') throw new CheckFailed('4.8 needs is suggested for card fees', JSON.stringify(item));
  }

  #receive(txn: BankTransaction): string {
    const { outcome } = this.#book.receive(txn);
    this.#sent.push(txn);
    const about = 'takenId' in txn ? txn.takenId : 'pendingId' in txn ? txn.pendingId : '';
    this.#note(`receive ${txn.kind} ${txn.id} ${'amount' in txn ? txn.amount : `for ${about}`}${'account' in txn ? ` ${txn.account}` : ''}${'to' in txn ? ` ${txn.from}->${txn.to}` : ''} "${txn.description}": ${outcome}`);
    return outcome;
  }

  // 4.2 and B9: the first rule in the list whose text the description contains.
  #ruleFor(kind: SortingRule['for'], description: string): SortingRule | undefined {
    const text = description.toLowerCase();
    return this.#rules.find((rule) => rule.for === kind && text.includes(rule.contains.toLowerCase()));
  }

  // ---- The person's evening ---------------------------------------------

  #evening(): void {
    const r = this.#random;
    for (const action of this.#tonight.splice(0)) action();
    this.#maybeChangeSettings();
    // Most evenings the person goes through what is waiting.
    if (r.chance(17, 20)) {
      for (const item of this.#book.reviewItems()) this.#handle(item);
    }
    if (r.chance(1, 40)) this.#resort();
    if (r.chance(1, 150)) this.#notForMom();
    this.#handMoves();
  }

  #handle(item: ReviewItem): void {
    const r = this.#random;
    const today = this.#date;
    // Earlier answers can sort later items (a new rule, a paycheck), so skip
    // anything no longer waiting.
    if (!this.#book.reviewItems().some((i) => i.id === item.id)) return;
    const before = this.#book.pots();
    switch (item.type) {
      case 'leftover': {
        let plan = this.#leftoverPlans.get(item.id);
        if (plan === undefined) {
          const when = r.int(1, 100);
          plan = { on: when <= 60 ? today : when <= 95 ? addDays(today, r.int(1, 3)) : null, answer: r.chance(3, 5) ? 'roll-over' : 'move-to-savings' };
          this.#leftoverPlans.set(item.id, plan);
        }
        if (plan.on === null || daysBetween(plan.on, today) < 0) return;
        // 3.4 and B4: what was asked at payday, lowered by spending made
        // before payday that showed up or changed since, never below zero
        // and never above what was asked. Worked out here from the purchases
        // as listed, not from the question.
        const askedAt = this.#askedAtPayday.get(item.id);
        if (askedAt === undefined) throw new CheckFailed('3.4 a leftover answer', `the simulator has no record of ${item.id}`);
        const late = this.#spentBeforeFromList(item.bucket, item.date) - askedAt.spentBefore;
        const moves = Math.min(askedAt.asked, Math.max(0, askedAt.asked - late));
        this.#book.answerLeftover(item.id, plan.answer, today);
        this.#note(`answer leftover ${item.id} ${plan.answer} (${moves} of ${askedAt.asked})`);
        // Rolling over moves nothing; moving to savings moves what it asks about now.
        this.#expectChange(before, plan.answer === 'roll-over' ? {} : { [item.bucket]: -moves, savings: moves }, '3.4 a leftover answer', item.id);
        if (moves !== askedAt.asked) this.#stats.leftoverLoweredLate++;
        if (daysBetween(item.date, today) > 0) this.#stats.leftoverAnsweredLate++;
        if (plan.answer === 'roll-over') this.#stats.leftoverRolledOver++;
        else this.#stats.leftoverMovedToSavings++;
        return;
      }
      case 'old-card-purchase':
        this.#book.acknowledge(item.id, today);
        this.#note(`acknowledge ${item.id}`);
        this.#expectChange(before, {}, '5.4 seeing the flag moves nothing', item.id);
        if (this.#book.reviewItems().some((i) => i.id === item.id)) throw new CheckFailed('5.4 seeing the flag clears it', `${item.id} is still waiting`);
        return;
      case 'money-in': {
        let choice = this.#moneyInChoice(item);
        // Now and then the person leaves an early paycheck for a while. By
        // then a newer paycheck may have come, and this one can no longer
        // start a pay period (B54), so it becomes other income.
        if (choice === 'paycheck') {
          let on = this.#waitUntil.get(item.id);
          if (on === undefined) {
            on = r.chance(1, 4) ? addDays(today, r.int(1, 20)) : today;
            this.#waitUntil.set(item.id, on);
          }
          if (daysBetween(on, today) < 0) return;
        }
        this.#tryMistake(item, before);
        if (choice === 'paycheck' && daysBetween(this.#lastPaycheckDate, item.date) < 0) {
          this.#expectRefused(() => this.#book.sort(item.id, { to: 'paycheck' }, today), before, item.id, 'calling a deposit older than the last paycheck a paycheck (B54)');
          choice = 'other-income';
        }
        const asked = this.#openLeftovers();
        this.#book.sort(item.id, { to: choice }, today);
        this.#note(`sort money in ${item.id} -> ${choice}`);
        if (choice === 'paycheck') {
          this.#stats.myPaycheckChoices++;
          this.#onPaycheck(before, asked, item.amount, item.date, true);
          return;
        }
        if (choice === 'other-income') this.#stats.otherIncome++;
        const change: Change = choice === 'other-income' ? this.#otherIncome(item.amount) : choice === 'not-mine' ? { heldForOthers: item.amount } : { [choice]: item.amount };
        this.#expectChange(before, { ...change, unsortedIn: -item.amount }, '6.1 sorting money in', item.id);
        return;
      }
      case 'spending':
        this.#tryMistake(item, before);
        this.#sortSpending(item, before);
        return;
    }
  }

  #moneyInChoice(item: Extract<ReviewItem, { type: 'money-in' }>): 'paycheck' | 'other-income' | 'not-mine' | 'needs' | 'wants' {
    const intent = this.#intents.get(item.id);
    if (intent?.type === 'refund') return intent.bucket;
    return intent?.type === 'money-in' ? intent.choice : 'other-income';
  }

  // Now and then the person first tries something the rulebook does not
  // allow. The app must refuse it and change nothing.
  #tryMistake(item: ReviewItem, before: Pots): void {
    const r = this.#random;
    if (!r.chance(1, 25)) return;
    const today = this.#date;
    if (item.type === 'spending' && item.amount >= 2) {
      const person = this.#intents.get(item.id)?.type === 'person';
      const split = (needs: Cents, wants: Cents) => () => this.#book.sort(item.id, { split: [{ bucket: 'needs', amount: needs }, { bucket: 'wants', amount: wants }] }, today);
      if (item.reason === 'mom-difference') this.#expectRefused(split(1, item.amount - 1), before, item.id, 'splitting a mom difference (B23)');
      else if (person) {
        const intoSavings = () => this.#book.sort(item.id, { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'savings' as never, amount: item.amount - 1 }] }, today);
        this.#expectRefused(intoSavings, before, item.id, 'splitting a payment to a person into savings (7.6)');
      } else if (item.reason === 'from-savings' && r.chance(1, 2)) {
        const always = () => this.#book.sortAlways(item.id, { to: 'needs' }, { id: `always-${item.id}`, contains: item.description }, today);
        this.#expectRefused(always, before, item.id, 'a sorting rule for money leaving savings (4.9)');
      } else if (r.chance(1, 2)) this.#expectRefused(split(1, item.amount - 2), before, item.id, 'a split one cent short (4.4)');
      else if (item.reason !== 'old-card-from-savings') this.#expectRefused(() => this.#book.sort(item.id, { to: 'savings' }, today), before, item.id, 'sorting spending to savings (4.2, QUESTIONS.md A3)');
    } else if (item.type === 'money-in' && item.reason === 'refund') {
      this.#expectRefused(() => this.#book.sort(item.id, { to: r.pick(['paycheck', 'other-income'] as const) }, today), before, item.id, 'calling a store refund income (B16)');
    }
  }

  #expectRefused(attempt: () => unknown, before: Pots, itemId: string | null, what: string): void {
    const logBefore = this.#book.changeLog().length;
    let refused = false;
    try {
      attempt();
    } catch (error) {
      if (!(error instanceof MoneyError)) throw error;
      refused = true;
    }
    if (!refused) throw new CheckFailed('refusing what the rulebook does not allow', `the person tried ${what}, and the app accepted it`);
    this.#expectChange(before, {}, 'a refused change leaves no trace', what);
    if (this.#book.changeLog().length !== logBefore) throw new CheckFailed('a refused change leaves no trace', `${what} was logged`);
    if (itemId !== null && !this.#book.reviewItems().some((i) => i.id === itemId)) throw new CheckFailed('a refused change leaves no trace', `${itemId} left review after ${what}`);
    this.#stats.mistakesRefused++;
    this.#note(`refused, as it should be: ${what}`);
  }

  #sortSpending(item: Extract<ReviewItem, { type: 'spending' }>, before: Pots): void {
    const r = this.#random;
    const today = this.#date;
    const intent = this.#intents.get(item.id);
    const store = intent?.type === 'store' ? intent.store : null;
    // 13.6: after sorting a few restaurant meals by hand, "always do this".
    // The item and every waiting meal the new rule is the first match for
    // land in wants.
    if (store === 'MADE UP RESTAURANT' && item.reason === 'no-rule' && ++this.#restaurantsSortedByHand > 3) {
      const waiting = this.#waitingFrom(store);
      const total = waiting.reduce((sum, i) => sum + i.amount, 0);
      const logBefore = this.#book.changeLog().length;
      const rule = { id: `always-${item.id}`, contains: store };
      const { sticks } = this.#book.sortAlways(item.id, { to: 'wants' }, rule, today);
      this.#rules.push({ ...rule, for: 'purchase', bucket: 'wants' });
      this.#note(`always: restaurants to wants (${item.id}), sorting ${waiting.length} waiting`);
      this.#expectChange(before, { wants: -total, unsortedOut: -total }, '13.6 always do this', item.id);
      if (!sticks || this.#book.changeLog().length !== logBefore + 1) throw new CheckFailed('13.6 always do this', `sticks: ${sticks}, log ${logBefore} -> ${this.#book.changeLog().length}`);
      for (const i of waiting) this.#standing.set(i.id, 'wants');
      this.#stats.alwaysRules++;
      return;
    }
    let change: Change;
    // A bucket to cover from savings by hand, once sorted.
    let cover: 'needs' | 'wants' | null = null;
    if (item.reason === 'old-card-from-savings') {
      // QUESTIONS.md A4: it suggests savings; the person mostly confirms it,
      // and sometimes picks needs instead.
      if (item.suggestion !== 'savings') throw new CheckFailed('5.2 an old card payment from savings suggests savings (A4)', JSON.stringify(item));
      const to = r.chance(3, 4) ? 'savings' : 'needs';
      this.#book.sort(item.id, { to }, today);
      change = { [to]: -item.amount };
    } else if (item.reason === 'card-fee' || item.reason === 'card-interest' || item.reason === 'setup-difference') {
      this.#book.sort(item.id, { to: 'needs' }, today);
      change = { needs: -item.amount };
    } else if (item.reason === 'mom-difference') {
      const to = r.pick(['needs', 'wants'] as const);
      this.#book.sort(item.id, { to }, today);
      change = { [to]: -item.amount };
      this.#differenceTo.set(item.id, to);
    } else if (item.reason === 'from-savings') {
      // 4.9 and 4.2: sorted to needs or wants like any spending. To pay for
      // it out of savings, the person then moves the money by hand (13.3).
      if (intent?.type !== 'from-savings') throw new CheckFailed('4.9 only money leaving savings waits as from savings', JSON.stringify(item));
      this.#book.sort(item.id, { to: intent.sorting }, today);
      change = { [intent.sorting]: -item.amount };
      if (r.chance(1, 2)) cover = intent.sorting;
    } else if (intent?.type === 'person') {
      const sorting = intent.sorting === 'split' && item.amount < 3 ? 'wants' : intent.sorting;
      if (sorting === 'mom') {
        // 7.6 (B20): for mom. Out of the reserve as far as it goes; the rest
        // waits as a mom difference (8.3). After a few, "always do this".
        if (this.#person.alwaysForMom && ++this.#forMomSortedByHand > 2) {
          this.#alwaysForMom(item, before);
          return;
        }
        this.#book.sort(item.id, { to: 'mom' }, today);
        const fromReserve = this.#forMomPayment(item.id, item.date, item.amount, before.momReserve);
        change = { momReserve: -fromReserve, unsortedOut: -fromReserve };
        this.#checkMomMonth(item.date);
        this.#stats.paymentsForMom++;
      } else if (sorting === 'split') {
        // 7.6 (B20): split across needs, wants, and not mine.
        const parts = splitInto(r, item.amount, r.chance(1, 2) ? (['wants', 'not-mine'] as const) : (['needs', 'wants', 'not-mine'] as const));
        this.#book.sort(item.id, { split: parts }, today);
        change = {};
        for (const part of parts) {
          const pot = part.bucket === 'not-mine' ? 'heldForOthers' : part.bucket;
          change[pot] = (change[pot] ?? 0) - part.amount;
        }
        this.#stats.personPaymentsSplit++;
      } else {
        this.#book.sort(item.id, { to: sorting }, today);
        change = sorting === 'not-mine' ? { heldForOthers: -item.amount } : { [sorting]: -item.amount };
      }
    } else if (intent?.type === 'store' && intent.sorting === 'split' && item.amount >= 2) {
      const needs = r.int(1, item.amount - 1);
      this.#book.sort(item.id, { split: [{ bucket: 'needs', amount: needs }, { bucket: 'wants', amount: item.amount - needs }] }, today);
      change = { needs: -needs, wants: -(item.amount - needs) };
      this.#standing.set(item.id, 'split');
      this.#splitParts.set(item.id, { needs, wants: item.amount - needs });
      this.#stats.splitPurchases++;
    } else {
      const sorting = intent?.type === 'store' ? intent.sorting : 'either';
      const to = sorting === 'needs' || sorting === 'wants' ? sorting : r.pick(['needs', 'wants'] as const);
      this.#book.sort(item.id, { to }, today);
      change = { [to]: -item.amount };
      if (intent?.type === 'store') {
        this.#standing.set(item.id, to);
        this.#handSorted.push({ id: item.id, to });
        if (this.#handSorted.length > 50) this.#handSorted.shift();
      }
    }
    this.#note(`sort spending ${item.id} (${item.reason}) ${JSON.stringify(change)}`);
    this.#expectChange(before, { unsortedOut: -item.amount, ...change }, '4.2, 4.4 and 7.6 sorting spending', item.id);
    if (cover !== null) this.#move('savings', cover, item.amount, true);
  }

  // 13.6 and 7.6: "always do this" for a payment for mom. The new rule sorts
  // this one and every one like it still waiting, each out of the reserve
  // as far as it goes, in the order they wait.
  #alwaysForMom(item: Extract<ReviewItem, { type: 'spending' }>, before: Pots): void {
    const waiting = this.#book
      .reviewItems()
      .filter((i): i is Extract<ReviewItem, { type: 'spending' }> => i.type === 'spending' && i.id !== item.id && i.reason === 'person-payment' && i.description.includes(FOR_MOM));
    const logBefore = this.#book.changeLog().length;
    const rule = { id: `always-${item.id}`, contains: FOR_MOM };
    const { sticks } = this.#book.sortAlways(item.id, { to: 'mom' }, rule, this.#date);
    this.#rules.push({ ...rule, for: 'person', choice: { to: 'mom' } });
    let reserve = before.momReserve;
    let taken = 0;
    for (const i of [item, ...waiting]) {
      const fromReserve = this.#forMomPayment(i.id, i.date, i.amount, reserve);
      reserve -= fromReserve;
      taken += fromReserve;
    }
    this.#note(`always: ${FOR_MOM} for mom (${item.id}), sorting ${waiting.length} more waiting`);
    this.#expectChange(before, { momReserve: -taken, unsortedOut: -taken }, '13.6 always do this, for mom (7.6)', item.id);
    for (const i of [item, ...waiting]) this.#checkMomMonth(i.date);
    if (!sticks || this.#book.changeLog().length !== logBefore + 1) throw new CheckFailed('13.6 always do this', `sticks: ${sticks}, log ${logBefore} -> ${this.#book.changeLog().length}`);
    this.#stats.forMomRules++;
    this.#stats.paymentsForMom += 1 + waiting.length;
  }

  // 7.6: now and then the person decides a payment marked for mom was not
  // for mom after all, and sorts it again. The reserve gets back what it
  // gave, the difference is undone wherever it went, and the month's total
  // drops (8.2). One the mom rule matched can never be sorted again (8.1).
  #notForMom(): void {
    const r = this.#random;
    const today = this.#date;
    if (this.#momRulePayments.length > 0 && r.chance(1, 4)) {
      const id = r.pick(this.#momRulePayments);
      this.#expectRefused(() => this.#book.sort(id, { to: 'needs' }, today), this.#book.pots(), null, `sorting ${id}, which the mom rule matched, another way (8.1)`);
    }
    const target = this.#forMom.length > 0 ? r.pick(this.#forMom) : undefined;
    if (target === undefined) return;
    this.#forMom.splice(this.#forMom.indexOf(target), 1);
    const before = this.#book.pots();
    const to = r.pick(['needs', 'wants', 'not-mine'] as const);
    this.#book.sort(target.id, { to }, today);
    const change: Change = { momReserve: target.fromReserve, [to === 'not-mine' ? 'heldForOthers' : to]: -target.amount };
    const difference = target.amount - target.fromReserve;
    const went = this.#differenceTo.get(`${target.id}:difference`);
    this.#differenceTo.delete(`${target.id}:difference`);
    if (difference > 0 && went === undefined) change.unsortedOut = -difference;
    else if (difference > 0 && went !== undefined) change[went] = (change[went] ?? 0) + difference;
    this.#addMomSent(target.date, -target.amount);
    this.#note(`re-sort ${target.id}, for mom, to ${to}`);
    this.#expectChange(before, change, '7.6 a payment for mom sorted again', target.id);
    this.#checkMomMonth(target.date);
    this.#stats.forMomResorted++;
  }

  // Spending from a store still waiting in review with no rule for it.
  #waitingFrom(store: string): Extract<ReviewItem, { type: 'spending' }>[] {
    return this.#book.reviewItems().filter((i): i is Extract<ReviewItem, { type: 'spending' }> => {
      const intent = this.#intents.get(i.id);
      return i.type === 'spending' && i.reason === 'no-rule' && intent?.type === 'store' && intent.store === store;
    });
  }

  // 4.7: now and then the person changes their mind about a purchase. What
  // is left of it moves from one bucket to the other (B7).
  #resort(): void {
    const target = this.#handSorted.length > 0 ? this.#random.pick(this.#handSorted) : undefined;
    if (!target || this.#standing.get(target.id) !== target.to) return;
    const from = target.to;
    const to = from === 'needs' ? 'wants' : 'needs';
    const before = this.#book.pots();
    this.#book.sort(target.id, { to }, this.#date);
    const moved = this.#book.pots()[from] - before[from];
    if (moved < 0) throw new CheckFailed('4.7 re-sorting a purchase', `${target.id} took ${-moved} more out of ${from}`);
    this.#expectChange(before, { [from]: moved, [to]: -moved }, '4.7 re-sorting a purchase', target.id);
    target.to = to;
    this.#standing.set(target.id, to);
    this.#stats.resorts++;
    this.#note(`re-sort ${target.id} -> ${to}`);
  }

  // 13.3: covering an overspent needs from savings, small moves between
  // needs and wants, keeping money a friend said to keep, and now and then
  // something out of the mom reserve.
  #handMoves(): void {
    const r = this.#random;
    const pots = this.#book.pots();
    if (pots.needs < 0 && pots.savings > -pots.needs && r.chance(1, 3)) this.#move('savings', 'needs', -pots.needs, true);
    if (r.chance(1, 60)) {
      const [from, to] = r.chance(1, 2) ? (['needs', 'wants'] as const) : (['wants', 'needs'] as const);
      this.#move(from, to, r.int(2_000, 10_000), r.chance(1, 2));
    }
    if (pots.heldForOthers > 0 && r.chance(1, 90)) this.#move('heldForOthers', 'wants', pots.heldForOthers, true);
    if (pots.momReserve > 5_000 && r.chance(1, 200)) this.#move('momReserve', 'needs', 5_000, true);
    // Rarely more comes out of the mom reserve than it holds, so the next
    // payment to mom meets a reserve below zero (8.3, B27).
    if (pots.momReserve >= 0 && r.chance(1, 400)) this.#move('momReserve', 'needs', pots.momReserve + r.int(1, 20_000), true);
    // And now and then a slip the app must refuse: a move to the same
    // bucket, or of nothing.
    if (r.chance(1, 100)) {
      const slip = r.chance(1, 2) ? { from: 'needs' as const, to: 'needs' as const, amount: 1_000 } : { from: 'needs' as const, to: 'wants' as const, amount: 0 };
      this.#expectRefused(() => this.#book.moveMoney(slip, this.#date), this.#book.pots(), null, `moving ${slip.amount} from ${slip.from} to ${slip.to}`);
    }
  }

  // 13.4: it asks first when money leaves savings or the mom reserve, or
  // would leave the bucket it comes out of below zero (B51), and nothing
  // moves until you confirm. 13.5: every move is logged.
  #move(from: Pot, to: Pot, amount: Cents, confirmIfAsked: boolean): void {
    const before = this.#book.pots();
    const logBefore = this.#book.changeLog().length;
    const reasons = [
      ...(from === 'savings' ? ['out-of-savings'] : []),
      ...(from === 'momReserve' ? ['out-of-mom-reserve'] : []),
      ...(before[from] - amount < 0 ? ['below-zero'] : []),
    ];
    let result = this.#book.moveMoney({ from, to, amount }, this.#date);
    if (reasons.length === 0 && !result.moved) throw new CheckFailed('13.4 asking to confirm', `moving ${amount} ${from} -> ${to} asked: ${JSON.stringify(result)}`);
    if (reasons.length > 0) {
      if (result.moved || !same([...result.reasons].sort(), [...reasons].sort())) {
        throw new CheckFailed('13.4 asking to confirm', `moving ${amount} ${from} -> ${to} with ${from} at ${before[from]}: expected to ask for ${reasons.join(', ')}, got ${JSON.stringify(result)}`);
      }
      this.#expectChange(before, {}, '13.4 nothing moves until you confirm', `${from} -> ${to}`);
      if (!confirmIfAsked) return;
      result = this.#book.moveMoney({ from, to, amount, confirmed: true }, this.#date);
      this.#stats.confirmedMoves++;
      if (!result.moved) throw new CheckFailed('13.4 a confirmed move goes through', JSON.stringify(result));
    }
    this.#expectChange(before, { [from]: -amount, [to]: amount }, '13.3 a hand move', `${amount} ${from} -> ${to}`);
    const last = this.#book.changeLog().at(-1);
    if (this.#book.changeLog().length !== logBefore + 1 || last?.kind !== 'money-moved' || last.from !== from || last.to !== to || last.amount !== amount || last.date !== this.#date) {
      throw new CheckFailed('13.5 every move is logged', JSON.stringify(last));
    }
    this.#stats.handMoves++;
    this.#note(`move ${amount} ${from} -> ${to}`);
  }

  // About once a year, on a day picked at random, some settings change
  // (13.1), and the first time, a new rule for the cinema (13.2).
  #maybeChangeSettings(): void {
    const r = this.#random;
    if (this.#date !== this.#nextSettingsChange) return;
    this.#nextSettingsChange = addDays(this.#date, r.int(300, 420));
    const patch: { -readonly [K in keyof Settings]?: Settings[K] } = { split: r.pick(SPLITS) };
    if (r.chance(2, 5)) patch.momReservePerPaycheck = r.pick([100_000, 150_000, 200_000]);
    if (r.chance(1, 4)) patch.momReserveCap = r.pick([300_000, 400_000]);
    if (r.chance(1, 4)) patch.lowBucketAlertPercent = r.pick([10, 20, 25]);
    if (r.chance(1, 8)) patch.payScheduleDays = this.#settings.payScheduleDays === 14 ? 15 : 14;
    if (r.chance(1, 4)) {
      const choices: readonly LeftoverChoice[] = ['ask', 'ask', 'roll-over', 'move-to-savings'];
      patch.leftoverAtPayday = { needs: r.pick(choices), wants: r.pick(choices) };
    }
    const logBefore = this.#book.changeLog().length;
    this.#book.changeSettings(patch, this.#date);
    this.#settings = { ...this.#settings, ...patch };
    this.#stats.settingsChanges++;
    this.#note(`settings changed: ${JSON.stringify(patch)}`);
    if (this.#book.changeLog().length !== logBefore + 1) throw new CheckFailed('13.5 every change is logged', 'a settings change was not logged');
    if (this.#rules.some((rule) => rule.id === 'cinema')) return;
    const rule: SortingRule = { id: 'cinema', for: 'purchase', contains: 'CINEMA', bucket: 'wants' };
    const waiting = this.#waitingFrom('MADE UP CINEMA');
    const total = waiting.reduce((sum, i) => sum + i.amount, 0);
    const before = this.#book.pots();
    this.#book.addRule(rule, this.#date);
    this.#rules.push(rule);
    this.#stats.rulesAdded++;
    this.#expectChange(before, { wants: -total, unsortedOut: -total }, '13.2 a new rule sorts what is waiting', `cinema, ${waiting.length} waiting`);
    for (const i of waiting) this.#standing.set(i.id, 'wants');
  }

  // ---- The checks at the end of every day --------------------------------

  #check(): void {
    const book = this.#book;
    const bank = this.#bank.balances();
    // 12.1: the simulator's own sum of pending charges agrees with the app's.
    const appWay = withPendingCharges(this.#bank.postedBalances(), this.#bank.pendingCharges());
    if (!same(appWay, bank)) throw new CheckFailed('12.1 pending charges', `the bank's balances with pending charges are ${JSON.stringify(bank)}, the app's way gives ${JSON.stringify(appWay)}`);
    // 12.3: the daily self-check. On a mismatch, safe to spend is held back
    // (0.5) and the alert shows the difference (10.4).
    const check = book.selfCheck(bank);
    if (check.ok && check.difference !== 0) throw new CheckFailed('12.3 a difference passed the self-check', JSON.stringify(check));
    if (!check.ok) {
      const safe = book.checkedSafeToSpend(this.#date, bank);
      if (safe.ok || safe.difference !== check.difference) throw new CheckFailed('0.5 safe to spend is held back on a mismatch', JSON.stringify(safe));
      const alert = book.takeAlerts({ bankConnection: 'ok', bankBalances: bank }).find((a) => a.kind === 'totals-mismatch');
      if (alert?.kind !== 'totals-mismatch' || alert.difference !== check.difference) throw new CheckFailed('10.4 the mismatch alert', JSON.stringify(alert));
      throw new CheckFailed('12.3 daily self-check', `bank side ${check.bankSide} + in transit ${check.inTransit} should equal app side ${check.appSide}; difference ${check.difference}`);
    }
    if (check.inTransit !== this.#bank.inTransit()) throw new CheckFailed('12.5 money in transit', `the book has ${check.inTransit} in transit, the bank ${this.#bank.inTransit()}`);
    // 12.5: the payments listed as on their way are exactly the ones the bank
    // shows with only one half, the old card's included.
    const listed = book.inTransit().items.map((i) => `${i.from} ${i.to} ${i.amount} ${i.seen}`).sort();
    const showing = this.#bank.halvesShowing().map((h) => `${h.from} ${h.to} ${h.amount} ${h.kind === 'transfer-sent' ? 'left' : 'arrived'}`).sort();
    if (!same(listed, showing)) throw new CheckFailed('12.5 the list of money in transit', `the book lists ${JSON.stringify(listed)}, the bank shows ${JSON.stringify(showing)}`);
    if (book.oldCardDebt() !== this.#bank.oldCardOwed()) throw new CheckFailed('12.4 old card debt', `the book shows ${book.oldCardDebt()}, the old card owes ${this.#bank.oldCardOwed()}`);
    // No cent created or lost: the running totals equal a recount from scratch.
    const pots = book.pots();
    const recount = book.recountPots();
    for (const key of POT_NAMES) {
      if (pots[key] !== recount[key]) throw new CheckFailed('recount', `${key} is ${pots[key]}, a recount gives ${recount[key]}`);
      if (!Number.isSafeInteger(pots[key])) throw new CheckFailed('0.1 whole cents', `${key} is ${pots[key]}`);
    }
    // 3.1: one pay period per paycheck, counted from the last one.
    if (book.period().number !== this.#paychecksSeen || book.lastPaycheckDate() !== this.#lastPaycheckDate) {
      throw new CheckFailed('3.1 pay periods', `period ${book.period().number} from ${book.lastPaycheckDate()}, expected ${this.#paychecksSeen} from ${this.#lastPaycheckDate}`);
    }
    // 11.1, 11.2 and 0.5: safe to spend is wants left minus unsorted
    // spending, with the days to the next payday from the pay schedule.
    const nextPayday = addDays(this.#lastPaycheckDate, this.#settings.payScheduleDays);
    const safe = book.checkedSafeToSpend(this.#date, bank);
    if (!safe.ok || safe.safeToSpend.amount !== pots.wants - pots.unsortedOut) {
      throw new CheckFailed('11.1 safe to spend', `${JSON.stringify(safe)} with wants ${pots.wants} and unsorted spending ${pots.unsortedOut}`);
    }
    if (safe.safeToSpend.nextPayday !== nextPayday || safe.safeToSpend.daysToPayday !== daysBetween(this.#date, nextPayday)) {
      throw new CheckFailed('11.2 days to payday', `${JSON.stringify(safe.safeToSpend)}, expected the next payday ${nextPayday}`);
    }
    // 7.3: held for others says what it means.
    const others = book.othersMoney();
    const meaning = pots.heldForOthers === 0 ? 'settled' : pots.heldForOthers > 0 ? 'holding-for-others' : 'owed-to-you';
    if (others.heldForOthers !== pots.heldForOthers || others.meaning !== meaning) throw new CheckFailed('7.3 held for others', JSON.stringify(others));
    // B3: never more than one leftover question for a bucket.
    const review = book.reviewItems();
    for (const bucket of ['needs', 'wants'] as const) {
      if (review.filter((i) => i.type === 'leftover' && i.bucket === bucket).length > 1) throw new CheckFailed('3.4 one leftover question per bucket', `${bucket} has more than one`);
    }
    this.#checkMomMonth(this.#date);
    this.#checkAlerts(pots, review.length, bank);
  }

  // Section 10, taken every day like the phone will: the low alert below the
  // level and the empty alert at zero or below, each once per bucket per pay
  // period, exactly when due; the daily review only when something waits;
  // no login alert while the connection is fine.
  #checkAlerts(pots: Pots, waiting: number, bank: ReturnType<SimBank['balances']>): void {
    const book = this.#book;
    const period = book.period().number;
    const started = book.startedPeriodWith();
    const percent = BigInt(this.#settings.lowBucketAlertPercent);
    const due = new Set<string>();
    for (const bucket of ['needs', 'wants'] as const) {
      const amount = pots[bucket];
      if (amount <= 0 && !this.#alertsGiven.has(`${period} ${bucket} empty-bucket`)) due.add(`${bucket} empty-bucket`);
      if (amount > 0 && BigInt(amount) * 100n < BigInt(started[bucket]) * percent && !this.#alertsGiven.has(`${period} ${bucket} low-bucket`)) due.add(`${bucket} low-bucket`);
    }
    const alerts = book.takeAlerts({ bankConnection: 'ok', bankBalances: bank });
    const given = new Set<string>();
    for (const alert of alerts) {
      if (alert.kind === 'bank-login' || alert.kind === 'totals-mismatch') throw new CheckFailed(`10.4 and 10.5 no ${alert.kind} alert when all is well`, JSON.stringify(alert));
      if (alert.kind === 'daily-review') {
        if (alert.waiting !== waiting || alert.at !== this.#settings.dailyReviewTime) throw new CheckFailed('10.3 the daily review', `${JSON.stringify(alert)} with ${waiting} waiting`);
        continue;
      }
      if (alert.kind === 'bank-took-back') {
        // 10.6: once, for each transaction the bank took back since the alerts were last taken.
        const expected = this.#tookBack.shift();
        if (expected === undefined || !same(alert, { kind: 'bank-took-back', ...expected })) throw new CheckFailed('10.6 the take-back alert', `${JSON.stringify(alert)}, expected ${JSON.stringify(expected)}`);
        continue;
      }
      if (alert.amount !== pots[alert.bucket] || (alert.kind === 'low-bucket' && alert.startedWith !== started[alert.bucket])) throw new CheckFailed('10.1 and 10.2 alert amounts', JSON.stringify(alert));
      given.add(`${alert.bucket} ${alert.kind}`);
      this.#alertsGiven.add(`${period} ${alert.bucket} ${alert.kind}`);
    }
    if (!same([...given].sort(), [...due].sort())) {
      throw new CheckFailed('10.1 and 10.2 low and empty alerts', `due ${JSON.stringify([...due])}, given ${JSON.stringify([...given])}, with needs ${pots.needs} and wants ${pots.wants} after starting at ${JSON.stringify(started)}`);
    }
    if ((waiting > 0) !== alerts.some((a) => a.kind === 'daily-review')) throw new CheckFailed('10.3 the daily review only when something waits', `${waiting} waiting`);
    if (this.#tookBack.length > 0) throw new CheckFailed('10.6 the take-back alert', `no alert for ${JSON.stringify(this.#tookBack)}`);
  }

  // The buckets changed by exactly this much, and nothing else changed
  // (apart from any buckets this check leaves out).
  #expectChange(before: Pots, change: Change, check: string, what: string, leaveOut: readonly PotName[] = []): void {
    const after = this.#book.pots();
    for (const key of POT_NAMES) {
      if (leaveOut.includes(key)) continue;
      const expected = before[key] + (change[key] ?? 0);
      if (after[key] !== expected) throw new CheckFailed(check, `${what}: ${key} went from ${before[key]} to ${after[key]}, expected ${expected}`);
    }
  }

  #note(line: string): void {
    this.#recent.push(`${this.#date} ${line}`);
    if (this.#recent.length > 25) this.#recent.shift();
  }
}

// A whole-number percent of an amount, rounded down, without floating point.
function share(amount: Cents, percent: number): Cents {
  const hundredths = amount * percent;
  return (hundredths - (hundredths % 100)) / 100;
}

// Random parts of an amount, one for each bucket, each at least a cent.
function splitInto<B extends string>(r: Random, amount: Cents, buckets: readonly B[]): { bucket: B; amount: Cents }[] {
  let left = amount;
  return buckets.map((bucket, i) => {
    const part = i === buckets.length - 1 ? left : r.int(1, left - (buckets.length - 1 - i));
    left -= part;
    return { bucket, amount: part };
  });
}

// The same plain data, whatever order the keys are in.
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortedKeys(a)) === JSON.stringify(sortedKeys(b));
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => [key, sortedKeys(v)]),
    );
  }
  return value;
}

export function describeFailure(result: Extract<LifeResult, { ok: false }>, years: number): string {
  return [
    `Simulated life failed: seed ${result.seed}, day ${result.day} (${result.date}), check "${result.check}".`,
    result.message,
    `Replay: node scripts/simulate.mjs --seed ${result.seed} --years ${years}`,
    'Last things that happened:',
    ...result.recent.map((line) => `  ${line}`),
  ].join('\n');
}
