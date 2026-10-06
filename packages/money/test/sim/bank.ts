import {
  addDays,
  type BankBalances,
  type BankTransaction,
  type CardCharge,
  type CardStatement,
  type Cents,
  type Deposit,
  type IsoDate,
  type PendingDropped,
  type PersonPayment,
  type Purchase,
  type Refund,
  type Transfer,
  type TransferArrived,
  type TransferSent,
} from '../../src/index.js';

export type Card = 'everyday-card' | 'old-card';
export type ChargeAccount = 'checking' | Card;
export type OwnAccount = 'checking' | 'savings';
export type Destination = OwnAccount | Card;

// Posted balances. The cards hold what you owe.
export interface Posted {
  checking: Cents;
  savings: Cents;
  everydayCard: Cents;
  oldCard: Cents;
}

// The simulator's bank: its own record of every account, worked out with its
// own arithmetic and kept apart from the book. It behaves the way the real
// bank feed will (Phase 3): posted balances, a list of charges still
// pending, and transfers whose two halves can show on different days. Each
// transaction it makes goes on the feed, and the simulator passes it to the
// book.
export class SimBank {
  readonly posted: Posted;
  readonly feed: BankTransaction[] = [];
  readonly #pending = new Map<string, Purchase>();
  // Transfers with only one half showing so far (12.5).
  readonly #halfway = new Map<string, TransferSent | TransferArrived>();
  #nextId = 1;

  constructor(start: Posted) {
    this.posted = { ...start };
  }

  // 12.1: the balances the self-check is given, posted plus pending charges.
  balances(): BankBalances {
    let { checking, everydayCard } = this.posted;
    for (const charge of this.#pending.values()) {
      if (charge.account === 'checking') checking -= charge.amount;
      if (charge.account === 'everyday-card') everydayCard += charge.amount;
    }
    return { checking, savings: this.posted.savings, everydayCard };
  }

  postedBalances(): BankBalances {
    return { checking: this.posted.checking, savings: this.posted.savings, everydayCard: this.posted.everydayCard };
  }

