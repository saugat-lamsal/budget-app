import { describe, expect, it } from 'vitest';
import { APP, CHECK_COMMAND, deployCheck, labelFor } from '../scripts/deploy-check-lib.mjs';

// The deploy check (QUESTIONS.md A50a), against a stand-in for flyctl: no
// command here reaches Fly. Each test says what flyctl answers; the check's
// steps, its answer, and what it removes are checked.

interface Answer {
  readonly code: number;
  readonly out: string;
  readonly stdout?: string;
}

const LABEL = 'deploy-check-20261014t230000z';
const IMAGE = `registry.fly.io/${APP}:${LABEL}`;
const THE_APP_MACHINE = { id: 'machine-of-the-app', config: { image: `registry.fly.io/${APP}:deployment-01made-up` } };

function standIn(answers: { build?: Answer; check?: Answer; list?: Answer }) {
  const calls: string[][] = [];
  const said: string[] = [];
  const run = async (args: readonly string[]): Promise<Answer> => {
    calls.push([...args]);
    if (args[0] === 'deploy') return answers.build ?? { code: 0, out: 'image pushed' };
    if (args[0] === 'console') return answers.check ?? { code: 0, out: 'The file is whole.\nHistory: 12 events.\nThe backup works.\n' };
    if (args[0] === 'machines') return answers.list ?? { code: 0, out: '', stdout: JSON.stringify([THE_APP_MACHINE]) };
    return { code: 0, out: '' };
  };
  return { calls, said, check: () => deployCheck({ run, say: (l: string) => said.push(l), label: LABEL }) };
}

