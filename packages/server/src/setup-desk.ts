import {
  MoneyError,
  addCents,
  assertIsoDate,
  checkAssignment,
  daysBetween,
  formatDollars,
  type BankBalances,
  type Book,
  type IsoDate,
  type Settings,
  type SortingRule,
  type StartingPots,
} from '@budget-app/money';
import { canonical, refuse } from './choices.js';
import { planSetup, type BankHistory } from './setup-history.js';
import type { SetupDone, SetupRequest, SetupResponse } from './views/choice.js';
import { NO_ANSWERS, setupView, type SetupAnswers } from './setup-view.js';
import type { SetupReadyView, SetupView } from './views/setup.js';

// How taps on the Setup day screens reach the books (rulebook section 14).
// The same promises as the choice desk (choices.ts):
// - Each answer carries a decision number made once on the phone; a repeat
//   of it gets the first answer back and changes nothing.
// - A refused answer changes nothing and says why, in words.
// - Starting to track is final, so it asks first: it is not done without his
//   yes, and the yes must name the last look he saw (its key).
// His answers are kept here until tracking starts. Setup day happens once:
// after that every new answer is refused.

export interface SetupDeskInput {
  // The bank history; null when the bank is not connected.
  readonly bank: BankHistory | null;
  readonly today: () => IsoDate;
  // What tracking starts with.
  readonly settings: Settings;
  readonly rules?: readonly SortingRule[];
  // How many days back setup day asks about halves on their way (QUESTIONS.md A25).
  readonly halvesWithinDays: number;
  readonly madeUpData: boolean;
}

export interface Started {
  readonly book: Book;
  // The bank side the book was checked against (12.1), pending charges included.
  readonly bank: BankBalances;
}

export class SetupDesk {
  readonly #input: SetupDeskInput;
  #answers: SetupAnswers = NO_ANSWERS;
  #started: Started | null = null;
  // What each decision number did, for the repeats. Kept in memory here (the
  // demo); the real server keeps it with the book's history (Phase 6).
  readonly #done = new Map<string, { readonly fingerprint: string; readonly done: SetupDone }>();

  constructor(input: SetupDeskInput) {
    this.#input = input;
  }

