// npm run serve [-- --connect] [-- --sync] [-- --port N] [-- --db <file>]
//
// Builds the screens and the real server, then starts it: the screens from
// the database (data/budget.sqlite unless --db says another file). Plaid's test
// bank only, this computer only, no login yet. It needs PLAID_ENV=sandbox,
// PLAID_CLIENT_ID, PLAID_SECRET and BANK_TOKEN_KEY in .env.
//   --connect   connects the test bank first, with made-up accounts like his
//   --sync      syncs with the test bank once before serving
// The demo (npm run demo) is separate and never opens the database.
import { build } from 'vite';
import { buildServer, path, runCommand } from './server-build.mjs';

await build({ root: path('packages/web'), logLevel: 'warn' });
await buildServer();
runCommand('serve', process.argv.slice(2));
