import { describe, expect, it } from 'vitest';
import { pointWebhooks } from '../src/bank-webhook.js';
import { connectTestBank } from '../src/connect.js';
import { TokenBox, newTokenKey } from '../src/crypto/token-box.js';
import { openDatabase } from '../src/db/database.js';
import { readConnection } from '../src/db/store.js';
import { memoryLog, type LogLine } from '../src/log.js';
import { PlaidClient } from '../src/plaid/client.js';
import { plaidKeySource } from '../src/plaid/webhook.js';
import { fact, liveKeys, todayUtc } from './test-bank.js';

// Section 2 (QUESTIONS.md A47), against Plaid's real test bank: what Plaid
// itself answers for the two calls the app makes for webhooks. Plaid cannot
// reach this computer, so no webhook comes here; the address used is under
// .example, a name kept for examples that reaches no one.

const MADE_UP_ADDRESS = 'https://budget-app-made-up.example/plaid/webhook';

describe('section 2 A47 Plaid\'s test bank and webhooks', () => {
  it('section 2 A47 a key id Plaid never made is "not found" (Plaid\'s INVALID_INPUT), not "Plaid out of reach"', async () => {
    const lines: LogLine[] = [];
    const plaid = new PlaidClient(liveKeys(), { log: memoryLog(lines) });
    expect(await plaidKeySource(plaid).fetch('made-up-key-id-0000')).toEqual({ found: false });
    fact(`unknown key id: ${JSON.stringify(lines.find((l) => l.event === 'plaid error')?.fields ?? {})}`);
  });

  it('section 2 A47 a test-bank connection pointed at an address: Plaid takes it and names the same connection', async () => {
    const lines: LogLine[] = [];
    const log = memoryLog(lines);
    const plaid = new PlaidClient(liveKeys(), { log });
    const db = openDatabase(':memory:');
    const box = new TokenBox(newTokenKey());
    await connectTestBank({ db, plaid, box, log, today: todayUtc(), institutionId: 'ins_109508' });
    const answer = await pointWebhooks({ db, plaid, box, address: MADE_UP_ADDRESS, log });
    expect(answer).toEqual({ ok: true, address: MADE_UP_ADDRESS, itemId: readConnection(db)?.itemId });
    fact('the webhook address was taken for the same test-bank connection');
    db.close();
  });
});
