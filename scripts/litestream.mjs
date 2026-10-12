// node scripts/litestream.mjs
//
// Phase 6: Litestream, which copies the books to Cloudflare R2 as they change
// (the backups). The server runs it on Fly.io, where the Dockerfile puts it
// in the image. This puts the same version on this computer, for the tests
// (they run it against a stand-in for R2, never a real bucket) and for npm run
// restore-check. It downloads the release from Litestream's own GitHub page
// once, checks it against the SHA-256 written below (from the release's
// checksums.txt), and keeps it outside the project, in the user's cache
// folder, so every copy of the project (break-it's too) finds it.
// Prints where it is. Run again, it does nothing.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The version, and each system's file with its SHA-256 (checksums.txt of the
// GitHub release v0.5.17, Aug 31, 2026). The Dockerfile uses the linux-x64
// one; test/hosting-config.test.ts checks they are the same.
export const LITESTREAM = {
  version: '0.5.17',
  files: {
    'win32-x64': { name: 'litestream-0.5.17-windows-x86_64.zip', sha256: '6f5532687d71c452e0099a9087e51da65f9935664fb11549abc0a5a34cb1d34e' },
    'win32-arm64': { name: 'litestream-0.5.17-windows-arm64.zip', sha256: '4760c629b43539e212fc6caf0d9c28d96f33f9a2878fd2edcd85cfebf21cea8f' },
    'linux-x64': { name: 'litestream-0.5.17-linux-x86_64.tar.gz', sha256: 'cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d' },
    'linux-arm64': { name: 'litestream-0.5.17-linux-arm64.tar.gz', sha256: 'f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5' },
    'darwin-x64': { name: 'litestream-0.5.17-darwin-x86_64.tar.gz', sha256: '891875af09db152e93a4b31a8a79f538ce7ce702c132803cfe0a831e7cb1b7db' },
    'darwin-arm64': { name: 'litestream-0.5.17-darwin-arm64.tar.gz', sha256: 'e211f68ff7658d19f193f2914417afdf8f89a053ff8f263e5d6b3b1d3bbc7b08' },
  },
};

const RELEASES = 'https://github.com/benbjohnson/litestream/releases/download';

// Where this computer keeps it.
export function litestreamPath() {
  return join(homedir(), '.cache', 'budget-app', `litestream-${LITESTREAM.version}`, process.platform === 'win32' ? 'litestream.exe' : 'litestream');
}

export async function installLitestream() {
  const target = litestreamPath();
  if (existsSync(target)) return target;
  const file = LITESTREAM.files[`${process.platform}-${process.arch}`];
  if (file === undefined) throw new Error(`Litestream ${LITESTREAM.version} has no build for ${process.platform}-${process.arch}`);
  const response = await fetch(`${RELEASES}/v${LITESTREAM.version}/${file.name}`);
  if (!response.ok) throw new Error(`could not download ${file.name}: ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(body).digest('hex');
  if (sha256 !== file.sha256) throw new Error(`${file.name} is not the release's file: its SHA-256 is ${sha256}, not ${file.sha256}. Nothing was kept.`);
  const work = mkdtempSync(join(tmpdir(), 'budget-litestream-'));
  try {
    const archive = join(work, file.name);
    writeFileSync(archive, body);
    // Windows' own tar reads zip files too; the one Git brings does not.
    const tar = process.platform === 'win32' ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    execFileSync(tar, ['-xf', archive, '-C', work], { stdio: 'inherit' });
    const unpacked = join(work, process.platform === 'win32' ? 'litestream.exe' : 'litestream');
    if (!existsSync(unpacked)) throw new Error(`${file.name} has no litestream program in it`);
    // Copied under another name, then renamed: a copy cut off halfway is never taken for the program.
    mkdirSync(join(target, '..'), { recursive: true });
    copyFileSync(unpacked, `${target}.part`);
    if (process.platform !== 'win32') chmodSync(`${target}.part`, 0o755);
    renameSync(`${target}.part`, target);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return target;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = await installLitestream();
  console.log(`Litestream ${LITESTREAM.version}: ${path}`);
}
