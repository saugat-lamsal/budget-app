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
export type {
  BankTransaction,
  CardCharge,
  Deposit,
  PendingDropped,
  PersonPayment,
  Purchase,
  Refund,
  Transfer,
  TransferArrived,
  TransferSent,
} from './transactions.js';
export { BUCKETS, SPENDING_BUCKETS, type Bucket, type SplitBucket } from './buckets.js';
export type { DepositRuleChoice, MoneyInChoice, PersonPaymentChoice, SortingRule } from './rules.js';
export {
  Book,
  openBook,
  type ChangeLogEntry,
  type LeftoverAnswer,
  type MomMonth,
  type MoneyMove,
  type MoveResult,
  type MoneyInReason,
  type OpenBookInput,
  type OthersMoney,
  type PaycheckRecord,
  type Pot,
  type Period,
  type Pots,
  type PurchaseView,
  type Received,
  type ReceiveOutcome,
  type ReviewItem,
  type CheckedSafeToSpend,
  type ConfirmReason,
  type InTransit,
  type InTransitItem,
  type SafeToSpend,
  type SavingsTransfer,
  type SelfCheck,
  type SortChoice,
  type SpendingKind,
  type SpendingSort,
  type SplitPart,
  type StartingPots,
} from './book.js';
export {
  cardNotices,
  payoffCountdown,
  type CardNotice,
  type CardPayment,
  type CardStatement,
  type PayoffCountdown,
} from './reminders.js';
export type { Alert, AlertInput } from './alerts.js';
export { bankSide, withPendingCharges, type BankBalances, type PendingCharge } from './self-check.js';
export { startTracking, startingMoney, type SetupInput, type SetupResult } from './setup.js';
