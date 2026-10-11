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
import { logSender } from './alert-timer.js';
import { serveBooks } from './serving.js';
import { connectLikeHis } from './test-bank.js';

// npm run serve [-- --connect] [-- --sync] [-- --port N] [-- --db <file>]
// The real server: the screens from the database, through the same desks as
// the demo. Plaid's test bank only (the sandbox lock), this computer only.
// Every screen needs a passkey login (Step 2); with no passkey yet, it prints
// a one-time code here, in its own window, to make the first one. It syncs
// with the test bank by itself every 60 minutes (a setting, section 2), and at
// once when it starts if one is due (Step 3). Every answer of his is kept in
// the database. Before it starts, it replays the
// whole history and checks it against the totals saved with each event; if
// they differ, it does not start, and says at which event (0.6, A28).

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
// The app's own address: passkeys are made for its host name, localhost.
let origin = `http://localhost:${options.port}`;
const log = consoleLog([keys.clientId, keys.secret]);

mkdirSync(dirname(options.db), { recursive: true });
const db = openDatabase(options.db);
let keeper: Keeper;
try {
  keeper = Keeper.open({ db, now: () => new Date(), log, origin: () => origin });
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
// The screens, and (Step 3) the timer that syncs by itself, every interval
// (section 2), and at once if one is due.
const webRoot = process.env['WEB_ROOT'] ?? fileURLToPath(new URL('../../../web/dist/', import.meta.url));
const { server, timer, alerts } = serveBooks({
  keeper,
  bank: { plaid, box, log },
  clock: { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
  webRoot,
  origin: () => origin,
  onError: (error) => log.error('a request failed', { error: error instanceof Error ? error.message : String(error) }),
  // Phase 5: no phone yet; each alert is written here, in this window.
  sender: logSender(log),
});
server.listen(options.port, '127.0.0.1', () => {
  const address = server.address();
  const at = typeof address === 'object' && address !== null ? address.port : options.port;
  origin = `http://localhost:${at}`;
  console.log("Budget app: Plaid's test bank only, this computer only.");
  console.log(`  The books: ${options.db}`);
  console.log(`  Open: ${origin}/home`);
  if (!keeper.hasPasskeys()) {
    console.log('');
    console.log('  No passkey yet. To make your first one, open the address above and type this one-time code:');
    console.log(`    ${keeper.loginCode()}`);
    console.log('  Good once, for 15 minutes. npm run login-code prints a new one.');
  }
  console.log(`  It syncs with the test bank by itself every ${keeper.syncEveryMinutes()} minutes (a setting).`);
  console.log('  Alerts are worked out and written here, in this window, until the phone gets them.');
  console.log('Stop it with Ctrl+C.');
  alerts.start();
  timer.start();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    // A sync on its way saves all or nothing; it is let finish first.
    void Promise.all([timer.stop(), alerts.stop()]).finally(() => {
      db.close();
      process.exit(0);
    });
  });
}
