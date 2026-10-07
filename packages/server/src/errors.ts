// Something from the bank that the app cannot use as it is: a field missing
// or of the wrong type, or an amount that is not whole cents (rule 0.1).
export class BankDataError extends Error {
  override readonly name = 'BankDataError';
}
