import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { endpointLock, endpointProblem } from '../packages/server/src/push/push-services.js';

// Phase 5, the phone: no test can reach a real push service. The sender sends
// only to an address the lock allows (packages/server/src/push/push-services.ts),
// checked before each push; under the tests (vitest sets VITEST) the lock
// allows this computer only, whatever a test asks for. And the push services'
// names are written in one place only. The words looked for are put together
// from parts, so this file does not trip over itself.
const repoRoot = new URL('..', import.meta.url);

function projectFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  return out
    .split('\0')
    .filter((path) => path !== '' && existsSync(new URL(path, repoRoot)))
    .filter((path) => !/\.(png|jpe?g|gif|ico|sqlite|db)$/i.test(path));
}

const join = (...parts: string[]): string => parts.join('');
const PUSH_HOSTS = new RegExp(join('push', '\\.apple\\.com|fcm', '\\.googleapis\\.com|push', '\\.services\\.mozilla\\.com|notify', '\\.windows\\.com'), 'i');
const LOCK = 'packages/server/src/push/push-services.ts';

describe('safety: no test reaches a real push service', () => {
  it('safety: under the tests the lock allows this computer only', () => {
    expect(process.env['VITEST']).toBeDefined();
    expect(endpointLock()).toBe('this-computer');
    for (const host of [join('web.push', '.apple.com'), join('api.push', '.apple.com'), join('fcm', '.googleapis.com'), join('updates.push', '.services.mozilla.com'), join('wns2-par02p.notify', '.windows.com')]) {
      expect(endpointProblem(`https://${host}/made-up`), host).toBe('Under the tests the server sends to this computer only.');
    }
    expect(endpointProblem('https://127.0.0.1:5555/push/phone-1')).toBeNull();
  });

  it("safety: the push services' addresses are named in the lock only, and in the tests of it", () => {
    const allowed = new Set([LOCK, 'packages/server/test/push.test.ts', 'packages/web/test/notifications-text.test.ts']);
    const found = projectFiles().filter((path) => !allowed.has(path) && PUSH_HOSTS.test(readFileSync(new URL(path, repoRoot), 'utf8')));
    // Docs may say where a phone's alerts go; no code or test may.
    expect(found.filter((path) => /\.(ts|tsx|mjs|js|json|ya?ml)$/.test(path))).toEqual([]);
  });

  it('safety: the sender checks the lock before each push, and nothing else in the server sends one', () => {
    const sender = readFileSync(new URL('packages/server/src/push/push-sender.ts', repoRoot), 'utf8');
    expect(sender).toMatch(/const problem = endpointProblem\(s\.endpoint\);\s*if \(problem !== null\) return/);
    const sends = projectFiles().filter((path) => path.startsWith('packages/') && /\.(ts|tsx)$/.test(path) && /\bsendNotification\(/.test(readFileSync(new URL(path, repoRoot), 'utf8')));
    expect(sends).toEqual(['packages/server/src/push/push-sender.ts']);
  });
});
