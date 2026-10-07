import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Builds the screens once per test run, the same way npm run demo does, so
// the browser tests use what would ship.
export default async function buildOnce(): Promise<void> {
  await build({ root: fileURLToPath(new URL('../../', import.meta.url)), logLevel: 'error' });
}
