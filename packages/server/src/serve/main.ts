import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenBoxFromEnv, type TokenBox } from '../crypto/token-box.js';
import { openDatabase } from '../db/database.js';
import { HistoryDoesNotReplay } from '../history/history-db.js';
import { Keeper } from '../history/keeper.js';
import { consoleLog } from '../log.js';
import { PlaidClient } from '../plaid/client.js';
import { plaidKeysFromEnv, type PlaidKeys } from '../plaid/sandbox-lock.js';
import { serveOptions, type ServeOptions } from './options.js';
import { connectLikeHis } from './test-bank.js';

// npm run serve [-- --connect] [-- --sync] [-- --port N] [-- --db <file>]
// The real server: the screens from the database, through the same desks as
// the demo. Plaid's test bank only (the sandbox lock), this computer only,
// and no login yet. Every answer of his is kept in the database. Before it
// starts, it replays the whole history and checks it against the totals saved
// with each event; if they differ, it does not start, and says at which event.

// The repository's root, from packages/server/src/serve or packages/server/dist/serve.
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const envFile = `${root}.env`;
if (existsSync(envFile)) process.loadEnvFile(envFile);

let started: { options: ServeOptions; keys: PlaidKeys; box: TokenBox };
try {
  // The sandbox lock: anything but Plaid's test bank stops it here.
  started = { options: serveOptions(process.argv.slice(2), process.env, root), keys: plaidKeysFromEnv(process.env), box: tokenBoxFromEnv(process.env) };
} catch (error) {
  console.error(`The server did not start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
const { options, keys, box } = started;
const log = consoleLog([keys.clientId, keys.secret]);

mkdirSync(dirname(options.db), { recursive: true });
const db = openDatabase(options.db);
let keeper: Keeper;
try {
  keeper = Keeper.open({ db, now: () => new Date(), log });
} catch (error) {
  db.close();
  if (error instanceof HistoryDoesNotReplay) {
    console.error(error.message);
    console.error('The server did not start, and nothing was changed.');
    console.error('To see each event whose totals would change, and decide (QUESTIONS.md A28): npm run replay-check');
    process.exit(1);
  }
  throw error;
}

const plaid = new PlaidClient(keys, { log });
if (options.connect) {
  console.log("Connecting Plaid's test bank, with made-up accounts like yours. This takes a minute.");
  await connectLikeHis({ db, plaid, box, log, today: keeper.today() });
  keeper.reload();
}
if (options.sync) {
  const result = await keeper.sync({ plaid, box, log });
  console.log(`Synced with the test bank: ${result.added} new, ${result.modified} changed, ${result.removed} removed.`);
}

const webRoot = process.env['WEB_ROOT'] ?? fileURLToPath(new URL('../../../web/dist/', import.meta.url));
const server = keeper.server(webRoot, (error) => log.error('a request failed', { error: error instanceof Error ? error.message : String(error) }));
server.listen(options.port, '127.0.0.1', () => {
  const address = server.address();
  const at = typeof address === 'object' && address !== null ? address.port : options.port;
  console.log("Budget app: Plaid's test bank only. No login yet, so this computer only.");
  console.log(`  The books: ${options.db}`);
  console.log(`  Open: http://localhost:${at}/home`);
  console.log('Stop it with Ctrl+C.');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
