// npm run restore-check [-- --out <file>]
//
// Phase 6: rebuilds the books from the backup in R2 into a new file and checks
// them (whole, and every event replaying to the totals saved with it). Needs
// the bucket and its key in .env (R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY). Litestream cannot do this on Windows: there, run it
// on the server instead (fly ssh console -C "node /app/serve/restore-check.mjs").
import { installLitestream } from './litestream.mjs';
import { buildServer, runBuilt } from './server-build.mjs';

const bin = process.platform === 'win32' ? 'litestream' : await installLitestream();
await buildServer();
runBuilt('packages/server/dist/serve/restore-check.mjs', process.argv.slice(2), { LITESTREAM_BIN: bin });
