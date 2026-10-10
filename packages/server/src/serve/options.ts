import { join } from 'node:path';

// What npm run serve was asked to do:
//   --db <file>   the books (BUDGET_DB too); data/budget.sqlite by default
//   --port N      5190 by default; always on this computer only
//   --connect     connect Plaid's test bank first, with made-up accounts like his
//   --sync        sync with the test bank once before serving (it also syncs by
//                 itself every 60 minutes, and at once if one is due: Step 3)
export interface ServeOptions {
  readonly db: string;
  readonly port: number;
  readonly sync: boolean;
  readonly connect: boolean;
}

export function serveOptions(args: readonly string[], env: Readonly<Record<string, string | undefined>>, root: string): ServeOptions {
  let db = env['BUDGET_DB'] ?? join(root, 'data', 'budget.sqlite');
  let port = 5190;
  let sync = false;
  let connect = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--sync') sync = true;
    else if (arg === '--connect') connect = true;
    else if (arg === '--port') {
      port = Number(args[(i += 1)]);
      if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`--port needs a port number, got ${String(args[i])}`);
    } else if (arg === '--db') {
      const file = args[(i += 1)];
      if (file === undefined || file === '') throw new Error('--db needs a file');
      db = file;
    } else throw new Error(`not an option: ${String(arg)}`);
  }
  if (db === ':memory:') throw new Error('the real server keeps everything in a file, so a restart finds it: --db needs a file');
  return { db, port, sync, connect };
}
