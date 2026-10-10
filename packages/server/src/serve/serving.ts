import type { Server } from 'node:http';
import type { Keeper, SyncBank } from '../history/keeper.js';
import { SyncTimer, type TimerClock } from './sync-timer.js';

// What npm run serve runs once the books are open (main.ts): the web server
// for the screens, with every screen behind the login, and the timer that
// syncs with the bank by itself (Step 3). The full pay period through the
// screens (packages/web, test/browser/pay-period) runs exactly this, with a
// made-up bank and a clock the test moves.

export interface ServeInput {
  readonly keeper: Keeper;
  // The bank to sync with.
  readonly bank: SyncBank;
  // Real time for npm run serve; a test's clock for the tests.
  readonly clock: TimerClock;
  readonly webRoot: string;
  // The app's own address, as the browser shows it, once it listens.
  readonly origin: () => string;
  readonly onError?: (error: unknown) => void;
}

export interface Serving {
  readonly server: Server;
  // Not started: start it once the server listens.
  readonly timer: SyncTimer;
}

export function serveBooks(input: ServeInput): Serving {
  const { keeper, bank } = input;
  const timer = new SyncTimer({
    syncer: { syncDueIn: () => keeper.syncDueIn(), sync: () => keeper.sync(bank) },
    clock: input.clock,
    log: bank.log,
  });
  const server = keeper.server(input.webRoot, input.origin, input.onError);
  return { server, timer };
}
