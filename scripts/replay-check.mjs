// npm run replay-check [-- --db <file>]
//
// QUESTIONS.md A28: when npm run serve does not start because the history no
// longer replays to the totals saved with it, this shows each event whose
// totals would change, before and after, and with your yes takes the new
// totals from that event on. It is logged (13.5). Run it with the server
// stopped. It never talks to the bank.
import { buildServer, runCommand } from './server-build.mjs';

await buildServer();
runCommand('replay-check', process.argv.slice(2));
