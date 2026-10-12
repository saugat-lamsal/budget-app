// node scripts/build.mjs
//
// Phase 6: builds what the hosted server runs, as the Dockerfile does: the
// screens (packages/web/dist) and the server's commands
// (packages/server/dist/serve). Nothing is started.
import { build } from 'vite';
import { buildServer, path } from './server-build.mjs';

await build({ root: path('packages/web'), logLevel: 'warn' });
await buildServer();
console.log('Built: packages/web/dist and packages/server/dist/serve');
