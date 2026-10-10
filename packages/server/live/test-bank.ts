import { existsSync, writeFileSync } from 'node:fs';
import type { IsoDate } from '@budget-app/money';
import { connectTestBank } from '../src/connect.js';
import { TokenBox, newTokenKey } from '../src/crypto/token-box.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { readConnection } from '../src/db/store.js';
import { memoryLog, type LogLine } from '../src/log.js';
import { PlaidClient, type Fetch } from '../src/plaid/client.js';
import { plaidKeysFromEnv, type PlaidKeys } from '../src/plaid/sandbox-lock.js';
import { syncBank, type SyncResult } from '../src/sync/sync.js';

// Helpers for the live tests against Plaid's test bank. The keys come from
// .env and are never printed. Each run makes its own test-bank connections,
// with a database that lives only in memory and a throwaway sealing key.

const envFile = new URL('../../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

export function liveKeys(): PlaidKeys {
  return plaidKeysFromEnv(process.env);
}

// What the test bank showed, printed so a person can read it. Only made-up
// test-bank data: amounts, dates, and flags.
export function fact(text: string): void {
  console.log(`  test bank: ${text}`);
}

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function todayUtc(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}

// Saves what the test bank answered, for reading later and for saved test
// data: only reads, never the calls that hand out keys. LIVE_RECORD names the file.
export interface Recorded {
  readonly endpoint: string;
  readonly cursor: string | null;
  readonly status: number;
  readonly response: unknown;
}

export function recordingFetch(into: Recorded[]): Fetch {
  return async (url, init) => {
    const response = await fetch(url, init);
    const text = await response.text();
    const endpoint = url.replace('https://sandbox.plaid.com', '');
    if (!endpoint.includes('public_token')) {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      into.push({ endpoint, cursor: typeof body['cursor'] === 'string' ? body['cursor'] : null, status: response.status, response: JSON.parse(text) as unknown });
    }
    return { ok: response.ok, status: response.status, text: async () => text };
  };
}

export function saveRecording(name: string, recorded: readonly Recorded[]): void {
  const path = process.env['LIVE_RECORD'];
  if (path === undefined || path === '') return;
  writeFileSync(`${path}-${name}.json`, `${JSON.stringify(recorded, null, 1)}\n`);
}

export interface LiveBank {
  readonly db: Db;
  readonly plaid: PlaidClient;
  readonly box: TokenBox;
  readonly lines: LogLine[];
  readonly recorded: Recorded[];
  readonly keys: PlaidKeys;
  sync(today: IsoDate): Promise<SyncResult>;
}

export async function connectLive(input: { username: string; password: string; today: IsoDate; daysRequested?: number }): Promise<LiveBank> {
  const keys = liveKeys();
  const lines: LogLine[] = [];
  const log = memoryLog(lines, [keys.clientId, keys.secret]);
  const recorded: Recorded[] = [];
  const plaid = new PlaidClient(keys, { fetch: recordingFetch(recorded), log });
  const box = new TokenBox(newTokenKey());
  const db = openDatabase(':memory:');
  await connectTestBank({
    db,
    plaid,
    box,
    log,
    today: input.today,
    // First Platypus Bank: the test bank Plaid suggests for this.
    institutionId: 'ins_109508',
    username: input.username,
    password: input.password,
    ...(input.daysRequested === undefined ? {} : { daysRequested: input.daysRequested }),
  });
  return { db, plaid, box, lines, recorded, keys, sync: (today) => syncBank({ db, plaid, box, log, today }) };
}

// Syncs until Plaid has sent all of the history.
export async function syncUntilHistory(bank: LiveBank, today: IsoDate): Promise<void> {
  for (let tries = 0; tries < 40; tries += 1) {
    await bank.sync(today);
    if (readConnection(bank.db)?.historyComplete === true) return;
    await wait(3_000);
  }
  throw new Error('the test bank did not finish sending the history in time');
}

// The bank key, opened only to check it never got anywhere it should not.
export function openKey(bank: LiveBank): string {
  const connection = readConnection(bank.db);
  if (connection === null) throw new Error('not connected');
  return bank.box.open(connection.sealedKey, connection.itemId);
}

// A custom test user shaped like his accounts (src/serve/test-bank.ts, which
// the real server's --connect uses too).
export { accountsLikeHis } from '../src/serve/test-bank.js';
