// For the tests that start the built server as a program of its own: it may
// not reach anything beyond this computer. Loaded first (NODE_OPTIONS
// --import), it makes every fetch to another host fail at once, so the
// server's first start, which connects Plaid's test bank, is refused here
// instead of calling Plaid.
const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return Promise.reject(new Error(`no network in the tests (${url.hostname})`));
  return real(input, init);
};
