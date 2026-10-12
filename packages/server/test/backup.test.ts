import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { backupLock, endpointProblem } from '../src/backup/backup-lock.js';
import { backupFromEnv, litestreamEnv, withoutBackup } from '../src/backup/backup.js';
import { checkOneMachine, machinesIn } from '../src/serve/one-machine.js';
import { hostedSettings } from '../src/serve/start.js';

// Phase 6, the backups and the one machine: the settings, checked before
// anything starts. Every address, name and key is made up.

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const R2 = `https://${ACCOUNT}.r2.cloudflarestorage.com`;
const BACKUP = { R2_ENDPOINT: R2, R2_BUCKET: 'made-up-books', R2_ACCESS_KEY_ID: 'MADEUPKEYID', R2_SECRET_ACCESS_KEY: 'made-up-secret-access-key-0123456789' };
const HOSTED = { APP_ORIGIN: 'https://made-up-budget.fly.dev', BUDGET_DB: '/data/budget.sqlite' };

describe('Phase 6 where the backups may go', () => {
  it('Phase 6 outside the tests, only an R2 account\'s own https address (or its EU one), with nothing after it', () => {
    expect(endpointProblem(R2, 'r2')).toBeNull();
    expect(endpointProblem(`${R2}/`, 'r2')).toBeNull();
    expect(endpointProblem(`https://${ACCOUNT}.eu.r2.cloudflarestorage.com`, 'r2')).toBeNull();
    expect(endpointProblem(`https://${ACCOUNT.toUpperCase()}.r2.cloudflarestorage.com`, 'r2')).toBeNull();
    for (const bad of [
      '',
      '   ',
      `http://${ACCOUNT}.r2.cloudflarestorage.com`,
      `${R2}/made-up-books`,
      `${R2}:8443`,
      `${R2}?x=1`,
      `https://key:secret@${ACCOUNT}.r2.cloudflarestorage.com`,
      'https://r2.cloudflarestorage.com',
      `https://${ACCOUNT}.r2.cloudflarestorage.com.elsewhere.example`,
      `https://abc.r2.cloudflarestorage.com`,
      'https://s3.amazonaws.com',
      'http://127.0.0.1:9000',
      'not an address',
    ]) {
      expect(endpointProblem(bad, 'r2'), bad).toContain('R2_ENDPOINT must be the bucket\'s S3 address from Cloudflare');
    }
  });

  it('Phase 6 under the tests, this computer only, whatever is asked: R2 itself is refused', () => {
    expect(backupLock({ VITEST: 'true' })).toBe('this-computer');
    expect(backupLock({ BACKUP_LOCK: 'this-computer' })).toBe('this-computer');
    // Under the tests the process's own environment has VITEST: no environment handed over loosens it.
    expect(backupLock({})).toBe('this-computer');
    expect(backupLock({ BACKUP_LOCK: 'r2' })).toBe('this-computer');
    expect(backupLock()).toBe('this-computer');
    expect(endpointProblem('http://127.0.0.1:9000', 'this-computer')).toBeNull();
    for (const bad of [R2, 'https://127.0.0.1:9000', 'http://localhost:9000', 'http://10.0.0.2:9000', '']) expect(endpointProblem(bad, 'this-computer'), bad).toBe('Under the tests the books are copied to this computer only.');
  });

  it('Phase 6 the backup is read from the environment: all four, or none; partly set says what is missing, without the key', () => {
    expect(backupFromEnv({})).toBeNull();
    expect(backupFromEnv({ R2_ENDPOINT: ' ', R2_BUCKET: '' }, 'r2')).toBeNull();
    const backup = backupFromEnv(BACKUP, 'r2');
    expect(backup).toEqual({ endpoint: R2, bucket: 'made-up-books', accessKeyId: 'MADEUPKEYID', secretAccessKey: BACKUP.R2_SECRET_ACCESS_KEY });
    expect(() => backupFromEnv({ ...BACKUP, R2_ACCESS_KEY_ID: '', R2_BUCKET: '' }, 'r2')).toThrow('the backup is only partly set: R2_BUCKET, R2_ACCESS_KEY_ID are missing');
    expect(() => backupFromEnv({ ...BACKUP, R2_ENDPOINT: 'https://s3.amazonaws.com' }, 'r2')).toThrow('R2_ENDPOINT must be');
    for (const bucket of ['Made-Up', 'ab', 'made_up', '-made-up', 'made-up-', 'x'.repeat(64)]) expect(() => backupFromEnv({ ...BACKUP, R2_BUCKET: bucket }, 'r2'), bucket).toThrow('R2_BUCKET must be the bucket\'s name');
    // Printed or logged, the key is not there.
    expect(JSON.stringify(backup)).not.toContain(BACKUP.R2_SECRET_ACCESS_KEY);
    expect(JSON.stringify(backup)).not.toContain(BACKUP.R2_ACCESS_KEY_ID);
    expect(inspect(backup)).not.toContain(BACKUP.R2_SECRET_ACCESS_KEY);
    expect(String(backup)).not.toContain(BACKUP.R2_SECRET_ACCESS_KEY);
  });

  it('Phase 6 Litestream is given the books\' path and the backup, and none of the server\'s other keys; the server is given none of the backup\'s', () => {
    const env = { ...BACKUP, R2_ENDPOINT: 'http://127.0.0.1:9000', ...HOSTED, PATH: '/usr/bin', HOME: '/root', BANK_TOKEN_KEY: 'made-up-bank-key', PLAID_CLIENT_ID: 'made-up-id', PLAID_SECRET: 'made-up-secret', VAPID_PRIVATE_KEY: 'made-up-private', VAPID_PUBLIC_KEY: 'made-up-public', LITESTREAM_SECRET_ACCESS_KEY: 'another', LITESTREAM_ACCESS_KEY_ID: 'another-id' };
    const backup = backupFromEnv(env);
    if (backup === null) throw new Error('no backup');
    expect(litestreamEnv('/data/budget.sqlite', backup, env)).toEqual({ PATH: '/usr/bin', HOME: '/root', BUDGET_DB: '/data/budget.sqlite', ...BACKUP, R2_ENDPOINT: 'http://127.0.0.1:9000' });
    // An R2 address is refused right before Litestream would run, even if it got this far.
    const r2 = backupFromEnv(BACKUP, 'r2');
    if (r2 === null) throw new Error('no backup');
    expect(() => litestreamEnv('/data/budget.sqlite', r2, {})).toThrow('Under the tests the books are copied to this computer only.');
    const server = withoutBackup(env);
    for (const name of [...Object.keys(BACKUP), 'LITESTREAM_SECRET_ACCESS_KEY', 'LITESTREAM_ACCESS_KEY_ID']) expect(server, name).not.toHaveProperty(name);
    expect(server).toMatchObject({ BANK_TOKEN_KEY: 'made-up-bank-key', PLAID_SECRET: 'made-up-secret', APP_ORIGIN: HOSTED.APP_ORIGIN });
  });

  it('Phase 6 the hosted server does not start without its https address, the books\' path on the volume, or a backup', () => {
    expect(() => hostedSettings({ ...BACKUP, BUDGET_DB: '/data/budget.sqlite' })).toThrow('APP_ORIGIN is not set');
    expect(() => hostedSettings({ ...BACKUP, APP_ORIGIN: HOSTED.APP_ORIGIN })).toThrow('BUDGET_DB is not set');
    expect(() => hostedSettings({ ...HOSTED })).toThrow('no backup is set: the hosted server does not run without one');
    // A real R2 address: refused under the tests.
    expect(() => hostedSettings({ ...HOSTED, ...BACKUP })).toThrow('Under the tests the books are copied to this computer only.');
    expect(() => hostedSettings({ ...HOSTED, ...BACKUP, APP_ORIGIN: 'http://made-up-budget.fly.dev' })).toThrow('APP_ORIGIN must be');
    expect(hostedSettings({ ...HOSTED, ...BACKUP, R2_ENDPOINT: 'http://127.0.0.1:9000' })).toMatchObject({ db: '/data/budget.sqlite', backup: { endpoint: 'http://127.0.0.1:9000' } });
  });
});

