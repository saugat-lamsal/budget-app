import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createDemoServer, demoAddress } from './demo-server.js';

// npm run demo [-- --wifi] [-- --port N]
// The screens on made-up data. Only on this computer, unless --wifi: then
// any phone on the same wifi can open it too. Made-up data only, always.

const { host, port, wifi } = demoAddress(process.argv.slice(2));

// From packages/server/src/demo or packages/server/dist/demo, the built
// screens are in packages/web/dist.
const webRoot = process.env['DEMO_WEB_ROOT'] ?? fileURLToPath(new URL('../../../web/dist/', import.meta.url));

const server = createDemoServer({ webRoot, onError: (error) => console.error('demo:', error instanceof Error ? error.message : error) });
server.listen(port, host, () => {
  const address = server.address();
  const at = typeof address === 'object' && address !== null ? address.port : port;
  console.log('Budget app demo: MADE-UP DATA ONLY. No bank, no database.');
  console.log(`  On this computer:  http://localhost:${at}/home`);
  console.log(`  Pick a made-up life: http://localhost:${at}/demo`);
  if (wifi) {
    for (const ip of wifiAddresses()) console.log(`  On your phone (same wifi):  http://${ip}:${at}/home`);
  } else {
    console.log('  To open it on your phone too: npm run demo -- --wifi');
  }
  console.log('Stop it with Ctrl+C.');
});

function wifiAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a !== undefined && a.family === 'IPv4' && !a.internal)
    .map((a) => (a as { address: string }).address);
}
