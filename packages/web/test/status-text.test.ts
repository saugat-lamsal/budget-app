import type { StatusView } from '@budget-app/server/views';
import { describe, expect, it } from 'vitest';
import { statusLines } from '../src/screens/status-text.js';

// Rule 0.7 (QUESTIONS.md A57): the status page in words, each line with
// whether it needs a look, so the screen shows a warning icon and the words
// say it, never colour alone. No amounts. Every time is made up.

const view = (extra: Partial<StatusView> = {}): StatusView => ({
  state: 'tracking',
  today: '2026-10-16',
  timeZone: 'America/New_York',
  lastRead: '2026-10-16T15:05:00-04:00',
  lastSync: { at: '2026-10-16T15:05:00-04:00', result: 'new' },
  backups: { copying: true, lastBeat: '2026-10-16T15:04:00-04:00' },
  started: '2026-10-16T06:00:00-04:00',
  history: { whenOpened: 63, now: 65 },
  mismatchSince: null,
  alertsWaiting: 0,
  ...extra,
});

describe('0.7 the status page in words', () => {
  it('0.7 all well: the bank read and the last sync, the backups copying, the server and its history, no difference, no alerts waiting', () => {
    expect(statusLines(view())).toEqual([
      { id: 'last-read', title: 'Bank last read', detail: '3:05 PM', look: false },
      { id: 'last-sync', title: 'Last sync', detail: '3:05 PM: new activity', look: false },
      { id: 'backups', title: 'Backups', detail: 'Copying. Last confirmed 3:04 PM.', look: false },
      { id: 'started', title: 'Server started', detail: '6:00 AM', look: false },
      { id: 'history', title: 'History', detail: '65 events kept. All 63 there when the books opened replayed to their totals; 2 since.', look: false },
      { id: 'difference', title: 'Daily check', detail: 'The totals match the bank.', look: false },
      { id: 'alerts', title: 'Alerts', detail: 'None waiting to be sent.', look: false },
    ]);
  });

  it('0.7 what needs a look says so in words: a failed sync, the bank wanting a login, backups stopped, a difference, alerts waiting', () => {
    const lines = statusLines(
      view({
        lastSync: { at: '2026-10-16T15:05:00-04:00', result: 'failed' },
        backups: { copying: false, lastBeat: '2026-10-15T23:50:00-04:00' },
        mismatchSince: '2026-10-16T09:00:00-04:00',
        alertsWaiting: 2,
      }),
    );
    const byId = new Map(lines.map((l) => [l.id, l]));
    expect(byId.get('last-sync')).toEqual({ id: 'last-sync', title: 'Last sync', detail: '3:05 PM: it failed, so nothing changed. It is tried again at the next time.', look: true });
    expect(byId.get('backups')).toEqual({ id: 'backups', title: 'Backups', detail: 'Not copying: none confirmed since Thu, Oct 15, 11:50 PM.', look: true });
    expect(byId.get('difference')).toEqual({ id: 'difference', title: 'Daily check', detail: 'The totals have not matched the bank since 9:00 AM.', look: true });
    expect(byId.get('alerts')).toEqual({ id: 'alerts', title: 'Alerts', detail: '2 waiting to be sent.', look: true });
    expect(statusLines(view({ alertsWaiting: 1 })).find((l) => l.id === 'alerts')?.detail).toBe('1 waiting to be sent.');
    expect(statusLines(view({ lastSync: { at: '2026-10-16T15:05:00-04:00', result: 'needs-login' } })).find((l) => l.id === 'last-sync')).toEqual({
      id: 'last-sync',
      title: 'Last sync',
      detail: '3:05 PM: the bank wants you to log in again.',
      look: true,
    });
    expect(statusLines(view({ lastSync: { at: '2026-10-16T15:05:00-04:00', result: 'nothing-new' } })).find((l) => l.id === 'last-sync')?.detail).toBe('3:05 PM: nothing new');
  });

  it('0.7 before anything: not read yet, no sync since the server started, no backups on this computer, no events yet', () => {
    const lines = statusLines(view({ lastRead: null, lastSync: null, backups: null, history: { whenOpened: 0, now: 0 } }));
    const byId = new Map(lines.map((l) => [l.id, l]));
    expect(byId.get('last-read')?.detail).toBe('Not read yet.');
    expect(byId.get('last-sync')?.detail).toBe('None since the server started.');
    expect(byId.get('backups')).toEqual({ id: 'backups', title: 'Backups', detail: 'None on this computer.', look: false });
    expect(byId.get('history')?.detail).toBe('No events yet.');
    expect(statusLines(view({ history: { whenOpened: 0, now: 4 } })).find((l) => l.id === 'history')?.detail).toBe('4 events kept, all since the books opened.');
    expect(statusLines(view({ history: { whenOpened: 1, now: 1 } })).find((l) => l.id === 'history')?.detail).toBe('1 event kept. It replayed to its totals when the books opened.');
    expect(statusLines(view({ history: { whenOpened: 63, now: 63 } })).find((l) => l.id === 'history')?.detail).toBe('63 events kept. All 63 replayed to their totals when the books opened.');
  });

  it('0.7 backups just started: copying, not confirmed yet', () => {
    expect(statusLines(view({ backups: { copying: true, lastBeat: null } })).find((l) => l.id === 'backups')).toEqual({ id: 'backups', title: 'Backups', detail: 'Starting. Not confirmed yet.', look: false });
    expect(statusLines(view({ backups: { copying: false, lastBeat: null } })).find((l) => l.id === 'backups')).toEqual({ id: 'backups', title: 'Backups', detail: 'Not copying: none confirmed since the server started.', look: true });
  });

  it('0.7 times on another day say the day', () => {
    expect(statusLines(view({ started: '2026-10-14T06:00:00-04:00' })).find((l) => l.id === 'started')?.detail).toBe('Wed, Oct 14, 6:00 AM');
  });

  it('0.7 no amounts: no line has a dollar sign', () => {
    for (const line of statusLines(view({ alertsWaiting: 3, mismatchSince: '2026-10-16T09:00:00-04:00' }))) expect(`${line.title} ${line.detail}`).not.toContain('$');
  });
});
