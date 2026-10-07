import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repoRoot = new URL('..', import.meta.url);

// git check-ignore exits 0 when a path is ignored and 1 when it is not.
function isIgnoredByGit(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--no-index', path], { cwd: repoRoot });
    return true;
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 1) return false;
    throw error;
  }
}

describe('safety: no secrets in the repo', () => {
  it('git ignores .env files anywhere in the project', () => {
    expect(isIgnoredByGit('.env')).toBe(true);
    expect(isIgnoredByGit('.env.local')).toBe(true);
    expect(isIgnoredByGit('packages/server/.env')).toBe(true);
  });

  it('git ignores the database, where the bank data and the sealed bank key live', () => {
    for (const path of ['data/budget.sqlite', 'packages/server/budget.sqlite', 'budget.sqlite-wal', 'budget.sqlite-shm', 'data/anything.json']) {
      expect(isIgnoredByGit(path), path).toBe(true);
    }
  });

  it('.env.example is kept in git and leaves every secret blank', () => {
    expect(isIgnoredByGit('.env.example')).toBe(false);

    const filledSecrets = readFileSync(new URL('.env.example', repoRoot), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/))
      .filter((match) => match !== null)
      .filter(([, name = '', value = '']) => /SECRET|TOKEN|KEY|PASSWORD|CLIENT_ID/.test(name) && value.trim() !== '')
      .map(([, name]) => name);

    expect(filledSecrets).toEqual([]);
  });
});
