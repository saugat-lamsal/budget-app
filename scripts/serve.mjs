// npm run serve [-- --connect] [-- --sync] [-- --port N] [-- --db <file>]
//
// Builds the screens and the real server, then starts it: the screens from
// the database (data/budget.sqlite unless --db says another file). Plaid's test
// bank only, this computer only, a passkey login (with no passkey yet it
// prints a one-time code to make the first). It needs PLAID_ENV=sandbox,
// PLAID_CLIENT_ID, PLAID_SECRET and BANK_TOKEN_KEY in .env.
//   --connect   connects the test bank first, with made-up accounts like his
//   --sync      syncs with the test bank once before serving
// It syncs by itself every 60 minutes (a setting on Settings), and at once
// when it starts if one is due.
// The demo (npm run demo) is separate and never opens the database.
import { build } from 'vite';
import { buildServer, path, runCommand } from './server-build.mjs';

await build({ root: path('packages/web'), logLevel: 'warn' });
await buildServer();
runCommand('serve', process.argv.slice(2));
