import type { IncomingMessage, Server } from 'node:http';
import { ChoiceDesk } from '../choices.js';
import { createAppServer, send } from '../http/server.js';
import { activityView } from '../views/activity.js';
import { bucketsView } from '../views/buckets.js';
import { homeView, type HomeInput } from '../views/home.js';
import { paydayView } from '../views/payday.js';
import { reviewView } from '../views/review.js';
import { DEMO_SCENARIOS, demoScenario, type DemoScenario } from './scenarios.js';

// The screens on made-up data only (Phase 4). /demo lists the made-up
// lives; picking one remembers it in a cookie and opens Home. Nothing here
// reads the database or talks to the bank, so it is safe to open over wifi.

export function createDemoServer(options: { readonly webRoot: string; readonly onError?: (error: unknown) => void }): Server {
  // Each made-up life is lived once, in memory, while the demo runs: the
  // take-backs marked seen, and every choice made in Review, stay as they
  // are. Picking the life again starts it over.
  const lives = new Map<string, Live>();
  const liveOf = (scenario: DemoScenario): Live => {
    let live = lives.get(scenario.name);
    if (live === undefined) {
      if (scenario.input === null) throw new Error('made-up failure, for the demo');
      const input = scenario.input();
      lives.set(scenario.name, (live = { input, seen: new Set(), desk: input.book === null ? null : new ChoiceDesk(input.book, () => input.today) }));
    }
    return live;
  };
  // Slow lives take their time before any screen's numbers arrive.
  const wait = async (scenario: DemoScenario): Promise<Live> => {
    if (scenario.delayMs !== undefined) await new Promise((done) => setTimeout(done, scenario.delayMs));
    return liveOf(scenario);
  };
  return createAppServer({
    webRoot: options.webRoot,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    home: async (request) => {
      const live = await wait(scenarioOf(request));
      return homeView({ ...live.input, seenTakeBacks: live.seen });
    },
    buckets: async (request) => {
      const { input } = await wait(scenarioOf(request));
      return bucketsView({ today: input.today, book: input.book, bank: input.bank, madeUpData: input.madeUpData });
    },
    review: async (request) => {
      const { input } = await wait(scenarioOf(request));
      return reviewView({ today: input.today, book: input.book, madeUpData: input.madeUpData });
    },
    choice: (request, choice) => {
      const { desk } = liveOf(scenarioOf(request));
      // Before setup day there is nothing in review to choose from.
      if (desk === null) return { ok: false, code: 'not-waiting', why: 'That one was already dealt with. Nothing was changed.' };
      return desk.decide(choice);
    },
    move: (request, move) => {
      const { desk } = liveOf(scenarioOf(request));
      // Before setup day there are no buckets to move money between.
      if (desk === null) return { ok: false, code: 'refused', why: 'There is nothing to move yet. Nothing was changed.' };
      return desk.move(move);
    },
    activity: async (request, pot) => {
      const { input } = await wait(scenarioOf(request));
      return activityView({ today: input.today, book: input.book, pot, madeUpData: input.madeUpData });
    },
    payday: async (request) => {
      const { input } = await wait(scenarioOf(request));
      return paydayView({ today: input.today, book: input.book, bank: input.bank, madeUpData: input.madeUpData });
    },
    seen: (request, what) => {
      const live = liveOf(scenarioOf(request));
      const known = live.input.book?.changeLog().some((entry) => entry.kind === 'bank-took-back' && entry.id === what.id) ?? false;
      if (known) live.seen.add(what.id);
      return known;
    },
    extra: (request, response, path) => {
      if (path === '/demo' || path === '/demo/') {
        send(response, 200, 'text/html; charset=utf-8', demoPage(scenarioOf(request)), 'no-store');
        return true;
      }
      if (path === '/demo/demo.css') {
        send(response, 200, 'text/css; charset=utf-8', DEMO_CSS, 'no-store');
        return true;
      }
      const picked = /^\/demo\/([a-z-]+)$/.exec(path)?.[1];
      if (picked === undefined) return false;
      if (demoScenario(picked) === undefined) {
        send(response, 404, 'text/plain; charset=utf-8', 'No such made-up life.', 'no-store');
        return true;
      }
      lives.delete(picked);
      response.setHeader('Set-Cookie', `demo=${picked}; Path=/; HttpOnly; SameSite=Strict`);
      response.setHeader('Location', '/home');
      send(response, 303, 'text/plain; charset=utf-8', 'Opening Home.', 'no-store');
      return true;
    },
  });
}

// One made-up life while the demo runs: its book, the take-backs seen, and
// the desk that takes his choices.
interface Live {
  readonly input: HomeInput;
  readonly seen: Set<string>;
  readonly desk: ChoiceDesk | null;
}

// Where the demo listens: this computer only, unless --wifi.
export function demoAddress(args: readonly string[]): { readonly host: string; readonly port: number; readonly wifi: boolean } {
  const wifi = args.includes('--wifi');
  const portAt = args.indexOf('--port');
  const port = portAt === -1 ? 5180 : Number(args[portAt + 1]);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`--port needs a port number, got ${String(args[portAt + 1])}`);
  return { host: wifi ? '0.0.0.0' : '127.0.0.1', port, wifi };
}

function scenarioOf(request: IncomingMessage): DemoScenario {
  const cookie = request.headers.cookie ?? '';
  const name = /(?:^|;\s*)demo=([a-z-]+)/.exec(cookie)?.[1] ?? 'normal';
  return demoScenario(name) ?? (DEMO_SCENARIOS[0] as DemoScenario);
}

function demoPage(current: DemoScenario): string {
  const items = DEMO_SCENARIOS.map(
    (s) => `<li><a href="/demo/${s.name}"${s === current ? ' aria-current="true"' : ''}>${s.title}</a></li>`,
  ).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Made-up lives</title>
<link rel="stylesheet" href="/demo/demo.css">
</head>
<body>
<h1>Made-up lives</h1>
<p>Every number here is invented. Pick one to open Home with it. Come back to <b>/demo</b> to switch.</p>
<ul>
${items}
</ul>
</body>
</html>`;
}

const DEMO_CSS = `
:root { color-scheme: light dark; font-family: system-ui, -apple-system, sans-serif; }
body { margin: 0 auto; max-width: 36rem; padding: max(16px, env(safe-area-inset-top)) 16px 32px; line-height: 1.4; }
ul { list-style: none; padding: 0; }
a { display: flex; align-items: center; min-height: 44px; padding: 4px 0; }
a[aria-current] { font-weight: 700; }
a[aria-current]::after { content: " (showing)"; font-weight: 400; }
`;
