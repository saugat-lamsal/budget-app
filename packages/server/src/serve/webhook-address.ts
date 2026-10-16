import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pointWebhooks } from '../bank-webhook.js';
import { tokenBoxFromEnv } from '../crypto/token-box.js';
import { openDatabase } from '../db/database.js';
import { consoleLog } from '../log.js';
import { PlaidClient } from '../plaid/client.js';
import { plaidKeysFromEnv } from '../plaid/sandbox-lock.js';
import { WEBHOOK_PATH } from '../plaid/webhook.js';
import { serveOptions } from './options.js';

// fly ssh console -C "node /app/serve/webhook-address.mjs"
// Section 2 (QUESTIONS.md A47): points his existing bank connection's
// webhooks at the hosted server's own address (APP_ORIGIN + /plaid/webhook),
// with one /item/webhook/update call: the same connection, nothing new made,
// nothing read. Run once, at his word, after the deploy that brings the
// webhook address. Plaid then sends WEBHOOK_UPDATE_ACKNOWLEDGED to it, which
// the server's log notes ("webhook address confirmed by Plaid"). Hosted
// only: Plaid cannot reach this computer. It prints no key and no secret.

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const envFile = `${root}.env`;
if (existsSync(envFile)) process.loadEnvFile(envFile);

let started: { options: ReturnType<typeof serveOptions>; plaid: PlaidClient; box: ReturnType<typeof tokenBoxFromEnv>; log: ReturnType<typeof consoleLog> };
try {
  const options = serveOptions(process.argv.slice(2), process.env, root);
  const keys = plaidKeysFromEnv(process.env);
  const log = consoleLog([keys.clientId, keys.secret, process.env['BANK_TOKEN_KEY'] ?? '']);
  started = { options, plaid: new PlaidClient(keys, { log }), box: tokenBoxFromEnv(process.env), log };
} catch (error) {
  console.error(`Nothing was changed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
const { options, plaid, box, log } = started;
const db = openDatabase(options.db);
try {
  const address = options.hosted === null ? null : `${options.hosted}${WEBHOOK_PATH}`;
  const answer = await pointWebhooks({ db, plaid, box, address, log });
  if (!answer.ok) {
    console.error(answer.why);
    process.exitCode = 1;
  } else {
    console.log(`Plaid now sends this connection's webhooks to ${answer.address}.`);
    console.log('The same connection: nothing new was made, and nothing was read. Plaid confirms it with WEBHOOK_UPDATE_ACKNOWLEDGED in the server\'s log.');
  }
} finally {
  db.close();
}