  pendingCharges(): Purchase[] {
    return [...this.#pending.values()];
  }

  // What the old card owes, pending charges included: the debt the book shows (12.4).
  oldCardOwed(): Cents {
    let owed = this.posted.oldCard;
    for (const charge of this.#pending.values()) if (charge.account === 'old-card') owed += charge.amount;
    return owed;
  }

  // 12.5: money that has left checking or savings and not landed yet, minus
  // money that has landed before it shows leaving. The old card is left out (12.4).
  inTransit(): Cents {
    let total = 0;
    for (const half of this.#halfway.values()) {
      if (half.to === 'old-card') continue;
      total += half.kind === 'transfer-sent' ? half.amount : -half.amount;
    }
    return total;
  }

  halvesShowing(): (TransferSent | TransferArrived)[] {
    return [...this.#halfway.values()];
  }

  // A card swipe the bank holds as pending until it posts (4.6).
  authorize(date: IsoDate, account: ChargeAccount, amount: Cents, description: string): Purchase {
    const txn: Purchase = { kind: 'purchase', id: this.#id('p'), account, date, amount, description, pending: true };
    this.#pending.set(txn.id, txn);
    return this.#add(txn);
  }

  // The posted version of a pending charge: a new id, and maybe a new amount.
  post(pendingId: string, date: IsoDate, amount: Cents): Purchase {
    const hold = this.#pending.get(pendingId);
    if (hold === undefined) throw new Error(`the bank has no pending charge ${pendingId}`);
    this.#pending.delete(pendingId);
    this.#owe(hold.account, amount);
    return this.#add({ kind: 'purchase', id: this.#id('p'), account: hold.account, date, amount, description: hold.description, pending: false, pendingId });
  }

  // The bank drops a pending charge without posting it, such as a gas pump
  // hold that falls off (QUESTIONS.md A2).
  drop(pendingId: string, date: IsoDate): PendingDropped {
    if (!this.#pending.delete(pendingId)) throw new Error(`the bank has no pending charge ${pendingId}`);
    return this.#add({ kind: 'pending-dropped', id: this.#id('x'), pendingId, date, description: 'HOLD RELEASED' });
  }

  // A charge that posts straight away, with no pending stage.
  purchase(date: IsoDate, account: ChargeAccount, amount: Cents, description: string): Purchase {
    this.#owe(account, amount);
    return this.#add({ kind: 'purchase', id: this.#id('p'), account, date, amount, description, pending: false });
  }

  refund(date: IsoDate, account: ChargeAccount, amount: Cents, description: string, refundOf?: string): Refund {
    this.#owe(account, -amount);
    return this.#add({ kind: 'refund', id: this.#id('r'), account, date, amount, description, ...(refundOf === undefined ? {} : { refundOf }) });
  }

  deposit(date: IsoDate, account: OwnAccount, amount: Cents, description: string): Deposit {
    this.posted[account] += amount;
    return this.#add({ kind: 'deposit', id: this.#id('d'), account, date, amount, description });
  }

  // Money sent to a person from checking (Zelle and the like).
  payPerson(date: IsoDate, amount: Cents, payee: string): PersonPayment {
    this.posted.checking -= amount;
    return this.#add({ kind: 'payment-to-person', id: this.#id('z'), account: 'checking', date, amount, description: `ZELLE TO ${payee}` });
  }

  cardCharge(date: IsoDate, card: Card, charge: 'fee' | 'interest', amount: Cents): CardCharge {
    this.#owe(card, amount);
    const description = charge === 'fee' ? 'LATE FEE' : 'INTEREST CHARGE';
    return this.#add({ kind: 'card-charge', id: this.#id('c'), account: card, date, amount, description, charge });
  }

  // A transfer that leaves and lands the same day.
  transfer(date: IsoDate, from: OwnAccount, to: Destination, amount: Cents): Transfer {
    this.posted[from] -= amount;
    this.#land(to, amount);
    return this.#add({ kind: 'transfer', id: this.#id('t'), from, to, date, amount, description: `TRANSFER ${from} TO ${to}` });
  }

  // The first half of a transfer: the money leaves now and lands later.
  send(date: IsoDate, from: OwnAccount, to: Destination, amount: Cents): TransferSent {
    this.posted[from] -= amount;
    const txn: TransferSent = { kind: 'transfer-sent', id: this.#id('t'), from, to, date, amount, description: `PAYMENT FROM ${from} TO ${to}` };
    this.#halfway.set(txn.id, txn);
    return this.#add(txn);
  }

  // The second half. The bank names the half that left only sometimes.
  land(date: IsoDate, sent: TransferSent, linked: boolean): TransferArrived {
    if (!this.#halfway.delete(sent.id)) throw new Error(`the bank has no transfer ${sent.id} on its way`);
    this.#land(sent.to, sent.amount);
    const { from, to, amount } = sent;
    return this.#add({ kind: 'transfer-arrived', id: this.#id('t'), from, to, date, amount, description: `PAYMENT RECEIVED FROM ${from}`, ...(linked ? { sentId: sent.id } : {}) });
  }

  // A transfer that shows landing before it shows leaving.
  landFirst(date: IsoDate, from: OwnAccount, to: Destination, amount: Cents): TransferArrived {
    this.#land(to, amount);
    const txn: TransferArrived = { kind: 'transfer-arrived', id: this.#id('t'), from, to, date, amount, description: `PAYMENT RECEIVED FROM ${from}` };
    this.#halfway.set(txn.id, txn);
    return this.#add(txn);
  }

  sendAfter(date: IsoDate, landed: TransferArrived): TransferSent {
    if (!this.#halfway.delete(landed.id)) throw new Error(`the bank has no transfer ${landed.id} waiting to show leaving`);
    this.posted[landed.from] -= landed.amount;
    const { from, to, amount } = landed;
    return this.#add({ kind: 'transfer-sent', id: this.#id('t'), from, to, date, amount, description: `PAYMENT FROM ${from} TO ${to}` });
  }

  // The statement on a card's closing day. Charges still pending are not on
  // it. The minimum is 2% rounded up to the dollar, at least $35, and never
  // more than what is owed.
  closeStatement(card: Card, date: IsoDate): CardStatement {
    const balance = card === 'everyday-card' ? this.posted.everydayCard : this.posted.oldCard;
    return { card, closingDate: date, dueDate: addDays(date, 25), statementBalance: balance, minimumPayment: minimumFor(balance) };
  }

  // Changes a balance without telling anyone. Only the simulator's own tests
  // use it, to make sure a mismatch is caught and reported.
  changeWithoutTelling(account: keyof Posted, amount: Cents): void {
    this.posted[account] += amount;
  }

  #owe(account: ChargeAccount, amount: Cents): void {
    if (account === 'checking') this.posted.checking -= amount;
    else if (account === 'everyday-card') this.posted.everydayCard += amount;
    else this.posted.oldCard += amount;
  }

  // Money arriving: checking and savings go up, a card owes less.
  #land(account: Destination, amount: Cents): void {
    if (account === 'checking' || account === 'savings') this.posted[account] += amount;
    else this.#owe(account, -amount);
  }

  #id(prefix: string): string {
    return `${prefix}${this.#nextId++}`;
  }

  #add<T extends BankTransaction>(txn: T): T {
    this.feed.push(txn);
    return txn;
  }
}

function minimumFor(balance: Cents): Cents {
  if (balance <= 0) return 0;
  const twoPercentInHundredths = balance * 2;
  const rest = twoPercentInHundredths % 10_000;
  const dollars = (twoPercentInHundredths - rest) / 10_000 + (rest === 0 ? 0 : 1);
  return Math.min(balance, Math.max(3_500, dollars * 100));
}