describe('Phase 6 only ever one machine', () => {
  it('Phase 6 Fly\'s list of the app\'s machines is read as it comes: "<id> <region>" pairs, split by commas, in one or more pieces', () => {
    expect(machinesIn([['1781973f6e9989 ewr']])).toEqual(['1781973f6e9989']);
    expect(machinesIn([['1781973f6e9989 ewr,e784079b449483 ord']])).toEqual(['1781973f6e9989', 'e784079b449483']);
    expect(machinesIn([['1781973f6e9989 ewr,e7840', '79b449483 ord']])).toEqual(['1781973f6e9989', 'e784079b449483']);
    expect(machinesIn([])).toEqual([]);
    expect(machinesIn([['']])).toEqual([]);
  });

  it('Phase 6 with one machine it starts; with two (or more) nothing starts, and it says how to put it right', async () => {
    const asked: string[] = [];
    const answer = (records: string[][]) => (name: string) => {
      asked.push(name);
      return Promise.resolve(records);
    };
    expect(await checkOneMachine({ FLY_APP_NAME: 'made-up-budget' }, answer([['1781973f6e9989 ewr']]))).toEqual({ problem: null, note: null });
    expect(asked).toEqual(['vms.made-up-budget.internal']);
    const two = await checkOneMachine({ FLY_APP_NAME: 'made-up-budget' }, answer([['1781973f6e9989 ewr,e784079b449483 ewr']]));
    expect(two.problem).toBe(
      'this app has 2 machines (1781973f6e9989, e784079b449483), and only one may run: the books are one SQLite file on one volume. Nothing was started here. See them with fly machine list, and remove the one made by mistake with fly machine destroy <its id> (the books are on the older one\'s volume, and in the backup).',
    );
    expect((await checkOneMachine({ FLY_APP_NAME: 'made-up-budget' }, answer([['a ewr,b ord,c iad']]))).problem).toContain('this app has 3 machines');
  });

  it('Phase 6 off Fly there is nothing to ask; if Fly\'s DNS cannot be asked, it starts and says so', async () => {
    const never = (): Promise<string[][]> => {
      throw new Error('not asked');
    };
    expect(await checkOneMachine({}, never)).toEqual({ problem: null, note: null });
    expect(await checkOneMachine({ FLY_APP_NAME: '' }, never)).toEqual({ problem: null, note: null });
    const down = await checkOneMachine({ FLY_APP_NAME: 'made-up-budget' }, () => Promise.reject(new Error('queryTxt ETIMEOUT vms.made-up-budget.internal')));
    expect(down).toEqual({ problem: null, note: 'could not ask Fly which machines the app has (queryTxt ETIMEOUT vms.made-up-budget.internal); starting' });
  });
});
