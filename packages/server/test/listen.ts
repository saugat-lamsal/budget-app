import type { AddressInfo, Server } from 'node:net';

// Browsers and Node's fetch refuse to open some ports: the fetch standard's
// "bad ports" (3659, 4045, 5060, 6000, 6566, 6665 to 6669, 6679, ...), all at
// or below 10080, which Chromium's and WebKit's lists end at too. This PC
// hands out ports from 1024 up, one after another, and gave test servers such
// ports: 3659 to a browser test on Oct 9 (net::ERR_UNSAFE_PORT), and one to a
// server test on Nov 4 ("fetch failed", caused by "bad port"). The CI
// machines start at 32768 (Linux) and 49152 (Windows).
export const HIGHEST_REFUSED_PORT = 10_080;

// Listens on 127.0.0.1, on the port asked for (0: one the system picks); a
// server given a port at or below the list's end listens again on another.
// Returns the port it listens on.
export async function listenLocally(server: Server, port = 0): Promise<number> {
  await listenAt(server, port);
  while ((server.address() as AddressInfo).port <= HIGHEST_REFUSED_PORT) {
    await new Promise<void>((done) => server.close(() => done()));
    await listenAt(server, 0);
  }
  return (server.address() as AddressInfo).port;
}

function listenAt(server: Server, port: number): Promise<void> {
  return new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', fail);
      done();
    });
  });
}