describe('A50a the deploy check, against a stand-in for fly', () => {
  it('A50a builds and pushes the new image without deploying it, then runs the restore check on a new machine from it, with no volume and no ports', async () => {
    const s = standIn({});
    expect(await s.check()).toEqual({ ok: true, lastLine: 'The backup works.', image: IMAGE });
    expect(s.calls[0]).toEqual(['deploy', '--app', APP, '--build-only', '--push', '--remote-only', '--image-label', LABEL]);
    expect(s.calls[1]).toEqual(['console', '--app', APP, '--image', IMAGE, '--vm-size', 'shared-cpu-1x', '--vm-memory', '512', '-C', CHECK_COMMAND]);
    expect(CHECK_COMMAND).toBe('node /app/serve/restore-check.mjs');
    for (const call of s.calls) {
      expect(call).not.toContain('--volume');
      expect(call).not.toContain('-p');
      expect(call).not.toContain('--port');
    }
    // Only the build, the check, and the look for leftovers: nothing is deployed.
    expect(s.calls.map((c) => c[0])).toEqual(['deploy', 'console', 'machines']);
  });

  it('A50a a check that does not say the backup works stops the deploy, with its last line', async () => {
    const s = standIn({ check: { code: 1, out: 'The file is whole.\nEvent 41 replays differently: wants 120.00, was 100.00.\n' } });
    expect(await s.check()).toEqual({ ok: false, lastLine: 'Event 41 replays differently: wants 120.00, was 100.00.', image: IMAGE });
  });

  it('A50a exit 0 alone is not enough: the last line must say the backup works', async () => {
    expect((await standIn({ check: { code: 0, out: 'History: nothing yet.\n' } }).check()).ok).toBe(false);
    expect((await standIn({ check: { code: 1, out: 'The backup works.\n' } }).check()).ok).toBe(false);
    expect((await standIn({ check: { code: 0, out: '' } }).check())).toMatchObject({ ok: false, lastLine: '(the check printed nothing)' });
  });

  it('A50a an image that does not build runs no check and stops the deploy', async () => {
    const s = standIn({ build: { code: 1, out: 'build failed' } });
    expect(await s.check()).toEqual({ ok: false, lastLine: 'The image did not build.', image: IMAGE });
    expect(s.calls.map((c) => c[0])).toEqual(['deploy', 'machines']);
  });

  it('A50a a machine left from the check\'s image is removed whatever happened; the app\'s own machine never is', async () => {
    const left = { id: 'left-behind', config: { image: IMAGE } };
    const withDigest = { id: 'left-with-digest', config: { image: `${IMAGE}@sha256:${'a'.repeat(64)}` } };
    const other = { id: 'other-label', config: { image: `${IMAGE}-other` } };
    const s = standIn({ check: { code: 1, out: 'Could not reach the backup.\n' }, list: { code: 0, out: 'a warning', stdout: JSON.stringify([THE_APP_MACHINE, left, withDigest, other]) } });
    expect((await s.check()).ok).toBe(false);
    const destroyed = s.calls.filter((c) => c[0] === 'machine').map((c) => c[2]);
    expect(destroyed).toEqual(['left-behind', 'left-with-digest']);
    expect(s.calls.filter((c) => c[0] === 'machine').every((c) => c[1] === 'destroy' && c.includes('--force'))).toBe(true);
  });

  it('A50a a stand-in run that throws still looks for leftovers', async () => {
    const calls: string[][] = [];
    const run = async (args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] === 'console') throw new Error('lost the connection');
      if (args[0] === 'machines') return { code: 0, out: '', stdout: JSON.stringify([{ id: 'left-behind', config: { image: IMAGE } }]) };
      return { code: 0, out: '' };
    };
    await expect(deployCheck({ run, say: () => undefined, label: LABEL })).rejects.toThrow('lost the connection');
    expect(calls.map((c) => c[0])).toEqual(['deploy', 'console', 'machines', 'machine']);
  });

  // Its first real run (Oct 15, 2026): the image was built and pushed, fly
  // console found it, and the machine could not start from it, Fly's registry
  // saying the new label was not known yet ("manifest unknown"). The same
  // command a few minutes later ran the check. No machine was made.
  it('A50a a new label Fly\'s registry does not know yet: the check is tried again after a wait, at most 3 times in all; any other failure is not', async () => {
    const notYet: Answer = { code: 1, out: `image found: img_madeup\nError: failed to launch VM: failed to get manifest registry.fly.io/${APP}:${LABEL}: request failed: not found [http 404]: {"errors":[{"code":"MANIFEST_UNKNOWN","message":"manifest unknown"}]}\n` };
    const works: Answer = { code: 0, out: 'History: 12 events.\nThe backup works.\n' };
    const tries = (answers: readonly Answer[]) => {
      const calls: string[][] = [];
      const waits: number[] = [];
      const left = [...answers];
      const run = async (args: readonly string[]): Promise<Answer> => {
        calls.push([...args]);
        if (args[0] === 'console') return left.shift() ?? works;
        if (args[0] === 'machines') return { code: 0, out: '', stdout: JSON.stringify([THE_APP_MACHINE]) };
        return { code: 0, out: 'image pushed' };
      };
      const wait = async (ms: number) => {
        waits.push(ms);
      };
      return { calls, waits, check: () => deployCheck({ run, say: () => undefined, label: LABEL, wait }) };
    };
    const twice = tries([notYet, works]);
    expect(await twice.check()).toEqual({ ok: true, lastLine: 'The backup works.', image: IMAGE });
    expect(twice.calls.map((c) => c[0])).toEqual(['deploy', 'console', 'console', 'machines']);
    expect(twice.waits).toEqual([30_000]);
    // The same command each time.
    expect(twice.calls[2]).toEqual(twice.calls[1]);

    const never = tries([notYet, notYet, notYet, works]);
    expect(await never.check()).toMatchObject({ ok: false });
    expect(never.calls.filter((c) => c[0] === 'console')).toHaveLength(3);
    expect(never.waits).toEqual([30_000, 30_000]);

    // A check that ran and failed is never tried again.
    const failed = tries([{ code: 1, out: 'Event 41 replays differently: wants 120.00, was 100.00.\n' }]);
    expect(await failed.check()).toMatchObject({ ok: false, lastLine: 'Event 41 replays differently: wants 120.00, was 100.00.' });
    expect(failed.calls.filter((c) => c[0] === 'console')).toHaveLength(1);
    expect(failed.waits).toEqual([]);
  });

  it('A50a the label is the time, so no machine of the app already runs it', () => {
    expect(labelFor(new Date('2026-10-14T23:00:00.123Z'))).toBe(LABEL);
  });
});
