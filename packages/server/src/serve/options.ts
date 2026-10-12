import { join } from 'node:path';

// What npm run serve was asked to do:
//   --db <file>      the books (BUDGET_DB too); data/budget.sqlite by default
//   --port N         5190 by default (hosted: PORT, 8080)
//   --connect        connect Plaid's test bank first, with made-up accounts like his
//   --connect-once   the same, only if no bank is connected yet (hosted, Phase 6:
//                    the first start connects the test bank; every later one
//                    finds it connected)
//   --sync           sync with the test bank once before serving (it also syncs by
//                    itself every 60 minutes, and at once if one is due: Step 3)
// Phase 6, hosted: APP_ORIGIN, the app's https address (in fly.toml), makes
// it the hosted server: that address is the only one it answers to, and it
// listens on every address of its machine for Fly's proxy, which takes the
// https. Without APP_ORIGIN it is this computer only, as before.
export interface ServeOptions {
  readonly db: string;
  readonly port: number;
  readonly sync: boolean;
  readonly connect: boolean;
  readonly connectOnce: boolean;
  // The app's own https address when hosted; null on this computer.
  readonly hosted: string | null;
  // Where it listens: this computer only, or (hosted) every address of its machine.
  readonly host: '127.0.0.1' | '0.0.0.0';
}

// The app's https address (APP_ORIGIN), checked: https, a host name, and nothing after it.
export function hostedOrigin(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null;
  const why = 'APP_ORIGIN must be the app\'s own https address and nothing more, such as https://budget-app-x7q2.fly.dev';
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(why);
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '' || url.origin !== value.trim()) throw new Error(why);
  return url.origin;
}

export function serveOptions(args: readonly string[], env: Readonly<Record<string, string | undefined>>, root: string): ServeOptions {
  const hosted = hostedOrigin(env['APP_ORIGIN']);
  let db = env['BUDGET_DB'] ?? join(root, 'data', 'budget.sqlite');
  let port = hosted === null ? 5190 : portOf(env['PORT'] ?? '8080', 'PORT');
  let sync = false;
  let connect = false;
  let connectOnce = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--sync') sync = true;
    else if (arg === '--connect') connect = true;
    else if (arg === '--connect-once') connectOnce = true;
    else if (arg === '--port') port = portOf(args[(i += 1)], '--port');
    else if (arg === '--db') {
      const file = args[(i += 1)];
      if (file === undefined || file === '') throw new Error('--db needs a file');
      db = file;
    } else throw new Error(`not an option: ${String(arg)}`);
  }
  if (db === ':memory:') throw new Error('the real server keeps everything in a file, so a restart finds it: --db needs a file');
  if (connect && connectOnce) throw new Error('--connect and --connect-once: one or the other');
  return { db, port, sync, connect, connectOnce, hosted, host: hosted === null ? '127.0.0.1' : '0.0.0.0' };
}

function portOf(value: string | undefined, name: string): number {
  const port = Number(value);
  if (value === undefined || value === '' || !Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`${name} needs a port number, got ${String(value)}`);
  return port;
}
