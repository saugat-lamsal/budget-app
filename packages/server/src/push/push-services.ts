// Phase 5, the phone: where the server may send an alert. A phone that turns
// notifications on gives the server an address at its push service (Apple's
// for the iPhone home-screen app); the server sends each alert there,
// encrypted for that phone, and signed with the app's own key (VAPID).
//
// The server never sends to an address a page made up: only to a push
// service's (https, one of the hosts below), checked when a phone turns
// notifications on and again before each send. Under the tests (vitest sets
// VITEST) only this computer, whatever a test asks for, so no test can reach a
// real push service (test/push-only-here.test.ts checks).

// Apple's (*.push.apple.com, as WebKit says to allow), and the ones a browser
// on his computer may use: Chrome's, Firefox's, Edge's.
const PUSH_SERVICE_HOSTS: readonly RegExp[] = [/^([a-z0-9-]+\.)*push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];

// The made-up push service the tests run (test/fake-push-service.ts).
const THIS_COMPUTER = /^127\.0\.0\.1$/;

export type EndpointLock = 'push-services' | 'this-computer';

// What the lock is now: this computer only under the tests.
export function endpointLock(env: Readonly<Record<string, string | undefined>> = process.env): EndpointLock {
  return env['VITEST'] === undefined ? 'push-services' : 'this-computer';
}

// Why an address is not one the server sends to; null when it is.
export function endpointProblem(endpoint: unknown, lock: EndpointLock = endpointLock()): string | null {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) return 'That is not a push service address.';
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return 'That is not a push service address.';
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return 'A push service address starts with https.';
  const host = url.hostname.toLowerCase();
  const allowed = lock === 'this-computer' ? THIS_COMPUTER.test(host) : PUSH_SERVICE_HOSTS.some((h) => h.test(host));
  return allowed ? null : lock === 'this-computer' ? 'Under the tests the server sends to this computer only.' : 'That is not a push service the app sends to.';
}
