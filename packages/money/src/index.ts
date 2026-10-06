// The money math: whole cents only, with no screens, network, database, or
// clock of its own. Callers pass in dates and settings.
export { MoneyError } from './errors.js';
export {
  addCents,
  assertCents,
  formatDollars,
  parseDollars,
  percentOf,
  subtractCents,
  type Cents,
} from './cents.js';
export { addDays, assertIsoDate, daysBetween, monthOf, type IsoDate } from './dates.js';
export {
  DEFAULT_SETTINGS,
  changeSettings,
  matchesTextRule,
  validateSettings,
  type LeftoverChoice,
  type Settings,
  type TextRule,
} from './settings.js';
export { ACCOUNTS, type AccountId } from './accounts.js';
export { splitPaycheck, type PaycheckSplit, type SplitSettings } from './payday.js';
export type { BankTransaction, Deposit } from './transactions.js';
export {
  Book,
  openBook,
  type LeftoverAnswer,
  type OpenBookInput,
  type PaycheckRecord,
  type Period,
  type Pots,
  type Received,
  type ReceiveOutcome,
  type ReviewItem,
  type SavingsTransfer,
  type SplitBucket,
  type StartingPots,
} from './book.js';
