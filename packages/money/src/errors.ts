// Every refusal from the money math is a MoneyError with a short code, so
// callers and tests can tell refusals apart without reading the message.
export class MoneyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}
