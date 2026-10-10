// npm run login-code [-- --db <file>] [-- --port N]
//
// Step 2: prints a new one-time code for making a passkey, for when you have
// lost all your passkeys (npm run serve prints one by itself when there is
// none yet). Good once, for 15 minutes; any older code stops working. Only on
// this computer: it opens the books' file directly.
import { buildServer, runCommand } from './server-build.mjs';

await buildServer();
runCommand('login-code', process.argv.slice(2));
