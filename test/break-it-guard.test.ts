import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Older versions of scripts/break-it.mjs broke a source file in this folder on
// purpose and kept the untouched copy next to it as <file>.break-it-backup
// until they put the file back. A backup left behind means such a run was
// stopped while that file was broken: `node scripts/break-it.mjs --restore`
// puts it back. The current version breaks files only in its own copies of
// the code, outside this folder, and leaves no backup here. A run of an older
// version names its own backup in BREAK_IT_BACKUP while it runs the tests,
// and only that one is let through.
const root = fileURLToPath(new URL('../', import.meta.url));

function backupsUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '.git') return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return backupsUnder(path);
    return entry.name.endsWith('.break-it-backup') ? [relative(root, path).split(sep).join('/')] : [];
  });
}

describe('safety: no deliberate break is left in the code', () => {
  it('no break-it backup is left behind', () => {
    const leftovers = backupsUnder(root).filter((path) => path !== process.env['BREAK_IT_BACKUP']);
    expect(
      leftovers,
      'A break-it run was stopped while these files were broken on purpose. Run `node scripts/break-it.mjs --restore` to put them back.',
    ).toEqual([]);
  });
});