  // What the Setup day screens show now.
  view(): SetupView {
    const bank = this.#input.bank;
    return setupView({
      today: this.#input.today(),
      madeUpData: this.#input.madeUpData,
      bank: bank === null ? null : { ...bank, setUp: bank.setUp || this.#started !== null },
      answers: this.#answers,
      settings: this.#input.settings,
      rules: this.#input.rules ?? [],
      halvesWithinDays: this.#input.halvesWithinDays,
    });
  }

  // The book, once tracking has started.
  started(): Started | null {
    return this.#started;
  }

  decide(request: SetupRequest): SetupResponse {
    const fingerprint = canonical(request);
    const earlier = this.#done.get(request.id);
    if (earlier !== undefined) {
      if (earlier.fingerprint === fingerprint) return { ok: true, replayed: true, done: earlier.done };
      return refuse('id-reused', 'That decision number was already used for a different answer.');
    }
    const view = this.view();
    if (view.state === 'tracking') return refuse('refused', 'Setup day is done already');
    if (!view.ready) return refuse('refused', capitalize(view.why));

    const answered = this.#answer(request, view);
    if ('why' in answered) return answered;
    this.#done.set(request.id, { fingerprint, done: answered });
    return { ok: true, replayed: false, done: answered };
  }

  #answer(request: SetupRequest, view: SetupReadyView): SetupDone | Extract<SetupResponse, { ok: false }> {
    const step = request.setup;
    const today = this.#input.today();

    // B48: on its way, or not.
    if ('onItsWay' in step) {
      const { half, answer } = step.onItsWay;
      const shown = view.halves.find((h) => h.id === half);
      if (shown === undefined) return refuse('refused', 'That is not one setup day asks about');
      if (shown.onItsWay === answer) return refuse('refused', 'That is already your answer');
      const onItsWay = new Map(this.#answers.onItsWay);
      onItsWay.set(half, answer);
      this.#answers = { ...this.#answers, onItsWay };
      return { step: 'on-its-way', half, answer, startingMoney: this.#ready().startingMoney };
    }

    // B42: the day of his last paycheck, on or before today.
    if ('lastPaycheck' in step) {
      const date = step.lastPaycheck;
      try {
        assertIsoDate(date, 'last paycheck');
      } catch (error) {
        if (error instanceof MoneyError) return refuse('refused', 'Pick a real date');
        throw error;
      }
      if (daysBetween(date, today) < 0) return refuse('refused', "Your last paycheck can't be after today: that paycheck has not come yet");
      if (this.#answers.lastPaycheckDate === date) return refuse('refused', 'That is already the date');
      this.#answers = { ...this.#answers, lastPaycheckDate: date };
      const shown = this.#ready().lastPaycheck;
      if (shown === null) throw new Error('the last paycheck went missing');
      return { step: 'last-paycheck', date, nextPayday: shown.nextPayday };
    }

    // 14.2: an amount in one bucket, or the rest of the starting money.
    if ('assign' in step) {
      const { pot } = step.assign;
      let amount: number;
      try {
        if ('rest' in step.assign) {
          if (view.leftToAssign === 0) return refuse('refused', 'Nothing is left to assign');
          amount = addCents(this.#answers.assignment[pot], view.leftToAssign);
        } else amount = step.assign.amount;
        if (amount === this.#answers.assignment[pot]) return refuse('refused', 'That is already the amount');
        const assignment: StartingPots = { ...this.#answers.assignment, [pot]: amount };
        checkAssignment(view.startingMoney, assignment);
        this.#answers = { ...this.#answers, assignment };
      } catch (error) {
        if (error instanceof MoneyError) return refuse('refused', 'That would make a total too large to keep exact');
        throw error;
      }
      return { step: 'assign', pot, amount, leftToAssign: this.#ready().leftToAssign };
    }

    // 14.3: start tracking, only when it adds up to the cent and the
    // self-check passes, and only with his yes to what he saw.
    if (view.missing.includes('halves')) return refuse('refused', 'Say whether each transfer is still on its way first');
    const date = this.#answers.lastPaycheckDate;
    if (date === null) return refuse('refused', 'Enter the date of your last paycheck first');
    if (view.leftToAssign > 0) return refuse('refused', `${formatDollars(view.leftToAssign)} is still to assign`);
    if (view.leftToAssign < 0) return refuse('refused', `${formatDollars(-view.leftToAssign)} more is assigned than there is`);
    if (view.selfCheck === null || !view.selfCheck.ok) return refuse('refused', 'The self-check does not pass, so tracking cannot start');
    if (request.confirmed !== true || request.seen !== view.key) {
      return refuse(
        'needs-confirmation',
        request.confirmed === true && request.seen !== undefined
          ? 'What tracking would start with has changed since you looked. Check it again'
          : 'Starting to track is final: setup day is done once. It needs your OK first',
      );
    }
    const bank = this.#input.bank;
    if (bank === null) return refuse('refused', 'There is no bank connection yet');
    let plan: ReturnType<typeof planSetup>;
    try {
      plan = planSetup(bank, {
        today,
        assignment: this.#answers.assignment,
        lastPaycheckDate: date,
        settings: this.#input.settings,
        rules: this.#input.rules ?? [],
        inTransit: view.halves.filter((h) => h.onItsWay === true).map((h) => h.id),
      });
    } catch (error) {
      if (error instanceof MoneyError) return refuse('refused', capitalize(error.message));
      throw error;
    }
    if (!plan.ok) return refuse('refused', 'It does not add up to the starting money');
    this.#started = { book: plan.book, bank: plan.bank };
    const settings = plan.book.settings();
    const stillToSet = (['paycheckRule', 'momRule'] as const).filter((key) => settings[key] === null);
    return { step: 'started', startingMoney: plan.startingMoney, stillToSet };
  }

  #ready(): SetupReadyView {
    const view = this.view();
    if (view.state !== 'not-set-up' || !view.ready) throw new Error('setup day stopped being ready');
    return view;
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
