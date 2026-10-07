import type { IsoDate } from '@budget-app/money';
import type { TokenBox } from './crypto/token-box.js';
import type { Db } from './db/database.js';
import { logChange, readConnection, saveNewConnection } from './db/store.js';
import type { Log } from './log.js';
import type { PlaidClient } from './plaid/client.js';

// Connecting to Plaid's test bank, without screens (Phase 3): the test bank
// makes a link key directly, which is swapped for the connection's bank key.
// The bank key is sealed before it is stored, and is never logged. One
// connection only (rulebook section 1).
export interface ConnectInput {
  readonly db: Db;
  readonly plaid: PlaidClient;
  readonly box: TokenBox;
  readonly log: Log;
  readonly today: IsoDate;
  readonly institutionId: string;
  // A test user. user_custom takes a description of the accounts as its password.
  readonly username?: string;
  readonly password?: string;
  readonly daysRequested?: number;
}

export async function connectTestBank(input: ConnectInput): Promise<{ readonly itemId: string }> {
  const { db, plaid, box, log } = input;
  if (readConnection(db) !== null) throw new Error('there is already a bank connection, and there is only ever one');
  const publicToken = await plaid.createSandboxPublicToken({
    institutionId: input.institutionId,
    products: ['transactions', 'liabilities'],
    ...(input.username === undefined ? {} : { username: input.username }),
    ...(input.password === undefined ? {} : { password: input.password }),
    ...(input.daysRequested === undefined ? {} : { daysRequested: input.daysRequested }),
  });
  const { key, itemId } = await plaid.exchangePublicToken(publicToken);
  db.transaction(() => {
    saveNewConnection(db, { itemId, institutionId: input.institutionId, sealedKey: box.seal(key.reveal(), itemId), connectedOn: input.today });
    logChange(db, input.today, 'connected to the test bank', { itemId, institutionId: input.institutionId });
  })();
  log.info('connected to the test bank', { itemId });
  return { itemId };
}
