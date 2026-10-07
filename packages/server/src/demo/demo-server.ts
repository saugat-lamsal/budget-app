import type { IncomingMessage, Server } from 'node:http';
import { createAppServer, send } from '../http/server.js';
import { homeView } from '../views/home.js';
import { DEMO_SCENARIOS, demoScenario, type DemoScenario } from './scenarios.js';

// The screens on made-up data only (Phase 4). /demo lists the made-up
// lives; picking one remembers it in a cookie and opens Home. Nothing here
// reads the database or talks to the bank, so it is safe to open over wifi.

export function createDemoServer(options: { readonly webRoot: string; readonly onError?: (error: unknown) => void }): Server {
  // The take-backs marked seen in each made-up life, kept only while the
  // demo runs. Picking the life again starts it over.
  const seenIn = new Map<string, Set<string>>();
  const seenOf = (scenario: DemoScenario): Set<string> => {
    let seen = seenIn.get(scenario.name);
    if (seen === undefined) seenIn.set(scenario.name, (seen = new Set()));
    return seen;
  };
  return createAppServer({
    webRoot: options.webRoot,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    home: async (request) => {
      const scenario = scenarioOf(request);
      if (scenario.delayMs !== undefined) await new Promise((done) => setTimeout(done, scenario.delayMs));
      if (scenario.input === null) throw new Error('made-up failure, for the demo');
      return homeView({ ...scenario.input(), seenTakeBacks: seenOf(scenario) });
    },
    seen: (request, what) => {
      const scenario = scenarioOf(request);
      const book = scenario.input?.().book ?? null;
      const known = book?.changeLog().some((entry) => entry.kind === 'bank-took-back' && entry.id === what.id) ?? false;
      if (known) seenOf(scenario).add(what.id);
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
      seenIn.delete(picked);
      response.setHeader('Set-Cookie', `demo=${picked}; Path=/; HttpOnly; SameSite=Strict`);
      response.setHeader('Location', '/home');
      send(response, 303, 'text/plain; charset=utf-8', 'Opening Home.', 'no-store');
      return true;
    },
  });
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
