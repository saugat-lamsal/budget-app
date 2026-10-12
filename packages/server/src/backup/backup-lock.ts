// Phase 6, the backups: where Litestream may copy the books. Cloudflare R2
// only: https, at an account's own S3 address (<account id>.r2.cloudflarestorage.com,
// or its EU one), with nothing after it. Under the tests (vitest sets VITEST)
// this computer only, whatever a test asks for, so no test can reach a real
// bucket (test/backup-only-here.test.ts checks). BACKUP_LOCK=this-computer
// makes it this computer only anywhere (the image check in CI): the lock can
// only be made tighter, never looser.

// The account id is 32 hexadecimal characters.
const R2_HOST = /^[0-9a-f]{32}\.(eu\.)?r2\.cloudflarestorage\.com$/;
const THIS_COMPUTER = /^127\.0\.0\.1$/;

export type BackupLock = 'r2' | 'this-computer';

// The process's own environment counts whatever is passed: a test cannot
// loosen the lock by handing over an environment of its own.
export function backupLock(env: Readonly<Record<string, string | undefined>> = process.env): BackupLock {
  const tight = (e: Readonly<Record<string, string | undefined>>): boolean => e['VITEST'] !== undefined || e['BACKUP_LOCK'] === 'this-computer';
  return tight(env) || tight(process.env) ? 'this-computer' : 'r2';
}

// Why an address is not one the books may be copied to; null when it is.
export function endpointProblem(endpoint: unknown, lock: BackupLock): string | null {
  const r2 = 'R2_ENDPOINT must be the bucket\'s S3 address from Cloudflare, such as https://<account id>.r2.cloudflarestorage.com, without the bucket name after it';
  if (typeof endpoint !== 'string' || endpoint.trim() === '') return lock === 'r2' ? r2 : 'Under the tests the books are copied to this computer only.';
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return r2;
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || (url.pathname !== '/' && url.pathname !== '')) return r2;
  if (lock === 'this-computer') return url.protocol === 'http:' && THIS_COMPUTER.test(url.hostname) ? null : 'Under the tests the books are copied to this computer only.';
  return url.protocol === 'https:' && url.port === '' && R2_HOST.test(url.hostname.toLowerCase()) ? null : r2;
}
