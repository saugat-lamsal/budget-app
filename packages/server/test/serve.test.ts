import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serveOptions } from '../src/serve/options.js';
import { connectLikeHis } from '../src/serve/test-bank.js';
import { readAccounts, readConnection } from '../src/db/store.js';
import { openDatabase } from '../src/db/database.js';
import { memoryLog } from '../src/log.js';
import { PlaidClient } from '../src/plaid/client.js';
import { plaidKeysFromEnv } from '../src/plaid/sandbox-lock.js';
import { TokenBox } from '../src/crypto/token-box.js';
import { FakePlaid, fourAccounts } from './fake-plaid.js';
import { POSTED_AT_START, TOKEN_KEY } from './harness.js';

// The real server command (npm run serve): the screens from the database,
// Plaid's test bank only, this computer only, no login yet.

const ROOT = join('C:', 'made-up', 'budget-app');

describe('the real server command', () => {
  it('keeps its books in data/budget.sqlite unless told another file; listens on this computer only (unless hosted, Phase 6: hosted.test.ts)', () => {
    expect(serveOptions([], {}, ROOT)).toEqual({ db: join(ROOT, 'data', 'budget.sqlite'), port: 5190, sync: false, connect: false, connectOnce: false, hosted: null, host: '127.0.0.1' });
    expect(serveOptions(['--db', 'C:/made-up/other.sqlite', '--port', '6000', '--sync'], {}, ROOT)).toEqual({ db: 'C:/made-up/other.sqlite', port: 6000, sync: true, connect: false, connectOnce: false, hosted: null, host: '127.0.0.1' });
    expect(serveOptions(['--connect'], { BUDGET_DB: 'C:/made-up/env.sqlite' }, ROOT)).toMatchObject({ db: 'C:/made-up/env.sqlite', connect: true });
  });

  it.each([
    [['--port', 'abc'], '--port needs a port number'],
    [['--port', '70000'], '--port needs a port number'],
    [['--db'], '--db needs a file'],
    [['--db', ':memory:'], 'the real server keeps everything in a file'],
    [['--wifi'], 'not an option: --wifi'],
  ])('refuses %j', (args, why) => {
    expect(() => serveOptions(args, {}, ROOT)).toThrow(why);
  });

  it('where options say (this computer only unless hosted), through the sandbox lock, with the bank key sealed: what main.ts does', () => {
    const main = readFileSync(new URL('../src/serve/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('server.listen(options.port, options.host,');
    expect(main).toContain('plaidKeysFromEnv(process.env)');
    expect(main).toContain('tokenBoxFromEnv(process.env)');
    expect(main).not.toMatch(/0\.0\.0\.0|--wifi/);
  });

  it('--connect: the test bank with made-up accounts like his, synced until it has sent all of the history, his four accounts set by their last four digits; only once', async () => {
    const fake = new FakePlaid(fourAccounts(POSTED_AT_START));
    const db = openDatabase(':memory:');
    const log = memoryLog([]);
    const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: fake.clientId, PLAID_SECRET: fake.secret }), { fetch: fake.fetch, log });
    const box = new TokenBox(TOKEN_KEY);
    await connectLikeHis({ db, plaid, box, log, today: '2026-10-09', wait: async () => {} });
    expect(readConnection(db)?.historyComplete).toBe(true);
    expect(readAccounts(db).map((a) => [a.raw.mask, a.role]).sort()).toEqual([
      ['1111', 'checking'],
      ['2222', 'savings'],
      ['3333', 'everyday-card'],
      ['4444', 'old-card'],
    ]);
    await expect(connectLikeHis({ db, plaid, box, log, today: '2026-10-09' })).rejects.toThrow('there is only ever one');
    db.close();
  });
});
