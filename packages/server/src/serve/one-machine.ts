import { promises as dns } from 'node:dns';

// Phase 6: only ever one machine. The books are one SQLite file on one
// volume, which two machines cannot share, and two copies of the server
// would each keep their own books and copy them to the same backup. fly.toml
// asks for one machine and has nothing that adds more; this is the second
// guard: before anything starts, the server asks Fly's private DNS which
// machines the app has started (vms.<app>.internal), and with more than one
// it does not start (and nothing is restored or copied).
//
// Off Fly (no FLY_APP_NAME) there is nothing to ask. If the DNS cannot be
// asked, it starts, and says so in its log: the one machine must not stay
// down because Fly's DNS was slow.

export type ResolveTxt = (name: string) => Promise<string[][]>;

export interface MachinesFound {
  // Why it must not start, or null.
  readonly problem: string | null;
  // A note for the log when it could not ask.
  readonly note: string | null;
}

// Fly's answer lists "<machine id> <region>" pairs, separated by commas.
export function machinesIn(records: readonly (readonly string[])[]): string[] {
  return records
    .map((chunks) => chunks.join(''))
    .join(',')
    .split(',')
    .map((pair) => pair.trim().split(/\s+/)[0] ?? '')
    .filter((id) => id !== '');
}

export async function checkOneMachine(env: Readonly<Record<string, string | undefined>>, resolveTxt: ResolveTxt = (name) => dns.resolveTxt(name)): Promise<MachinesFound> {
  const app = env['FLY_APP_NAME'];
  if (app === undefined || app === '') return { problem: null, note: null };
  let machines: string[];
  try {
    machines = machinesIn(await resolveTxt(`vms.${app}.internal`));
  } catch (error) {
    return { problem: null, note: `could not ask Fly which machines the app has (${error instanceof Error ? error.message : String(error)}); starting` };
  }
  if (machines.length <= 1) return { problem: null, note: null };
  return {
    problem: `this app has ${machines.length} machines (${machines.join(', ')}), and only one may run: the books are one SQLite file on one volume. Nothing was started here. See them with fly machine list, and remove the one made by mistake with fly machine destroy <its id> (the books are on the older one's volume, and in the backup).`,
    note: null,
  };
}
