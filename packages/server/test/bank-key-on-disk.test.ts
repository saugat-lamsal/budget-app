import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { TokenBox, newTokenKey } from '../src/crypto/token-box.js';
import { readConnection } from '../src/db/store.js';
import { FakeR2 } from './fake-r2.js';
import { TOKEN_KEY } from './harness.js';
import { lifeInAFile, setUpThroughTheDesk, type Life } from './keeper-harness.js';
import { backupOf, copied, replicate } from './litestream-harness.js';

// Phase 6's checklist: the bank key is encrypted on disk. The key the bank
// gives for the connection (Plaid's access token) is kept sealed with
// AES-256-GCM under BANK_TOKEN_KEY (a Fly secret, never on the volume). The
// books' file on the volume, its write-ahead log, and every copy Litestream
// makes in the bucket are searched for it, byte by byte. Every key is made up.

const cleanUp: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const done of cleanUp.splice(0).reverse()) await done();
});

async function connectedLife(): Promise<Life> {
  const life = await lifeInAFile();
  cleanUp.push(() => life.done());
  setUpThroughTheDesk(life);
  await life.sync();
  return life;
}

// The token as it could be written: as text, and in UTF-16 too.
function shapes(token: string): Buffer[] {
  return [Buffer.from(token, 'utf8'), Buffer.from(token, 'utf16le'), Buffer.from(token.slice(8, 32), 'utf8')];
}

describe('Phase 6 the bank key is encrypted on disk', () => {
  it('Phase 6 the books\' file and its write-ahead log never hold the bank connection\'s key, only its sealed form', async () => {
    const life = await connectedLife();
    const token = life.h.fake.accessToken;
    const stored = readConnection(life.h.db);
    if (stored === null) throw new Error('not connected');
    expect(stored.sealedKey).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
    expect(stored.sealedKey).not.toContain(token);
    const files = [life.path, `${life.path}-wal`].filter((f) => existsSync(f));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const bytes = readFileSync(file);
      for (const shape of shapes(token)) expect(bytes.includes(shape), file).toBe(false);
      expect(bytes.includes(Buffer.from(TOKEN_KEY)), `the sealing key in ${file}`).toBe(false);
    }
    // Only BANK_TOKEN_KEY opens it; another key, or another connection, cannot.
    expect(new TokenBox(TOKEN_KEY).open(stored.sealedKey, stored.itemId)).toBe(token);
    expect(() => new TokenBox(newTokenKey()).open(stored.sealedKey, stored.itemId)).toThrow('the stored bank key cannot be opened');
    expect(() => new TokenBox(TOKEN_KEY).open(stored.sealedKey, 'item-made-up-other')).toThrow('the stored bank key cannot be opened');
  });

  it('Phase 6 the copies Litestream puts in the bucket never hold it either', { timeout: 60_000 }, async () => {
    const r2 = await FakeR2.start();
    cleanUp.push(() => r2.close());
    const life = await connectedLife();
    const running = replicate(life.path, backupOf(r2));
    cleanUp.push(() => running.stop());
    await copied(r2, 0);
    expect(r2.objects.size).toBeGreaterThan(0);
    for (const [key, object] of r2.objects) for (const shape of shapes(life.h.fake.accessToken)) expect(object.body.includes(shape), key).toBe(false);
  });
});
